import { type Actor, actorRef } from "./access";

/**
 * Reemplazo en el navegador de NOTIFY + SSE (tiempo real) y del outbox de eventos que procesa
 * el worker. Los mensajes se encolan durante la operación y se entregan al terminar, igual que
 * NOTIFY se entrega al hacer commit.
 */

export const DOMAIN_EVENT_TYPES = ["task.created", "task.moved", "branch.created", "pr.opened", "pr.merged"] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export const projectChannel = (projectId: string) => `project:${projectId}`;
export const userChannel = (userId: string) => `user:${userId}`;

export type RealtimeMessage =
  | { type: "board"; taskIds?: string[] }
  | { type: "task"; taskId: string }
  | { type: "project" }
  | { type: "automation" }
  | { type: "notification" }
  | { type: "projects" };

export type RealtimeEnvelope = RealtimeMessage & { channel: string; origin?: string | null };

type Listener = (envelope: RealtimeEnvelope) => void;
const listeners = new Map<string, Set<Listener>>();
let outgoing: RealtimeEnvelope[] = [];

export function publish(channel: string, message: RealtimeMessage, actor?: Actor) {
  const origin = actor?.type === "user" ? (actor.clientId ?? null) : null;
  outgoing.push({ ...message, channel, origin });
}

export function subscribeRealtime(channels: string[], listener: Listener) {
  for (const channel of channels) {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(listener);
  }
  return () => {
    for (const channel of channels) listeners.get(channel)?.delete(listener);
  };
}

// ─── Outbox de eventos de dominio (lo que procesa el worker del original) ───

export type DomainEvent = {
  id: number;
  projectId: string;
  type: DomainEventType;
  taskId: string | null;
  actorType: Actor["type"];
  actorId: string | null;
  payload: Record<string, unknown>;
  depth: number;
  ruleChain: string[];
};

let pendingEvents: DomainEvent[] = [];
let eventSeq = 0;

export function emitDomainEvent(input: {
  projectId: string;
  type: DomainEventType;
  taskId?: string | null;
  actor: Actor;
  payload?: Record<string, unknown>;
}) {
  const { actor } = input;
  pendingEvents.push({
    id: ++eventSeq,
    projectId: input.projectId,
    type: input.type,
    taskId: input.taskId ?? null,
    actorType: actor.type,
    actorId: actorRef(actor),
    payload: input.payload ?? {},
    depth: actor.type === "automation" ? actor.depth : 0,
    ruleChain: actor.type === "automation" ? actor.chain : [],
  });
}

let worker: ((event: DomainEvent) => void) | null = null;
let workerTimer: ReturnType<typeof setTimeout> | null = null;

/** El "worker" de la demo: corre las automatizaciones un instante después del cambio. */
export function registerWorker(fn: (event: DomainEvent) => void) {
  worker = fn;
}

function scheduleWorker() {
  if (workerTimer || pendingEvents.length === 0 || !worker) return;
  workerTimer = setTimeout(() => {
    workerTimer = null;
    // Los eventos que generen las reglas se procesan en la misma pasada (cadenas de reglas).
    while (pendingEvents.length) {
      const event = pendingEvents.shift()!;
      try {
        worker?.(event);
      } catch (err) {
        console.warn("[demo] automatización", err);
      }
    }
    deliver();
  }, 700);
}

/** Al terminar una operación: entrega los mensajes de tiempo real y despierta al worker. */
export function commit() {
  deliver();
  scheduleWorker();
}

/** La operación falló: nada de lo encolado sale. */
export function rollback() {
  outgoing = [];
  pendingEvents = [];
}

function deliver() {
  const batch = outgoing;
  outgoing = [];
  if (batch.length === 0) return;
  setTimeout(() => {
    for (const envelope of batch) {
      for (const listener of listeners.get(envelope.channel) ?? []) listener(envelope);
    }
  }, 0);
}

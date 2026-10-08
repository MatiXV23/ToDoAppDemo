import { type Action, ruleInputSchema, type TriggerType } from "@/lib/automation-schema";
import type { Actor } from "../access";
import { db, type RuleRow, transaction, uuid } from "../db";
import { type DomainEvent, projectChannel, publish } from "../events";
import { addComment } from "../services/comments";
import { moveTaskToColumn, updateTask } from "../services/tasks";
import { type EngineEvent, type EngineRule, type Labels, planRun, renderTemplate, type TaskSnapshot } from "./engine";

/** Ejecutor de reglas: el mismo flujo que el worker del original, sobre la base de la demo. */

export function loadTaskSnapshot(taskId: string): TaskSnapshot | null {
  const d = db();
  const task = d.tasks.find((t) => t.id === taskId && !t.deletedAt);
  if (!task) return null;
  const project = d.projects.find((p) => p.id === task.projectId)!;
  return {
    id: task.id,
    number: task.number,
    title: task.title,
    projectKey: project.key,
    columnId: task.columnId,
    priority: task.priority,
    epicId: task.epicId,
    assigneeId: task.assigneeId,
    parentId: task.parentId,
    dueDate: task.dueDate,
    tagIds: d.taskTags.filter((tt) => tt.taskId === task.id).map((tt) => tt.tagId),
  };
}

function loadLabels(projectId: string): Labels {
  const d = db();
  const columns = new Map(d.columns.filter((c) => c.projectId === projectId).map((c) => [c.id, c.name]));
  const tagNames = new Map(d.tags.filter((t) => t.projectId === projectId).map((t) => [t.id, t.name]));
  const epicNames = new Map(d.epics.filter((e) => e.projectId === projectId).map((e) => [e.id, e.title]));
  const users = new Map(
    d.members.filter((m) => m.projectId === projectId).map((m) => [m.userId, d.users.find((u) => u.id === m.userId)?.name ?? ""]),
  );
  return {
    column: (id) => (id ? (columns.get(id) ?? "columna borrada") : "—"),
    tag: (id) => tagNames.get(id) ?? "tag borrado",
    epic: (id) => (id ? (epicNames.get(id) ?? "epic borrado") : "sin epic"),
    user: (id) => (id ? (users.get(id) ?? "usuario desconocido") : "sin responsable"),
  };
}

type ActionResult = { action: Action; ok: boolean; changed: boolean; message: string };

function executeAction(actor: Actor, action: Action, task: TaskSnapshot, event: EngineEvent, labels: Labels): ActionResult {
  try {
    switch (action.type) {
      case "move_to_column": {
        const { changed } = moveTaskToColumn(actor, task.id, action.columnId);
        return {
          action,
          ok: true,
          changed,
          message: changed ? `Movida a ${labels.column(action.columnId)}` : `Ya estaba en ${labels.column(action.columnId)}`,
        };
      }
      case "assign": {
        const current = loadTaskSnapshot(task.id);
        if (current?.assigneeId === action.userId) {
          return { action, ok: true, changed: false, message: `Ya estaba asignada a ${labels.user(action.userId)}` };
        }
        updateTask(actor, { taskId: task.id, assigneeId: action.userId });
        return { action, ok: true, changed: true, message: `Asignada a ${labels.user(action.userId)}` };
      }
      case "add_tag":
      case "remove_tag": {
        const current = loadTaskSnapshot(task.id)?.tagIds ?? [];
        const has = current.includes(action.tagId);
        if ((action.type === "add_tag" && has) || (action.type === "remove_tag" && !has)) {
          return { action, ok: true, changed: false, message: `Sin cambios en el tag ${labels.tag(action.tagId)}` };
        }
        const tagIds = action.type === "add_tag" ? [...current, action.tagId] : current.filter((t) => t !== action.tagId);
        updateTask(actor, { taskId: task.id, tagIds });
        return {
          action,
          ok: true,
          changed: true,
          message: `${action.type === "add_tag" ? "Agregado" : "Quitado"} el tag ${labels.tag(action.tagId)}`,
        };
      }
      case "add_comment": {
        addComment(actor, { taskId: task.id, bodyMd: renderTemplate(action.body, task, event.payload) });
        return { action, ok: true, changed: true, message: "Comentario agregado" };
      }
    }
  } catch (err) {
    return { action, ok: false, changed: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function recordRun(input: {
  id?: string;
  rule: RuleRow;
  event: EngineEvent;
  eventId: number | null;
  taskId: string | null;
  status: "success" | "skipped" | "failed";
  reason: string | null;
  details: Record<string, unknown>;
}) {
  transaction(() => {
    db().runs.push({
      id: input.id ?? uuid(),
      ruleId: input.rule.id,
      projectId: input.rule.projectId,
      taskId: input.taskId,
      eventId: input.eventId,
      triggerType: input.event.type,
      status: input.status,
      reason: input.reason,
      details: input.details,
      depth: input.event.depth,
      createdAt: new Date(),
    });
  });
}

export function runRule(rule: RuleRow, event: EngineEvent, eventId: number | null, labels?: Labels) {
  const parsed = ruleInputSchema.safeParse({ ...rule });
  if (!parsed.success) {
    recordRun({ rule, event, eventId, taskId: event.taskId, status: "failed", reason: "La regla tiene una configuración inválida", details: {} });
    return;
  }
  const task = loadTaskSnapshot(event.taskId);
  if (!task) {
    recordRun({ rule, event, eventId, taskId: null, status: "skipped", reason: "La tarea ya no existe", details: {} });
    return;
  }
  const l = labels ?? loadLabels(rule.projectId);
  const engineRule: EngineRule = { ...parsed.data, id: rule.id };
  const plan = planRun(engineRule, event, task, l);
  const eventDetails = { type: event.type, payload: event.payload, depth: event.depth };
  if (plan.decision === "skip") {
    recordRun({
      rule,
      event,
      eventId,
      taskId: task.id,
      status: "skipped",
      reason: plan.reason,
      details: { event: eventDetails, conditions: plan.conditions.map(({ description, actual, passed }) => ({ description, actual, passed })) },
    });
    return;
  }
  const runId = uuid();
  const actor: Actor = { type: "automation", ruleId: rule.id, runId, depth: event.depth + 1, chain: [...event.ruleChain, rule.id] };
  const results = plan.actions.map((action) => executeAction(actor, action, task, event, l));
  const failed = results.filter((r) => !r.ok);
  recordRun({
    id: runId,
    rule,
    event,
    eventId,
    taskId: task.id,
    status: failed.length ? "failed" : "success",
    reason: failed.length ? `Falló: ${failed.map((f) => f.message).join("; ")}` : null,
    details: {
      event: eventDetails,
      conditions: plan.conditions.map(({ description, actual, passed }) => ({ description, actual, passed })),
      actions: results.map(({ action, ok, changed, message }) => ({ type: action.type, ok, changed, message })),
    },
  });
}

/** Punto de entrada del "worker" de la demo para cada evento. */
export function handleDomainEvent(event: DomainEvent) {
  if (!event.taskId) return;
  const rules = db()
    .rules.filter((r) => r.projectId === event.projectId && r.enabled && (r.trigger as { type?: string })?.type === event.type)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (rules.length === 0) return;
  const engineEvent: EngineEvent = {
    type: event.type as TriggerType,
    taskId: event.taskId,
    payload: event.payload,
    depth: event.depth,
    ruleChain: event.ruleChain,
  };
  const labels = loadLabels(event.projectId);
  for (const rule of rules) runRule(rule, engineEvent, event.id, labels);
  publish(projectChannel(event.projectId), { type: "automation" });
}

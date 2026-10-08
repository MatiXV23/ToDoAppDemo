import { db } from "./db";
import { forbidden, notFound } from "./errors";
import { type Action, can, type Role } from "./permissions";

/** Quién ejecuta una operación. Las automatizaciones e integraciones no tienen rol propio. */
export type Actor =
  | { type: "user"; userId: string; clientId?: string | null; via?: string | null; external?: boolean }
  | { type: "automation"; ruleId: string; runId: string; depth: number; chain: string[] }
  | { type: "integration"; provider: string }
  | { type: "system" };

export const systemActor: Actor = { type: "system" };

export function actorUserId(actor: Actor): string | null {
  return actor.type === "user" ? actor.userId : null;
}

/** Id que se guarda en historial y eventos para identificar al actor. */
export function actorRef(actor: Actor): string | null {
  switch (actor.type) {
    case "user":
      return actor.userId;
    case "automation":
      return actor.ruleId;
    case "integration":
      return actor.provider;
    case "system":
      return null;
  }
}

export function getRole(projectId: string, userId: string): Role | null {
  return db().members.find((m) => m.projectId === projectId && m.userId === userId)?.role ?? null;
}

/**
 * Igual que en el original: un no miembro recibe NOT_FOUND (no se revela que el proyecto
 * existe) y un miembro sin permiso, FORBIDDEN.
 */
export function authorize(actor: Actor, projectId: string, action: Action): Role | null {
  if (actor.type !== "user") return null;
  const role = getRole(projectId, actor.userId);
  if (!role) throw notFound("Proyecto");
  if (!can(role, action)) throw forbidden();
  return role;
}

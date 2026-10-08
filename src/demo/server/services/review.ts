import { type Actor, authorize } from "../access";
import { db, transaction } from "../db";
import { badRequest, forbidden, notFound } from "../errors";
import { projectChannel, publish } from "../events";
import { logActivity } from "./activity";

/**
 * Aprobación de tareas que llegan por tokens externos. En la demo las tareas "Por aprobar"
 * vienen en los datos de ejemplo (creadas por el "Portal de reportes").
 */

export const isExternalActor = (actor: Actor) => actor.type === "user" && !!actor.external;

export function requestReviewIfExternal(actor: Actor, taskIds: string[]) {
  if (!isExternalActor(actor) || taskIds.length === 0) return;
  const d = db();
  const parents = d.tasks.filter((t) => taskIds.includes(t.id) && t.parentId).map((t) => t.parentId!);
  const ids = new Set([...taskIds, ...parents]);
  const changed = d.tasks.filter((t) => ids.has(t.id) && t.reviewStatus !== "pending");
  for (const t of changed) {
    t.reviewStatus = "pending";
    t.reviewedById = null;
    t.reviewedAt = null;
  }
  logActivity(
    actor,
    changed.map((t) => ({ taskId: t.id, projectId: t.projectId, kind: "review" as const, field: "requested" })),
  );
}

/** Aprueba (o vuelve a dejar pendiente) una tarea. Solo una persona desde la app, nunca un token. */
export function setTaskApproval(actor: Actor, taskId: string, approved: boolean) {
  if (actor.type !== "user" || actor.via) throw forbidden("Las tareas se aprueban desde la app, no por API");
  return transaction(() => {
    const task = db().tasks.find((t) => t.id === taskId && !t.deletedAt);
    if (!task) throw notFound("Tarea");
    authorize(actor, task.projectId, "task.update");
    if (!task.reviewStatus) throw badRequest("Esta tarea no necesita aprobación");
    const next = approved ? "approved" : "pending";
    if (task.reviewStatus === next) return;
    task.reviewStatus = next;
    task.reviewedById = approved ? actor.userId : null;
    task.reviewedAt = approved ? new Date() : null;
    logActivity(actor, [{ taskId: task.id, projectId: task.projectId, kind: "review", field: approved ? "approved" : "revoked" }]);
    publish(projectChannel(task.projectId), { type: "board", taskIds: [task.id] }, actor);
    publish(projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
  });
}

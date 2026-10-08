import { type Actor, actorRef } from "../access";
import { db, uuid } from "../db";

export type ActivityEntry = {
  taskId: string;
  projectId: string;
  kind:
    | "created"
    | "updated"
    | "moved"
    | "deleted"
    | "restored"
    | "linked"
    | "unlinked"
    | "attached"
    | "detached"
    | "agent"
    | "review";
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
};

export function logActivity(actor: Actor, entries: ActivityEntry[]) {
  const now = new Date();
  for (const e of entries) {
    db().activity.push({
      id: uuid(),
      taskId: e.taskId,
      projectId: e.projectId,
      actorType: actor.type,
      actorId: actorRef(actor),
      kind: e.kind,
      field: e.field ?? null,
      oldValue: e.oldValue ?? null,
      newValue: e.newValue ?? null,
      via: actor.type === "user" ? (actor.via ?? null) : null,
      createdAt: now,
    });
  }
}

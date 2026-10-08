import { db, transaction, uuid } from "../db";
import { publish, userChannel } from "../events";

export type NotificationType =
  | "invitation"
  | "invitation_accepted"
  | "assigned"
  | "comment"
  | "due_soon"
  | "removed_from_project"
  | "access_request";

export function notify(input: {
  userId: string;
  type: NotificationType;
  projectId?: string | null;
  taskId?: string | null;
  invitationId?: string | null;
  actorId?: string | null;
  data?: Record<string, unknown>;
}) {
  // Nadie recibe avisos de sus propias acciones.
  if (input.actorId && input.actorId === input.userId) return;
  db().notifications.push({
    id: uuid(),
    userId: input.userId,
    type: input.type,
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    invitationId: input.invitationId ?? null,
    actorId: input.actorId ?? null,
    data: input.data ?? {},
    readAt: null,
    createdAt: new Date(),
  });
  publish(userChannel(input.userId), { type: "notification" });
}

export function listNotifications(userId: string, opts: { limit?: number } = {}) {
  const d = db();
  return d.notifications
    .filter((n) => n.userId === userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, opts.limit ?? 50)
    .map((n) => {
      const project = n.projectId ? d.projects.find((p) => p.id === n.projectId) : undefined;
      const task = n.taskId ? d.tasks.find((t) => t.id === n.taskId) : undefined;
      const actor = n.actorId ? d.users.find((u) => u.id === n.actorId) : undefined;
      const invitation = n.invitationId ? d.invitations.find((i) => i.id === n.invitationId) : undefined;
      return {
        id: n.id,
        type: n.type,
        data: n.data,
        readAt: n.readAt,
        createdAt: n.createdAt,
        project: project ? { id: project.id, key: project.key, name: project.name } : null,
        task: task ? { id: task.id, number: task.number, title: task.title, deletedAt: task.deletedAt } : null,
        actor: actor ? { id: actor.id, name: actor.name, image: actor.image } : null,
        invitation: invitation ? { id: invitation.id, status: invitation.status, role: invitation.role } : null,
      };
    });
}

export function unreadCount(userId: string) {
  return db().notifications.filter((n) => n.userId === userId && !n.readAt).length;
}

export function markRead(userId: string, ids?: string[]) {
  transaction(() => {
    const now = new Date();
    for (const n of db().notifications) {
      if (n.userId !== userId || n.readAt) continue;
      if (ids?.length && !ids.includes(n.id)) continue;
      n.readAt = now;
    }
    publish(userChannel(userId), { type: "notification" });
  });
}

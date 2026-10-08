import { compareRank } from "@/lib/rank";
import { type Actor, authorize } from "../access";
import { db } from "../db";
import { notFound } from "../errors";
import { allowedActions } from "../permissions";

const PR_ORDER: Record<string, number> = { in_review: 1, open: 2, draft: 3, merged: 4 };

/**
 * Todo lo que necesita el tablero. Con sprints activados muestra solo el sprint activo;
 * sin sprints, todas las tareas. El filtrado se hace en el cliente.
 */
export function getBoard(actor: Actor, projectId: string) {
  const d = db();
  const role = authorize(actor, projectId, "project.view");
  const project = d.projects.find((p) => p.id === projectId);
  if (!project) throw notFound("Proyecto");

  const activeSprint = project.sprintsEnabled
    ? (d.sprints.find((s) => s.projectId === projectId && s.status === "active") ?? null)
    : null;

  const columns = d.columns
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => compareRank(a.rank, b.rank))
    .map((c) => ({ ...c, autoTagIds: d.columnTags.filter((ct) => ct.columnId === c.id).map((ct) => ct.tagId) }));

  const members = d.members
    .filter((m) => m.projectId === projectId)
    .map((m) => {
      const u = d.users.find((x) => x.id === m.userId)!;
      return { id: u.id, name: u.name, email: u.email, image: u.image, role: m.role };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const tags = d.tags.filter((t) => t.projectId === projectId).sort((a, b) => a.name.localeCompare(b.name));

  const epics = d.epics
    .filter((e) => e.projectId === projectId && !e.deletedAt)
    .sort((a, b) => compareRank(a.rank, b.rank))
    .map((e) => ({ id: e.id, title: e.title, color: e.color, status: e.status }));

  const sprints = d.sprints
    .filter((s) => s.projectId === projectId && s.status !== "completed")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((s) => ({ id: s.id, name: s.name, status: s.status }));

  const live = d.tasks.filter((t) => !t.deletedAt);
  const tasks = live
    .filter((t) => t.projectId === projectId && (!project.sprintsEnabled || (activeSprint && t.sprintId === activeSprint.id)))
    .sort((a, b) => compareRank(a.rank, b.rank) || a.id.localeCompare(b.id))
    .map((t) => {
      const subtasks = live.filter((s) => s.parentId === t.id);
      const prs = d.links
        .filter((l) => l.taskId === t.id && l.kind === "pull_request")
        .sort((a, b) => (PR_ORDER[a.state] ?? 5) - (PR_ORDER[b.state] ?? 5));
      return {
        id: t.id,
        number: t.number,
        title: t.title,
        priority: t.priority,
        assigneeId: t.assigneeId,
        epicId: t.epicId,
        columnId: t.columnId,
        sprintId: t.sprintId,
        rank: t.rank,
        parentId: t.parentId,
        dueDate: t.dueDate,
        completedAt: t.completedAt,
        tagIds: d.taskTags.filter((tt) => tt.taskId === t.id).map((tt) => tt.tagId),
        subtaskTotal: subtasks.length,
        subtaskDone: subtasks.filter((s) => s.completedAt).length,
        commentCount: d.comments.filter((c) => c.taskId === t.id).length,
        attachmentCount: d.attachments.filter((a) => a.taskId === t.id).length,
        agentStatus: t.agentStatus,
        reviewStatus: t.reviewStatus,
        prState: (prs[0]?.state ?? null) as string | null,
      };
    });

  return {
    project: { ...project, role, can: allowedActions(role) },
    activeSprint,
    sprints,
    columns,
    members,
    tags,
    epics,
    tasks,
  };
}

export type BoardData = ReturnType<typeof getBoard>;

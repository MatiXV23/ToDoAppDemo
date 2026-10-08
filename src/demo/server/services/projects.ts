import * as z from "zod";
import { DEFAULT_COLUMNS, PROJECT_KEY_RE } from "@/lib/domain";
import { ranksBetween } from "@/lib/rank";
import { type Actor, authorize, getRole } from "../access";
import { db, transaction, uuid } from "../db";
import { conflict, forbidden, notFound } from "../errors";
import { projectChannel, publish, userChannel } from "../events";
import { allowedActions } from "../permissions";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Poné un nombre").max(80),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(PROJECT_KEY_RE, "La clave debe tener de 2 a 10 letras o números y empezar con letra"),
  description: z.string().max(2000).default(""),
  sprintsEnabled: z.boolean().default(false),
});

export const updateProjectSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(2000).optional(),
  sprintsEnabled: z.boolean().optional(),
});

export function createProject(actor: Actor, input: z.input<typeof createProjectSchema>) {
  if (actor.type !== "user") throw forbidden();
  const data = createProjectSchema.parse(input);
  return transaction(() => {
    const d = db();
    if (d.projects.some((p) => p.key === data.key)) throw conflict(`Ya existe un proyecto con la clave ${data.key}`);
    const now = new Date();
    const project = {
      id: uuid(),
      ...data,
      ownerId: actor.userId,
      taskSeq: 0,
      agentEnabled: false,
      agentTagId: null,
      agentMergeFrom: "22:00",
      agentMergeUntil: "07:00",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    d.projects.push(project);
    d.members.push({ projectId: project.id, userId: actor.userId, role: "owner", createdAt: now });
    const ranks = ranksBetween(null, null, DEFAULT_COLUMNS.length);
    DEFAULT_COLUMNS.forEach((c, i) =>
      d.columns.push({ id: uuid(), projectId: project.id, name: c.name, category: c.category, rank: ranks[i], createdAt: now }),
    );
    publish(userChannel(actor.userId), { type: "projects" });
    return { ...project };
  });
}

export function listMyProjects(userId: string) {
  const d = db();
  return d.members
    .filter((m) => m.userId === userId)
    .map((m) => {
      const p = d.projects.find((x) => x.id === m.projectId)!;
      return {
        id: p.id,
        key: p.key,
        name: p.name,
        description: p.description,
        archivedAt: p.archivedAt,
        role: m.role,
        openTasks: d.tasks.filter((t) => t.projectId === p.id && !t.deletedAt && !t.completedAt && !t.parentId).length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getProjectByKey(actor: Actor, key: string) {
  if (actor.type !== "user") throw forbidden();
  const project = db().projects.find((p) => p.key === key.toUpperCase());
  if (!project) throw notFound("Proyecto");
  const role = getRole(project.id, actor.userId);
  if (!role) throw notFound("Proyecto");
  return { ...project, role, can: allowedActions(role) };
}

export function updateProject(actor: Actor, input: z.input<typeof updateProjectSchema>) {
  const { projectId, ...patch } = updateProjectSchema.parse(input);
  return transaction(() => {
    authorize(actor, projectId, "project.update");
    const project = db().projects.find((p) => p.id === projectId)!;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (project as Record<string, unknown>)[k] = v;
    project.updatedAt = new Date();
    publish(projectChannel(projectId), { type: "project" }, actor);
    publish(projectChannel(projectId), { type: "board" }, actor);
    return { ...project };
  });
}

export function setArchived(actor: Actor, projectId: string, archived: boolean) {
  transaction(() => {
    authorize(actor, projectId, "project.archive");
    const project = db().projects.find((p) => p.id === projectId)!;
    project.archivedAt = archived ? new Date() : null;
    notifyAllMembers(projectId);
  });
}

export function deleteProject(actor: Actor, projectId: string, confirmKey: string) {
  transaction(() => {
    authorize(actor, projectId, "project.delete");
    const d = db();
    const project = d.projects.find((p) => p.id === projectId);
    if (!project || project.key !== confirmKey.trim().toUpperCase()) {
      throw conflict("La clave de confirmación no coincide");
    }
    notifyAllMembers(projectId);
    const taskIds = new Set(d.tasks.filter((t) => t.projectId === projectId).map((t) => t.id));
    const columnIds = new Set(d.columns.filter((c) => c.projectId === projectId).map((c) => c.id));
    const ruleIds = new Set(d.rules.filter((r) => r.projectId === projectId).map((r) => r.id));
    const repoIds = new Set(d.repos.filter((r) => r.projectId === projectId).map((r) => r.id));
    d.tasks = d.tasks.filter((t) => t.projectId !== projectId);
    d.taskTags = d.taskTags.filter((tt) => !taskIds.has(tt.taskId));
    d.comments = d.comments.filter((c) => !taskIds.has(c.taskId));
    d.activity = d.activity.filter((a) => a.projectId !== projectId);
    d.attachments = d.attachments.filter((a) => !taskIds.has(a.taskId));
    d.links = d.links.filter((l) => !taskIds.has(l.taskId));
    d.columnTags = d.columnTags.filter((ct) => !columnIds.has(ct.columnId));
    d.columns = d.columns.filter((c) => c.projectId !== projectId);
    d.tags = d.tags.filter((t) => t.projectId !== projectId);
    d.epics = d.epics.filter((e) => e.projectId !== projectId);
    d.sprints = d.sprints.filter((s) => s.projectId !== projectId);
    d.rules = d.rules.filter((r) => !ruleIds.has(r.id));
    d.runs = d.runs.filter((r) => r.projectId !== projectId);
    d.repos = d.repos.filter((r) => !repoIds.has(r.id));
    d.agentPrs = d.agentPrs.filter((p) => p.projectId !== projectId);
    d.notifications = d.notifications.filter((n) => n.projectId !== projectId && (!n.taskId || !taskIds.has(n.taskId)));
    d.invitations = d.invitations.filter((i) => i.projectId !== projectId);
    d.members = d.members.filter((m) => m.projectId !== projectId);
    d.projects = d.projects.filter((p) => p.id !== projectId);
  });
}

function notifyAllMembers(projectId: string) {
  for (const m of db().members.filter((x) => x.projectId === projectId)) publish(userChannel(m.userId), { type: "projects" });
}

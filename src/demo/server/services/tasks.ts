import * as z from "zod";
import { PRIORITIES, taskKey } from "@/lib/domain";
import { compareRank, rankBetween } from "@/lib/rank";
import { type Actor, actorUserId, authorize } from "../access";
import { type ColumnRow, db, type TaskRow, transaction, uuid } from "../db";
import { badRequest, notFound } from "../errors";
import { emitDomainEvent, projectChannel, publish } from "../events";
import { type ActivityEntry, logActivity } from "./activity";
import { attachmentUrl } from "./attachments-url";
import { applyColumnTags, columnTagIds } from "./column-tags";
import { notify } from "./notifications";
import { isExternalActor, requestReviewIfExternal } from "./review";

// ─── Esquemas (idénticos al original) ───────────────────────────────────

export const taskFieldsSchema = z.object({
  title: z.string().trim().min(1, "El título no puede estar vacío").max(300),
  descriptionMd: z.string().max(50_000),
  priority: z.enum(PRIORITIES),
  assigneeId: z.string().min(1).nullable(),
  epicId: z.uuid().nullable(),
  sprintId: z.uuid().nullable(),
  dueDate: z.iso.date().nullable(),
  estimateHours: z.number().min(0).max(9999).nullable(),
  tagIds: z.array(z.uuid()).max(30),
});

export const createTaskSchema = taskFieldsSchema.partial().extend({
  projectId: z.uuid(),
  title: taskFieldsSchema.shape.title,
  columnId: z.uuid().optional(),
  parentId: z.uuid().nullable().optional(),
  position: z.enum(["top", "bottom"]).default("bottom"),
});

export const updateTaskSchema = taskFieldsSchema.partial().extend({
  taskId: z.uuid(),
  columnId: z.uuid().optional(),
});

export const moveTaskSchema = z.object({
  taskId: z.uuid(),
  columnId: z.uuid(),
  afterTaskId: z.uuid().nullable(),
});

type Ref = { id: string; label: string } | null;

// ─── Helpers internos ───────────────────────────────────────────────────

export function loadTask(taskId: string) {
  const task = db().tasks.find((t) => t.id === taskId && !t.deletedAt);
  if (!task) throw notFound("Tarea");
  return task;
}

function getColumn(projectId: string, columnId: string) {
  const column = db().columns.find((c) => c.id === columnId && c.projectId === projectId);
  if (!column) throw badRequest("Columna inválida");
  return column;
}

export function projectColumns(projectId: string) {
  return db()
    .columns.filter((c) => c.projectId === projectId)
    .sort((a, b) => compareRank(a.rank, b.rank));
}

function firstColumn(projectId: string) {
  const column = projectColumns(projectId)[0];
  if (!column) throw badRequest("El proyecto no tiene columnas");
  return column;
}

function resolveRefs(
  projectId: string,
  refs: { epicId?: string | null; sprintId?: string | null; assigneeId?: string | null; tagIds?: string[]; parentId?: string | null },
) {
  const d = db();
  const out: { epic?: Ref; sprint?: Ref; assignee?: Ref; tags?: { id: string; name: string }[]; parent?: TaskRow | null } = {};
  if (refs.epicId !== undefined) {
    if (refs.epicId === null) out.epic = null;
    else {
      const e = d.epics.find((x) => x.id === refs.epicId && x.projectId === projectId && !x.deletedAt);
      if (!e) throw badRequest("Epic inválido");
      out.epic = { id: e.id, label: e.title };
    }
  }
  if (refs.sprintId !== undefined) {
    if (refs.sprintId === null) out.sprint = null;
    else {
      const s = d.sprints.find((x) => x.id === refs.sprintId && x.projectId === projectId);
      if (!s) throw badRequest("Sprint inválido");
      if (s.status === "completed") throw badRequest("Ese sprint ya está cerrado");
      out.sprint = { id: s.id, label: s.name };
    }
  }
  if (refs.assigneeId !== undefined) {
    if (refs.assigneeId === null) out.assignee = null;
    else {
      const member = d.members.find((m) => m.projectId === projectId && m.userId === refs.assigneeId);
      const u = member && d.users.find((x) => x.id === member.userId);
      if (!u) throw badRequest("El responsable tiene que ser miembro del proyecto");
      out.assignee = { id: u.id, label: u.name };
    }
  }
  if (refs.tagIds !== undefined) {
    const unique = [...new Set(refs.tagIds)];
    const rows = d.tags.filter((t) => t.projectId === projectId && unique.includes(t.id));
    if (rows.length !== unique.length) throw badRequest("Tag inválido");
    out.tags = rows.map((t) => ({ id: t.id, name: t.name }));
  }
  if (refs.parentId !== undefined) {
    if (refs.parentId === null) out.parent = null;
    else {
      const p = d.tasks.find((t) => t.id === refs.parentId && t.projectId === projectId && !t.deletedAt);
      if (!p) throw badRequest("Tarea principal inválida");
      if (p.parentId) throw badRequest("Las subtareas no pueden tener subtareas");
      out.parent = p;
    }
  }
  return out;
}

function columnTasks(columnId: string, excludeId?: string) {
  return db()
    .tasks.filter((t) => t.columnId === columnId && !t.deletedAt && t.id !== excludeId)
    .sort((a, b) => compareRank(a.rank, b.rank));
}

function edgeRank(columnId: string, edge: "top" | "bottom", excludeId?: string) {
  const list = columnTasks(columnId, excludeId);
  const row = edge === "top" ? list[0] : list[list.length - 1];
  return row?.rank ?? null;
}

function rankAtEdge(columnId: string, edge: "top" | "bottom", excludeId?: string) {
  const current = edgeRank(columnId, edge, excludeId);
  return edge === "top" ? rankBetween(null, current) : rankBetween(current, null);
}

function bottomBacklogRank(projectId: string) {
  const ranks = db()
    .tasks.filter((t) => t.projectId === projectId)
    .map((t) => t.backlogRank)
    .sort(compareRank);
  return rankBetween(ranks[ranks.length - 1] ?? null, null);
}

function publishTaskChange(actor: Actor, projectId: string, taskIds: string[]) {
  publish(projectChannel(projectId), { type: "board", taskIds }, actor);
  for (const taskId of taskIds) publish(projectChannel(projectId), { type: "task", taskId }, actor);
}

function applyMove(actor: Actor, task: TaskRow, columnId: string, rank: string) {
  task.rank = rank;
  if (columnId !== task.columnId) {
    const from = getColumn(task.projectId, task.columnId);
    const to = getColumn(task.projectId, columnId);
    task.columnId = columnId;
    task.completedAt = to.category === "done" ? (task.completedAt ?? new Date()) : null;
    logActivity(actor, [
      {
        taskId: task.id,
        projectId: task.projectId,
        kind: "moved",
        field: "column",
        oldValue: { id: from.id, label: from.name },
        newValue: { id: to.id, label: to.name },
      },
    ]);
    applyColumnTags(actor, to, [task.id]);
    emitDomainEvent({
      projectId: task.projectId,
      type: "task.moved",
      taskId: task.id,
      actor,
      payload: { fromColumnId: from.id, toColumnId: to.id },
    });
  }
  task.updatedAt = new Date();
  publishTaskChange(actor, task.projectId, [task.id]);
  return { ...task };
}

// ─── Operaciones ────────────────────────────────────────────────────────

export function createTask(actor: Actor, input: z.input<typeof createTaskSchema>) {
  const data = createTaskSchema.parse(input);
  return transaction(() => {
    const d = db();
    authorize(actor, data.projectId, "task.create");
    const refs = resolveRefs(data.projectId, {
      epicId: data.epicId,
      sprintId: data.sprintId,
      assigneeId: data.assigneeId,
      tagIds: data.tagIds,
      parentId: data.parentId,
    });
    const column: ColumnRow = data.columnId ? getColumn(data.projectId, data.columnId) : firstColumn(data.projectId);
    const project = d.projects.find((p) => p.id === data.projectId)!;
    project.taskSeq += 1;

    const parent = refs.parent ?? null;
    const now = new Date();
    const task: TaskRow = {
      id: uuid(),
      projectId: data.projectId,
      number: project.taskSeq,
      parentId: parent?.id ?? null,
      sprintId: parent ? parent.sprintId : (data.sprintId ?? null),
      epicId: data.epicId !== undefined ? data.epicId : (parent?.epicId ?? null),
      columnId: column.id,
      rank: rankAtEdge(column.id, data.position),
      backlogRank: bottomBacklogRank(data.projectId),
      title: data.title,
      descriptionMd: data.descriptionMd ?? "",
      priority: data.priority ?? "medium",
      assigneeId: data.assigneeId ?? null,
      reporterId: actorUserId(actor),
      dueDate: data.dueDate ?? null,
      estimateHours: data.estimateHours ?? null,
      completedAt: column.category === "done" ? now : null,
      agentStatus: null,
      agentBranch: null,
      agentClaimedAt: null,
      reviewStatus: isExternalActor(actor) ? "pending" : null,
      reviewedById: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    d.tasks.push(task);

    const tagIds = new Set([...(refs.tags ?? []).map((t) => t.id), ...columnTagIds(column.id)]);
    for (const tagId of tagIds) d.taskTags.push({ taskId: task.id, tagId });
    logActivity(actor, [{ taskId: task.id, projectId: task.projectId, kind: "created" }]);
    if (parent) requestReviewIfExternal(actor, [parent.id]);
    emitDomainEvent({ projectId: task.projectId, type: "task.created", taskId: task.id, actor, payload: { columnId: column.id } });
    if (task.assigneeId) {
      notify({ userId: task.assigneeId, type: "assigned", projectId: task.projectId, taskId: task.id, actorId: actorUserId(actor) });
    }
    publishTaskChange(actor, task.projectId, parent ? [task.id, parent.id] : [task.id]);
    return { ...task };
  });
}

const SCALAR_FIELDS = ["title", "descriptionMd", "priority", "dueDate", "estimateHours"] as const;

function describeTaskRefs(task: TaskRow): Record<string, Ref> {
  const d = db();
  const epic = task.epicId ? d.epics.find((e) => e.id === task.epicId) : null;
  const sprint = task.sprintId ? d.sprints.find((s) => s.id === task.sprintId) : null;
  const assignee = task.assigneeId ? d.users.find((u) => u.id === task.assigneeId) : null;
  return {
    epic: epic ? { id: epic.id, label: epic.title } : null,
    sprint: sprint ? { id: sprint.id, label: sprint.name } : null,
    assignee: assignee ? { id: assignee.id, label: assignee.name } : null,
  };
}

export function updateTask(actor: Actor, input: z.input<typeof updateTaskSchema>) {
  const { taskId, columnId, tagIds, ...patch } = updateTaskSchema.parse(input);
  return transaction(() => {
    const d = db();
    const task = loadTask(taskId);
    authorize(actor, task.projectId, "task.update");
    const refs = resolveRefs(task.projectId, {
      epicId: patch.epicId,
      sprintId: task.parentId ? undefined : patch.sprintId,
      assigneeId: patch.assigneeId,
      tagIds,
    });

    const activity: ActivityEntry[] = [];
    const base = { taskId: task.id, projectId: task.projectId, kind: "updated" as const };
    let changed = false;

    for (const field of SCALAR_FIELDS) {
      const value = patch[field];
      if (value === undefined || value === task[field]) continue;
      activity.push({
        ...base,
        field,
        oldValue: field === "descriptionMd" ? null : task[field],
        newValue: field === "descriptionMd" ? null : value,
      });
      (task as Record<string, unknown>)[field] = value;
      changed = true;
    }

    const refFields = [
      ["epicId", "epic", refs.epic],
      ["sprintId", "sprint", refs.sprint],
      ["assigneeId", "assignee", refs.assignee],
    ] as const;
    const previousRefs = describeTaskRefs(task);
    let sprintChanged = false;
    let newAssignee: string | null = null;
    for (const [field, name, ref] of refFields) {
      if (ref === undefined) continue;
      const next = ref?.id ?? null;
      if (next === task[field]) continue;
      task[field] = next;
      changed = true;
      if (field === "sprintId") sprintChanged = true;
      if (field === "assigneeId") newAssignee = next;
      activity.push({ ...base, field: name, oldValue: previousRefs[name], newValue: ref });
    }

    if (refs.tags) {
      const current = d.taskTags
        .filter((tt) => tt.taskId === task.id)
        .map((tt) => d.tags.find((t) => t.id === tt.tagId)!)
        .filter(Boolean);
      const currentIds = new Set(current.map((t) => t.id));
      const nextIds = new Set(refs.tags.map((t) => t.id));
      const added = refs.tags.filter((t) => !currentIds.has(t.id));
      const removed = current.filter((t) => !nextIds.has(t.id));
      for (const t of added) d.taskTags.push({ taskId: task.id, tagId: t.id });
      if (removed.length) {
        d.taskTags = d.taskTags.filter((tt) => !(tt.taskId === task.id && removed.some((r) => r.id === tt.tagId)));
      }
      if (added.length || removed.length) {
        activity.push({ ...base, field: "tags", oldValue: current.map((t) => t.name), newValue: refs.tags.map((t) => t.name) });
      }
    }

    if (changed) task.updatedAt = new Date();
    logActivity(actor, activity);
    if (activity.length) requestReviewIfExternal(actor, [task.id]);

    if (sprintChanged && !task.parentId) {
      for (const sub of d.tasks) if (sub.parentId === task.id && !sub.deletedAt) sub.sprintId = task.sprintId;
    }
    if (newAssignee) {
      notify({ userId: newAssignee, type: "assigned", projectId: task.projectId, taskId: task.id, actorId: actorUserId(actor) });
    }

    if (columnId && columnId !== task.columnId) {
      getColumn(task.projectId, columnId);
      return applyMove(actor, task, columnId, rankAtEdge(columnId, "top"));
    }
    publishTaskChange(actor, task.projectId, task.parentId ? [task.id, task.parentId] : [task.id]);
    return { ...task };
  });
}

export function moveTask(actor: Actor, input: z.input<typeof moveTaskSchema>) {
  const { taskId, columnId, afterTaskId } = moveTaskSchema.parse(input);
  return transaction(() => {
    const task = loadTask(taskId);
    authorize(actor, task.projectId, "task.update");
    getColumn(task.projectId, columnId);

    let prev: string | null = null;
    let next: string | null;
    const after =
      afterTaskId && afterTaskId !== taskId ? db().tasks.find((t) => t.id === afterTaskId && !t.deletedAt) : undefined;
    const others = columnTasks(columnId, taskId);

    if (!afterTaskId) {
      next = others[0]?.rank ?? null;
    } else if (after && after.columnId === columnId) {
      prev = after.rank;
      next = others.find((t) => compareRank(t.rank, prev!) > 0)?.rank ?? null;
    } else {
      prev = others[others.length - 1]?.rank ?? null;
      next = null;
    }
    return applyMove(actor, task, columnId, rankBetween(prev, next));
  });
}

/** Mueve una tarea al principio de una columna. La usan las automatizaciones. */
export function moveTaskToColumn(actor: Actor, taskId: string, columnId: string) {
  return transaction(() => {
    const task = loadTask(taskId);
    authorize(actor, task.projectId, "task.update");
    getColumn(task.projectId, columnId);
    if (task.columnId === columnId) return { task, changed: false };
    const updated = applyMove(actor, task, columnId, rankAtEdge(columnId, "top", taskId));
    return { task: updated, changed: true };
  });
}

export function deleteTask(actor: Actor, taskId: string) {
  return transaction(() => {
    const task = loadTask(taskId);
    authorize(actor, task.projectId, "task.delete");
    const now = new Date();
    const deleted = db().tasks.filter((t) => !t.deletedAt && (t.id === task.id || t.parentId === task.id));
    for (const t of deleted) t.deletedAt = now;
    logActivity(actor, [{ taskId: task.id, projectId: task.projectId, kind: "deleted" }]);
    const affected = deleted.map((t) => t.id);
    if (task.parentId) affected.push(task.parentId);
    publishTaskChange(actor, task.projectId, affected);
    return { id: task.id, deletedAt: now };
  });
}

/** Deshace un borrado reciente (la tarea y las subtareas borradas junto con ella). */
export function restoreTask(actor: Actor, taskId: string) {
  transaction(() => {
    const task = db().tasks.find((t) => t.id === taskId);
    if (!task || !task.deletedAt) throw notFound("Tarea");
    authorize(actor, task.projectId, "task.delete");
    const deletedAt = task.deletedAt.getTime();
    const restored = db().tasks.filter(
      (t) => t.deletedAt?.getTime() === deletedAt && (t.id === task.id || t.parentId === task.id),
    );
    for (const t of restored) t.deletedAt = null;
    logActivity(actor, [{ taskId: task.id, projectId: task.projectId, kind: "restored" }]);
    publishTaskChange(actor, task.projectId, restored.map((r) => r.id));
  });
}

// ─── Lectura ────────────────────────────────────────────────────────────

export function findTaskId(actor: Actor, projectId: string, number: number) {
  authorize(actor, projectId, "project.view");
  const row = db().tasks.find((t) => t.projectId === projectId && t.number === number && !t.deletedAt);
  if (!row) throw notFound("Tarea");
  return row.id;
}

export function getTaskDetail(actor: Actor, taskId: string) {
  const d = db();
  const task = loadTask(taskId);
  const role = authorize(actor, task.projectId, "project.view");
  const project = d.projects.find((p) => p.id === task.projectId)!;
  const userRef = (id: string | null) => {
    const u = id ? d.users.find((x) => x.id === id) : undefined;
    return u ? { id: u.id, name: u.name, image: u.image } : null;
  };

  const tags = d.taskTags
    .filter((tt) => tt.taskId === task.id)
    .map((tt) => d.tags.find((t) => t.id === tt.tagId)!)
    .filter(Boolean)
    .map((t) => ({ id: t.id, name: t.name, color: t.color }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const subtasks = d.tasks
    .filter((t) => t.parentId === task.id && !t.deletedAt)
    .sort((a, b) => a.number - b.number)
    .map((t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      columnId: t.columnId,
      assigneeId: t.assigneeId,
      priority: t.priority,
      completedAt: t.completedAt,
    }));

  const parentRow = task.parentId ? d.tasks.find((t) => t.id === task.parentId) : undefined;

  const comments = d.comments
    .filter((c) => c.taskId === task.id)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((c) => ({
      id: c.id,
      bodyMd: c.bodyMd,
      source: c.source,
      via: c.via,
      createdAt: c.createdAt,
      editedAt: c.editedAt,
      author: userRef(c.authorId),
      ruleName: c.automationRuleId ? (d.rules.find((r) => r.id === c.automationRuleId)?.name ?? null) : null,
    }));

  const activity = d.activity
    .filter((a) => a.taskId === task.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 100)
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      field: a.field,
      oldValue: a.oldValue,
      newValue: a.newValue,
      actorType: a.actorType,
      actorId: a.actorId,
      via: a.via,
      createdAt: a.createdAt,
      userName: a.actorType === "user" ? (d.users.find((u) => u.id === a.actorId)?.name ?? null) : null,
      ruleName: a.actorType === "automation" ? (d.rules.find((r) => r.id === a.actorId)?.name ?? null) : null,
    }));

  const links = d.links
    .filter((l) => l.taskId === task.id)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .flatMap((l) => {
      const repo = d.repos.find((r) => r.id === l.projectRepositoryId);
      if (!repo) return [];
      return [
        {
          id: l.id,
          kind: l.kind,
          externalId: l.externalId,
          title: l.title,
          url: l.url,
          state: l.state,
          data: l.data,
          updatedAt: l.updatedAt,
          repository: { id: repo.id, fullName: repo.fullName, provider: repo.provider },
        },
      ];
    });

  const attachments = d.attachments
    .filter((a) => a.taskId === task.id)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((a) => {
      const u = a.uploadedById ? d.users.find((x) => x.id === a.uploadedById) : undefined;
      return {
        id: a.id,
        fileName: a.fileName,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        createdAt: a.createdAt,
        uploadedBy: u ? { id: u.id, name: u.name } : null,
        url: attachmentUrl(a),
      };
    });

  return {
    ...task,
    key: taskKey(project.key, task.number),
    projectKey: project.key,
    sprintsEnabled: project.sprintsEnabled,
    role,
    tags,
    subtasks,
    parent: parentRow ? { id: parentRow.id, number: parentRow.number, title: parentRow.title, key: taskKey(project.key, parentRow.number) } : null,
    comments,
    activity,
    links,
    attachments,
  };
}

export type TaskDetail = ReturnType<typeof getTaskDetail>;

import * as z from "zod";
import { compareRank, rankBetween } from "@/lib/rank";
import { type Actor, authorize } from "../access";
import { db, type SprintRow, type TaskRow, transaction, uuid } from "../db";
import { badRequest, conflict, notFound } from "../errors";
import { projectChannel, publish } from "../events";
import { logActivity } from "./activity";
import { loadTask } from "./tasks";

const dateOrNull = z.iso.date().nullable();

export const createSprintSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().max(80).optional(),
  goal: z.string().max(1000).default(""),
  startDate: dateOrNull.optional(),
  endDate: dateOrNull.optional(),
});

export const updateSprintSchema = z.object({
  sprintId: z.uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  goal: z.string().max(1000).optional(),
  startDate: dateOrNull.optional(),
  endDate: dateOrNull.optional(),
});

export const completeSprintSchema = z.object({
  sprintId: z.uuid(),
  moveOpenTasksTo: z.uuid().nullable(),
});

export const moveInBacklogSchema = z.object({
  taskId: z.uuid(),
  sprintId: z.uuid().nullable(),
  afterTaskId: z.uuid().nullable(),
});

function loadSprint(sprintId: string) {
  const sprint = db().sprints.find((s) => s.id === sprintId);
  if (!sprint) throw notFound("Sprint");
  return sprint;
}

export function createSprint(actor: Actor, input: z.input<typeof createSprintSchema>) {
  const data = createSprintSchema.parse(input);
  return transaction(() => {
    authorize(actor, data.projectId, "sprint.manage");
    const n = db().sprints.filter((s) => s.projectId === data.projectId).length;
    const sprint: SprintRow = {
      id: uuid(),
      projectId: data.projectId,
      name: data.name || `Sprint ${n + 1}`,
      goal: data.goal,
      status: "planned",
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    };
    db().sprints.push(sprint);
    publish(projectChannel(data.projectId), { type: "board" }, actor);
    return { ...sprint };
  });
}

export function updateSprint(actor: Actor, input: z.input<typeof updateSprintSchema>) {
  const { sprintId, ...patch } = updateSprintSchema.parse(input);
  return transaction(() => {
    const sprint = loadSprint(sprintId);
    authorize(actor, sprint.projectId, "sprint.manage");
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (sprint as Record<string, unknown>)[k] = v;
    publish(projectChannel(sprint.projectId), { type: "board" }, actor);
    return { ...sprint };
  });
}

export function startSprint(actor: Actor, input: { sprintId: string; startDate?: string | null; endDate?: string | null }) {
  return transaction(() => {
    const sprint = loadSprint(input.sprintId);
    if (sprint.status !== "planned") throw badRequest("Solo se puede iniciar un sprint planificado");
    authorize(actor, sprint.projectId, "sprint.manage");
    if (db().sprints.some((s) => s.projectId === sprint.projectId && s.status === "active")) {
      throw conflict("Ya hay un sprint activo. Cerralo antes de iniciar otro.");
    }
    sprint.status = "active";
    sprint.startedAt = new Date();
    sprint.startDate = input.startDate ?? sprint.startDate ?? new Date().toISOString().slice(0, 10);
    sprint.endDate = input.endDate ?? sprint.endDate;
    publish(projectChannel(sprint.projectId), { type: "board" }, actor);
    return { ...sprint };
  });
}

export function completeSprint(actor: Actor, input: z.input<typeof completeSprintSchema>) {
  const { sprintId, moveOpenTasksTo } = completeSprintSchema.parse(input);
  return transaction(() => {
    const sprint = loadSprint(sprintId);
    if (sprint.status !== "active") throw badRequest("Solo se puede cerrar el sprint activo");
    authorize(actor, sprint.projectId, "sprint.manage");
    if (moveOpenTasksTo) {
      const target = db().sprints.find((s) => s.id === moveOpenTasksTo && s.projectId === sprint.projectId);
      if (!target || target.status !== "planned") throw badRequest("El sprint destino tiene que estar planificado");
    }
    const moved = db().tasks.filter((t) => t.sprintId === sprint.id && !t.completedAt && !t.deletedAt);
    for (const t of moved) t.sprintId = moveOpenTasksTo;
    sprint.status = "completed";
    sprint.completedAt = new Date();
    publish(projectChannel(sprint.projectId), { type: "board" }, actor);
    return { movedTasks: moved.length };
  });
}

/** Solo se pueden borrar sprints planificados; sus tareas vuelven al backlog. */
export function deleteSprint(actor: Actor, sprintId: string) {
  transaction(() => {
    const sprint = loadSprint(sprintId);
    if (sprint.status !== "planned") throw badRequest("Solo se pueden borrar sprints planificados");
    authorize(actor, sprint.projectId, "sprint.manage");
    for (const t of db().tasks) if (t.sprintId === sprintId) t.sprintId = null;
    db().sprints = db().sprints.filter((s) => s.id !== sprintId);
    publish(projectChannel(sprint.projectId), { type: "board" }, actor);
  });
}

function backlogFields(t: TaskRow) {
  const d = db();
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    priority: t.priority,
    assigneeId: t.assigneeId,
    epicId: t.epicId,
    columnId: t.columnId,
    sprintId: t.sprintId,
    backlogRank: t.backlogRank,
    estimateHours: t.estimateHours,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    tagIds: d.taskTags.filter((tt) => tt.taskId === t.id).map((tt) => tt.tagId),
    subtaskCount: d.tasks.filter((s) => s.parentId === t.id && !s.deletedAt).length,
  };
}

/** Backlog: sprints abiertos con sus tareas y las tareas sin sprint (solo tareas principales). */
export function getBacklog(actor: Actor, projectId: string) {
  authorize(actor, projectId, "project.view");
  const d = db();
  const openSprints = d.sprints
    .filter((s) => s.projectId === projectId && s.status !== "completed")
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || a.createdAt.getTime() - b.createdAt.getTime());
  const sprintIds = new Set(openSprints.map((s) => s.id));
  const tasks = d.tasks
    .filter(
      (t) =>
        t.projectId === projectId &&
        !t.deletedAt &&
        !t.parentId &&
        ((!t.sprintId && !t.completedAt) || (t.sprintId && sprintIds.has(t.sprintId))),
    )
    .sort((a, b) => compareRank(a.backlogRank, b.backlogRank))
    .map(backlogFields);
  return { sprints: openSprints.map((s) => ({ ...s })), tasks };
}

export function moveInBacklog(actor: Actor, input: z.input<typeof moveInBacklogSchema>) {
  const { taskId, sprintId, afterTaskId } = moveInBacklogSchema.parse(input);
  transaction(() => {
    const d = db();
    const task = loadTask(taskId);
    authorize(actor, task.projectId, "sprint.manage");
    if (task.parentId) throw badRequest("Las subtareas siguen a su tarea principal");
    let targetSprint: SprintRow | null = null;
    if (sprintId) {
      targetSprint = d.sprints.find((s) => s.id === sprintId && s.projectId === task.projectId) ?? null;
      if (!targetSprint || targetSprint.status === "completed") throw badRequest("Sprint inválido");
    }
    const scope = d.tasks
      .filter(
        (t) =>
          t.projectId === task.projectId &&
          !t.deletedAt &&
          !t.parentId &&
          t.id !== task.id &&
          (sprintId ? t.sprintId === sprintId : !t.sprintId),
      )
      .sort((a, b) => compareRank(a.backlogRank, b.backlogRank));
    const prev = afterTaskId ? (scope.find((t) => t.id === afterTaskId)?.backlogRank ?? null) : null;
    const next = (prev ? scope.find((t) => compareRank(t.backlogRank, prev) > 0) : scope[0])?.backlogRank ?? null;
    const previousSprintId = task.sprintId;
    task.backlogRank = rankBetween(prev, next);
    task.sprintId = sprintId;
    if (sprintId !== previousSprintId) {
      for (const sub of d.tasks) if (sub.parentId === task.id && !sub.deletedAt) sub.sprintId = sprintId;
      const previous = previousSprintId ? d.sprints.find((s) => s.id === previousSprintId) : null;
      logActivity(actor, [
        {
          taskId: task.id,
          projectId: task.projectId,
          kind: "updated",
          field: "sprint",
          oldValue: previous ? { id: previous.id, label: previous.name } : null,
          newValue: targetSprint ? { id: targetSprint.id, label: targetSprint.name } : null,
        },
      ]);
    }
    publish(projectChannel(task.projectId), { type: "board", taskIds: [task.id] }, actor);
    publish(projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
  });
}

/** Datos de un sprint para resúmenes. */
export function getSprintStats(actor: Actor, sprintId: string) {
  const sprint = loadSprint(sprintId);
  authorize(actor, sprint.projectId, "project.view");
  const tasks = db()
    .tasks.filter((t) => t.sprintId === sprintId && !t.deletedAt)
    .sort((a, b) => compareRank(a.backlogRank, b.backlogRank))
    .map(backlogFields);
  return { sprint, tasks };
}

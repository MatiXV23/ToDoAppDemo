import * as z from "zod";
import { COLUMN_CATEGORIES } from "@/lib/domain";
import { compareRank, rankBetween } from "@/lib/rank";
import { type Actor, authorize } from "../access";
import { db, transaction, uuid } from "../db";
import { badRequest, notFound } from "../errors";
import { projectChannel, publish } from "../events";
import { applyColumnTags, columnTagIds } from "./column-tags";
import { projectColumns } from "./tasks";

const name = z.string().trim().min(1, "Poné un nombre").max(40);
const autoTagIds = z.array(z.uuid()).max(10);

export const createColumnSchema = z.object({
  projectId: z.uuid(),
  name,
  category: z.enum(COLUMN_CATEGORIES),
  autoTagIds: autoTagIds.optional(),
});

export const updateColumnSchema = z.object({
  columnId: z.uuid(),
  name: name.optional(),
  category: z.enum(COLUMN_CATEGORIES).optional(),
  autoTagIds: autoTagIds.optional(),
});

function assertProjectTags(projectId: string, tagIds: string[]) {
  const unique = [...new Set(tagIds)];
  const found = db().tags.filter((t) => t.projectId === projectId && unique.includes(t.id));
  if (found.length !== unique.length) throw badRequest("Tag inválido");
  return unique;
}

/** Reemplaza los tags automáticos y se los agrega a las tareas que ya están en la columna. */
function setAutoTags(actor: Actor, column: { id: string; projectId: string }, tagIds: string[]) {
  const d = db();
  const next = assertProjectTags(column.projectId, tagIds);
  const previous = columnTagIds(column.id);
  d.columnTags = d.columnTags.filter((ct) => ct.columnId !== column.id);
  for (const tagId of next) d.columnTags.push({ columnId: column.id, tagId });
  const added = next.filter((id) => !previous.includes(id));
  if (added.length === 0) return [];
  const inColumn = d.tasks.filter((t) => t.columnId === column.id && !t.deletedAt).map((t) => t.id);
  return applyColumnTags(actor, column, inColumn, added);
}

function loadColumn(columnId: string) {
  const column = db().columns.find((c) => c.id === columnId);
  if (!column) throw notFound("Columna");
  return column;
}

export function createColumn(actor: Actor, input: z.input<typeof createColumnSchema>) {
  const { autoTagIds, ...data } = createColumnSchema.parse(input);
  return transaction(() => {
    authorize(actor, data.projectId, "column.manage");
    const columns = projectColumns(data.projectId);
    const column = {
      id: uuid(),
      ...data,
      rank: rankBetween(columns[columns.length - 1]?.rank ?? null, null),
      createdAt: new Date(),
    };
    db().columns.push(column);
    if (autoTagIds?.length) setAutoTags(actor, column, autoTagIds);
    publish(projectChannel(data.projectId), { type: "board" }, actor);
    return { ...column };
  });
}

export function updateColumn(actor: Actor, input: z.input<typeof updateColumnSchema>) {
  const { columnId, autoTagIds, ...patch } = updateColumnSchema.parse(input);
  return transaction(() => {
    const column = loadColumn(columnId);
    authorize(actor, column.projectId, "column.manage");
    if (patch.name !== undefined) column.name = patch.name;
    if (patch.category !== undefined) column.category = patch.category;
    const tagged = autoTagIds ? setAutoTags(actor, column, autoTagIds) : [];
    publish(projectChannel(column.projectId), { type: "board" }, actor);
    for (const taskId of tagged) publish(projectChannel(column.projectId), { type: "task", taskId }, actor);
    return { ...column };
  });
}

export function moveColumn(actor: Actor, input: { columnId: string; afterColumnId: string | null }) {
  transaction(() => {
    const column = loadColumn(input.columnId);
    authorize(actor, column.projectId, "column.manage");
    const siblings = projectColumns(column.projectId).filter((c) => c.id !== column.id);
    const index = input.afterColumnId ? siblings.findIndex((c) => c.id === input.afterColumnId) : -1;
    if (input.afterColumnId && index === -1) throw badRequest("Columna de referencia inválida");
    const prev = index >= 0 ? siblings[index].rank : null;
    const next = siblings[index + 1]?.rank ?? null;
    column.rank = rankBetween(prev, next);
    publish(projectChannel(column.projectId), { type: "board" }, actor);
  });
}

/** Borra una columna moviendo sus tareas a otra. */
export function deleteColumn(actor: Actor, input: { columnId: string; moveTasksTo: string }) {
  transaction(() => {
    const d = db();
    const column = loadColumn(input.columnId);
    authorize(actor, column.projectId, "column.manage");
    if (projectColumns(column.projectId).length <= 1) throw badRequest("El tablero necesita al menos una columna");
    if (input.moveTasksTo === column.id) throw badRequest("Elegí otra columna destino");
    const target = d.columns.find((c) => c.id === input.moveTasksTo && c.projectId === column.projectId);
    if (!target) throw badRequest("Columna destino inválida");

    const inTarget = d.tasks.filter((t) => t.columnId === target.id).sort((a, b) => compareRank(a.rank, b.rank));
    const moving = d.tasks.filter((t) => t.columnId === column.id).sort((a, b) => compareRank(a.rank, b.rank));
    let prev = inTarget[inTarget.length - 1]?.rank ?? null;
    for (const t of moving) {
      const rank = rankBetween(prev, null);
      t.columnId = target.id;
      t.rank = rank;
      t.completedAt = target.category === "done" ? (t.completedAt ?? new Date()) : null;
      prev = rank;
    }
    applyColumnTags(actor, target, moving.map((t) => t.id));
    d.columnTags = d.columnTags.filter((ct) => ct.columnId !== column.id);
    d.columns = d.columns.filter((c) => c.id !== column.id);
    publish(projectChannel(column.projectId), { type: "board" }, actor);
  });
}

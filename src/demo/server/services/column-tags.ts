import type { Actor } from "../access";
import { db } from "../db";
import { type ActivityEntry, logActivity } from "./activity";

/**
 * Tags automáticos de columna: las tareas que se crean en la columna o entran a ella los
 * reciben. Al salir de la columna los tags quedan.
 */

export function columnTagIds(columnId: string) {
  return db()
    .columnTags.filter((ct) => ct.columnId === columnId)
    .map((ct) => ct.tagId);
}

/** Agrega a las tareas los tags de la columna (o los indicados) que todavía no tengan. */
export function applyColumnTags(
  actor: Actor,
  column: { id: string; projectId: string },
  taskIds: string[],
  onlyTagIds?: string[],
) {
  const d = db();
  const tagIds = onlyTagIds ?? columnTagIds(column.id);
  if (taskIds.length === 0 || tagIds.length === 0) return [];
  const wanted = d.tags.filter((t) => tagIds.includes(t.id));
  const activity: ActivityEntry[] = [];
  for (const taskId of taskIds) {
    const has = d.taskTags
      .filter((tt) => tt.taskId === taskId)
      .map((tt) => d.tags.find((t) => t.id === tt.tagId)!)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    const missing = wanted.filter((t) => !has.some((h) => h.id === t.id));
    if (missing.length === 0) continue;
    for (const t of missing) d.taskTags.push({ taskId, tagId: t.id });
    activity.push({
      taskId,
      projectId: column.projectId,
      kind: "updated",
      field: "tags",
      oldValue: has.map((h) => h.name),
      newValue: [...has.map((h) => h.name), ...missing.map((t) => t.name)],
    });
  }
  logActivity(actor, activity);
  return activity.map((a) => a.taskId);
}

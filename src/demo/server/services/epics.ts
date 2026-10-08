import * as z from "zod";
import { PALETTE } from "@/lib/domain";
import { compareRank, rankBetween } from "@/lib/rank";
import { type Actor, authorize } from "../access";
import { db, transaction, uuid } from "../db";
import { notFound } from "../errors";
import { projectChannel, publish } from "../events";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido");

export const createEpicSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, "Poné un título").max(200),
  descriptionMd: z.string().max(50_000).default(""),
  color: color.optional(),
});

export const updateEpicSchema = z.object({
  epicId: z.uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  descriptionMd: z.string().max(50_000).optional(),
  color: color.optional(),
  status: z.enum(["open", "done"]).optional(),
});

function loadEpic(epicId: string) {
  const epic = db().epics.find((e) => e.id === epicId && !e.deletedAt);
  if (!epic) throw notFound("Epic");
  return epic;
}

export function listEpics(actor: Actor, projectId: string) {
  authorize(actor, projectId, "project.view");
  const d = db();
  const tasks = d.tasks.filter((t) => t.projectId === projectId && !t.deletedAt && !t.parentId);
  return d.epics
    .filter((e) => e.projectId === projectId && !e.deletedAt)
    .sort((a, b) => compareRank(a.rank, b.rank))
    .map((e) => {
      const own = tasks.filter((t) => t.epicId === e.id);
      return {
        id: e.id,
        title: e.title,
        descriptionMd: e.descriptionMd,
        color: e.color,
        status: e.status,
        createdAt: e.createdAt,
        total: own.length,
        done: own.filter((t) => t.completedAt).length,
        hours: own.reduce((sum, t) => sum + (t.estimateHours ?? 0), 0),
      };
    });
}

export function createEpic(actor: Actor, input: z.input<typeof createEpicSchema>) {
  const data = createEpicSchema.parse(input);
  return transaction(() => {
    authorize(actor, data.projectId, "epic.manage");
    const existing = db()
      .epics.filter((e) => e.projectId === data.projectId)
      .sort((a, b) => compareRank(b.rank, a.rank));
    const now = new Date();
    const epic = {
      id: uuid(),
      projectId: data.projectId,
      title: data.title,
      descriptionMd: data.descriptionMd,
      color: data.color ?? PALETTE[(existing.length * 5 + 7) % PALETTE.length],
      status: "open" as const,
      rank: rankBetween(existing[0]?.rank ?? null, null),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    db().epics.push(epic);
    publish(projectChannel(data.projectId), { type: "board" }, actor);
    return { ...epic };
  });
}

export function updateEpic(actor: Actor, input: z.input<typeof updateEpicSchema>) {
  const { epicId, ...patch } = updateEpicSchema.parse(input);
  return transaction(() => {
    const epic = loadEpic(epicId);
    authorize(actor, epic.projectId, "epic.manage");
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (epic as Record<string, unknown>)[k] = v;
    epic.updatedAt = new Date();
    publish(projectChannel(epic.projectId), { type: "board" }, actor);
    return { ...epic };
  });
}

export function deleteEpic(actor: Actor, epicId: string) {
  transaction(() => {
    const epic = loadEpic(epicId);
    authorize(actor, epic.projectId, "epic.manage");
    epic.deletedAt = new Date();
    for (const t of db().tasks) if (t.epicId === epicId) t.epicId = null;
    publish(projectChannel(epic.projectId), { type: "board" }, actor);
  });
}

export function getEpic(actor: Actor, epicId: string) {
  const epic = loadEpic(epicId);
  authorize(actor, epic.projectId, "project.view");
  const tasks = db()
    .tasks.filter((t) => t.epicId === epicId && !t.deletedAt && !t.parentId)
    .sort((a, b) => compareRank(a.backlogRank, b.backlogRank))
    .map((t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      priority: t.priority,
      columnId: t.columnId,
      assigneeId: t.assigneeId,
      completedAt: t.completedAt,
      estimateHours: t.estimateHours,
    }));
  return { ...epic, tasks };
}

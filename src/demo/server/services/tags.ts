import * as z from "zod";
import { type Actor, authorize } from "../access";
import { db, transaction, uuid } from "../db";
import { conflict, notFound } from "../errors";
import { projectChannel, publish } from "../events";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido");
const name = z.string().trim().min(1, "Poné un nombre").max(30);

export const createTagSchema = z.object({ projectId: z.uuid(), name, color });
export const updateTagSchema = z.object({ tagId: z.uuid(), name: name.optional(), color: color.optional() });

const duplicated = (projectId: string, tagName: string, exceptId?: string) =>
  db().tags.some((t) => t.projectId === projectId && t.name === tagName && t.id !== exceptId);

export function listTags(actor: Actor, projectId: string) {
  authorize(actor, projectId, "project.view");
  return db()
    .tags.filter((t) => t.projectId === projectId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function createTag(actor: Actor, input: z.input<typeof createTagSchema>) {
  const data = createTagSchema.parse(input);
  return transaction(() => {
    authorize(actor, data.projectId, "tag.manage");
    if (duplicated(data.projectId, data.name)) throw conflict(`Ya existe el tag "${data.name}"`);
    const tag = { id: uuid(), ...data, createdAt: new Date() };
    db().tags.push(tag);
    publish(projectChannel(data.projectId), { type: "board" }, actor);
    return { ...tag };
  });
}

export function updateTag(actor: Actor, input: z.input<typeof updateTagSchema>) {
  const { tagId, ...patch } = updateTagSchema.parse(input);
  return transaction(() => {
    const tag = db().tags.find((t) => t.id === tagId);
    if (!tag) throw notFound("Tag");
    authorize(actor, tag.projectId, "tag.manage");
    if (patch.name && duplicated(tag.projectId, patch.name, tag.id)) throw conflict(`Ya existe el tag "${patch.name}"`);
    if (patch.name !== undefined) tag.name = patch.name;
    if (patch.color !== undefined) tag.color = patch.color;
    publish(projectChannel(tag.projectId), { type: "board" }, actor);
    return { ...tag };
  });
}

export function deleteTag(actor: Actor, tagId: string) {
  transaction(() => {
    const d = db();
    const tag = d.tags.find((t) => t.id === tagId);
    if (!tag) throw notFound("Tag");
    authorize(actor, tag.projectId, "tag.manage");
    d.tags = d.tags.filter((t) => t.id !== tagId);
    d.taskTags = d.taskTags.filter((tt) => tt.tagId !== tagId);
    d.columnTags = d.columnTags.filter((ct) => ct.tagId !== tagId);
    publish(projectChannel(tag.projectId), { type: "board" }, actor);
  });
}

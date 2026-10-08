import * as z from "zod";
import { type Actor, actorUserId, authorize } from "../access";
import { db, transaction, uuid } from "../db";
import { badRequest, notFound } from "../errors";
import { projectChannel, publish } from "../events";
import { logActivity } from "./activity";
import { attachmentUrl, removeFile, storeFile } from "./attachments-url";
import { requestReviewIfExternal } from "./review";
import { loadTask } from "./tasks";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_PER_TASK = 40;
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/**
 * Reemplaza a POST /api/tasks/:id/attachments. En la demo no hay servidor de archivos: el
 * navegador achica la imagen y acá se guarda como data URL en localStorage.
 */
export const uploadAttachmentSchema = z.object({
  taskId: z.uuid(),
  fileName: z.string().max(300),
  /** Tamaño del archivo original, el que se muestra en la lista. */
  sizeBytes: z.number().int().min(0),
  dataUrl: z.string().startsWith("data:image/"),
});

export function addAttachment(actor: Actor, input: z.input<typeof uploadAttachmentSchema>) {
  const data = uploadAttachmentSchema.parse(input);
  return transaction(() => {
    const task = loadTask(data.taskId);
    authorize(actor, task.projectId, "task.update");
    if (data.sizeBytes > MAX_ATTACHMENT_BYTES) throw badRequest("La imagen supera los 10 MB");
    const contentType = data.dataUrl.slice(5, data.dataUrl.indexOf(";"));
    const ext = TYPES[contentType];
    if (!ext) throw badRequest("Solo se aceptan imágenes PNG, JPG, GIF o WebP");
    if (db().attachments.filter((a) => a.taskId === task.id).length >= MAX_PER_TASK) {
      throw badRequest(`Máximo ${MAX_PER_TASK} adjuntos por tarea`);
    }
    const id = uuid();
    const fileName = data.fileName.replace(/[/\\]/g, "_").slice(0, 200) || `imagen.${ext}`;
    const storedLocally = storeFile(id, data.dataUrl);
    const row = {
      id,
      taskId: task.id,
      uploadedById: actorUserId(actor),
      fileName,
      contentType,
      sizeBytes: data.sizeBytes,
      storageKey: `local:${id}`,
      createdAt: new Date(),
    };
    db().attachments.push(row);
    logActivity(actor, [
      { taskId: task.id, projectId: task.projectId, kind: "attached", field: "attachment", newValue: { id, label: fileName } },
    ]);
    requestReviewIfExternal(actor, [task.id]);
    publish(projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
    publish(projectChannel(task.projectId), { type: "board", taskIds: [task.id] }, actor);
    return { id, fileName, url: attachmentUrl(row), storedLocally };
  });
}

export function deleteAttachment(actor: Actor, id: string) {
  transaction(() => {
    const row = db().attachments.find((a) => a.id === id);
    if (!row) throw notFound("Adjunto");
    const task = loadTask(row.taskId);
    authorize(actor, task.projectId, "task.update");
    db().attachments = db().attachments.filter((a) => a.id !== id);
    logActivity(actor, [
      { taskId: task.id, projectId: task.projectId, kind: "detached", field: "attachment", oldValue: { id, label: row.fileName } },
    ]);
    publish(projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
    publish(projectChannel(task.projectId), { type: "board", taskIds: [task.id] }, actor);
    if (row.storageKey.startsWith("local:")) removeFile(id);
  });
}

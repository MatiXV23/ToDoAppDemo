import { withBasePath } from "@/demo/base-path";
import { type AttachmentRow, STORAGE_PREFIX } from "../db";

/**
 * Archivos de los adjuntos. Los de ejemplo son imágenes en /public/demo/attachments; los que
 * sube el visitante se guardan achicados como data URL en localStorage (o solo en memoria si
 * no hay espacio).
 */

const memoryFiles = new Map<string, string>();
const fileKey = (id: string) => `${STORAGE_PREFIX}:file:${id}`;

/** Guarda la imagen. Devuelve false si no entró en localStorage (queda solo en esta sesión). */
export function storeFile(id: string, dataUrl: string) {
  memoryFiles.set(id, dataUrl);
  try {
    window.localStorage.setItem(fileKey(id), dataUrl);
    return true;
  } catch {
    return false;
  }
}

export function removeFile(id: string) {
  memoryFiles.delete(id);
  try {
    window.localStorage.removeItem(fileKey(id));
  } catch {
    // nada que hacer
  }
}

export function attachmentUrl(a: AttachmentRow) {
  if (!a.storageKey.startsWith("local:")) return withBasePath(a.storageKey);
  const id = a.storageKey.slice("local:".length);
  const inMemory = memoryFiles.get(id);
  if (inMemory) return inMemory;
  try {
    const stored = window.localStorage.getItem(fileKey(id));
    if (stored) {
      memoryFiles.set(id, stored);
      return stored;
    }
  } catch {
    // almacenamiento bloqueado
  }
  return withBasePath("/demo/attachments/no-disponible.png");
}

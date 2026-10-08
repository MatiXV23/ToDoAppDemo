import { toast } from "sonner";

/**
 * Avisos de "esto está simulado en la demo". Se muestran una sola vez por sesión para no
 * tapar la experiencia: la idea es que se entienda qué es simulado sin que moleste.
 */
const shown = new Set<string>();

export function demoNotice(key: string, message: string, opts: { always?: boolean } = {}) {
  if (typeof window === "undefined") return;
  if (!opts.always && shown.has(key)) return;
  shown.add(key);
  // Después de la respuesta, para que no se mezcle con el toast de la propia acción.
  setTimeout(() => toast.info(message, { duration: 7000 }), 150);
}

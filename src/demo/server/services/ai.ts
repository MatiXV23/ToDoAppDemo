import { addDays, format, nextDay } from "date-fns";
import * as z from "zod";
import { type Priority, PRIORITY_META, slugify, taskKey } from "@/lib/domain";
import { demoNotice } from "@/demo/notices";
import { type Actor, authorize } from "../access";
import { db, type TaskRow } from "../db";
import { AppError, forbidden, notFound } from "../errors";
import type { Action } from "../permissions";
import { getEpic } from "./epics";
import { getTaskDetail } from "./tasks";

/**
 * IA simulada. La app real le pide estas sugerencias a un modelo (DeepSeek); en la demo se
 * arman con reglas simples a partir de los datos de la tarea o del proyecto. La forma de cada
 * respuesta es la misma, así que la interfaz funciona igual: todo vuelve como sugerencia.
 */

const NOTICE =
  "IA simulada en la demo: las sugerencias se arman con reglas simples. En la versión completa las genera un modelo de lenguaje con los datos del proyecto.";

function runFeature<T>(actor: Actor, projectId: string, action: Action, fn: () => T): T {
  if (actor.type !== "user") throw forbidden();
  authorize(actor, projectId, action);
  demoNotice("ai", NOTICE);
  return fn();
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const has = (text: string, words: string[]) => words.some((w) => slugify(text).includes(slugify(w)));

type Kind = "bug" | "ui" | "api" | "content" | "infra" | "general";

function kindOf(text: string): Kind {
  if (has(text, ["error", "falla", "bug", "no funciona", "corregir", "arreglar", "se rompe", "no carga", "duplicad", "500"])) return "bug";
  if (has(text, ["deploy", "servidor", "backup", "dominio", "ssl", "monitoreo", "ci", "docker", "base de datos", "migracion"])) return "infra";
  if (has(text, ["api", "endpoint", "integracion", "webhook", "pasarela", "sincroniz", "importar", "exportar", "mercado pago", "notificacion"])) return "api";
  if (has(text, ["texto", "contenido", "seo", "redaccion", "fotos", "copy", "traduc", "newsletter"])) return "content";
  if (has(text, ["pantalla", "diseno", "vista", "formulario", "boton", "landing", "pagina", "menu", "responsive", "maqueta", "home", "checkout", "carrito"])) return "ui";
  return "general";
}

const SPLIT_TEMPLATES: Record<Kind, { title: (t: string) => string; description: string; hours: number }[]> = {
  bug: [
    { title: () => "Reproducir el error y anotar los pasos", description: "Confirmar en qué navegador, dispositivo o datos ocurre.", hours: 1 },
    { title: () => "Encontrar la causa en el código o en los datos", description: "Revisar logs y el último cambio que tocó esa parte.", hours: 2 },
    { title: () => "Aplicar la corrección", description: "Cambio mínimo que resuelva la causa, no solo el síntoma.", hours: 2 },
    { title: () => "Agregar un test que cubra el caso", description: "Que el mismo error no vuelva a aparecer sin que nos enteremos.", hours: 1 },
    { title: () => "Verificar en staging y avisar a quien lo reportó", description: "", hours: 0.5 },
  ],
  ui: [
    { title: (t) => `Definir el contenido y los estados de ${lower(t)}`, description: "Vacío, cargando, error y con datos.", hours: 2 },
    { title: () => "Maquetar la vista con los componentes existentes", description: "Respetar el sistema de diseño y el modo celular.", hours: 4 },
    { title: () => "Conectar la vista con los datos", description: "", hours: 3 },
    { title: () => "Revisar accesibilidad y versión mobile", description: "Contraste, foco con teclado y textos alternativos.", hours: 1.5 },
    { title: () => "Validar con el cliente y ajustar detalles", description: "", hours: 1 },
  ],
  api: [
    { title: (t) => `Relevar el contrato de datos de ${lower(t)}`, description: "Campos, errores posibles y límites del servicio externo.", hours: 2 },
    { title: () => "Implementar el cliente y el manejo de errores", description: "Reintentos y mensajes claros para el usuario.", hours: 4 },
    { title: () => "Guardar y mostrar el resultado en la app", description: "", hours: 3 },
    { title: () => "Probar con datos de prueba del proveedor", description: "Casos felices y rechazos.", hours: 2 },
    { title: () => "Documentar la configuración en el README", description: "", hours: 1 },
  ],
  content: [
    { title: () => "Juntar el material que falta con el cliente", description: "Textos, fotos y datos de contacto.", hours: 1 },
    { title: () => "Redactar o adaptar los textos", description: "Tono del cliente y palabras clave principales.", hours: 3 },
    { title: () => "Cargar el contenido y revisar cómo se ve", description: "", hours: 2 },
    { title: () => "Pasar la revisión final con el cliente", description: "", hours: 1 },
  ],
  infra: [
    { title: () => "Documentar el estado actual y el plan de cambio", description: "Incluir cómo volver atrás si algo sale mal.", hours: 1 },
    { title: () => "Probar el cambio en staging", description: "", hours: 2 },
    { title: () => "Aplicar el cambio en producción en horario de bajo uso", description: "", hours: 1.5 },
    { title: () => "Configurar alertas y verificar durante 24 h", description: "", hours: 1 },
  ],
  general: [
    { title: (t) => `Relevar qué se necesita para ${lower(t)}`, description: "Alcance, dependencias y criterios de aceptación.", hours: 1.5 },
    { title: () => "Hacer la primera versión", description: "", hours: 4 },
    { title: () => "Revisar con el equipo y ajustar", description: "", hours: 1.5 },
    { title: () => "Cerrar y comunicar el resultado", description: "", hours: 0.5 },
  ],
};

/** Ítems de una checklist "- [ ] algo" en la descripción: son las subtareas más naturales. */
function checklistItems(markdown: string) {
  return [...markdown.matchAll(/^\s*[-*]\s+\[ \]\s+(.+)$/gm)].map((m) => m[1].trim()).filter(Boolean);
}

export function suggestSplit(actor: Actor, input: { taskId?: string; epicId?: string }) {
  if (input.taskId) {
    const task = getTaskDetail(actor, input.taskId);
    return runFeature(actor, task.projectId, "ai.use", () => {
      const existing = new Set(task.subtasks.map((s) => slugify(s.title)));
      const fromChecklist = checklistItems(task.descriptionMd).map((title) => ({
        title: title.charAt(0).toUpperCase() + title.slice(1),
        description: null as string | null,
        estimateHours: null as number | null,
      }));
      const list = fromChecklist.length >= 2
        ? fromChecklist
        : SPLIT_TEMPLATES[kindOf(`${task.title} ${task.descriptionMd}`)].map((s) => ({
            title: s.title(task.title),
            description: s.description || null,
            estimateHours: s.hours,
          }));
      const fresh = list.filter((s) => !existing.has(slugify(s.title)));
      return (fresh.length ? fresh : list).slice(0, 8);
    });
  }
  if (input.epicId) {
    const epic = getEpic(actor, input.epicId);
    return runFeature(actor, epic.projectId, "ai.use", () => {
      const kind = kindOf(`${epic.title} ${epic.descriptionMd}`);
      const base = epic.title.replace(/^(epic:?\s*)/i, "");
      const ideas = [
        { title: `Definir alcance y criterios de aceptación de "${base}"`, description: "Acordarlo con el cliente antes de estimar.", estimateHours: 3 },
        ...SPLIT_TEMPLATES[kind].slice(1).map((s) => ({ title: s.title(base), description: s.description || null, estimateHours: s.hours * 2 })),
        { title: `Preparar la demo de "${base}" para el cliente`, description: null, estimateHours: 2 },
      ];
      const existing = new Set(epic.tasks.map((t) => slugify(t.title)));
      return ideas.filter((i) => !existing.has(slugify(i.title)));
    });
  }
  throw new AppError("BAD_REQUEST", "Indicá una tarea o un epic");
}

export function suggestDescription(actor: Actor, input: { projectId: string; title: string; note?: string; current?: string }) {
  return runFeature(actor, input.projectId, "ai.use", () => {
    const current = input.current?.trim();
    const kind = kindOf(`${input.title} ${input.note ?? ""} ${current ?? ""}`);
    const steps = SPLIT_TEMPLATES[kind].slice(0, 4).map((s, i) => `${i + 1}. ${s.title(input.title)}`);
    const context = current
      ? current
          .split(/\n{2,}/)[0]
          .replace(/^#+\s*/gm, "")
          .trim()
      : input.note?.trim()
        ? input.note.trim().replace(/\s+/g, " ")
        : `Hay que ${lower(input.title)}.`;
    const checklist = current ? checklistItems(current) : [];
    const criteria = checklist.length
      ? checklist.map((c) => `- [ ] ${c}`)
      : kind === "bug"
        ? ["- [ ] El caso reportado ya no se reproduce", "- [ ] Hay un test que cubre el error", "- [ ] Se avisó a quien lo reportó"]
        : ["- [ ] Funciona en celular y en computadora", "- [ ] Quedó revisado por otra persona del equipo", "- [ ] El cliente lo aprobó en staging"];
    const doubts = !current && !input.note?.trim() ? ["", "### Dudas", "- ¿Hay una fecha comprometida con el cliente?", "- ¿Quién valida el resultado?"] : [];
    return [
      context.endsWith(".") ? context : `${context}.`,
      "",
      "### Qué hay que hacer",
      ...steps,
      "",
      "### Criterios de aceptación",
      ...criteria,
      ...doubts,
    ].join("\n");
  });
}

export function suggestFields(actor: Actor, taskId: string) {
  const task = getTaskDetail(actor, taskId);
  return runFeature(actor, task.projectId, "ai.use", () => {
    const text = `${task.title} ${task.descriptionMd}`;
    const kind = kindOf(text);
    const urgent = has(text, ["urgente", "caido", "caída", "produccion", "no pueden pagar", "bloquea", "todos los usuarios"]);
    const priority: Priority = urgent ? "urgent" : kind === "bug" ? "high" : has(text, ["mejora", "idea", "algun dia", "opcional"]) ? "low" : "medium";
    const steps = task.subtasks.length || SPLIT_TEMPLATES[kind].length;
    const estimateHours = Math.min(40, Math.max(1, Math.round((steps * (kind === "infra" ? 1.5 : 2) + task.descriptionMd.length / 400) * 2) / 2));
    const tags = db().tags.filter((t) => t.projectId === task.projectId);
    const byKind: Record<Kind, string[]> = {
      bug: ["bug", "error", "soporte"],
      ui: ["frontend", "diseño", "ux", "ui", "mobile"],
      api: ["backend", "api", "integracion", "integraciones", "pagos"],
      content: ["contenido", "seo", "textos"],
      infra: ["infra", "devops", "servidor"],
      general: [],
    };
    const wanted = byKind[kind].map(slugify);
    const matched = tags.filter((t) => wanted.includes(slugify(t.name)) || has(text, [t.name])).slice(0, 3);
    const newTags = matched.length === 0 && kind !== "general" ? [byKind[kind][0].charAt(0).toUpperCase() + byKind[kind][0].slice(1)] : [];
    const reasons: Record<Kind, string> = {
      bug: "Es un error que afecta a usuarios: conviene resolverlo antes que lo nuevo.",
      ui: "Trabajo de interfaz con varios estados y revisión del cliente.",
      api: "Depende de un servicio externo: suma tiempo de pruebas y manejo de errores.",
      content: "Depende de material del cliente; el trabajo técnico es acotado.",
      infra: "Cambio de infraestructura: conviene planificarlo y probarlo en staging.",
      general: "Estimación a partir del alcance descrito.",
    };
    return {
      priority,
      estimateHours,
      tagIds: matched.map((t) => t.id),
      newTags,
      reasoning: `${urgent ? "Menciona un impacto inmediato. " : ""}${reasons[kind]} (Sugerencia simulada en la demo.)`,
    };
  });
}

export function summarize(actor: Actor, input: { sprintId?: string; projectId?: string }) {
  const d = db();
  let projectId = input.projectId;
  const sprint = input.sprintId ? d.sprints.find((s) => s.id === input.sprintId) : undefined;
  if (input.sprintId && !sprint) throw notFound("Sprint");
  if (sprint) projectId = sprint.projectId;
  if (!projectId) throw new AppError("BAD_REQUEST", "Indicá un sprint o un proyecto");
  const pid = projectId;
  return runFeature(actor, pid, "ai.summarize", () => {
    const project = d.projects.find((p) => p.id === pid)!;
    const twoWeeksAgo = Date.now() - 14 * 86_400_000;
    const rows = d.tasks.filter(
      (t) =>
        t.projectId === pid &&
        !t.deletedAt &&
        !t.parentId &&
        (sprint ? t.sprintId === sprint.id : !t.completedAt || t.completedAt.getTime() >= twoWeeksAgo),
    );
    const column = (t: TaskRow) => d.columns.find((c) => c.id === t.columnId);
    const name = (id: string | null) => d.users.find((u) => u.id === id)?.name.split(" ")[0] ?? "sin responsable";
    const key = (t: TaskRow) => taskKey(project.key, t.number);
    const today = new Date().toISOString().slice(0, 10);
    const done = rows.filter((t) => column(t)?.category === "done");
    const doing = rows.filter((t) => column(t)?.category === "in_progress");
    const todo = rows.filter((t) => column(t)?.category === "todo");
    const overdue = rows.filter((t) => !t.completedAt && t.dueDate && t.dueDate < today);
    const urgentIdle = todo.filter((t) => t.priority === "urgent" || t.priority === "high");
    const unassigned = rows.filter((t) => !t.completedAt && !t.assigneeId);
    const pct = rows.length ? Math.round((done.length / rows.length) * 100) : 0;
    const hours = (list: TaskRow[]) => list.reduce((s, t) => s + (t.estimateHours ?? 0), 0);
    const list = (items: TaskRow[], max = 4) =>
      items
        .slice(0, max)
        .map((t) => `${key(t)} ${t.title} (${name(t.assigneeId)})`)
        .join("; ");

    const lines = [
      sprint
        ? `**${sprint.name}**${sprint.goal ? ` · ${sprint.goal}` : ""}`
        : `**${project.name}** · tareas abiertas y terminadas en las últimas dos semanas`,
      "",
      `- **Avance:** ${done.length} de ${rows.length} tareas terminadas (${pct} %)${hours(rows) ? `, ${hours(done)} de ${hours(rows)} h estimadas` : ""}.`,
      done.length ? `- **Terminado:** ${list(done)}${done.length > 4 ? ` y ${done.length - 4} más` : ""}.` : "- **Terminado:** todavía nada en este período.",
      doing.length ? `- **En curso:** ${list(doing)}.` : "- **En curso:** nada en este momento.",
    ];
    const risks: string[] = [];
    if (overdue.length) risks.push(`${overdue.length} vencida${overdue.length > 1 ? "s" : ""} (${overdue.map(key).slice(0, 3).join(", ")})`);
    if (urgentIdle.length) risks.push(`${urgentIdle.length} de prioridad alta o urgente sin empezar`);
    if (unassigned.length) risks.push(`${unassigned.length} sin responsable`);
    lines.push(risks.length ? `- **Riesgos:** ${risks.join("; ")}.` : "- **Riesgos:** no se ven bloqueos ni vencimientos.");
    const next: string[] = [];
    if (overdue[0]) next.push(`Definir nueva fecha o cerrar ${key(overdue[0])}`);
    if (urgentIdle[0]) next.push(`Empezar ${key(urgentIdle[0])} (${PRIORITY_META[urgentIdle[0].priority].label.toLowerCase()})`);
    if (unassigned[0]) next.push(`Asignar responsable a ${key(unassigned[0])}`);
    if (next.length === 0) next.push("Mantener el ritmo y revisar el backlog para el próximo sprint");
    lines.push("", "**Próximos pasos**", ...next.slice(0, 3).map((n, i) => `${i + 1}. ${n}.`));
    lines.push("", "_Resumen simulado en la demo, calculado con los datos reales del tablero._");
    return lines.join("\n");
  });
}

// ─── Crear tareas a partir de texto libre ───────────────────────────────

export const parseTasksInput = z.object({
  projectId: z.uuid(),
  text: z.string().trim().min(3, "Escribí qué tenés que hacer").max(4000),
  timezone: z.string().max(64).optional(),
});

const WEEKDAYS: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

function dueFrom(text: string): string | null {
  const t = slugify(text).replace(/-/g, " ");
  const today = new Date();
  const iso = (d: Date) => format(d, "yyyy-MM-dd");
  if (/\bpasado manana\b/.test(t)) return iso(addDays(today, 2));
  if (/\bmanana\b/.test(t)) return iso(addDays(today, 1));
  if (/\bhoy\b/.test(t)) return iso(today);
  if (/semana que viene|proxima semana/.test(t)) return iso(nextDay(today, 1));
  if (/fin de mes/.test(t)) return iso(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  for (const [day, n] of Object.entries(WEEKDAYS)) if (new RegExp(`\\b${day}\\b`).test(t)) return iso(nextDay(today, n));
  const m = /\b(\d{1,2})\/(\d{1,2})\b/.exec(text);
  if (m) {
    const date = new Date(today.getFullYear(), Number(m[2]) - 1, Number(m[1]));
    if (date < today) date.setFullYear(date.getFullYear() + 1);
    return iso(date);
  }
  return null;
}

const FILLERS =
  /^(tengo que|tenemos que|hay que|habría que|habria que|necesito|necesitamos|me falta|falta|acordarme de|no olvidar|y|también|tambien|además|ademas|después|despues|luego|el|la)\s+/i;
const DATES =
  /\b(?:(?:para |el |este |esta |la )?(?:pasado mañana|mañana|hoy|la semana que viene|la próxima semana|fin de mes|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo))\b/gi;
/** Un verbo en infinitivo (llamar, revisar, avisarle…): marca dónde empieza una tarea. */
const INFINITIVE = /\b[a-záéíóúñ]{2,}(?:ar|er|ir)(?:le|lo|la|les|los|las|se)?\b/i;

function cleanTitle(part: string) {
  let title = part.replace(DATES, " ").replace(/\b(es )?urgente\b/gi, " ").replace(/\s{2,}/g, " ").trim();
  for (let i = 0; i < 4; i++) title = title.replace(FILLERS, "");
  title = title.replace(/[\s,.;:]+$/, "").trim();
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** Corta el texto en acciones: por renglón, punto, coma o "y", y vuelve a unir lo que no tiene verbo. */
function splitActions(text: string) {
  const pieces = text
    .split(/\n+|;|\.\s+|,\s*|\s+y\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const actions: string[] = [];
  for (const piece of pieces) {
    if (actions.length && !INFINITIVE.test(piece.replace(DATES, " "))) actions[actions.length - 1] += ` y ${piece}`;
    else actions.push(piece);
  }
  return actions.filter((a) => a.length > 2);
}

export function parseTasks(actor: Actor, input: z.input<typeof parseTasksInput>) {
  const { projectId, text } = parseTasksInput.parse(input);
  return runFeature(actor, projectId, "ai.use", () => {
    const d = db();
    const members = d.members
      .filter((m) => m.projectId === projectId)
      .map((m) => d.users.find((u) => u.id === m.userId)!)
      .filter(Boolean);
    const tags = d.tags.filter((t) => t.projectId === projectId);
    const parts = splitActions(text);
    const result = parts.slice(0, 15).map((part) => {
      // Responsable: "que lo haga Martín", "Martín se encarga", "con Sofía". "Avisarle a Juan" no es asignar.
      const assignee =
        members.find((m) => {
          const first = slugify(m.name.split(" ")[0]);
          const p = slugify(part).replace(/-/g, " ");
          return new RegExp(`(lo haga|la haga|se encarga|asignar a|asignale a|para|que haga|con) ${first}\\b|\\b${first} (se encarga|lo hace|la hace)`).test(p);
        }) ?? null;
      const title = cleanTitle(part);
      return {
        title: title || part,
        descriptionMd: "",
        dueDate: dueFrom(part),
        priority: (has(part, ["urgente", "ya mismo", "cuanto antes", "asap"]) ? "urgent" : "medium") as Priority,
        assigneeId: assignee?.id ?? null,
        tagIds: tags.filter((t) => has(part, [t.name])).map((t) => t.id),
      };
    });
    if (result.length === 0) throw new AppError("BAD_REQUEST", "No encontré tareas en el texto");
    return result;
  });
}

export function aiStatus() {
  return { configured: true, model: "simulado (demo)" };
}

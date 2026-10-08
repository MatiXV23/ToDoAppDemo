import * as z from "zod";
import { type Actor, authorize } from "../access";
import { db, transaction, uuid } from "../db";
import { badRequest, notFound } from "../errors";
import { projectChannel, publish } from "../events";

/**
 * Agente Claude. En la app real una rutina de Claude Code toma las tareas por MCP y abre PRs;
 * en la demo los PRs del agente vienen de los datos de ejemplo y la configuración se guarda.
 */

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)");

export const agentSettingsSchema = z.object({
  projectId: z.uuid(),
  enabled: z.boolean(),
  tagId: z.uuid().nullable().optional(),
  mergeFrom: HHMM,
  mergeUntil: HHMM,
});

export const DEMO_TIMEZONE = "America/Montevideo";

export function getAgentSettings(actor: Actor, projectId: string) {
  authorize(actor, projectId, "project.view");
  const d = db();
  const project = d.projects.find((p) => p.id === projectId);
  if (!project) throw notFound("Proyecto");
  const pullRequests = d.agentPrs
    .filter((p) => p.projectId === projectId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20)
    .flatMap((p) => {
      const repo = d.repos.find((r) => r.id === p.projectRepositoryId);
      if (!repo) return [];
      return [
        {
          id: p.id,
          number: p.number,
          title: p.title,
          url: p.url,
          branch: p.branch,
          complexity: p.complexity,
          status: p.status,
          lastReason: p.lastReason,
          lastCheckAt: p.lastCheckAt,
          createdAt: p.createdAt,
          repo: repo.fullName,
        },
      ];
    });
  return {
    enabled: project.agentEnabled,
    tagId: project.agentTagId,
    mergeFrom: project.agentMergeFrom,
    mergeUntil: project.agentMergeUntil,
    timezone: DEMO_TIMEZONE,
    pullRequests,
  };
}

export function updateAgentSettings(actor: Actor, input: z.input<typeof agentSettingsSchema>) {
  const data = agentSettingsSchema.parse(input);
  authorize(actor, data.projectId, "project.update");
  transaction(() => {
    const d = db();
    let tagId = data.tagId ?? null;
    if (data.enabled && !tagId) {
      // Al activarlo sin tag elegido se usa (o crea) el tag "IA".
      const existing = d.tags.find((t) => t.projectId === data.projectId && t.name === "IA");
      if (existing) tagId = existing.id;
      else {
        tagId = uuid();
        d.tags.push({ id: tagId, projectId: data.projectId, name: "IA", color: "#a855f7", createdAt: new Date() });
        publish(projectChannel(data.projectId), { type: "board" }, actor);
      }
    }
    if (tagId && !d.tags.some((t) => t.id === tagId && t.projectId === data.projectId)) throw badRequest("Tag inválido");
    const project = d.projects.find((p) => p.id === data.projectId)!;
    project.agentEnabled = data.enabled;
    project.agentTagId = tagId;
    project.agentMergeFrom = data.mergeFrom;
    project.agentMergeUntil = data.mergeUntil;
    publish(projectChannel(data.projectId), { type: "project" }, actor);
  });
}

export function requeueTask(actor: Actor, taskId: string) {
  transaction(() => {
    const task = db().tasks.find((t) => t.id === taskId);
    if (!task) throw notFound("Tarea");
    authorize(actor, task.projectId, "task.update");
    task.agentStatus = null;
    task.agentBranch = null;
    publish(projectChannel(task.projectId), { type: "board", taskIds: [taskId] }, actor);
    publish(projectChannel(task.projectId), { type: "task", taskId }, actor);
  });
}

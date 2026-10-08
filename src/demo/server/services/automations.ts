import * as z from "zod";
import { type RuleInput, ruleInputSchema } from "@/lib/automation-schema";
import { type Actor, actorUserId, authorize } from "../access";
import { db, type RuleRow, transaction, uuid } from "../db";
import { badRequest, notFound } from "../errors";
import { projectChannel, publish } from "../events";

/** Verifica que columnas, tags, epics y personas usados por la regla sean del proyecto. */
function validateReferences(projectId: string, rule: RuleInput) {
  const d = db();
  const columnIds = new Set<string>();
  const tagIds = new Set<string>();
  const epicIds = new Set<string>();
  const userIds = new Set<string>();
  if (rule.trigger.type === "task.moved") {
    if (rule.trigger.fromColumnId) columnIds.add(rule.trigger.fromColumnId);
    if (rule.trigger.toColumnId) columnIds.add(rule.trigger.toColumnId);
  }
  for (const c of rule.conditions) {
    if (c.type === "column") columnIds.add(c.columnId);
    if (c.type === "tag") tagIds.add(c.tagId);
    if (c.type === "epic" && c.epicId) epicIds.add(c.epicId);
    if (c.type === "assignee" && c.userId) userIds.add(c.userId);
  }
  for (const a of rule.actions) {
    if (a.type === "move_to_column") columnIds.add(a.columnId);
    if (a.type === "add_tag" || a.type === "remove_tag") tagIds.add(a.tagId);
    if (a.type === "assign" && a.userId) userIds.add(a.userId);
  }
  const check = (ids: Set<string>, found: number, what: string) => {
    if (ids.size && found !== ids.size) throw badRequest(`La regla usa ${what} que no pertenece al proyecto`);
  };
  check(columnIds, d.columns.filter((c) => c.projectId === projectId && columnIds.has(c.id)).length, "una columna");
  check(tagIds, d.tags.filter((t) => t.projectId === projectId && tagIds.has(t.id)).length, "un tag");
  check(epicIds, d.epics.filter((e) => e.projectId === projectId && epicIds.has(e.id)).length, "un epic");
  check(userIds, d.members.filter((m) => m.projectId === projectId && userIds.has(m.userId)).length, "una persona");
}

export const createRuleSchema = ruleInputSchema.extend({ projectId: z.uuid() });
export const updateRuleSchema = ruleInputSchema.extend({ ruleId: z.uuid() });

export function listRules(actor: Actor, projectId: string) {
  authorize(actor, projectId, "automation.view");
  const d = db();
  return d.rules
    .filter((r) => r.projectId === projectId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((r) => {
      const runs = d.runs.filter((x) => x.ruleId === r.id);
      const lastRunAt = runs.length ? new Date(Math.max(...runs.map((x) => x.createdAt.getTime()))) : null;
      const row = {
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        trigger: r.trigger,
        conditions: r.conditions,
        actions: r.actions,
        createdAt: r.createdAt,
        lastRunAt,
        runs: runs.filter((x) => x.status === "success").length,
        failures: runs.filter((x) => x.status === "failed").length,
      };
      const parsed = ruleInputSchema.safeParse(row);
      return { ...row, ...(parsed.data ?? {}), valid: parsed.success };
    });
}

export function createRule(actor: Actor, input: z.input<typeof createRuleSchema>) {
  const { projectId, ...rule } = createRuleSchema.parse(input);
  return transaction(() => {
    authorize(actor, projectId, "automation.manage");
    validateReferences(projectId, rule);
    const now = new Date();
    const row: RuleRow = { id: uuid(), projectId, ...rule, createdById: actorUserId(actor), createdAt: now, updatedAt: now };
    db().rules.push(row);
    publish(projectChannel(projectId), { type: "automation" }, actor);
    return { ...row };
  });
}

function loadRule(ruleId: string) {
  const rule = db().rules.find((r) => r.id === ruleId);
  if (!rule) throw notFound("Regla");
  return rule;
}

export function updateRule(actor: Actor, input: z.input<typeof updateRuleSchema>) {
  const { ruleId, ...rule } = updateRuleSchema.parse(input);
  return transaction(() => {
    const existing = loadRule(ruleId);
    authorize(actor, existing.projectId, "automation.manage");
    validateReferences(existing.projectId, rule);
    Object.assign(existing, rule, { updatedAt: new Date() });
    publish(projectChannel(existing.projectId), { type: "automation" }, actor);
    return { ...existing };
  });
}

export function setRuleEnabled(actor: Actor, ruleId: string, enabled: boolean) {
  transaction(() => {
    const existing = loadRule(ruleId);
    authorize(actor, existing.projectId, "automation.manage");
    existing.enabled = enabled;
    publish(projectChannel(existing.projectId), { type: "automation" }, actor);
  });
}

export function deleteRule(actor: Actor, ruleId: string) {
  transaction(() => {
    const existing = loadRule(ruleId);
    authorize(actor, existing.projectId, "automation.manage");
    db().rules = db().rules.filter((r) => r.id !== ruleId);
    db().runs = db().runs.filter((r) => r.ruleId !== ruleId);
    publish(projectChannel(existing.projectId), { type: "automation" }, actor);
  });
}

export function listRuns(
  actor: Actor,
  input: { projectId: string; ruleId?: string; status?: "success" | "skipped" | "failed"; limit?: number },
) {
  authorize(actor, input.projectId, "automation.view");
  const d = db();
  const project = d.projects.find((p) => p.id === input.projectId)!;
  return d.runs
    .filter((r) => r.projectId === input.projectId && (!input.ruleId || r.ruleId === input.ruleId) && (!input.status || r.status === input.status))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, Math.min(input.limit ?? 100, 300))
    .flatMap((r) => {
      const rule = d.rules.find((x) => x.id === r.ruleId);
      if (!rule) return [];
      const task = r.taskId ? d.tasks.find((t) => t.id === r.taskId) : undefined;
      return [
        {
          id: r.id,
          ruleId: r.ruleId,
          ruleName: rule.name,
          triggerType: r.triggerType,
          status: r.status,
          reason: r.reason,
          details: r.details,
          depth: r.depth,
          createdAt: r.createdAt,
          task: task ? { id: task.id, number: task.number, title: task.title } : null,
          projectKey: project.key,
        },
      ];
    });
}

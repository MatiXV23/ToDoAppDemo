import * as z from "zod";
import * as agent from "./services/agent";
import * as ai from "./services/ai";
import * as access from "./services/app-access";
import * as apiTokens from "./services/api-tokens";
import * as attachments from "./services/attachments";
import * as automations from "./services/automations";
import * as board from "./services/board";
import * as columns from "./services/columns";
import * as comments from "./services/comments";
import * as epics from "./services/epics";
import * as members from "./services/members";
import * as notifications from "./services/notifications";
import * as projects from "./services/projects";
import * as repos from "./services/repos";
import * as review from "./services/review";
import * as sprints from "./services/sprints";
import * as tags from "./services/tags";
import * as tasks from "./services/tasks";
import { authedProcedure as p, router } from "./trpc";

/**
 * Los mismos routers que src/server/trpc/routers del original (nombres, entradas y salidas),
 * resueltos contra la base de la demo. Los componentes no notan la diferencia.
 */

const id = z.uuid();

export const projectRouter = router({
  list: p.query(({ ctx }) => projects.listMyProjects(ctx.user.id)),
  byKey: p.input(z.object({ key: z.string() })).query(({ ctx, input }) => projects.getProjectByKey(ctx.actor, input.key)),
  create: p.input(projects.createProjectSchema).mutation(({ ctx, input }) => projects.createProject(ctx.actor, input)),
  update: p.input(projects.updateProjectSchema).mutation(({ ctx, input }) => projects.updateProject(ctx.actor, input)),
  setArchived: p
    .input(z.object({ projectId: id, archived: z.boolean() }))
    .mutation(({ ctx, input }) => projects.setArchived(ctx.actor, input.projectId, input.archived)),
  delete: p
    .input(z.object({ projectId: id, confirmKey: z.string() }))
    .mutation(({ ctx, input }) => projects.deleteProject(ctx.actor, input.projectId, input.confirmKey)),
});

export const memberRouter = router({
  list: p.input(z.object({ projectId: id })).query(({ ctx, input }) => members.listMembers(ctx.actor, input.projectId)),
  invite: p.input(members.inviteSchema).mutation(({ ctx, input }) => members.inviteMember(ctx.actor, input)),
  revokeInvitation: p
    .input(z.object({ invitationId: id }))
    .mutation(({ ctx, input }) => members.revokeInvitation(ctx.actor, input.invitationId)),
  myInvitations: p.query(({ ctx }) => members.listMyInvitations(ctx.user.id)),
  respond: p
    .input(z.object({ invitationId: id, accept: z.boolean() }))
    .mutation(({ ctx, input }) => members.respondInvitation(ctx.actor, input.invitationId, input.accept)),
  changeRole: p
    .input(z.object({ projectId: id, userId: z.string(), role: z.enum(["editor", "viewer"]) }))
    .mutation(({ ctx, input }) => members.changeRole(ctx.actor, input)),
  remove: p
    .input(z.object({ projectId: id, userId: z.string() }))
    .mutation(({ ctx, input }) => members.removeMember(ctx.actor, input)),
});

export const notificationRouter = router({
  list: p.query(({ ctx }) => notifications.listNotifications(ctx.user.id)),
  unreadCount: p.query(({ ctx }) => notifications.unreadCount(ctx.user.id)),
  markRead: p
    .input(z.object({ ids: z.array(id).optional() }))
    .mutation(({ ctx, input }) => notifications.markRead(ctx.user.id, input.ids)),
});

export const boardRouter = router({
  get: p.input(z.object({ projectId: id })).query(({ ctx, input }) => board.getBoard(ctx.actor, input.projectId)),
});

export const taskRouter = router({
  get: p.input(z.object({ taskId: id })).query(({ ctx, input }) => tasks.getTaskDetail(ctx.actor, input.taskId)),
  findId: p
    .input(z.object({ projectId: id, number: z.number().int().positive() }))
    .query(({ ctx, input }) => tasks.findTaskId(ctx.actor, input.projectId, input.number)),
  create: p.input(tasks.createTaskSchema).mutation(({ ctx, input }) => tasks.createTask(ctx.actor, input)),
  update: p.input(tasks.updateTaskSchema).mutation(({ ctx, input }) => tasks.updateTask(ctx.actor, input)),
  move: p.input(tasks.moveTaskSchema).mutation(({ ctx, input }) => tasks.moveTask(ctx.actor, input)),
  delete: p.input(z.object({ taskId: id })).mutation(({ ctx, input }) => tasks.deleteTask(ctx.actor, input.taskId)),
  restore: p.input(z.object({ taskId: id })).mutation(({ ctx, input }) => tasks.restoreTask(ctx.actor, input.taskId)),
  setApproval: p
    .input(z.object({ taskId: id, approved: z.boolean() }))
    .mutation(({ ctx, input }) => review.setTaskApproval(ctx.actor, input.taskId, input.approved)),
});

export const commentRouter = router({
  add: p.input(comments.addCommentSchema).mutation(({ ctx, input }) => comments.addComment(ctx.actor, input)),
  update: p
    .input(z.object({ commentId: id, bodyMd: z.string() }))
    .mutation(({ ctx, input }) => comments.updateComment(ctx.actor, input)),
  delete: p.input(z.object({ commentId: id })).mutation(({ ctx, input }) => comments.deleteComment(ctx.actor, input.commentId)),
});

export const columnRouter = router({
  create: p.input(columns.createColumnSchema).mutation(({ ctx, input }) => columns.createColumn(ctx.actor, input)),
  update: p.input(columns.updateColumnSchema).mutation(({ ctx, input }) => columns.updateColumn(ctx.actor, input)),
  move: p
    .input(z.object({ columnId: id, afterColumnId: id.nullable() }))
    .mutation(({ ctx, input }) => columns.moveColumn(ctx.actor, input)),
  delete: p
    .input(z.object({ columnId: id, moveTasksTo: id }))
    .mutation(({ ctx, input }) => columns.deleteColumn(ctx.actor, input)),
});

export const tagRouter = router({
  list: p.input(z.object({ projectId: id })).query(({ ctx, input }) => tags.listTags(ctx.actor, input.projectId)),
  create: p.input(tags.createTagSchema).mutation(({ ctx, input }) => tags.createTag(ctx.actor, input)),
  update: p.input(tags.updateTagSchema).mutation(({ ctx, input }) => tags.updateTag(ctx.actor, input)),
  delete: p.input(z.object({ tagId: id })).mutation(({ ctx, input }) => tags.deleteTag(ctx.actor, input.tagId)),
});

export const epicRouter = router({
  list: p.input(z.object({ projectId: id })).query(({ ctx, input }) => epics.listEpics(ctx.actor, input.projectId)),
  get: p.input(z.object({ epicId: id })).query(({ ctx, input }) => epics.getEpic(ctx.actor, input.epicId)),
  create: p.input(epics.createEpicSchema).mutation(({ ctx, input }) => epics.createEpic(ctx.actor, input)),
  update: p.input(epics.updateEpicSchema).mutation(({ ctx, input }) => epics.updateEpic(ctx.actor, input)),
  delete: p.input(z.object({ epicId: id })).mutation(({ ctx, input }) => epics.deleteEpic(ctx.actor, input.epicId)),
});

export const sprintRouter = router({
  backlog: p.input(z.object({ projectId: id })).query(({ ctx, input }) => sprints.getBacklog(ctx.actor, input.projectId)),
  create: p.input(sprints.createSprintSchema).mutation(({ ctx, input }) => sprints.createSprint(ctx.actor, input)),
  update: p.input(sprints.updateSprintSchema).mutation(({ ctx, input }) => sprints.updateSprint(ctx.actor, input)),
  start: p
    .input(z.object({ sprintId: id, startDate: z.iso.date().nullish(), endDate: z.iso.date().nullish() }))
    .mutation(({ ctx, input }) => sprints.startSprint(ctx.actor, input)),
  complete: p.input(sprints.completeSprintSchema).mutation(({ ctx, input }) => sprints.completeSprint(ctx.actor, input)),
  delete: p.input(z.object({ sprintId: id })).mutation(({ ctx, input }) => sprints.deleteSprint(ctx.actor, input.sprintId)),
  moveTask: p.input(sprints.moveInBacklogSchema).mutation(({ ctx, input }) => sprints.moveInBacklog(ctx.actor, input)),
});

export const attachmentRouter = router({
  delete: p
    .input(z.object({ attachmentId: id }))
    .mutation(({ ctx, input }) => attachments.deleteAttachment(ctx.actor, input.attachmentId)),
  /** Solo en la demo: reemplaza a POST /api/tasks/:id/attachments. */
  upload: p
    .input(attachments.uploadAttachmentSchema)
    .mutation(({ ctx, input }) => attachments.addAttachment(ctx.actor, input)),
});

export const tokenRouter = router({
  list: p.query(({ ctx }) => apiTokens.listApiTokens(ctx.user.id)),
  create: p.input(apiTokens.createTokenSchema).mutation(({ ctx, input }) => apiTokens.createApiToken(ctx.user.id, input)),
  setExternal: p
    .input(z.object({ tokenId: id, external: z.boolean() }))
    .mutation(({ ctx, input }) => apiTokens.setApiTokenExternal(ctx.user.id, input.tokenId, input.external)),
  revoke: p.input(z.object({ tokenId: id })).mutation(({ ctx, input }) => apiTokens.revokeApiToken(ctx.user.id, input.tokenId)),
});

export const accessRouter = router({
  list: p.query(({ ctx }) => access.listAccess(ctx.actor)),
  pendingCount: p.query(({ ctx }) => access.pendingAccessCount(ctx.actor)),
  decide: p.input(access.decideAccessSchema).mutation(({ ctx, input }) => access.decideAccess(ctx.actor, input)),
});

export const automationRouter = router({
  list: p.input(z.object({ projectId: id })).query(({ ctx, input }) => automations.listRules(ctx.actor, input.projectId)),
  create: p.input(automations.createRuleSchema).mutation(({ ctx, input }) => automations.createRule(ctx.actor, input)),
  update: p.input(automations.updateRuleSchema).mutation(({ ctx, input }) => automations.updateRule(ctx.actor, input)),
  setEnabled: p
    .input(z.object({ ruleId: id, enabled: z.boolean() }))
    .mutation(({ ctx, input }) => automations.setRuleEnabled(ctx.actor, input.ruleId, input.enabled)),
  delete: p.input(z.object({ ruleId: id })).mutation(({ ctx, input }) => automations.deleteRule(ctx.actor, input.ruleId)),
  runs: p
    .input(
      z.object({
        projectId: id,
        ruleId: id.optional(),
        status: z.enum(["success", "skipped", "failed"]).optional(),
        limit: z.number().int().min(1).max(300).optional(),
      }),
    )
    .query(({ ctx, input }) => automations.listRuns(ctx.actor, input)),
});

export const githubRouter = router({
  status: p.input(z.object({ projectId: id })).query(({ ctx, input }) => repos.getIntegrationStatus(ctx.actor, input.projectId)),
  availableRepos: p
    .input(z.object({ projectId: id }))
    .query(({ ctx, input }) => repos.listAvailableRepos(ctx.actor, input.projectId)),
  connectRepo: p
    .input(z.object({ projectId: id, installationId: id, externalRepoId: z.string() }))
    .mutation(({ ctx, input }) => repos.connectRepo(ctx.actor, input)),
  disconnectRepo: p
    .input(z.object({ projectRepositoryId: id }))
    .mutation(({ ctx, input }) => repos.disconnectRepo(ctx.actor, input.projectRepositoryId)),
  createBranch: p
    .input(z.object({ taskId: id, projectRepositoryId: id, branch: z.string().min(1).max(200), baseBranch: z.string().max(200).optional() }))
    .mutation(({ ctx, input }) => repos.createBranchForTask(ctx.actor, input)),
  unlink: p.input(z.object({ linkId: id })).mutation(({ ctx, input }) => repos.unlinkVcs(ctx.actor, input.linkId)),
  branchStatus: p.input(z.object({ linkId: id })).query(({ ctx, input }) => repos.getBranchStatus(ctx.actor, input.linkId)),
  /** Solo en la demo: reemplaza el ida y vuelta a GitHub de /api/integrations/github/connect. */
  simulateInstall: p
    .input(z.object({ projectId: id }))
    .mutation(({ ctx, input }) => repos.simulateInstall(ctx.actor, input.projectId)),
});

export const aiRouter = router({
  status: p.query(() => ai.aiStatus()),
  split: p
    .input(z.object({ taskId: id.optional(), epicId: id.optional() }))
    .mutation(({ ctx, input }) => ai.suggestSplit(ctx.actor, input)),
  description: p
    .input(
      z.object({
        projectId: id,
        title: z.string().min(1).max(300),
        note: z.string().max(5000).optional(),
        current: z.string().max(20_000).optional(),
      }),
    )
    .mutation(({ ctx, input }) => ai.suggestDescription(ctx.actor, input)),
  fields: p.input(z.object({ taskId: id })).mutation(({ ctx, input }) => ai.suggestFields(ctx.actor, input.taskId)),
  summary: p
    .input(z.object({ sprintId: id.optional(), projectId: id.optional() }))
    .mutation(({ ctx, input }) => ai.summarize(ctx.actor, input)),
  parseTasks: p.input(ai.parseTasksInput).mutation(({ ctx, input }) => ai.parseTasks(ctx.actor, input)),
});

export const agentRouter = router({
  settings: p.input(z.object({ projectId: z.uuid() })).query(({ ctx, input }) => agent.getAgentSettings(ctx.actor, input.projectId)),
  update: p.input(agent.agentSettingsSchema).mutation(({ ctx, input }) => agent.updateAgentSettings(ctx.actor, input)),
  requeue: p.input(z.object({ taskId: z.uuid() })).mutation(({ ctx, input }) => agent.requeueTask(ctx.actor, input.taskId)),
});

import * as z from "zod";
import { type Actor, actorUserId, authorize } from "../access";
import { db, transaction, uuid } from "../db";
import { forbidden, notFound } from "../errors";
import { projectChannel, publish } from "../events";
import { can } from "../permissions";
import { notify } from "./notifications";
import { isExternalActor, requestReviewIfExternal } from "./review";
import { loadTask } from "./tasks";

export const addCommentSchema = z.object({
  taskId: z.uuid(),
  bodyMd: z.string().trim().min(1, "El comentario está vacío").max(20_000),
});

export function addComment(actor: Actor, input: z.input<typeof addCommentSchema>) {
  const { taskId, bodyMd } = addCommentSchema.parse(input);
  return transaction(() => {
    const task = loadTask(taskId);
    authorize(actor, task.projectId, "comment.create");
    const comment = {
      id: uuid(),
      taskId,
      bodyMd,
      authorId: actorUserId(actor),
      source: actor.type === "automation" ? ("automation" as const) : actor.type === "user" ? ("user" as const) : ("system" as const),
      automationRuleId: actor.type === "automation" ? actor.ruleId : null,
      via: actor.type === "user" ? (actor.via ?? null) : null,
      createdAt: new Date(),
      editedAt: null,
    };
    db().comments.push(comment);
    requestReviewIfExternal(actor, [taskId]);

    // Solo los comentarios de personas generan avisos; los automáticos serían ruido.
    const recipients =
      actor.type === "user" ? new Set([task.assigneeId, task.reporterId].filter((id): id is string => !!id)) : new Set<string>();
    for (const userId of recipients) {
      notify({
        userId,
        type: "comment",
        projectId: task.projectId,
        taskId,
        actorId: actorUserId(actor),
        data: { excerpt: bodyMd.slice(0, 140) },
      });
    }
    publish(projectChannel(task.projectId), { type: "task", taskId }, actor);
    publish(projectChannel(task.projectId), { type: "board", taskIds: [taskId] }, actor);
    return { ...comment };
  });
}

function loadOwnComment(actor: Actor, commentId: string, moderateAllowed: boolean) {
  const comment = db().comments.find((c) => c.id === commentId);
  if (!comment) throw notFound("Comentario");
  const task = loadTask(comment.taskId);
  const role = authorize(actor, task.projectId, "project.view");
  const isAuthor = actor.type === "user" && comment.authorId === actor.userId;
  if (!isAuthor && !(moderateAllowed && can(role, "comment.moderate"))) throw forbidden();
  if (isAuthor && !can(role, "comment.create")) throw forbidden();
  return { comment, task };
}

export function updateComment(actor: Actor, input: { commentId: string; bodyMd: string }) {
  const bodyMd = addCommentSchema.shape.bodyMd.parse(input.bodyMd);
  return transaction(() => {
    const { comment, task } = loadOwnComment(actor, input.commentId, false);
    comment.bodyMd = bodyMd;
    comment.editedAt = new Date();
    requestReviewIfExternal(actor, [task.id]);
    publish(projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
    if (isExternalActor(actor)) publish(projectChannel(task.projectId), { type: "board", taskIds: [task.id] }, actor);
    return { ...comment };
  });
}

export function deleteComment(actor: Actor, commentId: string) {
  transaction(() => {
    const { task } = loadOwnComment(actor, commentId, true);
    db().comments = db().comments.filter((c) => c.id !== commentId);
    publish(projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
    publish(projectChannel(task.projectId), { type: "board", taskIds: [task.id] }, actor);
  });
}

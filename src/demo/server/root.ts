import { handleDomainEvent } from "./automations/executor";
import { registerSeed } from "./db";
import { registerWorker } from "./events";
import {
  accessRouter,
  agentRouter,
  aiRouter,
  attachmentRouter,
  automationRouter,
  boardRouter,
  columnRouter,
  commentRouter,
  epicRouter,
  githubRouter,
  memberRouter,
  notificationRouter,
  projectRouter,
  sprintRouter,
  tagRouter,
  taskRouter,
  tokenRouter,
} from "./routers";
import { buildSeed } from "./seed";
import { router } from "./trpc";

registerSeed(buildSeed);
registerWorker(handleDomainEvent);

export const appRouter = router({
  project: projectRouter,
  member: memberRouter,
  notification: notificationRouter,
  board: boardRouter,
  task: taskRouter,
  comment: commentRouter,
  column: columnRouter,
  tag: tagRouter,
  epic: epicRouter,
  sprint: sprintRouter,
  attachment: attachmentRouter,
  token: tokenRouter,
  automation: automationRouter,
  github: githubRouter,
  ai: aiRouter,
  agent: agentRouter,
  access: accessRouter,
});

export type AppRouter = typeof appRouter;

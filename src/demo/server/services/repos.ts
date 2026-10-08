import { type Actor, authorize } from "../access";
import { db, transaction, uuid } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { emitDomainEvent, projectChannel, publish } from "../events";
import { logActivity } from "./activity";
import { loadTask } from "./tasks";

/**
 * GitHub simulado: las instalaciones, repos, ramas y PRs vienen de los datos de ejemplo.
 * Nada sale del navegador; crear una rama solo la registra en la base de la demo.
 */

const LINK_LABEL = { branch: "Rama", commit: "Commit", pull_request: "PR" } as const;

function myInstallations(userId: string) {
  return db()
    .installations.filter((i) => i.provider === "github" && i.userIds.includes(userId))
    .map((i) => ({ id: i.id, externalId: i.externalId, accountLogin: i.accountLogin }));
}

export function getIntegrationStatus(actor: Actor, projectId: string) {
  const role = authorize(actor, projectId, "project.view");
  const repos = db()
    .repos.filter((r) => r.projectId === projectId)
    .map((r) => ({ id: r.id, fullName: r.fullName, htmlUrl: r.htmlUrl, defaultBranch: r.defaultBranch, provider: r.provider }));
  const installations = actor.type === "user" && role === "owner" ? myInstallations(actor.userId) : [];
  return { configured: true, repos, installations };
}

/** "Instalar la GitHub App": en la demo vincula la cuenta de ejemplo sin salir de la página. */
export function simulateInstall(actor: Actor, projectId: string) {
  authorize(actor, projectId, "repo.connect");
  if (actor.type !== "user") throw forbidden();
  return transaction(() => {
    const installation = db().installations.find((i) => i.provider === "github");
    if (!installation) throw notFound("Instalación");
    if (!installation.userIds.includes(actor.userId)) installation.userIds.push(actor.userId);
    publish(projectChannel(projectId), { type: "project" }, actor);
    return { accountLogin: installation.accountLogin };
  });
}

export function listAvailableRepos(actor: Actor, projectId: string) {
  authorize(actor, projectId, "repo.connect");
  if (actor.type !== "user") throw forbidden();
  const d = db();
  const connected = new Set(d.repos.filter((r) => r.projectId === projectId).map((r) => r.externalRepoId));
  return myInstallations(actor.userId).flatMap((inst) =>
    d.githubRepos
      .filter((r) => r.installationId === inst.id)
      .map((r) => ({
        externalId: r.externalId,
        fullName: r.fullName,
        htmlUrl: r.htmlUrl,
        defaultBranch: r.defaultBranch,
        private: r.private,
        installationId: inst.id,
        account: inst.accountLogin,
        connected: connected.has(r.externalId),
      })),
  );
}

export function connectRepo(actor: Actor, input: { projectId: string; installationId: string; externalRepoId: string }) {
  authorize(actor, input.projectId, "repo.connect");
  if (actor.type !== "user") throw forbidden();
  const installation = myInstallations(actor.userId).find((i) => i.id === input.installationId);
  if (!installation) throw forbidden("No tenés acceso a esa instalación");
  const repo = db().githubRepos.find((r) => r.installationId === installation.id && r.externalId === input.externalRepoId);
  if (!repo) throw notFound("Repositorio");
  return transaction(() => {
    const d = db();
    if (d.repos.some((r) => r.projectId === input.projectId && r.externalRepoId === repo.externalId)) {
      throw conflict("El repositorio ya está conectado");
    }
    const row = {
      id: uuid(),
      projectId: input.projectId,
      installationId: installation.id,
      provider: "github",
      externalRepoId: repo.externalId,
      fullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
      htmlUrl: repo.htmlUrl,
      createdAt: new Date(),
    };
    d.repos.push(row);
    publish(projectChannel(input.projectId), { type: "project" }, actor);
    return { ...row };
  });
}

export function disconnectRepo(actor: Actor, projectRepositoryId: string) {
  return transaction(() => {
    const d = db();
    const repo = d.repos.find((r) => r.id === projectRepositoryId);
    if (!repo) throw notFound("Repositorio");
    authorize(actor, repo.projectId, "repo.connect");
    d.repos = d.repos.filter((r) => r.id !== repo.id);
    d.links = d.links.filter((l) => l.projectRepositoryId !== repo.id);
    d.agentPrs = d.agentPrs.filter((p) => p.projectRepositoryId !== repo.id);
    publish(projectChannel(repo.projectId), { type: "project" }, actor);
    publish(projectChannel(repo.projectId), { type: "board" }, actor);
    return { ...repo };
  });
}

export function createBranchForTask(
  actor: Actor,
  input: { taskId: string; projectRepositoryId: string; branch: string; baseBranch?: string },
) {
  const task = loadTask(input.taskId);
  authorize(actor, task.projectId, "repo.link");
  const repo = db().repos.find((r) => r.id === input.projectRepositoryId);
  if (!repo) throw notFound("Repositorio");
  if (repo.projectId !== task.projectId) throw badRequest("El repositorio no pertenece al proyecto");
  const branch = input.branch.trim();
  if (!/^[A-Za-z0-9._\-/]+$/.test(branch) || branch.includes("..") || branch.endsWith("/")) {
    throw badRequest("Nombre de rama inválido");
  }
  const url = `${repo.htmlUrl}/tree/${branch}`;
  return transaction(() => {
    const d = db();
    const existing = d.links.find(
      (l) => l.taskId === task.id && l.projectRepositoryId === repo.id && l.kind === "branch" && l.externalId === branch,
    );
    const created = !existing;
    if (created) {
      const now = new Date();
      d.links.push({
        id: uuid(),
        taskId: task.id,
        projectRepositoryId: repo.id,
        kind: "branch",
        externalId: branch,
        title: branch,
        url,
        state: "active",
        data: { base: input.baseBranch?.trim() || repo.defaultBranch },
        createdAt: now,
        updatedAt: now,
      });
      logActivity(actor, [
        { taskId: task.id, projectId: task.projectId, kind: "linked", field: "branch", newValue: { id: branch, label: `${LINK_LABEL.branch} ${branch}` } },
      ]);
      emitDomainEvent({
        projectId: task.projectId,
        type: "branch.created",
        taskId: task.id,
        actor,
        payload: { branch, repo: repo.fullName, url },
      });
    }
    publish(projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
    return { created, url, branch };
  });
}

export function unlinkVcs(actor: Actor, linkId: string) {
  transaction(() => {
    const d = db();
    const link = d.links.find((l) => l.id === linkId);
    if (!link) throw notFound("Vínculo");
    const task = loadTask(link.taskId);
    authorize(actor, task.projectId, "repo.link");
    d.links = d.links.filter((l) => l.id !== linkId);
    logActivity(actor, [
      {
        taskId: task.id,
        projectId: task.projectId,
        kind: "unlinked",
        field: link.kind,
        oldValue: { id: link.externalId, label: `${LINK_LABEL[link.kind]} ${link.kind === "pull_request" ? `#${link.externalId}` : link.title}` },
      },
    ]);
    publish(projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
    publish(projectChannel(task.projectId), { type: "board", taskIds: [task.id] }, actor);
  });
}

/** Commits adelante/atrás de la rama: en la demo salen de los datos del vínculo. */
export function getBranchStatus(actor: Actor, linkId: string) {
  const link = db().links.find((l) => l.id === linkId);
  if (!link || link.kind !== "branch") throw notFound("Rama");
  const task = loadTask(link.taskId);
  authorize(actor, task.projectId, "project.view");
  const data = link.data as { aheadBy?: number; behindBy?: number };
  return { exists: true, aheadBy: data.aheadBy ?? 0, behindBy: data.behindBy ?? 0 };
}

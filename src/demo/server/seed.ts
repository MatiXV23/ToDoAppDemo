import { addDays, format } from "date-fns";
import type { RuleInput } from "@/lib/automation-schema";
import { type ColumnCategory, type Priority, PRIORITIES } from "@/lib/domain";
import { ranksBetween } from "@/lib/rank";
import age from "../seed/projects/age.json";
import coop from "../seed/projects/coop.json";
import rut from "../seed/projects/rut.json";
import sop from "../seed/projects/sop.json";
import tie from "../seed/projects/tie.json";
import users from "../seed/users.json";
import workspace from "../seed/workspace.json";
import { evaluateConditions, type Labels, type TaskSnapshot } from "./automations/engine";
import {
  type ActivityRow,
  type ColumnRow,
  type Db,
  DB_VERSION,
  type NotificationRow,
  type ProjectRepoRow,
  type RuleRow,
  type TaskRow,
  uuid,
  type VcsLinkRow,
} from "./db";
import type { Role } from "./permissions";

/**
 * Arma la base de la demo a partir de los JSON de src/demo/seed. Las fechas de los JSON son
 * días relativos a hoy (−3 = hace tres días), así la demo siempre se ve al día: lo que
 * "vence mañana" vence mañana para cualquier visitante.
 */

// ─── Tipos de los JSON ──────────────────────────────────────────────────

type SeedLink =
  | { k: "pr"; repo: string; n: number; title: string; state: string; branch: string; at: number; author?: string }
  | { k: "branch"; repo: string; name: string; at: number; ahead?: number; behind?: number; state?: string }
  | { k: "commit"; repo: string; sha: string; msg: string; at: number; author?: string };

type SeedTask = {
  n: number;
  t: string;
  c: string;
  p?: string;
  a?: string | null;
  r?: string;
  e?: string;
  s?: string;
  tags?: string[];
  due?: number;
  est?: number;
  created: number;
  done?: number;
  d?: string;
  sub?: { t: string; c: string; a?: string; p?: string; est?: number; done?: number }[];
  com?: { u?: string; at: number; b: string; via?: string; rule?: string }[];
  att?: { file: string; name: string; by: string; at: number; size: number }[];
  links?: SeedLink[];
  agent?: { status: string; branch?: string; at?: number };
  review?: { status: string; by?: string; at?: number };
  via?: string;
};

type SeedRule = {
  k: string;
  name: string;
  enabled?: boolean;
  created: number;
  by: string;
  trigger: Record<string, unknown>;
  conditions?: Record<string, unknown>[];
  actions: Record<string, unknown>[];
};

type SeedRun = { rule: string; task: number; at: number; status: "success" | "skipped" | "failed"; reason?: string; changed?: boolean };

type SeedProject = {
  key: string;
  name: string;
  description: string;
  owner: string;
  created: number;
  sprintsEnabled?: boolean;
  agent?: { enabled: boolean; tag: string; from: string; until: string };
  members: { user: string; role: string; joined?: number }[];
  invitations?: { email: string; role: string; by: string; at: number; status?: string; notify?: string }[];
  columns: { k: string; name: string; cat: string; autoTags?: string[] }[];
  tags: { name: string; color: string }[];
  epics?: { k: string; title: string; color: string; status?: string; d?: string; created?: number }[];
  sprints?: { k: string; name: string; goal?: string; status: string; start: number; end: number }[];
  repos?: { k: string; fullName: string; defaultBranch: string; connected?: number }[];
  tasks: SeedTask[];
  rules?: SeedRule[];
  runs?: SeedRun[];
  agentPrs?: {
    n: number;
    repo: string;
    branch: string;
    title: string;
    complexity: "easy" | "large";
    status: "pending" | "merged" | "closed" | "waiting_review";
    reason?: string;
    tasks: number[];
    at: number;
    merged?: number;
  }[];
};

type SeedWorkspace = {
  adminEmails: string[];
  access: { email: string; status: string; name?: string; requested?: number; decided?: number }[];
  installation: { login: string; users: string[]; created: number };
  githubRepos: { fullName: string; defaultBranch: string; private: boolean }[];
  tokens: { user: string; name: string; external: boolean; created: number; lastUsed?: number; prefix: string }[];
  notifications: { user: string; type: string; at: number; read?: boolean; actor?: string; project?: string; task?: number; data?: Record<string, unknown> }[];
};

// ─── Helpers ────────────────────────────────────────────────────────────

const now = () => new Date();
const daysFrom = (base: Date, days: number) => new Date(base.getTime() + days * 86_400_000);
const isoDay = (base: Date, days: number) => format(addDays(base, days), "yyyy-MM-dd");
const userId = (key: string) => `u_${key}`;
const asPriority = (p: string | undefined): Priority => (PRIORITIES as readonly string[]).includes(p ?? "") ? (p as Priority) : "medium";

/** Hora de trabajo creíble: los eventos del pasado caen entre las 9 y las 19. */
function workTime(base: Date, days: number, salt: number) {
  const d = daysFrom(base, days);
  if (days >= -0.05) return d.getTime() > base.getTime() ? base : d;
  const hour = 9 + ((salt * 7) % 10);
  const minute = (salt * 13) % 60;
  d.setHours(hour, minute, 0, 0);
  return d.getTime() > base.getTime() ? daysFrom(base, -0.02) : d;
}

export function buildSeed(): Db {
  const today = now();
  const ws = workspace as SeedWorkspace;
  const db: Db = {
    version: DB_VERSION,
    seededAt: today,
    adminEmails: ws.adminEmails,
    users: [],
    appAccess: [],
    projects: [],
    members: [],
    invitations: [],
    columns: [],
    columnTags: [],
    epics: [],
    sprints: [],
    tasks: [],
    tags: [],
    taskTags: [],
    comments: [],
    activity: [],
    notifications: [],
    installations: [],
    githubRepos: [],
    repos: [],
    links: [],
    rules: [],
    runs: [],
    attachments: [],
    tokens: [],
    agentPrs: [],
    eventSeq: 0,
  };
  let salt = 1;
  const t = (days: number) => workTime(today, days, salt++);

  for (const u of users as { key: string; name: string; email: string; created: number }[]) {
    db.users.push({ id: userId(u.key), name: u.name, email: u.email, image: null, createdAt: t(u.created) });
  }

  for (const a of ws.access) {
    db.appAccess.push({
      email: a.email,
      status: a.status as "pending" | "approved" | "denied",
      name: a.name ?? null,
      image: null,
      requestedAt: a.requested !== undefined ? t(a.requested) : null,
      decidedAt: a.decided !== undefined ? t(a.decided) : null,
      decidedById: a.decided !== undefined ? userId("laura") : null,
      createdAt: t(a.requested ?? a.decided ?? -60),
    });
  }

  const installationId = uuid();
  db.installations.push({
    id: installationId,
    provider: "github",
    externalId: "48213907",
    accountLogin: ws.installation.login,
    accountType: "Organization",
    userIds: ws.installation.users.map(userId),
    createdAt: t(ws.installation.created),
  });
  ws.githubRepos.forEach((r, i) =>
    db.githubRepos.push({
      installationId,
      externalId: String(712_400_000 + i * 1_337),
      fullName: r.fullName,
      htmlUrl: `https://github.com/${r.fullName}`,
      defaultBranch: r.defaultBranch,
      private: r.private,
    }),
  );

  for (const tk of ws.tokens) {
    db.tokens.push({
      id: uuid(),
      userId: userId(tk.user),
      name: tk.name,
      prefix: tk.prefix,
      external: tk.external,
      lastUsedAt: tk.lastUsed !== undefined ? t(tk.lastUsed) : null,
      createdAt: t(tk.created),
      revokedAt: null,
    });
  }

  const projectTasks = new Map<string, Map<number, TaskRow>>();
  for (const p of [age, tie, coop, sop, rut] as SeedProject[]) buildProject(db, p, t, today, projectTasks, installationId);

  // Avisos escritos a mano (invitaciones, solicitudes de acceso, etc.).
  for (const n of ws.notifications) {
    const project = n.project ? db.projects.find((p) => p.key === n.project) : undefined;
    const task = project && n.task ? projectTasks.get(project.key)?.get(n.task) : undefined;
    const invitation =
      n.type === "invitation" && project
        ? db.invitations.find((i) => i.projectId === project.id && i.email === db.users.find((u) => u.id === userId(n.user))?.email)
        : undefined;
    db.notifications.push({
      id: uuid(),
      userId: userId(n.user),
      type: n.type,
      projectId: project?.id ?? null,
      taskId: task?.id ?? null,
      invitationId: invitation?.id ?? null,
      actorId: n.actor ? userId(n.actor) : null,
      data: n.data ?? {},
      readAt: n.read ? t(n.at + 0.1) : null,
      createdAt: t(n.at),
    });
  }
  synthesizeNotifications(db, today);
  return db;
}

// ─── Proyecto ───────────────────────────────────────────────────────────

function buildProject(
  db: Db,
  p: SeedProject,
  t: (days: number) => Date,
  today: Date,
  projectTasks: Map<string, Map<number, TaskRow>>,
  installationId: string,
) {
  const projectId = uuid();
  const created = t(p.created);
  const tagIds = new Map<string, string>();
  const columnIds = new Map<string, ColumnRow>();
  const epicIds = new Map<string, string>();
  const sprintIds = new Map<string, string>();
  const repoByKey = new Map<string, ProjectRepoRow>();
  const byNumber = new Map<number, TaskRow>();
  projectTasks.set(p.key, byNumber);

  for (const tag of p.tags) {
    const id = uuid();
    tagIds.set(tag.name, id);
    db.tags.push({ id, projectId, name: tag.name, color: tag.color, createdAt: created });
  }

  const allNumbers = p.tasks.map((x) => x.n);
  const subCount = p.tasks.reduce((s, x) => s + (x.sub?.length ?? 0), 0);
  db.projects.push({
    id: projectId,
    key: p.key,
    name: p.name,
    description: p.description,
    ownerId: userId(p.owner),
    sprintsEnabled: !!p.sprintsEnabled,
    taskSeq: Math.max(0, ...allNumbers) + subCount,
    agentEnabled: !!p.agent?.enabled,
    agentTagId: p.agent ? (tagIds.get(p.agent.tag) ?? null) : null,
    agentMergeFrom: p.agent?.from ?? "22:00",
    agentMergeUntil: p.agent?.until ?? "07:00",
    createdAt: created,
    updatedAt: created,
    archivedAt: null,
  });

  for (const m of p.members) {
    db.members.push({ projectId, userId: userId(m.user), role: m.role as Role, createdAt: t(m.joined ?? p.created) });
  }
  for (const inv of p.invitations ?? []) {
    db.invitations.push({
      id: uuid(),
      projectId,
      email: inv.email,
      role: inv.role as Role,
      status: (inv.status ?? "pending") as "pending" | "accepted",
      invitedById: userId(inv.by),
      createdAt: t(inv.at),
      respondedAt: inv.status && inv.status !== "pending" ? t(inv.at + 0.5) : null,
    });
  }

  const columnRanks = ranksBetween(null, null, p.columns.length);
  p.columns.forEach((c, i) => {
    const row: ColumnRow = { id: uuid(), projectId, name: c.name, rank: columnRanks[i], category: c.cat as ColumnCategory, createdAt: created };
    columnIds.set(c.k, row);
    db.columns.push(row);
    for (const tagName of c.autoTags ?? []) db.columnTags.push({ columnId: row.id, tagId: tagIds.get(tagName)! });
  });
  const firstColumn = db.columns.find((c) => c.id === columnIds.get(p.columns[0].k)!.id)!;
  const progressColumn = [...columnIds.values()].find((c) => c.category === "in_progress");

  const epicRanks = ranksBetween(null, null, Math.max(1, p.epics?.length ?? 0));
  (p.epics ?? []).forEach((e, i) => {
    const id = uuid();
    epicIds.set(e.k, id);
    const at = t(e.created ?? p.created);
    db.epics.push({
      id,
      projectId,
      title: e.title,
      descriptionMd: e.d ?? "",
      color: e.color,
      status: (e.status ?? "open") as "open" | "done",
      rank: epicRanks[i],
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    });
  });

  for (const s of p.sprints ?? []) {
    const id = uuid();
    sprintIds.set(s.k, id);
    const status = s.status as "planned" | "active" | "completed";
    db.sprints.push({
      id,
      projectId,
      name: s.name,
      goal: s.goal ?? "",
      status,
      startDate: isoDay(today, s.start),
      endDate: isoDay(today, s.end),
      startedAt: status !== "planned" ? t(s.start) : null,
      completedAt: status === "completed" ? t(s.end) : null,
      createdAt: t(s.start - 3),
    });
  }

  for (const r of p.repos ?? []) {
    const gh = db.githubRepos.find((x) => x.fullName === r.fullName)!;
    const row: ProjectRepoRow = {
      id: uuid(),
      projectId,
      installationId,
      provider: "github",
      externalRepoId: gh.externalId,
      fullName: r.fullName,
      defaultBranch: r.defaultBranch,
      htmlUrl: gh.htmlUrl,
      createdAt: t(r.connected ?? p.created + 1),
    };
    repoByKey.set(r.k, row);
    db.repos.push(row);
  }

  const ruleIds = new Map<string, string>();
  for (const r of p.rules ?? []) {
    const id = uuid();
    ruleIds.set(r.k, id);
    const at = t(r.created);
    const rule: RuleRow = {
      id,
      projectId,
      name: r.name,
      enabled: r.enabled ?? true,
      trigger: resolveRefs(r.trigger, { columnIds, tagIds, epicIds }),
      conditions: (r.conditions ?? []).map((c) => resolveRefs(c, { columnIds, tagIds, epicIds })),
      actions: r.actions.map((a) => resolveRefs(a, { columnIds, tagIds, epicIds })),
      createdById: userId(r.by),
      createdAt: at,
      updatedAt: at,
    };
    db.rules.push(rule);
  }

  // ─── Tareas ───
  const columnOrder = new Map<string, TaskRow[]>();
  const backlogOrder: TaskRow[] = [];
  let nextNumber = Math.max(0, ...allNumbers);

  const makeTask = (input: {
    number: number;
    title: string;
    column: ColumnRow;
    priority: Priority;
    assignee: string | null;
    reporter: string | null;
    epicId: string | null;
    sprintId: string | null;
    parentId: string | null;
    created: Date;
    done: Date | null;
    due: string | null;
    estimate: number | null;
    description: string;
  }) => {
    const row: TaskRow = {
      id: uuid(),
      projectId,
      number: input.number,
      parentId: input.parentId,
      epicId: input.epicId,
      columnId: input.column.id,
      sprintId: input.sprintId,
      rank: "",
      backlogRank: "",
      title: input.title,
      descriptionMd: input.description,
      priority: input.priority,
      assigneeId: input.assignee,
      reporterId: input.reporter,
      dueDate: input.due,
      estimateHours: input.estimate,
      completedAt: input.column.category === "done" ? (input.done ?? input.created) : null,
      agentStatus: null,
      agentBranch: null,
      agentClaimedAt: null,
      reviewStatus: null,
      reviewedById: null,
      reviewedAt: null,
      createdAt: input.created,
      updatedAt: input.done ?? input.created,
      deletedAt: null,
    };
    db.tasks.push(row);
    if (!columnOrder.has(row.columnId)) columnOrder.set(row.columnId, []);
    columnOrder.get(row.columnId)!.push(row);
    if (!row.parentId) backlogOrder.push(row);
    return row;
  };

  const activity = (row: TaskRow, entry: Omit<ActivityRow, "id" | "taskId" | "projectId">) =>
    db.activity.push({ id: uuid(), taskId: row.id, projectId, ...entry });

  /** Historial creíble: creación, asignación y el paso por las columnas hasta la actual. */
  const history = (row: TaskRow, reporter: string | null, via: string | null, doneAt: Date | null) => {
    const createdAt = row.createdAt;
    activity(row, { actorType: "user", actorId: reporter, kind: "created", field: null, oldValue: null, newValue: null, via, createdAt });
    if (row.assigneeId && row.assigneeId !== reporter && !via) {
      const name = db.users.find((u) => u.id === row.assigneeId)?.name ?? "";
      activity(row, {
        actorType: "user",
        actorId: reporter,
        kind: "updated",
        field: "assignee",
        oldValue: null,
        newValue: { id: row.assigneeId, label: name },
        via: null,
        createdAt: new Date(createdAt.getTime() + 20 * 60_000),
      });
    }
    const column = db.columns.find((c) => c.id === row.columnId)!;
    if (column.id === firstColumn.id) return;
    const end = doneAt ?? new Date(Math.min(today.getTime() - 3_600_000, createdAt.getTime() + 2 * 86_400_000));
    const mover = row.assigneeId ?? reporter;
    const steps: ColumnRow[] = [];
    if (column.category === "done" && progressColumn && progressColumn.id !== column.id) steps.push(progressColumn);
    steps.push(column);
    let from = firstColumn;
    steps.forEach((to, i) => {
      const at = new Date(createdAt.getTime() + ((end.getTime() - createdAt.getTime()) * (i + 1)) / (steps.length + 0.5));
      activity(row, {
        actorType: "user",
        actorId: mover,
        kind: "moved",
        field: "column",
        oldValue: { id: from.id, label: from.name },
        newValue: { id: to.id, label: to.name },
        via: null,
        createdAt: at,
      });
      from = to;
    });
  };

  for (const s of p.tasks) {
    const column = columnIds.get(s.c);
    if (!column) throw new Error(`Columna ${s.c} inexistente en ${p.key}-${s.n}`);
    const createdAt = t(s.created);
    const doneAt = column.category === "done" ? t(s.done ?? Math.min(-0.2, s.created + 2)) : null;
    const reporter = s.r ? userId(s.r) : userId(p.owner);
    const row = makeTask({
      number: s.n,
      title: s.t,
      column,
      priority: asPriority(s.p),
      assignee: s.a ? userId(s.a) : null,
      reporter,
      epicId: s.e ? (epicIds.get(s.e) ?? null) : null,
      sprintId: s.s ? (sprintIds.get(s.s) ?? null) : null,
      parentId: null,
      created: createdAt,
      done: doneAt,
      due: s.due !== undefined ? isoDay(today, s.due) : null,
      estimate: s.est ?? null,
      description: s.d ?? "",
    });
    byNumber.set(s.n, row);
    for (const tagName of s.tags ?? []) {
      const tagId = tagIds.get(tagName);
      if (!tagId) throw new Error(`Tag ${tagName} inexistente en ${p.key}`);
      db.taskTags.push({ taskId: row.id, tagId });
    }
    const via = s.via ?? null;
    history(row, reporter, via, doneAt);

    if (s.review) {
      row.reviewStatus = s.review.status;
      activity(row, { actorType: "user", actorId: reporter, kind: "review", field: "requested", oldValue: null, newValue: null, via, createdAt: new Date(createdAt.getTime() + 1000) });
      if (s.review.status === "approved" && s.review.by) {
        row.reviewedById = userId(s.review.by);
        row.reviewedAt = t(s.review.at ?? s.created + 0.3);
        activity(row, { actorType: "user", actorId: row.reviewedById, kind: "review", field: "approved", oldValue: null, newValue: null, via: null, createdAt: row.reviewedAt });
      }
    }
    if (s.agent) {
      row.agentStatus = s.agent.status;
      row.agentBranch = s.agent.branch ?? null;
      row.agentClaimedAt = s.agent.at !== undefined ? t(s.agent.at) : null;
      if (row.agentClaimedAt && row.agentBranch) {
        activity(row, { actorType: "user", actorId: userId(p.owner), kind: "agent", field: "claimed", oldValue: null, newValue: { id: row.agentBranch, label: row.agentBranch }, via: "Agente Claude", createdAt: row.agentClaimedAt });
      }
    }

    for (const c of s.com ?? []) {
      const rule = c.rule ? db.rules.find((r) => r.id === ruleIds.get(c.rule!)) : undefined;
      db.comments.push({
        id: uuid(),
        taskId: row.id,
        authorId: rule ? null : c.u ? userId(c.u) : null,
        source: rule ? "automation" : "user",
        automationRuleId: rule?.id ?? null,
        via: c.via ?? null,
        bodyMd: c.b.replace("{{task.key}}", `${p.key}-${row.number}`).replace("{{due_date}}", row.dueDate ?? ""),
        createdAt: t(c.at),
        editedAt: null,
      });
    }

    for (const a of s.att ?? []) {
      const id = uuid();
      const at = t(a.at);
      db.attachments.push({
        id,
        taskId: row.id,
        uploadedById: userId(a.by),
        fileName: a.name,
        contentType: a.file.endsWith(".png") ? "image/png" : "image/jpeg",
        sizeBytes: a.size,
        storageKey: `/demo/attachments/${a.file}`,
        createdAt: at,
      });
      activity(row, { actorType: "user", actorId: userId(a.by), kind: "attached", field: "attachment", oldValue: null, newValue: { id, label: a.name }, via: null, createdAt: at });
    }

    for (const l of s.links ?? []) {
      const repo = repoByKey.get(l.repo);
      if (!repo) throw new Error(`Repo ${l.repo} inexistente en ${p.key}`);
      const at = t(l.at);
      const link: VcsLinkRow =
        l.k === "pr"
          ? {
              id: uuid(),
              taskId: row.id,
              projectRepositoryId: repo.id,
              kind: "pull_request",
              externalId: String(l.n),
              title: l.title,
              url: `${repo.htmlUrl}/pull/${l.n}`,
              state: l.state,
              data: { headBranch: l.branch, baseBranch: repo.defaultBranch, author: l.author ?? "martin-sosa" },
              createdAt: at,
              updatedAt: at,
            }
          : l.k === "branch"
            ? {
                id: uuid(),
                taskId: row.id,
                projectRepositoryId: repo.id,
                kind: "branch",
                externalId: l.name,
                title: l.name,
                url: `${repo.htmlUrl}/tree/${l.name}`,
                state: l.state ?? "active",
                data: { aheadBy: l.ahead ?? 3, behindBy: l.behind ?? 0 },
                createdAt: at,
                updatedAt: at,
              }
            : {
                id: uuid(),
                taskId: row.id,
                projectRepositoryId: repo.id,
                kind: "commit",
                externalId: l.sha,
                title: l.msg,
                url: `${repo.htmlUrl}/commit/${l.sha}`,
                state: "pushed",
                data: { author: l.author ?? "martin-sosa" },
                createdAt: at,
                updatedAt: at,
              };
      db.links.push(link);
      if (l.k !== "commit") {
        activity(row, {
          actorType: "integration",
          actorId: "github",
          kind: "linked",
          field: link.kind,
          oldValue: null,
          newValue: { id: link.externalId, label: l.k === "pr" ? `PR #${l.n}` : `Rama ${link.title}` },
          via: null,
          createdAt: at,
        });
      }
    }

    for (const sub of s.sub ?? []) {
      const subColumn = columnIds.get(sub.c);
      if (!subColumn) throw new Error(`Columna ${sub.c} inexistente en subtarea de ${p.key}-${s.n}`);
      nextNumber += 1;
      const subCreated = new Date(createdAt.getTime() + 45 * 60_000);
      const subDone = subColumn.category === "done" ? t(sub.done ?? Math.min(-0.3, s.created + 1.5)) : null;
      const subRow = makeTask({
        number: nextNumber,
        title: sub.t,
        column: subColumn,
        priority: asPriority(sub.p ?? s.p),
        assignee: sub.a ? userId(sub.a) : row.assigneeId,
        reporter,
        epicId: row.epicId,
        sprintId: row.sprintId,
        parentId: row.id,
        created: subCreated,
        done: subDone,
        due: null,
        estimate: sub.est ?? null,
        description: "",
      });
      history(subRow, reporter, via, subDone);
    }
  }

  // Orden en columnas y en el backlog: el del JSON.
  for (const list of columnOrder.values()) {
    const ranks = ranksBetween(null, null, list.length);
    list.forEach((row, i) => (row.rank = ranks[i]));
  }
  const backlogRanks = ranksBetween(null, null, backlogOrder.length);
  backlogOrder.forEach((row, i) => (row.backlogRank = backlogRanks[i]));
  const subtasks = db.tasks.filter((x) => x.projectId === projectId && x.parentId);
  const subRanks = ranksBetween(backlogRanks[backlogRanks.length - 1] ?? null, null, subtasks.length);
  subtasks.forEach((row, i) => (row.backlogRank = subRanks[i]));

  // ─── Ejecuciones de reglas (registro de automatizaciones) ───
  const labels: Labels = {
    column: (id) => [...columnIds.values()].find((c) => c.id === id)?.name ?? "—",
    tag: (id) => [...tagIds.entries()].find(([, v]) => v === id)?.[0] ?? id,
    epic: (id) => (id ? (db.epics.find((e) => e.id === id)?.title ?? "sin epic") : "sin epic"),
    user: (id) => (id ? (db.users.find((u) => u.id === id)?.name ?? "usuario") : "sin responsable"),
  };
  for (const run of p.runs ?? []) {
    const rule = db.rules.find((r) => r.id === ruleIds.get(run.rule))!;
    const task = byNumber.get(run.task);
    if (!rule || !task) throw new Error(`Run inválido en ${p.key}: ${run.rule} / ${run.task}`);
    const snapshot: TaskSnapshot = {
      id: task.id,
      number: task.number,
      title: task.title,
      projectKey: p.key,
      columnId: task.columnId,
      priority: task.priority,
      epicId: task.epicId,
      assigneeId: task.assigneeId,
      parentId: task.parentId,
      dueDate: task.dueDate,
      tagIds: db.taskTags.filter((tt) => tt.taskId === task.id).map((tt) => tt.tagId),
    };
    const conditions = evaluateConditions((rule.conditions ?? []) as RuleInput["conditions"], snapshot, labels).results.map(
      ({ description, actual, passed }) => ({ description, actual, passed: run.status === "skipped" ? passed : true }),
    );
    const trigger = rule.trigger as { type: string; toColumnId?: string; hoursBefore?: number };
    const payload: Record<string, unknown> =
      trigger.type === "task.moved"
        ? { fromColumnId: firstColumn.id, toColumnId: trigger.toColumnId ?? task.columnId }
        : trigger.type.startsWith("pr.")
          ? { pr: prPayload(db, task.id) }
          : trigger.type === "task.due_soon"
            ? { hoursBefore: trigger.hoursBefore, dueDate: task.dueDate }
            : {};
    const actions = (rule.actions as RuleInput["actions"]).map((a) => ({
      type: a.type,
      ok: run.status !== "failed",
      changed: run.changed ?? true,
      message:
        run.status === "failed"
          ? (run.reason ?? "Error")
          : a.type === "move_to_column"
            ? `Movida a ${labels.column(a.columnId)}`
            : a.type === "assign"
              ? `Asignada a ${labels.user(a.userId)}`
              : a.type === "add_tag"
                ? `Agregado el tag ${labels.tag(a.tagId)}`
                : a.type === "remove_tag"
                  ? `Quitado el tag ${labels.tag(a.tagId)}`
                  : "Comentario agregado",
    }));
    db.runs.push({
      id: uuid(),
      ruleId: rule.id,
      projectId,
      taskId: task.id,
      eventId: null,
      triggerType: trigger.type,
      status: run.status,
      reason: run.status === "success" ? null : (run.reason ?? null),
      details: {
        event: { type: trigger.type, payload, depth: 0 },
        conditions,
        ...(run.status === "skipped" ? {} : { actions }),
      },
      depth: 0,
      createdAt: t(run.at),
    });
    if (run.status === "success" && run.changed !== false) {
      const moveTo = (rule.actions as RuleInput["actions"]).find((a) => a.type === "move_to_column");
      if (moveTo && moveTo.type === "move_to_column" && moveTo.columnId === task.columnId) {
        db.activity
          .filter((a) => a.taskId === task.id && a.kind === "moved" && (a.newValue as { id?: string })?.id === task.columnId)
          .forEach((a) => {
            a.actorType = "automation";
            a.actorId = rule.id;
          });
      }
    }
  }

  // ─── PRs del agente ───
  for (const pr of p.agentPrs ?? []) {
    const repo = repoByKey.get(pr.repo)!;
    db.agentPrs.push({
      id: uuid(),
      projectId,
      projectRepositoryId: repo.id,
      number: pr.n,
      branch: pr.branch,
      title: pr.title,
      url: `${repo.htmlUrl}/pull/${pr.n}`,
      complexity: pr.complexity,
      summary: "",
      taskIds: pr.tasks.map((n) => byNumber.get(n)!.id),
      status: pr.status,
      lastCheckAt: t(Math.min(-0.05, pr.at + 0.5)),
      lastReason: pr.reason ?? null,
      createdAt: t(pr.at),
      mergedAt: pr.merged !== undefined ? t(pr.merged) : null,
    });
  }

}

function prPayload(db: Db, taskId: string) {
  const pr = db.links.find((l) => l.taskId === taskId && l.kind === "pull_request");
  if (!pr) return {};
  return { number: Number(pr.externalId), title: pr.title, url: pr.url, branch: (pr.data as { headBranch?: string }).headBranch };
}

/** Reemplaza claves legibles del JSON (column, tag, epic, user) por los ids reales. */
function resolveRefs(
  obj: Record<string, unknown>,
  maps: { columnIds: Map<string, ColumnRow>; tagIds: Map<string, string>; epicIds: Map<string, string> },
) {
  const out: Record<string, unknown> = { ...obj };
  if (typeof obj.column === "string") {
    out.columnId = maps.columnIds.get(obj.column)!.id;
    delete out.column;
  }
  if (typeof obj.from === "string") {
    out.fromColumnId = maps.columnIds.get(obj.from)!.id;
    delete out.from;
  }
  if (typeof obj.to === "string") {
    out.toColumnId = maps.columnIds.get(obj.to)!.id;
    delete out.to;
  }
  if (typeof obj.tag === "string") {
    out.tagId = maps.tagIds.get(obj.tag)!;
    delete out.tag;
  }
  if (typeof obj.epic === "string") {
    out.epicId = maps.epicIds.get(obj.epic)!;
    delete out.epic;
  }
  if ("user" in obj) {
    out.userId = obj.user ? userId(String(obj.user)) : null;
    delete out.user;
  }
  return out;
}

// ─── Avisos derivados de los datos ──────────────────────────────────────

function synthesizeNotifications(db: Db, today: Date) {
  const push = (n: Omit<NotificationRow, "id">) => db.notifications.push({ id: uuid(), ...n });
  const ageDays = (d: Date) => (today.getTime() - d.getTime()) / 86_400_000;
  const live = db.tasks.filter((x) => !x.deletedAt);

  // Comentarios de otros en tareas donde la persona es responsable o la creó.
  for (const c of db.comments) {
    if (c.source !== "user" || !c.authorId || ageDays(c.createdAt) > 9) continue;
    const task = live.find((x) => x.id === c.taskId);
    if (!task) continue;
    for (const uid of new Set([task.assigneeId, task.reporterId])) {
      if (!uid || uid === c.authorId) continue;
      if (!db.members.some((m) => m.projectId === task.projectId && m.userId === uid)) continue;
      push({
        userId: uid,
        type: "comment",
        projectId: task.projectId,
        taskId: task.id,
        invitationId: null,
        actorId: c.authorId,
        data: { excerpt: c.bodyMd.replace(/\s+/g, " ").slice(0, 140) },
        readAt: ageDays(c.createdAt) > 1.5 ? new Date(c.createdAt.getTime() + 3_600_000) : null,
        createdAt: c.createdAt,
      });
    }
  }

  // Asignaciones recientes hechas por otra persona.
  for (const task of live) {
    if (!task.assigneeId || task.assigneeId === task.reporterId || task.parentId || ageDays(task.createdAt) > 6) continue;
    push({
      userId: task.assigneeId,
      type: "assigned",
      projectId: task.projectId,
      taskId: task.id,
      invitationId: null,
      actorId: task.reporterId,
      data: {},
      readAt: ageDays(task.createdAt) > 2 ? new Date(task.createdAt.getTime() + 7_200_000) : null,
      createdAt: new Date(task.createdAt.getTime() + 20 * 60_000),
    });
  }

  // Vencimientos de hoy y mañana.
  const soon = [format(today, "yyyy-MM-dd"), format(addDays(today, 1), "yyyy-MM-dd")];
  for (const task of live) {
    if (!task.assigneeId || task.completedAt || !task.dueDate || !soon.includes(task.dueDate)) continue;
    const at = new Date(today);
    at.setHours(8, 0, 0, 0);
    push({
      userId: task.assigneeId,
      type: "due_soon",
      projectId: task.projectId,
      taskId: task.id,
      invitationId: null,
      actorId: null,
      data: { dueDate: task.dueDate },
      readAt: null,
      createdAt: at.getTime() > today.getTime() ? new Date(today.getTime() - 3_600_000) : at,
    });
  }
}

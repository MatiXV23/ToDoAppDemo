import superjson from "superjson";
import type { ColumnCategory, Priority } from "@/lib/domain";
import type { Role } from "./permissions";

/**
 * "Base de datos" de la demo: las mismas tablas que el Postgres del original, como arrays
 * en memoria. Se carga de los JSON de `src/demo/seed` y se guarda en localStorage después
 * de cada cambio, así lo que hace el visitante sobrevive a un refresh.
 */

export type ActorType = "user" | "automation" | "integration" | "system";

export type UserRow = { id: string; name: string; email: string; image: string | null; createdAt: Date };
export type AppAccessRow = {
  email: string;
  status: "pending" | "approved" | "denied";
  name: string | null;
  image: string | null;
  requestedAt: Date | null;
  decidedAt: Date | null;
  decidedById: string | null;
  createdAt: Date;
};
export type ProjectRow = {
  id: string;
  key: string;
  name: string;
  description: string;
  ownerId: string;
  sprintsEnabled: boolean;
  taskSeq: number;
  agentEnabled: boolean;
  agentTagId: string | null;
  agentMergeFrom: string;
  agentMergeUntil: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};
export type MemberRow = { projectId: string; userId: string; role: Role; createdAt: Date };
export type InvitationRow = {
  id: string;
  projectId: string;
  email: string;
  role: Role;
  status: "pending" | "accepted" | "declined" | "revoked";
  invitedById: string;
  createdAt: Date;
  respondedAt: Date | null;
};
export type ColumnRow = { id: string; projectId: string; name: string; rank: string; category: ColumnCategory; createdAt: Date };
export type ColumnTagRow = { columnId: string; tagId: string };
export type EpicRow = {
  id: string;
  projectId: string;
  title: string;
  descriptionMd: string;
  color: string;
  status: "open" | "done";
  rank: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};
export type SprintRow = {
  id: string;
  projectId: string;
  name: string;
  goal: string;
  status: "planned" | "active" | "completed";
  startDate: string | null;
  endDate: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
};
export type TaskRow = {
  id: string;
  projectId: string;
  number: number;
  parentId: string | null;
  epicId: string | null;
  columnId: string;
  sprintId: string | null;
  rank: string;
  backlogRank: string;
  title: string;
  descriptionMd: string;
  priority: Priority;
  assigneeId: string | null;
  reporterId: string | null;
  dueDate: string | null;
  estimateHours: number | null;
  completedAt: Date | null;
  agentStatus: string | null;
  agentBranch: string | null;
  agentClaimedAt: Date | null;
  reviewStatus: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};
export type TagRow = { id: string; projectId: string; name: string; color: string; createdAt: Date };
export type TaskTagRow = { taskId: string; tagId: string };
export type CommentRow = {
  id: string;
  taskId: string;
  authorId: string | null;
  source: ActorType;
  automationRuleId: string | null;
  via: string | null;
  bodyMd: string;
  createdAt: Date;
  editedAt: Date | null;
};
export type ActivityRow = {
  id: string;
  taskId: string;
  projectId: string;
  actorType: ActorType;
  actorId: string | null;
  kind: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  via: string | null;
  createdAt: Date;
};
export type NotificationRow = {
  id: string;
  userId: string;
  type: string;
  projectId: string | null;
  taskId: string | null;
  invitationId: string | null;
  actorId: string | null;
  data: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
};
export type InstallationRow = {
  id: string;
  provider: string;
  externalId: string;
  accountLogin: string;
  accountType: string | null;
  userIds: string[];
  createdAt: Date;
};
/** Repos que "existen en GitHub" para cada instalación (lo que devolvería la API). */
export type GithubRepoRow = {
  installationId: string;
  externalId: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
};
export type ProjectRepoRow = {
  id: string;
  projectId: string;
  installationId: string;
  provider: string;
  externalRepoId: string;
  fullName: string;
  defaultBranch: string;
  htmlUrl: string;
  createdAt: Date;
};
export type VcsLinkRow = {
  id: string;
  taskId: string;
  projectRepositoryId: string;
  kind: "branch" | "commit" | "pull_request";
  externalId: string;
  title: string;
  url: string;
  state: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};
export type RuleRow = {
  id: string;
  projectId: string;
  name: string;
  enabled: boolean;
  trigger: unknown;
  conditions: unknown;
  actions: unknown;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type RunRow = {
  id: string;
  ruleId: string;
  projectId: string;
  taskId: string | null;
  eventId: number | null;
  triggerType: string;
  status: "success" | "skipped" | "failed";
  reason: string | null;
  details: Record<string, unknown>;
  depth: number;
  createdAt: Date;
};
export type AttachmentRow = {
  id: string;
  taskId: string;
  uploadedById: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** Imagen de ejemplo (ruta en /public) o "local:<id>" si la subió el visitante. */
  storageKey: string;
  createdAt: Date;
};
export type ApiTokenRow = {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  external: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
};
export type AgentPrRow = {
  id: string;
  projectId: string;
  projectRepositoryId: string;
  number: number;
  branch: string;
  title: string;
  url: string;
  complexity: "easy" | "large";
  summary: string;
  taskIds: string[];
  status: "pending" | "merged" | "closed" | "waiting_review";
  lastCheckAt: Date | null;
  lastReason: string | null;
  createdAt: Date;
  mergedAt: Date | null;
};

export type Db = {
  version: number;
  seededAt: Date;
  adminEmails: string[];
  users: UserRow[];
  appAccess: AppAccessRow[];
  projects: ProjectRow[];
  members: MemberRow[];
  invitations: InvitationRow[];
  columns: ColumnRow[];
  columnTags: ColumnTagRow[];
  epics: EpicRow[];
  sprints: SprintRow[];
  tasks: TaskRow[];
  tags: TagRow[];
  taskTags: TaskTagRow[];
  comments: CommentRow[];
  activity: ActivityRow[];
  notifications: NotificationRow[];
  installations: InstallationRow[];
  githubRepos: GithubRepoRow[];
  repos: ProjectRepoRow[];
  links: VcsLinkRow[];
  rules: RuleRow[];
  runs: RunRow[];
  attachments: AttachmentRow[];
  tokens: ApiTokenRow[];
  agentPrs: AgentPrRow[];
  eventSeq: number;
};

/** Cambiar este número descarta los datos guardados de versiones anteriores de la demo. */
export const DB_VERSION = 1;
export const STORAGE_PREFIX = "todoapp-demo";
const DB_KEY = `${STORAGE_PREFIX}:db`;

let current: Db | null = null;
let seedFactory: (() => Db) | null = null;

/** El seed se registra desde fuera para no cargar los JSON en el bundle del servidor de build. */
export function registerSeed(factory: () => Db) {
  seedFactory = factory;
}

function readStorage(): Db | null {
  try {
    const raw = window.localStorage.getItem(DB_KEY);
    if (!raw) return null;
    const parsed = superjson.parse<Db>(raw);
    return parsed?.version === DB_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function db(): Db {
  if (current) return current;
  current = readStorage();
  if (!current) {
    if (!seedFactory) throw new Error("Seed de la demo no registrado");
    current = seedFactory();
    save();
  }
  return current;
}

export function save() {
  if (!current) return;
  try {
    window.localStorage.setItem(DB_KEY, superjson.stringify(current));
  } catch {
    // Sin espacio o almacenamiento bloqueado: la demo sigue funcionando en memoria.
  }
}

/** Vuelve a leer lo guardado (cambios hechos en otra pestaña). */
export function reloadFromStorage() {
  const stored = readStorage();
  if (stored) current = stored;
}

export function isDbKey(key: string | null) {
  return key === DB_KEY;
}

/** Restablece los datos de ejemplo y borra todo lo que creó el visitante. */
export function resetDb() {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(`${STORAGE_PREFIX}:`) && !key.endsWith(":session")) window.localStorage.removeItem(key);
    }
  } catch {
    // Almacenamiento bloqueado: alcanza con regenerar en memoria.
  }
  current = null;
  db();
}

/**
 * Ejecuta un cambio como una transacción: si algo falla a mitad de camino, la base vuelve
 * al estado anterior. Si sale bien, se guarda.
 */
export function transaction<T>(fn: () => T): T {
  const snapshot = structuredClone(db());
  try {
    const result = fn();
    save();
    return result;
  } catch (err) {
    current = snapshot;
    throw err;
  }
}

export const uuid = () => crypto.randomUUID();

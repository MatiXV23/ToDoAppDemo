import * as z from "zod";
import type { Actor } from "../access";
import { db, transaction } from "../db";
import { badRequest, forbidden } from "../errors";
import { publish, userChannel } from "../events";

/** Acceso a la app: solo entran los emails aprobados por un admin. */

const emailSchema = z.email("Email inválido").transform((e) => e.trim().toLowerCase());

export const decideAccessSchema = z.object({ email: emailSchema, approve: z.boolean() });

export const isAdminEmail = (email: string) => db().adminEmails.includes(email.trim().toLowerCase());

function requireAdmin(actor: Actor) {
  if (actor.type !== "user") throw forbidden();
  const me = db().users.find((u) => u.id === actor.userId);
  if (!me || !isAdminEmail(me.email)) throw forbidden("Solo el administrador gestiona el acceso a la app");
  return actor.userId;
}

const time = (d: Date | null) => d?.getTime() ?? -Infinity;

export function listAccess(actor: Actor) {
  requireAdmin(actor);
  const d = db();
  const rows = d.appAccess
    .map((a) => {
      const u = d.users.find((x) => x.email === a.email);
      return {
        email: a.email,
        status: a.status,
        name: u?.name ?? a.name,
        image: u?.image ?? a.image,
        registered: !!u,
        requestedAt: a.requestedAt,
        decidedAt: a.decidedAt,
      };
    })
    .sort((a, b) => time(b.requestedAt) - time(a.requestedAt) || a.email.localeCompare(b.email));

  const pendingEmails = rows.filter((r) => r.status === "pending").map((r) => r.email);
  const invitations = d.invitations
    .filter((i) => pendingEmails.includes(i.email) && i.status === "pending")
    .map((i) => ({
      email: i.email,
      project: d.projects.find((p) => p.id === i.projectId)?.name ?? "",
      invitedBy: d.users.find((u) => u.id === i.invitedById)?.name ?? "",
    }));

  return {
    admins: d.adminEmails.map((email) => {
      const u = d.users.find((x) => x.email === email);
      return { email, name: u?.name ?? null, image: u?.image ?? null };
    }),
    pending: rows.filter((r) => r.status === "pending").map((r) => ({ ...r, invitations: invitations.filter((i) => i.email === r.email) })),
    approved: rows
      .filter((r) => r.status === "approved" && !isAdminEmail(r.email))
      .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)),
    denied: rows.filter((r) => r.status === "denied"),
  };
}

export function pendingAccessCount(actor: Actor) {
  requireAdmin(actor);
  return db().appAccess.filter((a) => a.status === "pending").length;
}

export function decideAccess(actor: Actor, input: z.input<typeof decideAccessSchema>) {
  const { email, approve } = decideAccessSchema.parse(input);
  const adminId = requireAdmin(actor);
  if (isAdminEmail(email)) throw badRequest("Los administradores siempre tienen acceso");
  const status = approve ? "approved" : "denied";
  const now = new Date();
  transaction(() => {
    const d = db();
    const row = d.appAccess.find((a) => a.email === email);
    if (row) Object.assign(row, { status, decidedAt: now, decidedById: adminId });
    else d.appAccess.push({ email, status, name: null, image: null, requestedAt: null, decidedAt: now, decidedById: adminId, createdAt: now });
    for (const n of d.notifications) {
      if (n.type === "access_request" && n.data.email === email && !n.readAt) n.readAt = now;
    }
    for (const admin of d.users.filter((u) => isAdminEmail(u.email))) publish(userChannel(admin.id), { type: "notification" });
  });
}

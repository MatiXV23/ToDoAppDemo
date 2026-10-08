import * as z from "zod";
import { type Actor, authorize } from "../access";
import { db, transaction, uuid } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { projectChannel, publish, userChannel } from "../events";
import { can } from "../permissions";
import { isAdminEmail } from "./app-access";
import { notify } from "./notifications";

export const inviteSchema = z.object({
  projectId: z.uuid(),
  email: z.email("Email inválido").transform((e) => e.trim().toLowerCase()),
  role: z.enum(["editor", "viewer"]),
});

function requireUser(actor: Actor) {
  if (actor.type !== "user") throw forbidden();
  return actor;
}

export function listMembers(actor: Actor, projectId: string) {
  const d = db();
  const role = authorize(actor, projectId, "project.view");
  const members = d.members
    .filter((m) => m.projectId === projectId)
    .map((m) => {
      const u = d.users.find((x) => x.id === m.userId)!;
      return { userId: u.id, name: u.name, email: u.email, image: u.image, role: m.role, joinedAt: m.createdAt };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const invitations = can(role, "member.manage")
    ? d.invitations
        .filter((i) => i.projectId === projectId && i.status === "pending")
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt }))
    : [];
  return { members, invitations };
}

/**
 * En la demo no se manda ningún email: la invitación queda pendiente en la lista (igual que en
 * la app real, donde las invitaciones llegan al buzón de la persona cuando entra).
 */
export function inviteMember(actor: Actor, input: z.input<typeof inviteSchema>) {
  const { projectId, email, role } = inviteSchema.parse(input);
  const me = requireUser(actor);
  return transaction(() => {
    const d = db();
    authorize(actor, projectId, "member.manage");
    const existingUser = d.users.find((u) => u.email === email);
    if (existingUser && d.members.some((m) => m.projectId === projectId && m.userId === existingUser.id)) {
      throw conflict("Esa persona ya es miembro del proyecto");
    }
    if (d.invitations.some((i) => i.projectId === projectId && i.email === email && i.status === "pending")) {
      throw conflict("Ya hay una invitación pendiente para ese email");
    }
    const invitation = {
      id: uuid(),
      projectId,
      email,
      role,
      status: "pending" as const,
      invitedById: me.userId,
      createdAt: new Date(),
      respondedAt: null,
    };
    d.invitations.push(invitation);

    // Si invita el admin, la persona queda con acceso a la app para poder aceptarla.
    const inviter = d.users.find((u) => u.id === me.userId);
    if (inviter && isAdminEmail(inviter.email) && !isAdminEmail(email)) {
      const now = new Date();
      const access = d.appAccess.find((a) => a.email === email);
      if (!access) {
        d.appAccess.push({ email, status: "approved", name: null, image: null, requestedAt: null, decidedAt: now, decidedById: me.userId, createdAt: now });
      } else if (access.status !== "approved") {
        Object.assign(access, { status: "approved", decidedAt: now, decidedById: me.userId });
      }
    }
    if (existingUser) {
      notify({ userId: existingUser.id, type: "invitation", projectId, invitationId: invitation.id, actorId: me.userId });
    }
    publish(projectChannel(projectId), { type: "project" }, actor);
    return { ...invitation };
  });
}

export function revokeInvitation(actor: Actor, invitationId: string) {
  transaction(() => {
    const d = db();
    const inv = d.invitations.find((i) => i.id === invitationId);
    if (!inv) throw notFound("Invitación");
    authorize(actor, inv.projectId, "member.manage");
    if (inv.status !== "pending") throw conflict("La invitación ya no está pendiente");
    inv.status = "revoked";
    inv.respondedAt = new Date();
    const invitee = d.users.find((u) => u.email === inv.email);
    if (invitee) publish(userChannel(invitee.id), { type: "notification" });
    publish(projectChannel(inv.projectId), { type: "project" }, actor);
  });
}

export function listMyInvitations(userId: string) {
  const d = db();
  const me = d.users.find((u) => u.id === userId);
  if (!me) return [];
  return d.invitations
    .filter((i) => i.email === me.email.toLowerCase() && i.status === "pending")
    .flatMap((i) => {
      const project = d.projects.find((p) => p.id === i.projectId);
      const inviter = d.users.find((u) => u.id === i.invitedById);
      if (!project || !inviter) return [];
      return [
        {
          id: i.id,
          role: i.role,
          createdAt: i.createdAt,
          project: { id: project.id, key: project.key, name: project.name },
          invitedBy: { name: inviter.name, image: inviter.image },
        },
      ];
    });
}

export function respondInvitation(actor: Actor, invitationId: string, accept: boolean) {
  const me = requireUser(actor);
  return transaction(() => {
    const d = db();
    const inv = d.invitations.find((i) => i.id === invitationId);
    const current = d.users.find((u) => u.id === me.userId);
    if (!inv || !current || inv.email !== current.email.toLowerCase()) throw notFound("Invitación");
    if (inv.status !== "pending") throw conflict("La invitación ya no está pendiente");
    inv.status = accept ? "accepted" : "declined";
    inv.respondedAt = new Date();
    if (accept) {
      if (!d.members.some((m) => m.projectId === inv.projectId && m.userId === me.userId)) {
        d.members.push({ projectId: inv.projectId, userId: me.userId, role: inv.role, createdAt: new Date() });
      }
      notify({ userId: inv.invitedById, type: "invitation_accepted", projectId: inv.projectId, actorId: me.userId });
      publish(projectChannel(inv.projectId), { type: "project" }, actor);
    }
    const now = new Date();
    for (const n of d.notifications) if (n.invitationId === invitationId && n.userId === me.userId) n.readAt = now;
    publish(userChannel(me.userId), { type: "projects" });
    publish(userChannel(me.userId), { type: "notification" });
    const project = d.projects.find((p) => p.id === inv.projectId);
    return { projectKey: project?.key ?? null };
  });
}

export function changeRole(actor: Actor, input: { projectId: string; userId: string; role: "editor" | "viewer" }) {
  transaction(() => {
    authorize(actor, input.projectId, "member.manage");
    const target = db().members.find((m) => m.projectId === input.projectId && m.userId === input.userId);
    if (!target) throw notFound("Miembro");
    if (target.role === "owner") throw badRequest("No se puede cambiar el rol del dueño");
    target.role = input.role;
    publish(projectChannel(input.projectId), { type: "project" }, actor);
    publish(userChannel(input.userId), { type: "projects" });
  });
}

/** El dueño puede quitar a cualquiera menos a sí mismo; cualquier otro miembro puede salir. */
export function removeMember(actor: Actor, input: { projectId: string; userId: string }) {
  const me = requireUser(actor);
  transaction(() => {
    const d = db();
    const leaving = input.userId === me.userId;
    if (leaving) authorize(actor, input.projectId, "project.view");
    else authorize(actor, input.projectId, "member.manage");
    const target = d.members.find((m) => m.projectId === input.projectId && m.userId === input.userId);
    if (!target) throw notFound("Miembro");
    if (target.role === "owner") throw badRequest("El dueño no puede salir del proyecto");
    d.members = d.members.filter((m) => m !== target);
    for (const t of d.tasks) if (t.projectId === input.projectId && t.assigneeId === input.userId) t.assigneeId = null;
    if (!leaving) {
      notify({ userId: input.userId, type: "removed_from_project", actorId: me.userId, data: { projectId: input.projectId } });
    }
    publish(projectChannel(input.projectId), { type: "project" }, actor);
    publish(projectChannel(input.projectId), { type: "board" }, actor);
    publish(userChannel(input.userId), { type: "projects" });
  });
}

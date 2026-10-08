import * as z from "zod";
import { db, transaction, uuid } from "../db";
import { notFound } from "../errors";

export const createTokenSchema = z.object({
  name: z.string().trim().min(1, "Poné un nombre").max(60),
  external: z.boolean().default(false),
});

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  // "demo" en el token: no sirve contra ningún servidor real.
  return `tda_demo_${b64}`;
}

/** Crea un token personal. En la demo es ficticio: se muestra una vez, igual que en la app. */
export function createApiToken(userId: string, input: z.input<typeof createTokenSchema>) {
  const { name, external } = createTokenSchema.parse(input);
  return transaction(() => {
    const token = randomToken();
    const row = { id: uuid(), userId, name, external, prefix: token.slice(0, 12), lastUsedAt: null, createdAt: new Date(), revokedAt: null };
    db().tokens.push(row);
    return { id: row.id, name: row.name, prefix: row.prefix, external: row.external, createdAt: row.createdAt, token };
  });
}

export function listApiTokens(userId: string) {
  return db()
    .tokens.filter((t) => t.userId === userId && !t.revokedAt)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, external: t.external, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt }));
}

function ownToken(userId: string, tokenId: string) {
  const row = db().tokens.find((t) => t.id === tokenId && t.userId === userId && !t.revokedAt);
  if (!row) throw notFound("Token");
  return row;
}

export function setApiTokenExternal(userId: string, tokenId: string, external: boolean) {
  transaction(() => {
    ownToken(userId, tokenId).external = external;
  });
}

export function revokeApiToken(userId: string, tokenId: string) {
  transaction(() => {
    ownToken(userId, tokenId).revokedAt = new Date();
  });
}

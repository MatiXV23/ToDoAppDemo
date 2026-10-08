import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import * as z from "zod";
import type { Actor } from "./access";
import { db } from "./db";
import { AppError } from "./errors";
import { commit, rollback } from "./events";
import { getSessionUser } from "@/demo/session";

/**
 * Mismo armado que src/server/trpc/init.ts del original, pero el "servidor" corre en el
 * navegador: el cliente llega acá por unstable_localLink, sin HTTP.
 */

export type SessionUser = { id: string; name: string; email: string; image: string | null; isAdmin: boolean };

export async function createContext(clientId: string) {
  return { user: getSessionUser(), clientId };
}

type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  isServer: false,
  allowOutsideOfServer: true,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        fieldErrors: error.cause instanceof z.ZodError ? z.flattenError(error.cause).fieldErrors : null,
      },
    };
  },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const between = (min: number, max: number) => min + Math.random() * (max - min);

/** Latencia de red simulada: corta, para que se vean los estados de carga. */
const latency = t.middleware(async ({ path, type, next }) => {
  const isAi = path.startsWith("ai.") && path !== "ai.status";
  await sleep(isAi ? between(1100, 1900) : type === "query" ? between(250, 550) : between(200, 400));
  return next();
});

/** Entrega los mensajes de tiempo real al terminar y los descarta si la operación falló. */
const realtime = t.middleware(async ({ next }) => {
  const result = await next();
  if (result.ok) commit();
  else rollback();
  return result;
});

/** Traduce errores de dominio y de validación a errores tRPC con mensajes legibles. */
const translateErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const cause = result.error.cause;
    if (cause instanceof AppError) {
      throw new TRPCError({ code: cause.code, message: cause.message, cause });
    }
    if (cause instanceof z.ZodError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: cause.issues[0]?.message ?? "Datos inválidos", cause });
    }
  }
  return result;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(latency).use(realtime).use(translateErrors);

export const authedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Iniciá sesión" });
  // La base se carga (o se crea con los datos de ejemplo) en la primera llamada.
  db();
  const actor: Actor = { type: "user", userId: ctx.user.id, clientId: ctx.clientId };
  return next({ ctx: { user: ctx.user, actor } });
});

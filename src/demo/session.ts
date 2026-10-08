"use client";

import { useSyncExternalStore } from "react";
import { db, STORAGE_PREFIX } from "./server/db";
import { DEMO_ACCOUNTS } from "./accounts";

/**
 * Sesión de la demo: reemplaza a Better Auth + Google. Guarda en localStorage qué usuario de
 * ejemplo entró. No hay contraseñas reales: las credenciales de demo están a la vista en el login.
 */

export type SessionUser = { id: string; name: string; email: string; image: string | null; isAdmin: boolean };

const SESSION_KEY = `${STORAGE_PREFIX}:session`;
const EVENT = "todoapp-demo:session";

function readUserId(): string | null {
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return memorySession;
  }
}

let memorySession: string | null = null;

export function getSessionUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  const id = readUserId() ?? memorySession;
  if (!id) return null;
  const d = db();
  const user = d.users.find((u) => u.id === id);
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, image: user.image, isAdmin: d.adminEmails.includes(user.email) };
}

function setSession(userId: string | null) {
  memorySession = userId;
  try {
    if (userId) window.localStorage.setItem(SESSION_KEY, userId);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Sin localStorage la sesión dura lo que dura la pestaña.
  }
  window.dispatchEvent(new Event(EVENT));
}

export type SignInResult = { ok: true } | { ok: false; error: string };

/** Valida contra las cuentas de demo (las mismas que se muestran en el login). */
export function signIn(email: string, password: string): SignInResult {
  const account = DEMO_ACCOUNTS.find((a) => a.email.toLowerCase() === email.trim().toLowerCase());
  if (!account || account.password !== password) {
    return { ok: false, error: "Email o contraseña incorrectos. Usá una de las cuentas de demo." };
  }
  setSession(account.userId);
  return { ok: true };
}

export function signInAs(userId: string) {
  setSession(userId);
}

export function signOut() {
  setSession(null);
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === SESSION_KEY) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Usuario de la sesión: `undefined` mientras no se sabe (en el HTML estático), `null` si no
 * hay sesión. El id es estable y se resuelve contra la base en cada render.
 */
export function useSessionUserId(): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => readUserId() ?? memorySession,
    () => undefined,
  );
}

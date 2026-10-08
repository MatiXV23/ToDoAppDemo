"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/common/logo";
import { getSessionUser, useSessionUserId } from "@/demo/session";
import { AppShell } from "./app-shell";

/** Sin sesión de demo, al login. Mientras se resuelve (HTML estático) muestra un splash. */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const userId = useSessionUserId();
  const user = userId ? getSessionUser() : null;

  useEffect(() => {
    if (userId === null || (userId && !user)) router.replace("/login");
  }, [userId, user, router]);

  if (!user) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Logo className="size-10 animate-pulse" />
      </div>
    );
  }
  return <AppShell user={user}>{children}</AppShell>;
}

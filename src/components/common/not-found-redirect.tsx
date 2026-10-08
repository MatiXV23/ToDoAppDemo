"use client";

import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { BASE_PATH } from "@/demo/base-path";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";

/**
 * Página 404. Si el enlace usa las rutas de la app original (/p/AGE/backlog), lo lleva a la
 * ruta equivalente de la demo (/p/backlog/?key=AGE) en vez de mostrar el error.
 */
export function NotFoundRedirect() {
  useEffect(() => {
    const path = window.location.pathname.slice(BASE_PATH.length);
    const match = /^\/p\/([A-Za-z][A-Za-z0-9]{1,9})(?:\/(backlog|epics|automations|settings))?\/?$/.exec(path);
    if (!match) return;
    const params = new URLSearchParams(window.location.search);
    params.set("key", match[1].toUpperCase());
    window.location.replace(`${BASE_PATH}/p/${match[2] ? `${match[2]}/` : ""}?${params.toString()}`);
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <EmptyState
        icon={FileQuestion}
        title="Página no encontrada"
        description="El enlace no existe en esta demo."
        action={
          <Button asChild variant="outline">
            <Link href="/">Ir a mis proyectos</Link>
          </Button>
        }
      />
    </main>
  );
}

"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { isDbKey, reloadFromStorage } from "./server/db";

/**
 * Comportamiento propio de la demo, fuera de los componentes del producto:
 * - Si el visitante tiene la demo abierta en dos pestañas, los cambios de una aparecen en la otra.
 * - Los enlaces a GitHub (repos, ramas, PRs) son de ejemplo: en vez de abrir una página que no
 *   existe, avisan que están simulados.
 */
export function useDemoRuntime(queryClient: QueryClient) {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!isDbKey(e.key)) return;
      reloadFromStorage();
      void queryClient.invalidateQueries();
    };
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin === window.location.origin || !/^https?:$/.test(url.protocol)) return;
      e.preventDefault();
      const isGithub = url.hostname === "github.com";
      toast.info(
        isGithub
          ? "Enlace simulado: en la versión completa abre el repositorio, la rama o el PR en GitHub."
          : "Enlace externo deshabilitado en la demo.",
      );
    };
    window.addEventListener("storage", onStorage);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("click", onClick, true);
    };
  }, [queryClient]);
}

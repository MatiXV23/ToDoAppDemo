"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** La tarea abierta vive en la URL (?task=TDA-12) para poder compartir el enlace. */
export function useTaskParam() {
  const searchParams = useSearchParams();
  const taskKey = searchParams.get("task");

  const setTask = useCallback(
    (key: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (key) params.set("task", key);
      else params.delete("task");
      const query = params.toString();
      // pushState no dispara una navegación del servidor: abre el panel al instante.
      // window.location.pathname incluye la ruta base de GitHub Pages (usePathname no).
      const pathname = window.location.pathname;
      window.history.pushState(null, "", query ? `${pathname}?${query}` : pathname);
    },
    [],
  );

  return { taskKey, openTask: setTask, closeTask: useCallback(() => setTask(null), [setTask]) };
}

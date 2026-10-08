"use client";

import { FlaskConical, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { withBasePath } from "./base-path";
import { resetDb, STORAGE_PREFIX } from "./server/db";

const COLLAPSED_KEY = `${STORAGE_PREFIX}:badge-collapsed`;

/** Aviso discreto de "versión demo" con el botón para volver a los datos de ejemplo. */
export function DemoBadge() {
  const [collapsed, setCollapsed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preferencia guardada, solo existe en el navegador
      setCollapsed(window.sessionStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // sin almacenamiento: queda expandido
    }
  }, []);

  const toggle = (value: boolean) => {
    setCollapsed(value);
    try {
      window.sessionStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
    } catch {
      // nada que guardar
    }
  };

  const reset = () => {
    resetDb();
    // Recarga completa: limpia la caché de consultas y cualquier pantalla de algo que ya no existe.
    window.location.assign(withBasePath("/"));
  };

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center px-4">
        {collapsed ? (
          <button
            onClick={() => toggle(false)}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full border bg-background/95 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
            aria-label="Mostrar aviso de versión demo"
          >
            <FlaskConical className="size-3.5 text-brand" /> Demo
          </button>
        ) : (
          <div
            role="note"
            className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border bg-background/95 py-1 pr-1 pl-3 text-xs shadow-md backdrop-blur"
          >
            <FlaskConical className="size-3.5 shrink-0 text-brand" />
            <span className="min-w-0 truncate text-muted-foreground">
              <span className="font-medium text-foreground">Versión demo:</span>
              <span className="sm:hidden"> datos de ejemplo</span>
              <span className="hidden sm:inline"> los datos son de ejemplo y se guardan solo en este navegador</span>
            </span>
            <button
              onClick={() => setConfirming(true)}
              className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-foreground hover:bg-muted/70"
            >
              <RotateCcw className="size-3" /> Restablecer
            </button>
            <button
              onClick={() => toggle(true)}
              className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Minimizar aviso"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Restablecer los datos de ejemplo?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran las tareas, comentarios y cambios que hiciste en la demo y todo vuelve al estado inicial. Tu sesión
              sigue abierta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={reset}>Restablecer datos</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

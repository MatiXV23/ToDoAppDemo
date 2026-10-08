"use client";

import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { useCurrentUser } from "@/components/shell/current-user";

/** La pantalla de acceso es solo para administradores (en el original, notFound() en el servidor). */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser();
  if (user.isAdmin) return children;
  return (
    <div className="p-8">
      <EmptyState icon={ShieldAlert} title="Página no encontrada" description="Esta sección es solo para administradores." />
    </div>
  );
}

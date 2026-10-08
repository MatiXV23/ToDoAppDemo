import type { Metadata } from "next";
import { AccessView } from "@/components/admin/access-view";
import { AdminOnly } from "@/components/admin/admin-only";

export const metadata: Metadata = { title: "Acceso a la app" };

export default function AccessPage() {
  return (
    <AdminOnly>
      <AccessView />
    </AdminOnly>
  );
}

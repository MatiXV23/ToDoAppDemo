import { SessionGate } from "@/components/shell/session-gate";

/** En la app original la sesión se verifica en el servidor; en la demo, en el navegador. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <SessionGate>{children}</SessionGate>;
}

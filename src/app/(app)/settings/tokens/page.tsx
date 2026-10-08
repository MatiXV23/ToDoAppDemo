import type { Metadata } from "next";
import { TokensView } from "@/components/settings/tokens-view";

export const metadata: Metadata = { title: "Tokens de API" };

/** URL de ejemplo para el comando de Claude Code: en la demo no hay servidor MCP. */
const DEMO_APP_URL = "https://tareas.estudionebula.uy";

export default function TokensPage() {
  return <TokensView appUrl={DEMO_APP_URL} />;
}

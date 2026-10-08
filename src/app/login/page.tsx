import type { Metadata } from "next";
import { LoginCard } from "./login-card";

export const metadata: Metadata = { title: "Ingresar" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-4 pb-20">
      <LoginCard />
    </main>
  );
}

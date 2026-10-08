"use client";

import { Eye, Loader2, Pencil, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/common/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { DEMO_ACCOUNTS } from "@/demo/accounts";
import { signIn, signInAs, useSessionUserId } from "@/demo/session";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.66 4.1-5.5 4.1-3.31 0-6-2.74-6-6.2s2.69-6.2 6-6.2c1.88 0 3.15.8 3.87 1.49l2.64-2.54C16.84 3.2 14.65 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.66 0 9.4-3.98 9.4-9.58 0-.64-.07-1.13-.16-1.62H12z" />
    </svg>
  );
}

const ROLE_ICONS = [ShieldCheck, Pencil, Eye];
const MAIN = DEMO_ACCOUNTS[0];

/**
 * Login de la demo. En la app real se entra con Google y solo con aprobación del admin;
 * acá las credenciales de demo están cargadas y a la vista, con un acceso rápido por rol.
 */
export function LoginCard() {
  const router = useRouter();
  const session = useSessionUserId();
  const [pending, setPending] = useState<string | null>(null);
  const [email, setEmail] = useState(MAIN.email);
  const [password, setPassword] = useState(MAIN.password);

  useEffect(() => {
    if (session) router.replace("/");
  }, [session, router]);

  // Una pausa corta, como un login real, para que se vea el estado de carga.
  const enter = (key: string, fn: () => boolean) => {
    setPending(key);
    setTimeout(() => {
      if (!fn()) setPending(null);
    }, 450);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    enter("form", () => {
      const result = signIn(email, password);
      if (!result.ok) toast.error(result.error);
      return result.ok;
    });
  };

  return (
    <div className="w-full max-w-sm rounded-2xl border bg-background p-6 shadow-sm sm:p-8">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <Logo className="size-12" />
        <div>
          <h1 className="text-lg font-semibold">ToDoApp</h1>
          <p className="text-sm text-muted-foreground">Tus proyectos, sin vueltas.</p>
        </div>
      </div>

      <Button
        className="w-full"
        size="lg"
        variant="outline"
        disabled={!!pending}
        onClick={() =>
          enter("google", () => {
            toast.info("Ingreso con Google simulado: en la demo entrás como Laura, la administradora.");
            signInAs(MAIN.userId);
            return true;
          })
        }
      >
        {pending === "google" ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
        Continuar con Google
      </Button>

      <div className="my-5 flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">o con una cuenta de demo</span>
        <Separator className="flex-1" />
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="login-email">Email</Label>
          <Input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="login-password">Contraseña</Label>
          <Input
            id="login-password"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={!!pending}>
          {pending === "form" ? <Loader2 className="animate-spin" /> : null}
          Ingresar
        </Button>
      </form>

      <div className="mt-6">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Acceso rápido por rol</p>
        <div className="space-y-2">
          {DEMO_ACCOUNTS.map((account, i) => {
            const Icon = ROLE_ICONS[i] ?? Eye;
            return (
              <button
                key={account.userId}
                type="button"
                disabled={!!pending}
                onClick={() => enter(account.userId, () => (signInAs(account.userId), true))}
                className="flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-60"
              >
                {pending === account.userId ? (
                  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-brand" />
                ) : (
                  <Icon className="mt-0.5 size-4 shrink-0 text-brand" />
                )}
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{account.role}</span>
                  <span className="block text-xs text-muted-foreground">{account.description}</span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{account.email}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Contraseña de todas las cuentas: <span className="font-mono font-medium text-foreground">{MAIN.password}</span>
        </p>
      </div>
    </div>
  );
}

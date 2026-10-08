"use client";

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, TRPCClientError, unstable_localLink } from "@trpc/client";
import { useEffect, useState } from "react";
import superjson from "superjson";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DemoBadge } from "@/demo/demo-badge";
import { useDemoRuntime } from "@/demo/runtime";
import { appRouter, type AppRouter } from "@/demo/server/root";
import { createContext } from "@/demo/server/trpc";
import { CLIENT_ID } from "@/lib/client-id";
import { TRPCProvider } from "@/lib/trpc";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, error) => {
          // Errores de permisos o validación no se reintentan.
          if (error instanceof TRPCClientError && error.data?.httpStatus < 500) return false;
          return count < 2;
        },
      },
    },
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.meta?.silent) return;
        toast.error(error.message || "Algo salió mal");
      },
    }),
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  // Demo: en vez de httpBatchLink("/api/trpc"), el cliente llama al router que corre en el
  // navegador (src/demo/server). Misma interfaz, sin red.
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        unstable_localLink({
          router: appRouter,
          createContext: () => createContext(CLIENT_ID),
          transformer: superjson,
        }),
      ],
    }),
  );
  useDemoRuntime(queryClient);
  useEffect(() => {
    document.documentElement.dataset.demoReady = "true";
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <TooltipProvider delayDuration={300}>
          {children}
          <DemoBadge />
          <Toaster position="bottom-right" richColors closeButton />
        </TooltipProvider>
      </TRPCProvider>
    </QueryClientProvider>
  );
}

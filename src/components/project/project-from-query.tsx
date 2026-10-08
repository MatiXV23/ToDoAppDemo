"use client";

import { useSearchParams } from "next/navigation";
import { ProjectShell } from "./project-shell";

export function ProjectFromQuery({ children }: { children: React.ReactNode }) {
  const key = useSearchParams().get("key")?.toUpperCase() ?? "";
  return (
    <ProjectShell key={key} projectKey={key}>
      {children}
    </ProjectShell>
  );
}

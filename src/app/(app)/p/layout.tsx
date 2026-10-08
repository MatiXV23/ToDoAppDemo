import { Suspense } from "react";
import { ProjectFromQuery } from "@/components/project/project-from-query";

/** En la demo la clave del proyecto viene en la query (?key=AGE), no en la ruta. */
export default function ProjectLayout({ children }: LayoutProps<"/p">) {
  return (
    <Suspense>
      <ProjectFromQuery>{children}</ProjectFromQuery>
    </Suspense>
  );
}

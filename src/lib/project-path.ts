/**
 * Rutas de proyecto. En la app original son /p/TDA/backlog; en la demo estática la clave va
 * en la query (/p/backlog/?key=TDA) porque GitHub Pages solo sirve rutas generadas en el build
 * y los proyectos que crea el visitante no existen al momento del build.
 */
export type ProjectTab = "" | "backlog" | "epics" | "automations" | "settings";

export function projectHref(key: string, tab: ProjectTab = "", extra?: Record<string, string>) {
  const params = new URLSearchParams({ key, ...extra });
  return `/p/${tab ? `${tab}/` : ""}?${params.toString()}`;
}

/** Pestaña actual a partir del pathname (sin la ruta base). */
export function projectTabOf(pathname: string): ProjectTab | null {
  const match = /^\/p(?:\/([a-z]+))?\/?$/.exec(pathname);
  if (!match) return null;
  return (match[1] ?? "") as ProjectTab;
}

/** Pathname sin la barra final que agrega `trailingSlash` ("/inbox/" → "/inbox"). */
export function cleanPathname(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

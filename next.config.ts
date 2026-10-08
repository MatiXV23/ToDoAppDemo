import type { NextConfig } from "next";

/**
 * Demo estática para GitHub Pages: `next build` genera `out/` con un index.html por ruta.
 * La ruta base es el nombre del repo (https://usuario.github.io/<repo>/). El workflow la
 * pasa en BASE_PATH; en local se usa /ToDoAppDemo para probar igual que en Pages.
 */
const basePath = process.env.BASE_PATH ?? "/ToDoAppDemo";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  // Cada ruta queda como carpeta con index.html: un refresh o un link directo no dan 404.
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

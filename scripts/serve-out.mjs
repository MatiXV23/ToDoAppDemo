// Sirve el build estático (out/) bajo la ruta base, imitando a GitHub Pages:
// /<base>/ruta → /<base>/ruta/ (redirección), carpetas → index.html y lo que no existe → 404.html.
// Uso: npm run build && npm run preview   (puerto 4173, o PORT=xxxx)
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "out");
const base = process.env.BASE_PATH ?? "/ToDoAppDemo";
const port = Number(process.env.PORT ?? 4173);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

if (!existsSync(root)) {
  console.error("No existe out/: corré `npm run build` primero.");
  process.exit(1);
}

const send = (res, file, status = 200) => {
  res.writeHead(status, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/" || url.pathname === base) {
    res.writeHead(302, { Location: `${base}/${url.search}` });
    return res.end();
  }
  if (!url.pathname.startsWith(`${base}/`)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Fuera de la ruta base");
  }
  const rel = decodeURIComponent(url.pathname.slice(base.length));
  const file = path.join(root, rel);
  if (!file.startsWith(root)) {
    res.writeHead(400);
    return res.end();
  }
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!url.pathname.endsWith("/")) {
      res.writeHead(301, { Location: `${url.pathname}/${url.search}` });
      return res.end();
    }
    const index = path.join(file, "index.html");
    if (existsSync(index)) return send(res, index);
  } else if (existsSync(file)) {
    return send(res, file);
  }
  send(res, path.join(root, "404.html"), 404);
}).listen(port, () => console.log(`Demo en http://localhost:${port}${base}/`));

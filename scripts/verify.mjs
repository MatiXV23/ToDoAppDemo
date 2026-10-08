// Recorre la demo ya construida (out/) servida bajo la ruta base, como en GitHub Pages, y
// verifica que no haya requests fuera del sitio ni errores en consola.
// Uso: npm run build && npm run verify   (deja capturas en verify-output/)
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "verify-output");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const PORT = "4199";
const BASE_PATH = process.env.BASE_PATH ?? "/ToDoAppDemo";
const BASE = `http://localhost:${PORT}${BASE_PATH}`;
const server = spawn("node", ["scripts/serve-out.mjs"], { cwd: root, env: { ...process.env, PORT } });
await new Promise((resolve, reject) => {
  server.stdout.once("data", resolve);
  server.once("exit", (code) => reject(new Error(`El servidor terminó (${code}). ¿Corriste npm run build?`)));
});

const problems = [];
const results = [];
const browser = await chromium.launch();

function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error" && /status of 404/.test(m.text()) && /(__no-existe|p\/AGE\/epics)/.test(m.location().url)) return;
    if (m.type() === "error" || m.type() === "warning") problems.push(`[${label}] consola ${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[${label}] error de página: ${e.message}`));
  page.on("request", (r) => {
    const url = r.url();
    if (url.startsWith(`${BASE}/`) || url.startsWith("data:") || url.startsWith("blob:")) return;
    problems.push(`[${label}] request fuera del sitio: ${r.method()} ${url}`);
  });
  page.on("response", (r) => {
    // 404 esperados: la ruta inexistente y el enlace con formato de la app original (404.html redirige).
    if (r.status() >= 400 && !/\/(__no-existe|p\/AGE\/epics)\/?$/.test(r.url())) problems.push(`[${label}] HTTP ${r.status()}: ${r.url()}`);
  });
}

async function step(name, fn) {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (err) {
    results.push(`✗ ${name}: ${err.message.split("\n")[0]}`);
  }
}

const column = (page, name) => page.locator("section").filter({ has: page.locator("h2", { hasText: new RegExp(`^${name}$`) }) });
const card = (page, key) => page.locator("[role=button]", { hasText: key }).first();
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });

async function drag(page, from, to) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + 30, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 20 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

// ─── Escritorio ─────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-UY", timezoneId: "America/Montevideo" });
  const page = await ctx.newPage();
  watch(page, "escritorio");
  page.setDefaultTimeout(10_000);

  await step("La raíz redirige al login con credenciales precargadas", async () => {
    await page.goto(`${BASE}/`);
    await page.waitForURL(/\/login\/$/);
    const email = await page.getByLabel("Email").inputValue();
    if (!email.includes("@")) throw new Error("El email de demo no está precargado");
    await shot(page, "01-login");
  });

  await step("Login con contraseña incorrecta muestra un mensaje (no un error)", async () => {
    await page.getByLabel("Contraseña").fill("otra");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await page.getByText("Email o contraseña incorrectos").waitFor();
    await page.getByLabel("Contraseña").fill("demo1234");
  });

  await step("Login de la administradora y lista de proyectos", async () => {
    await page.getByRole("button", { name: "Ingresar" }).click();
    await page.waitForURL(`${BASE}/`);
    await page.getByText("Agenda médica · Policlínica Las Acacias").first().waitFor();
    await shot(page, "02-proyectos");
  });

  await step("Tablero con sprint activo", async () => {
    await page.getByRole("link", { name: /Agenda médica/ }).first().click();
    await page.waitForURL(/\/p\/\?key=AGE/);
    await column(page, "Por hacer").waitFor();
    await card(page, "AGE-13").waitFor();
    await shot(page, "03-tablero");
  });

  await step("Crear una tarea rápida", async () => {
    await column(page, "Por hacer").getByRole("button", { name: "Crear tarea" }).click();
    await page.getByPlaceholder("¿Qué hay que hacer?").fill("Revisar textos legales con la policlínica");
    await page.keyboard.press("Enter");
    await column(page, "Por hacer").getByText("Revisar textos legales con la policlínica").waitFor();
  });

  await step("Arrastrar y soltar una tarea entre columnas", async () => {
    await drag(page, card(page, "AGE-13"), column(page, "En revisión"));
    await column(page, "En revisión").getByText("AGE-13").waitFor();
  });

  await step("Mover a QA desde el detalle dispara la automatización (asigna a Valentina)", async () => {
    await page.goto(`${BASE}/p/?key=AGE&task=AGE-15`);
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Panel de recepción: marcar llegada del paciente").first().waitFor();
    await dialog.getByRole("button", { name: "En curso" }).click();
    await page.getByRole("option", { name: "QA" }).click();
    await dialog.getByText("Valentina Ruiz").first().waitFor({ timeout: 8000 });
    await page.keyboard.press("Escape");
  });

  await step("Detalle de tarea: comentar", async () => {
    await page.goto(`${BASE}/p/?key=AGE&task=AGE-9`);
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Selector de fecha y horario disponible").first().waitFor();
    await dialog.getByPlaceholder("Escribí un comentario… (Markdown)").fill("Probado en Android: funciona perfecto 👌");
    await dialog.getByRole("button", { name: "Comentar", exact: true }).click();
    await dialog.getByText("Probado en Android: funciona perfecto").waitFor();
    await shot(page, "04-detalle");
  });

  await step("Adjuntar una imagen (se guarda en el navegador)", async () => {
    const dialog = page.getByRole("dialog");
    await dialog.locator("input[type=file]").setInputFiles(path.join(root, "public/demo/attachments/grafico-turnos-semana.png"));
    await dialog.getByRole("img", { name: "grafico-turnos-semana.png" }).waitFor();
    await page.getByText("la imagen no se sube a ningún servidor").waitFor();
  });

  await step("IA: sugerir prioridad, estimación y tags", async () => {
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Sugerir prioridad, estimación y tags" }).click();
    await page.getByRole("button", { name: "Aplicar" }).waitFor();
    await page.getByText("Sugerencia simulada").waitFor();
    await page.getByRole("button", { name: "Descartar" }).click();
    await page.keyboard.press("Escape");
  });

  await step("IA: resumen del sprint", async () => {
    await page.goto(`${BASE}/p/?key=AGE`);
    await page.getByRole("button", { name: "IA", exact: true }).click();
    await page.getByRole("menuitem", { name: "Resumir el sprint" }).click();
    await page.getByText("Avance:").waitFor({ timeout: 8000 });
    await shot(page, "05-resumen-ia");
    await page.keyboard.press("Escape");
  });

  await step("IA: crear tareas desde texto", async () => {
    await page.getByRole("button", { name: "IA", exact: true }).click();
    await page.getByRole("menuitem", { name: "Crear tareas desde texto" }).click();
    await page.getByRole("dialog").locator("textarea").fill("mañana hay que llamar a la policlínica por los feriados y el viernes revisar la agenda de Cordón");
    await page.getByRole("button", { name: "Proponer tareas" }).click();
    await page.getByRole("button", { name: /^Crear \d+ tareas?$/ }).click({ timeout: 8000 });
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  });

  await step("Backlog con sprints", async () => {
    await page.getByRole("link", { name: "Backlog" }).click();
    await page.waitForURL(/\/p\/backlog\/\?key=AGE/);
    await page.getByText("Sprint 6").first().waitFor();
    await shot(page, "06-backlog");
  });

  await step("Refresh en una ruta interna no da 404", async () => {
    await page.reload();
    await page.getByText("Sprint 6").first().waitFor();
  });

  await step("Epics", async () => {
    await page.getByRole("link", { name: "Epics" }).click();
    await page.getByText("Recordatorios por WhatsApp").first().waitFor();
    await shot(page, "07-epics");
  });

  await step("Automatizaciones y registro (incluye la ejecución de recién)", async () => {
    await page.getByRole("link", { name: "Automatizaciones" }).click();
    await page.getByText("Al pasar a QA, asignar a Valentina").waitFor();
    await page.getByRole("tab", { name: "Registro" }).click();
    await page.getByText("Panel de recepción: marcar llegada del paciente").first().waitFor();
    await shot(page, "08-registro");
  });

  await step("Ajustes: GitHub simulado", async () => {
    await page.getByRole("link", { name: "Ajustes" }).click();
    await page.getByRole("button", { name: "GitHub" }).click();
    await page.getByRole("button", { name: "Instalar GitHub App" }).click();
    await page.getByText("no se abrió GitHub").waitFor();
    await page.getByText("estudio-nebula/infra-scripts").waitFor();
    await shot(page, "09-github");
  });

  await step("Enlace a GitHub no navega: avisa que es simulado", async () => {
    const before = page.url();
    await page.getByRole("link", { name: "estudio-nebula/agenda-acacias-web" }).click();
    await page.getByText("Enlace simulado").waitFor();
    if (page.url() !== before) throw new Error("Navegó fuera de la demo");
  });

  await step("Tarea por aprobar (Soporte): aprobar", async () => {
    await page.goto(`${BASE}/p/?key=SOP&task=SOP-1`);
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Pendiente de aprobación").waitFor();
    await shot(page, "10-por-aprobar");
    await dialog.getByRole("button", { name: "Aprobar" }).click();
    await dialog.getByText("Pendiente de aprobación").waitFor({ state: "hidden" });
  });

  await step("Buzón: aceptar la invitación a otro proyecto", async () => {
    await page.goto(`${BASE}/inbox`); // sin barra final: GitHub Pages redirige
    await page.getByText("te invitó a").first().waitFor();
    await shot(page, "11-buzon");
    await page.getByRole("button", { name: "Aceptar" }).click();
    await page.waitForURL(/\/p\/\?key=RUT/);
    await page.getByText("Ordenar las entregas por cercanía").waitFor();
  });

  await step("Acceso a la app: aprobar una solicitud", async () => {
    await page.getByRole("link", { name: /Acceso a la app/ }).click();
    await page.getByText("Gonzalo Rivas").first().waitFor();
    await shot(page, "12-acceso");
    await page.getByRole("button", { name: "Aprobar" }).first().click();
    await page.waitForTimeout(1200);
  });

  await step("Tokens de API: crear un token de ejemplo", async () => {
    await page.goto(`${BASE}/settings/tokens/`);
    await page.getByRole("button", { name: /Crear/ }).first().click();
    await page.getByText(/tda_demo_/).first().waitFor();
    await shot(page, "13-tokens");
  });

  await step("Los cambios sobreviven a un refresh", async () => {
    await page.goto(`${BASE}/p/?key=AGE`);
    await page.reload();
    await page.getByText("Revisar textos legales con la policlínica").waitFor();
  });

  await step("Enlace con el formato de la app original redirige", async () => {
    await page.goto(`${BASE}/p/AGE/epics`);
    await page.waitForURL(/\/p\/epics\/\?key=AGE/);
    await page.getByText("Recordatorios por WhatsApp").first().waitFor();
  });

  await step("Restablecer datos vuelve al estado inicial", async () => {
    await page.getByRole("button", { name: "Restablecer" }).click();
    await page.getByRole("button", { name: "Restablecer datos" }).click();
    await page.waitForURL(`${BASE}/`);
    await page.goto(`${BASE}/p/?key=AGE`);
    await card(page, "AGE-13").waitFor();
    if (await page.getByText("Revisar textos legales con la policlínica").count()) throw new Error("La tarea creada sigue ahí");
    if (await page.getByRole("link", { name: /Rutas Delivery/ }).count()) throw new Error("Sigue el proyecto de la invitación aceptada");
  });

  await step("Rol solo lectura: sin acciones de edición", async () => {
    await page.locator("aside").getByText("Laura Benítez").click();
    await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
    await page.waitForURL(/login/);
    await page.getByRole("button", { name: /Solo lectura/ }).click();
    await page.waitForURL(`${BASE}/`);
    await page.goto(`${BASE}/p/?key=AGE`);
    await card(page, "AGE-13").waitFor();
    if (await page.getByRole("button", { name: "Crear", exact: true }).count()) throw new Error("Ve el botón Crear");
    await shot(page, "14-solo-lectura");
  });

  await page.goto(`${BASE}/__no-existe/`);
  await page.getByText("Página no encontrada").waitFor();
  await ctx.close();
}

// ─── Celular ────────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "es-UY",
    timezoneId: "America/Montevideo",
  });
  const page = await ctx.newPage();
  watch(page, "celular");
  page.setDefaultTimeout(10_000);

  await step("Celular: login", async () => {
    await page.goto(`${BASE}/login/`);
    await page.getByRole("button", { name: "Ingresar" }).waitFor();
    await shot(page, "m1-login");
    await page.getByRole("button", { name: /Editor/ }).click();
    await page.waitForURL(`${BASE}/`);
  });

  await step("Celular: proyectos y menú", async () => {
    await page.locator("main").getByText("Agenda médica · Policlínica Las Acacias").waitFor();
    await shot(page, "m2-proyectos");
    await page.getByRole("button", { name: "Abrir menú" }).click();
    await page.getByRole("dialog").getByRole("link", { name: /Buzón/ }).waitFor();
    await page.waitForTimeout(500); // animación del panel
    await shot(page, "m3-menu");
    await page.keyboard.press("Escape");
  });

  await step("Celular: tablero y detalle sin scroll horizontal de página", async () => {
    await page.goto(`${BASE}/p/?key=TIE`);
    await card(page, "TIE-8").waitFor();
    await shot(page, "m4-tablero");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error(`La página desborda ${overflow}px`);
    await card(page, "TIE-6").click();
    await page.getByRole("dialog").getByText("Pago con tarjeta").first().waitFor();
    await page.waitForTimeout(400);
    await shot(page, "m5-detalle");
  });

  await ctx.close();
}

await browser.close();
server.kill();

console.log(results.join("\n"));
console.log(problems.length ? `\nProblemas:\n${[...new Set(problems)].join("\n")}` : "\nSin requests fuera del sitio ni errores en consola.");
console.log(`\nCapturas en ${path.relative(process.cwd(), outDir)}/`);
process.exit(results.some((r) => r.startsWith("✗")) || problems.length ? 1 : 0);

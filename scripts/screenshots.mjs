// Genera las capturas del README (docs/) navegando la demo construida con Playwright.
// Uso: npm run build && npm run screenshots   (el GIF necesita ffmpeg instalado)
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docs = path.join(root, "docs");
const shots = path.join(docs, "screenshots");
await mkdir(shots, { recursive: true });

const PORT = "4198";
const BASE = `http://localhost:${PORT}${process.env.BASE_PATH ?? "/ToDoAppDemo"}`;
const server = spawn("node", ["scripts/serve-out.mjs"], { cwd: root, env: { ...process.env, PORT } });
await new Promise((resolve) => server.stdout.once("data", resolve));

const browser = await chromium.launch();
const HIDE = "[data-sonner-toaster], [role=note], button[aria-label='Mostrar aviso de versión demo'] { display: none !important }";

async function login(page, role = "Administradora") {
  await page.goto(`${BASE}/login/`);
  await page.getByRole("button", { name: new RegExp(role) }).click();
  await page.waitForURL(`${BASE}/`);
}
const column = (page, name) => page.locator("section").filter({ has: page.locator("h2", { hasText: new RegExp(`^${name}$`) }) });
const card = (page, key) => page.locator("[role=button]", { hasText: key }).first();
const settle = (page, ms = 900) => page.waitForTimeout(ms);
const shot = async (page, name, opts = {}) => {
  await page.addStyleTag({ content: HIDE });
  await settle(page, 350);
  await page.screenshot({ path: path.join(shots, `${name}.png`), ...opts });
  console.log("✓", name);
};

// ─── Escritorio ─────────────────────────────────────────────────────────
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "es-UY", timezoneId: "America/Montevideo" });
let page = await desktop.newPage();
page.setDefaultTimeout(15_000);

await page.goto(`${BASE}/login/`);
await page.getByRole("button", { name: "Ingresar" }).waitFor();
await settle(page);
await page.screenshot({ path: path.join(shots, "login.png") });
console.log("✓ login");

await login(page);
await page.goto(`${BASE}/p/?key=AGE`);
await card(page, "AGE-13").waitFor();
await settle(page);
await shot(page, "tablero");

await page.goto(`${BASE}/p/?key=AGE&task=AGE-9`);
await page.getByRole("dialog").getByText("Selector de fecha y horario disponible").first().waitFor();
await settle(page, 1200);
await shot(page, "detalle-tarea");

await page.getByRole("dialog").getByRole("tab", { name: /GitHub/ }).click();
await page.getByRole("dialog").getByText("Commits").scrollIntoViewIfNeeded();
await settle(page, 800);
await shot(page, "github-en-tarea");
await page.keyboard.press("Escape");

await page.getByRole("button", { name: "IA", exact: true }).click();
await page.getByRole("menuitem", { name: "Resumir el sprint" }).click();
await page.getByText("Avance:").waitFor();
await shot(page, "ia-resumen");
await page.keyboard.press("Escape");

await page.getByRole("button", { name: "IA", exact: true }).click();
await page.getByRole("menuitem", { name: "Crear tareas desde texto" }).click();
await page.getByRole("dialog").locator("textarea").fill("Mañana hay que llamar a la policlínica por los feriados, el viernes revisar la agenda de Cordón con Martín y es urgente pedir las fotos de los profesionales");
await page.getByRole("button", { name: "Proponer tareas" }).click();
await page.getByRole("button", { name: /^Crear \d+ tareas?$/ }).waitFor();
await shot(page, "ia-tareas-desde-texto");
await page.keyboard.press("Escape");

await page.goto(`${BASE}/p/backlog/?key=AGE`);
await page.getByText("Sprint 6").first().waitFor();
await settle(page);
await shot(page, "backlog");

await page.goto(`${BASE}/p/epics/?key=AGE`);
await page.getByText("Recordatorios por WhatsApp").first().waitFor();
await settle(page);
await shot(page, "epics");

await page.goto(`${BASE}/p/automations/?key=AGE`);
await page.getByText("Al pasar a QA, asignar a Valentina").waitFor();
await settle(page);
await shot(page, "automatizaciones");
await page.getByRole("tab", { name: "Registro" }).click();
await page.getByText("Ejecutada").first().waitFor();
await page.locator("button", { hasText: "Al pasar a QA, asignar a Valentina" }).first().click();
await settle(page);
await shot(page, "registro-automatizaciones");

await page.goto(`${BASE}/p/?key=TIE`);
await card(page, "TIE-8").waitFor();
await settle(page);
await shot(page, "tablero-agente");

await page.goto(`${BASE}/p/settings/?key=TIE&tab=agent`);
await page.getByText("PRs del agente").waitFor();
await settle(page);
await shot(page, "agente-claude");

await page.goto(`${BASE}/p/?key=SOP&task=SOP-1`);
await page.getByRole("dialog").getByText("Pendiente de aprobación").waitFor();
await settle(page, 1200);
await shot(page, "por-aprobar");
await page.keyboard.press("Escape");

await page.goto(`${BASE}/inbox/`);
await page.getByText("te invitó a").first().waitFor();
await settle(page);
await shot(page, "buzon");

await page.goto(`${BASE}/admin/access/`);
await page.getByText("Gonzalo Rivas").first().waitFor();
await settle(page);
await shot(page, "acceso");

await page.goto(`${BASE}/`);
await page.locator("main").getByText("Agenda médica · Policlínica Las Acacias").waitFor();
await settle(page);
await shot(page, "proyectos");
await desktop.close();

// ─── Celular ────────────────────────────────────────────────────────────
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "es-UY",
  timezoneId: "America/Montevideo",
});
page = await mobile.newPage();
page.setDefaultTimeout(15_000);
await login(page, "Editor");
await page.goto(`${BASE}/p/?key=AGE`);
await card(page, "AGE-13").waitFor();
await settle(page);
await shot(page, "celular-tablero");
await page.goto(`${BASE}/p/?key=AGE&task=AGE-11`);
await page.getByRole("dialog").getByText("Bloquear el horario").first().waitFor();
await settle(page, 1200);
await shot(page, "celular-detalle");
await mobile.close();

// ─── Banner: escritorio + celular ───────────────────────────────────────
const asData = async (file) => `data:image/png;base64,${(await readFile(path.join(shots, file))).toString("base64")}`;
const bannerPage = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await bannerPage.setContent(`<!doctype html><html><body style="margin:0">
  <div style="width:1600px;height:900px;background:linear-gradient(135deg,#eef2ff 0%,#dbeafe 55%,#e0e7ff 100%);position:relative;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,sans-serif">
    <div style="position:absolute;left:70px;top:70px;width:1220px;border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgba(30,41,99,.28);background:#fff">
      <div style="height:34px;background:#f1f5f9;display:flex;align-items:center;gap:7px;padding:0 14px">
        <span style="width:11px;height:11px;border-radius:50%;background:#f87171"></span><span style="width:11px;height:11px;border-radius:50%;background:#fbbf24"></span><span style="width:11px;height:11px;border-radius:50%;background:#34d399"></span>
      </div>
      <img src="${await asData("tablero.png")}" style="display:block;width:1220px" />
    </div>
    <div style="position:absolute;right:80px;top:150px;width:330px;height:714px;border-radius:46px;background:#0f172a;padding:12px;box-shadow:0 30px 80px rgba(15,23,42,.45)">
      <img src="${await asData("celular-detalle.png")}" style="display:block;width:330px;height:714px;border-radius:36px;object-fit:cover;object-position:top" />
    </div>
  </div></body></html>`);
await bannerPage.waitForTimeout(300);
await bannerPage.screenshot({ path: path.join(docs, "banner.png") });
console.log("✓ banner");
await bannerPage.close();

// ─── GIF: arrastrar una tarea y ver la automatización ───────────────────
const videoDir = path.join(root, ".video-tmp");
await rm(videoDir, { recursive: true, force: true });
const rec = await browser.newContext({
  viewport: { width: 1280, height: 760 },
  locale: "es-UY",
  timezoneId: "America/Montevideo",
  recordVideo: { dir: videoDir, size: { width: 1280, height: 760 } },
});
page = await rec.newPage();
page.setDefaultTimeout(15_000);
await login(page);
await page.goto(`${BASE}/p/?key=AGE`);
await card(page, "AGE-13").waitFor();
await page.addStyleTag({ content: HIDE });
await settle(page, 1200);
const moveCard = async (key, target) => {
  const a = await card(page, key).boundingBox();
  const b = await column(page, target).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + 24, { steps: 8 });
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + 30, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + 90, { steps: 35 });
  await settle(page, 250);
  await page.mouse.up();
  await settle(page, 1100);
};
await moveCard("AGE-13", "En curso");
await moveCard("AGE-21", "En curso");
const target = await card(page, "AGE-9").boundingBox();
await page.mouse.move(target.x + 120, target.y + 20, { steps: 12 });
await card(page, "AGE-9").click();
await page.getByRole("dialog").getByText("Selector de fecha y horario disponible").first().waitFor();
await settle(page, 1800);
await page.getByRole("dialog").getByText("Criterios de aceptación").scrollIntoViewIfNeeded();
await page.mouse.wheel(0, 380);
await settle(page, 1800);
await rec.close();
const [video] = (await readdir(videoDir)).filter((f) => f.endsWith(".webm"));
const ffmpeg = spawnSync("ffmpeg", ["-version"]);
if (video && ffmpeg.status === 0) {
  const input = path.join(videoDir, video);
  const filters = "fps=12,scale=960:-1:flags=lanczos";
  spawnSync("ffmpeg", ["-y", "-ss", "1.2", "-i", input, "-vf", `${filters},palettegen=stats_mode=diff`, path.join(videoDir, "palette.png")]);
  spawnSync("ffmpeg", ["-y", "-ss", "1.2", "-i", input, "-i", path.join(videoDir, "palette.png"), "-lavfi", `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`, path.join(docs, "demo.gif")]);
  console.log("✓ demo.gif");
} else {
  console.log("✗ demo.gif: falta ffmpeg");
}
await rm(videoDir, { recursive: true, force: true });

await browser.close();
server.kill();

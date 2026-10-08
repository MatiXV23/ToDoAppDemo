// Genera las imágenes de ejemplo que usan los adjuntos de la demo (public/demo/attachments).
// Son bocetos y capturas ficticias dibujadas con HTML. Uso: node scripts/attachments.mjs
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "demo", "attachments");
await mkdir(out, { recursive: true });

const font = "font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;";
const phone = (inner, title) => `
  <div style="width:260px;height:520px;border:3px solid #334155;border-radius:34px;padding:14px;background:#fff;display:flex;flex-direction:column;gap:10px">
    <div style="height:6px;width:60px;background:#cbd5e1;border-radius:3px;margin:0 auto 4px"></div>
    <div style="font-weight:700;font-size:15px;color:#0f172a">${title}</div>
    <div style="display:inline-flex;align-self:flex-start;font-size:11px;padding:3px 8px;border:1.5px dashed #2563eb;color:#2563eb;border-radius:999px">Sede Centro</div>
    ${inner}
  </div>`;
const line = (w, h = 10) => `<div style="height:${h}px;width:${w}%;background:#e2e8f0;border-radius:5px"></div>`;
const box = (h, label = "") =>
  `<div style="height:${h}px;border:1.5px solid #94a3b8;border-radius:10px;display:flex;align-items:center;padding:0 10px;font-size:12px;color:#475569">${label}</div>`;

const images = {
  "boceto-reserva-turno.png": {
    size: { width: 1200, height: 760 },
    html: `<div style="${font};background:#f8fafc;width:1200px;height:760px;padding:36px;box-sizing:border-box">
      <div style="font-size:22px;font-weight:700;color:#0f172a">Reserva de turno · boceto v2</div>
      <div style="font-size:13px;color:#64748b;margin:4px 0 26px">Flujo para celular · 4 pasos · Policlínica Las Acacias</div>
      <div style="display:flex;gap:34px;justify-content:center">
        ${phone(`${box(36, "🔍 Buscar especialidad")}${["Clínica general", "Cardiología", "Pediatría", "Dermatología", "Traumatología"].map((s) => box(40, s)).join("")}`, "1. Especialidad")}
        ${phone(`${[["Dra. Olivera", "Mañana 9:30"], ["Dr. Pintos", "Jue 15:00"], ["Dra. Sanguinetti", "Vie 10:15"]].map(([n, t]) => `<div style="display:flex;gap:10px;align-items:center;border:1.5px solid #94a3b8;border-radius:10px;padding:10px"><div style="width:36px;height:36px;border-radius:50%;background:#e2e8f0"></div><div style="font-size:12px;color:#334155"><b>${n}</b><br/><span style="color:#16a34a">Próximo: ${t}</span></div></div>`).join("")}`, "2. Profesional")}
        ${phone(`<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">${Array.from({ length: 28 }, (_, i) => `<div style="height:26px;border-radius:6px;font-size:10px;display:flex;align-items:center;justify-content:center;${i % 6 === 0 ? "color:#cbd5e1" : i === 9 ? "background:#2563eb;color:#fff" : "border:1px solid #cbd5e1;color:#334155"}">${i + 1}</div>`).join("")}</div>
          <div style="font-size:12px;color:#64748b">Mañana</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${["9:00", "9:30", "10:00", "10:30", "11:15"].map((h, i) => `<div style="font-size:11px;padding:6px 9px;border-radius:8px;${i === 1 ? "background:#2563eb;color:#fff" : "border:1px solid #94a3b8"}">${h}</div>`).join("")}</div>
          <div style="font-size:12px;color:#64748b">Tarde</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${["14:00", "15:30", "16:00"].map((h) => `<div style="font-size:11px;padding:6px 9px;border-radius:8px;border:1px solid #94a3b8">${h}</div>`).join("")}</div>`, "3. Día y hora")}
        ${phone(`<div style="border:1.5px solid #94a3b8;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px">${line(70, 12)}${line(55)}${line(80)}${line(45)}</div>
          <div style="font-size:11px;color:#64748b">Podés cancelar sin costo hasta 24 h antes.</div>
          <div style="margin-top:auto;height:44px;border-radius:12px;background:#2563eb;color:#fff;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center">Confirmar turno</div>`, "4. Confirmación")}
      </div>
    </div>`,
  },
  "grafico-turnos-semana.png": {
    size: { width: 1000, height: 600 },
    html: `<div style="${font};background:#fff;width:1000px;height:600px;padding:36px;box-sizing:border-box">
      <div style="font-size:20px;font-weight:700;color:#0f172a">Ausentismo por día · semana pasada</div>
      <div style="font-size:13px;color:#64748b;margin:4px 0 30px">Turnos a los que el paciente no vino, sobre el total de turnos dados</div>
      <div style="display:flex;align-items:flex-end;gap:42px;height:380px;border-bottom:2px solid #cbd5e1;padding:0 40px">
        ${[["Lun", 21], ["Mar", 16], ["Mié", 14], ["Jue", 19], ["Vie", 23], ["Sáb", 11]].map(([d, v]) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:8px"><div style="font-size:15px;font-weight:600;color:#334155">${v} %</div><div style="width:100%;height:${v * 14}px;background:${v > 18 ? "#f97316" : "#60a5fa"};border-radius:8px 8px 0 0"></div><div style="font-size:14px;color:#475569">${d}</div></div>`).join("")}
      </div>
      <div style="font-size:12px;color:#64748b;margin-top:14px">Promedio: 18 % · Meta con recordatorios: menos de 10 %</div>
    </div>`,
  },
  "captura-error-checkout.png": {
    size: { width: 1200, height: 720 },
    html: `<div style="${font};background:#e2e8f0;width:1200px;height:720px;padding:24px;box-sizing:border-box">
      <div style="background:#fff;border-radius:12px;overflow:hidden;height:100%;box-shadow:0 6px 24px rgba(15,23,42,.12)">
        <div style="height:40px;background:#f1f5f9;display:flex;align-items:center;gap:8px;padding:0 14px">
          <span style="width:12px;height:12px;border-radius:50%;background:#f87171"></span><span style="width:12px;height:12px;border-radius:50%;background:#fbbf24"></span><span style="width:12px;height:12px;border-radius:50%;background:#34d399"></span>
          <div style="margin-left:16px;flex:1;height:24px;border-radius:6px;background:#fff;font-size:12px;color:#64748b;display:flex;align-items:center;padding:0 10px">staging.tienda.local/checkout</div>
        </div>
        <div style="display:flex;gap:30px;padding:34px 44px">
          <div style="flex:1.4;display:flex;flex-direction:column;gap:14px">
            <div style="font-size:22px;font-weight:700;color:#14532d">Finalizar compra</div>
            ${["Nombre y apellido", "Email", "Departamento: Montevideo", "Dirección de entrega"].map((l) => `<div style="height:42px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;color:#64748b;display:flex;align-items:center;padding:0 12px">${l}</div>`).join("")}
            <div style="border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;border-radius:10px;padding:14px 16px;font-size:14px">
              <b>No pudimos procesar el pago.</b><br/>cc_rejected_other_reason · amount must be greater than 50 (sandbox)
            </div>
            <div style="height:46px;border-radius:10px;background:#15803d;color:#fff;font-weight:600;display:flex;align-items:center;justify-content:center;opacity:.6">Pagar $ 45</div>
          </div>
          <div style="flex:1;border:1px solid #e2e8f0;border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:10px;font-size:14px;color:#334155;align-self:flex-start">
            <b>Tu pedido</b>
            <div style="display:flex;justify-content:space-between"><span>Bombilla de alpaca</span><span>$ 45</span></div>
            <div style="display:flex;justify-content:space-between;color:#64748b"><span>Envío</span><span>Retiro en local</span></div>
            <div style="border-top:1px solid #e2e8f0;padding-top:10px;display:flex;justify-content:space-between;font-weight:700"><span>Total</span><span>$ 45</span></div>
          </div>
        </div>
      </div>
    </div>`,
  },
  "propuesta-home-tienda.png": {
    size: { width: 1200, height: 800 },
    html: `<div style="${font};background:#fffbeb;width:1200px;height:800px;box-sizing:border-box">
      <div style="height:64px;background:#14532d;color:#fefce8;display:flex;align-items:center;justify-content:space-between;padding:0 40px">
        <b style="font-size:20px">Almacén de Campo</b>
        <div style="display:flex;gap:26px;font-size:14px;opacity:.9"><span>Yerbas</span><span>Mieles</span><span>Quesos</span><span>Accesorios</span><span>🛒 2</span></div>
      </div>
      <div style="margin:28px 40px;height:250px;border-radius:18px;background:linear-gradient(120deg,#f59e0b,#fbbf24);display:flex;align-items:center;padding:0 46px;color:#422006">
        <div><div style="font-size:14px;letter-spacing:.08em;text-transform:uppercase">Cosecha de primavera</div><div style="font-size:38px;font-weight:800;margin:6px 0 14px">Miel de pradera</div><div style="display:inline-block;background:#14532d;color:#fff;padding:10px 18px;border-radius:10px;font-weight:600">Ver productos</div></div>
      </div>
      <div style="margin:0 40px;font-size:18px;font-weight:700;color:#14532d">Destacados de la semana</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin:16px 40px">
        ${[["Yerba barbacuá 1 kg", "$ 390", "#a3e635"], ["Miel de pradera 500 g", "$ 280", "#fbbf24"], ["Queso colonia (kg)", "$ 520", "#fde68a"], ["Mate de calabaza", "$ 650", "#d6d3d1"]].map(([n, p, c]) => `<div style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #fde68a"><div style="height:140px;background:${c}"></div><div style="padding:12px;font-size:14px;color:#334155">${n}<br/><b style="color:#14532d">${p}</b></div></div>`).join("")}
      </div>
    </div>`,
  },
  "reporte-pantalla-blanca.png": {
    size: { width: 480, height: 600 },
    html: `<div style="${font};background:#fff;width:480px;height:600px;box-sizing:border-box;border:1px solid #e2e8f0">
      <style>@keyframes s{to{transform:rotate(360deg)}}</style>
      <div style="height:30px;background:#1e293b;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:space-between;padding:0 14px"><span>10:42</span><span>4G · 61 %</span></div>
      <div style="height:56px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:12px;padding:0 16px;font-size:17px;font-weight:600;color:#0f172a">← Mis turnos</div>
      <div style="height:512px;display:flex;align-items:center;justify-content:center">
        <div style="width:34px;height:34px;border-radius:50%;border:4px solid #e2e8f0;border-top-color:#94a3b8"></div>
      </div>
    </div>`,
  },
  "no-disponible.png": {
    size: { width: 800, height: 500 },
    html: `<div style="${font};background:#f1f5f9;width:800px;height:500px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:#64748b">
      <div style="font-size:48px">🖼️</div><div style="font-size:18px">Imagen no disponible en este navegador</div>
    </div>`,
  },
};

const browser = await chromium.launch();
for (const [name, { size, html }] of Object.entries(images)) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0">${html}</body></html>`);
  await page.screenshot({ path: path.join(out, name) });
  await page.close();
  console.log("✓", name);
}
await browser.close();

/* =========================================================
   PANEL DE CONTROL · Gestión Empresarial UT Cancún
   Lee y escribe los archivos del sitio en GitHub mediante su API.
   ========================================================= */
(() => {
"use strict";
const C = PANEL_CONFIG;
const R = `/repos/${C.owner}/${C.repo}`;
const SITE = new URL("../", location.href).href;          // Raíz del sitio publicado
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const slug = s => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "archivo";
const uid = () => Date.now().toString(36).slice(-5);
const clone = o => JSON.parse(JSON.stringify(o));
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const ICON = {
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  img: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg>'
};

/* ---------------- Estado ---------------- */
const S = {
  token: null,
  data: null,          // Variables de js/datos.js
  empresas: [],        // js/empresas.js
  css: "", index: "",  // Textos de css/styles.css e index.html
  uploads: {},         // ruta → {blob, url, published}
  deletes: new Set(),  // rutas a borrar al publicar
  touched: new Set(),  // archivos de texto modificados
  log: new Map(),      // clave → descripción del cambio
  source: "",          // "github" o "sitio"
  headSha: "",
  view: "inicio"
};

/* ---------------- Utilidades de interfaz ---------------- */
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }
function busy(txt) { $("#busy").hidden = !txt; if (txt) $("#busyTxt").textContent = txt; }
function confirmBox(title, text, okTxt = "Sí, continuar", danger = true) {
  return new Promise(res => {
    const d = $("#confirmDlg"); $("#confirmTitle").textContent = title; $("#confirmText").innerHTML = text;
    const ok = $("#confirmOk"); ok.textContent = okTxt; ok.className = "btn " + (danger ? "danger" : "green");
    d.returnValue = ""; d.showModal(); d.addEventListener("close", () => res(d.returnValue === "yes"), { once: true });
  });
}
document.addEventListener("click", e => { const b = e.target.closest("[data-close]"); if (b) b.closest("dialog").close(); });

function change(file, key, text) {
  S.touched.add(file); S.log.set(key, text); updateCount();
}
function updateCount() {
  const n = S.log.size, c = $("#pendingCount");
  c.textContent = n; c.hidden = !n;
}
window.addEventListener("beforeunload", e => { if (S.log.size) { e.preventDefault(); e.returnValue = ""; } });

/* ---------------- Fechas ---------------- */
const parseISO = iso => { const [y, m, d] = iso.split("-").map(Number); return { y, m, d }; };
function rangeText(s, e) {
  if (!s) return "";
  const a = parseISO(s), b = parseISO(e || s);
  if (s === (e || s)) return `${a.d} ${MESES[a.m - 1]} ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${a.d} – ${b.d} ${MESES[a.m - 1]} ${a.y}`;
  if (a.y === b.y) return `${a.d} ${MESES[a.m - 1]} – ${b.d} ${MESES[b.m - 1]} ${a.y}`;
  return `${a.d} ${MESES[a.m - 1]} ${a.y} – ${b.d} ${MESES[b.m - 1]} ${b.y}`;
}
const todayISO = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
const fmtDate = iso => { if (!iso) return ""; const a = parseISO(iso); return `${a.d} ${MESES[a.m - 1]} ${a.y}`; };

/* ---------------- GitHub ---------------- */
class GhError extends Error { constructor(status, body) { super(`GitHub respondió ${status}`); this.status = status; this.body = body; } }
async function gh(path, { method = "GET", body, raw = false, auth = true } = {}) {
  const headers = { Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (auth && S.token) headers.Authorization = `Bearer ${S.token}`;
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch(C.api + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  if (!r.ok) throw new GhError(r.status, await r.text().catch(() => ""));
  return raw ? r.text() : (r.status === 204 ? null : r.json());
}
const encPath = p => p.split("/").map(encodeURIComponent).join("/");
function ghMessage(err) {
  if (!(err instanceof GhError)) return "No hay conexión a internet o GitHub no responde. Intenta de nuevo.";
  if (err.status === 401) return "La llave de acceso no es válida o ya venció. Genera una nueva y vuelve a conectar.";
  if (err.status === 403) return "La llave no tiene permiso de escritura. Revisa que en Contents diga «Read and write».";
  if (err.status === 404) return "No se encontró el repositorio. Revisa que la llave tenga acceso a " + C.repo + ".";
  if (err.status === 409 || err.status === 422) return "GitHub rechazó el cambio porque alguien publicó al mismo tiempo. Recarga el panel e intenta de nuevo.";
  return "GitHub respondió con un error (" + err.status + "). Intenta de nuevo en unos minutos.";
}

const store = {
  get() { try { return localStorage.getItem("ge-panel-token") || sessionStorage.getItem("ge-panel-token"); } catch (e) { return null; } },
  set(t, remember) { try { (remember ? localStorage : sessionStorage).setItem("ge-panel-token", t); } catch (e) {} },
  clear() { try { localStorage.removeItem("ge-panel-token"); sessionStorage.removeItem("ge-panel-token"); } catch (e) {} }
};
function setStatus() {
  const b = $("#statusBtn"); b.classList.toggle("on", !!S.token);
  $("span", b).textContent = S.token ? "Conectado a GitHub" : "Sin conectar";
}

async function readText(path) {
  if (S.token) {
    try { S.source = "github"; return await gh(`${R}/contents/${encPath(path)}?ref=${C.branch}`, { raw: true }); }
    catch (e) { if (!(e instanceof GhError) || e.status !== 404) throw e; }
  }
  S.source = "sitio";
  const r = await fetch(SITE + path + "?t=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error("No se pudo leer " + path);
  return r.text();
}

/* ---------------- Lectura de datos ---------------- */
const NAMES = ["AGENDA_URL", "FECHA_LISTA", "FORMATOS", "DIVS", "BENEFICIOS", "VACANTES", "TEL", "PEOPLE_GE", "PEOPLE_DIV", "STEPS", "CHECK"];
function parseDatos(text) {
  const fn = new Function(text + "\n;return {" + NAMES.map(n => `${n}: typeof ${n} !== "undefined" ? ${n} : undefined`).join(",") + "};");
  const d = fn();
  d.FORMATOS ||= []; d.BENEFICIOS ||= []; d.VACANTES ||= []; d.PEOPLE_GE ||= []; d.PEOPLE_DIV ||= []; d.STEPS ||= []; d.CHECK ||= [];
  return clone(d);
}
function parseEmpresas(text) { return clone(new Function(text + "\n;return EMPRESAS;")()); }

async function load() {
  $("#loading").hidden = false; $$(".view").forEach(v => v.hidden = true);
  try {
    const [datos, emp, css, index] = await Promise.all(["js/datos.js", "js/empresas.js", "css/styles.css", "index.html"].map(readText));
    S.data = parseDatos(datos); S.empresas = parseEmpresas(emp); S.css = css; S.index = index;
    S.touched.clear(); S.log.clear(); S.deletes.clear(); updateCount();
    $("#loading").hidden = true; go(S.view);
  } catch (e) {
    console.error(e);
    $("#loading").innerHTML = `<div class="notice">No se pudo cargar la información del sitio. ${esc(e instanceof GhError ? ghMessage(e) : e.message)}<br><button class="btn sm ghost" onclick="location.reload()">Reintentar</button></div>`;
  }
}

/* ---------------- Generación de archivos ---------------- */
const J = v => JSON.stringify(v);
const arr = a => a.length ? "[\n  " + a.map(J).join(",\n  ") + "\n]" : "[]";
function genDatos() {
  const d = S.data;
  return `/* =========================================================
   DATOS EDITABLES DEL SITIO
   Este archivo lo actualiza el Panel de control (carpeta panel/).
   Si lo editas a mano, respeta comillas, comas y corchetes.
   ========================================================= */
const AGENDA_URL = ${J(d.AGENDA_URL || "")};   // Agenda de actividades en PDF (carpeta docs/)
const FECHA_LISTA = ${J(d.FECHA_LISTA || "")};   // Fecha de actualización del listado de empresas

/* Formatos de la sección Estadías. archivo:true descarga el archivo en lugar de abrir una página. */
const FORMATOS = ${arr(d.FORMATOS)};

const DIVS = {
${Object.entries(d.DIVS).map(([k, v]) => `  ${k}: ${J(v)}`).join(",\n")}
};

/* Beneficios para la comunidad UT (sección Egresados). */
const BENEFICIOS = ${arr(d.BENEFICIOS)};

/* Vacantes publicadas (sección Bolsa de trabajo). */
const VACANTES = ${arr(d.VACANTES)};

const TEL = ${J(d.TEL || "")};
const PEOPLE_GE = ${arr(d.PEOPLE_GE)};
const PEOPLE_DIV = ${arr(d.PEOPLE_DIV)};

/* Calendario del periodo: fechas "AAAA-MM-DD". m:true marca una fecha clave sin número. */
const STEPS = ${arr(d.STEPS)};

/* Actividades del checklist de estadía. */
const CHECK = ${arr(d.CHECK)};
`;
}
function genEmpresas() {
  return `/* Listado de empresas vinculadas. Este archivo lo actualiza el Panel de control.
   Campos: n = nombre comercial, g = actividad comercial,
   s = giro (categoría para el filtro), d = divisiones afines (eca, ing, tur, gas), u = ubicación. */
const EMPRESAS = [
${S.empresas.map(J).join(",\n")}
];
`;
}

/* ---------------- Archivos subidos ---------------- */
const srcOf = p => !p ? "" : /^(https?:|blob:|data:)/.test(p) ? p : (S.uploads[p]?.url || SITE + p);
function addUpload(path, blob) {
  if (S.uploads[path]?.url) URL.revokeObjectURL(S.uploads[path].url);
  S.uploads[path] = { blob, url: URL.createObjectURL(blob), published: false };
  S.deletes.delete(path);
}
function referenced(path) {
  const d = S.data; const all = [d.AGENDA_URL, ...d.FORMATOS.map(f => f.url), ...d.VACANTES.map(v => v.flyer), ...d.BENEFICIOS.map(b => b.flyer)];
  return all.includes(path);
}
function dropFile(path) {
  if (!path || /^https?:/.test(path) || referenced(path)) return;
  if (!/^(img\/vacantes|img\/beneficios|docs)\//.test(path)) return;
  const u = S.uploads[path];
  if (u && !u.published) { URL.revokeObjectURL(u.url); delete S.uploads[path]; }
  else S.deletes.add(path);
}
function loadImage(file) {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error("No se pudo leer la imagen")); img.src = URL.createObjectURL(file); });
}
async function processImage(file, { max = 1400, png = false } = {}) {
  const img = await loadImage(file);
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement("canvas"); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
  const ctx = cv.getContext("2d");
  if (!png) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); }
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  URL.revokeObjectURL(img.src);
  return new Promise(res => cv.toBlob(res, png ? "image/png" : "image/jpeg", .84));
}
const extOf = name => (String(name).match(/\.([a-z0-9]{2,5})$/i) || ["", ""])[1].toLowerCase();

/* ---------------- Formulario genérico ---------------- */
function fieldHTML(f, v) {
  const id = "f_" + f.k, req = f.req ? ' <span class="req">*</span>' : "";
  const help = f.help ? `<small>${f.help}</small>` : "";
  const half = f.half ? ' data-half' : "";
  switch (f.type) {
    case "textarea": return `<label class="field"${half}><span>${f.label}${req}</span><textarea id="${id}" placeholder="${esc(f.ph || "")}">${esc(v || "")}</textarea>${help}</label>`;
    case "lines": return `<label class="field"><span>${f.label}${req}</span><textarea id="${id}" placeholder="Escribe un elemento por renglón">${esc((v || []).join("\n"))}</textarea>${help}</label>`;
    case "divs": return `<div class="field"><span>${f.label}${req}</span><div class="chips" id="${id}">${Object.entries(S.data.DIVS).map(([k, d]) => `<label><input type="checkbox" value="${k}" ${[].concat(v || []).includes(k) ? "checked" : ""}>${esc(d.n)}</label>`).join("")}</div>${help}</div>`;
    case "check": return `<label class="check-line"><input type="checkbox" id="${id}" ${v ? "checked" : ""}> ${f.label}</label>`;
    case "image": case "file": {
      const isImg = f.type === "image";
      const prev = v ? (isImg ? `<img src="${esc(srcOf(v))}" alt="">` : `<span class="ph">${ICON.file}</span>`) : `<span class="ph">${isImg ? ICON.img : ICON.file}</span>`;
      return `<div class="field"><span>${f.label}${req}</span>
        <label class="drop" id="${id}">${prev}<p><b>Haz clic o arrastra aquí ${isImg ? "la imagen" : "el archivo"}</b><br><span class="muted" data-name>${v ? "Actual: " + esc(String(v).split("/").pop()) : (f.accept === "application/pdf" ? "Solo PDF" : isImg ? "JPG o PNG" : "PDF, Word o Excel")}</span></p>
        <input type="file" hidden accept="${f.accept || (isImg ? "image/*" : ".pdf,.doc,.docx,.xls,.xlsx")}"></label>${help}</div>`;
    }
    default: return `<label class="field"${half}><span>${f.label}${req}</span><input type="${f.type || "text"}" id="${id}" value="${esc(v ?? "")}" placeholder="${esc(f.ph || "")}" ${f.list ? `list="${id}_l"` : ""}>${f.list ? `<datalist id="${id}_l">${f.list.map(o => `<option value="${esc(o)}">`).join("")}</datalist>` : ""}${help}</label>`;
  }
}
function openForm({ title, fields, values = {}, okText = "Guardar", onSave }) {
  const dlg = $("#formDlg"), body = $("#formBody"), files = {};
  $("#formTitle").textContent = title; $("#formOk").textContent = okText;
  // Agrupa campos de media anchura en dos columnas
  let html = "", buf = [];
  const flush = () => { if (buf.length) { html += `<div class="grid2">${buf.join("")}</div>`; buf = []; } };
  for (const f of fields) { const h = fieldHTML(f, values[f.k]); if (f.half) buf.push(h); else { flush(); html += h; } }
  flush(); html += `<p class="msg err" id="formErr"></p>`;
  body.innerHTML = html;
  for (const f of fields.filter(f => f.type === "image" || f.type === "file")) {
    const zone = $("#f_" + f.k), input = $("input", zone);
    const take = async file => {
      if (!file) return;
      if (f.accept === "application/pdf" && extOf(file.name) !== "pdf") return toast("Ese archivo no es PDF");
      if (f.type === "image" && !file.type.startsWith("image/")) return toast("Ese archivo no es una imagen");
      if (file.size > 40 * 1024 * 1024) return toast("El archivo pesa más de 40 MB");
      files[f.k] = { file, blob: f.type === "image" ? await processImage(file) : file };
      const ph = $("img,.ph", zone);
      if (f.type === "image") { const im = document.createElement("img"); im.src = URL.createObjectURL(files[f.k].blob); ph.replaceWith(im); }
      $("[data-name]", zone).textContent = "Nuevo: " + file.name;
    };
    input.addEventListener("change", () => take(input.files[0]));
    zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", e => { e.preventDefault(); zone.classList.remove("over"); take(e.dataTransfer.files[0]); });
  }
  $("#formEl").onsubmit = e => {
    e.preventDefault();
    const out = {};
    for (const f of fields) {
      const el = $("#f_" + f.k);
      if (f.type === "divs") out[f.k] = $$("input:checked", el).map(i => i.value);
      else if (f.type === "lines") out[f.k] = el.value.split("\n").map(s => s.trim()).filter(Boolean);
      else if (f.type === "check") out[f.k] = el.checked;
      else if (f.type === "image" || f.type === "file") out[f.k] = values[f.k] || "";
      else out[f.k] = el.value.trim();
      const empty = f.type === "image" || f.type === "file" ? !out[f.k] && !files[f.k] : (Array.isArray(out[f.k]) ? !out[f.k].length : !out[f.k]);
      if (f.req && empty) { $("#formErr").textContent = `Falta llenar: ${f.label}.`; return; }
    }
    if (onSave(out, files) !== false) dlg.close();
  };
  dlg.showModal();
}
const clean = o => { for (const k of Object.keys(o)) if (o[k] === "" || o[k] === false || (Array.isArray(o[k]) && !o[k].length)) delete o[k]; return o; };

/* ---------------- Navegación ---------------- */
const RENDER = {};
function go(view) {
  S.view = view;
  $$(".side button").forEach(b => b.classList.toggle("on", b.dataset.go === view));
  $$(".view").forEach(v => v.hidden = v.dataset.view !== view);
  if (S.data) RENDER[view]($(`.view[data-view="${view}"]`));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("#side").addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) go(b.dataset.go); });
document.addEventListener("click", e => { const b = e.target.closest("[data-goto]"); if (b) go(b.dataset.goto); });
const head = (eyebrow, title, desc, extra = "") => `<div class="head"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${desc}</p></div><div class="row">${extra}</div></div>`;
const howto = (items, open = false) => `<details class="howto" ${open ? "open" : ""}><summary>¿Cómo se hace?</summary><ol>${items.map(i => `<li>${i}</li>`).join("")}</ol></details>`;
const moveIn = (a, i, d) => { const j = i + d; if (j < 0 || j >= a.length) return false; [a[i], a[j]] = [a[j], a[i]]; return true; };

/* ================= INICIO ================= */
RENDER.inicio = el => {
  const d = S.data;
  const next = d.STEPS.find(s => s.s && (s.e || s.s) >= todayISO());
  el.innerHTML = head("Bienvenida", "Panel de control del sitio", "Desde aquí cualquier persona del equipo puede actualizar el sitio de Gestión Empresarial sin tocar código.") +
    (S.token ? `<div class="notice ok">✅ Conectado a GitHub. Los cambios que publiques se verán en el sitio de GitHub en 1 a 3 minutos.</div>`
      : `<div class="notice">🔒 Puedes editar y usar <b>Ver como</b> sin conectarte. Para <b>publicar</b> necesitas conectar el panel con GitHub. <button class="btn sm green" type="button" id="iConnect">Conectar</button></div>`) +
    `<div class="steps3">
      <div class="st"><b>1</b><h3>Edita</h3><p>Elige una sección del menú izquierdo: vacantes, estadías, beneficios, empresas, contactos o apariencia.</p></div>
      <div class="st"><b>2</b><h3>Revisa con «Ver como»</h3><p>Arriba, en <b>Ver como</b>, ves el sitio con tus cambios en computadora, tableta o celular antes de publicar.</p></div>
      <div class="st"><b>3</b><h3>Publica y descarga</h3><p><b>Publicar cambios</b> guarda todo en GitHub. <b>Descargar código</b> te da el ZIP listo para la carpeta del servidor.</p></div>
    </div>
    <div class="block" style="margin-top:18px"><h2>Lo que hay hoy en el sitio</h2><p class="sub">Haz clic en una tarjeta para ir a esa sección.</p>
      <div class="stats">
        <div class="stat" data-goto="vacantes"><b>${d.VACANTES.length}</b><span>Vacantes publicadas</span></div>
        <div class="stat" data-goto="beneficios"><b>${d.BENEFICIOS.length}</b><span>Beneficios</span></div>
        <div class="stat" data-goto="empresas"><b>${S.empresas.length}</b><span>Empresas vinculadas</span></div>
        <div class="stat" data-goto="cuatri"><b style="font-size:1.05rem;line-height:1.3">${next ? esc(next.t) : "Sin fechas próximas"}</b><span>${next ? "Próxima fecha: " + esc(next.w || fmtDate(next.s)) : "Actualiza el calendario"}</span></div>
      </div></div>
    <div class="block"><h2>Al iniciar un nuevo cuatrimestre</h2><p class="sub">Sigue esta lista en orden. Cada botón te lleva a la sección correcta.</p>
      <ul class="todo">
        <li><b>1</b><span>Sube la nueva <b>agenda de actividades en PDF</b>.</span><button class="btn sm ghost" data-goto="cuatri">Ir</button></li>
        <li><b>2</b><span>Actualiza las <b>fechas del calendario</b> (los 10 pasos y las fechas clave).</span><button class="btn sm ghost" data-goto="cuatri">Ir</button></li>
        <li><b>3</b><span>Revisa los <b>formatos</b>: fechas en el texto y, si cambió, sube la nueva carta de liberación.</span><button class="btn sm ghost" data-goto="cuatri">Ir</button></li>
        <li><b>4</b><span>Quita las <b>vacantes y beneficios vencidos</b> y agrega los nuevos.</span><button class="btn sm ghost" data-goto="vacantes">Ir</button></li>
        <li><b>5</b><span>Si hay un nuevo listado de <b>empresas vinculadas</b>, actualízalo y cambia la fecha del listado.</span><button class="btn sm ghost" data-goto="empresas">Ir</button></li>
        <li><b>6</b><span>Revisa todo con <b>Ver como</b>, <b>publica</b> y <b>descarga el código</b> para el servidor.</span><button class="btn sm ghost" data-goto="publicar">Ir</button></li>
      </ul></div>
    <p class="small muted">Sitio publicado en GitHub: <a href="${esc(SITE)}" target="_blank" rel="noopener">${esc(SITE)}</a> · Repositorio: <a href="https://github.com/${C.owner}/${C.repo}" target="_blank" rel="noopener">${C.owner}/${C.repo}</a></p>`;
  $("#iConnect")?.addEventListener("click", openConnect);
};

/* ================= VACANTES ================= */
const VAC_FIELDS = () => [
  { k: "flyer", type: "image", label: "Cartel de la vacante", help: "Se muestra completo en la página. Si no tienes cartel, llena funciones, requisitos y prestaciones." },
  { k: "puesto", label: "Puesto", req: true },
  { k: "empresa", label: "Empresa", req: true },
  { k: "div", type: "divs", label: "División o divisiones afines", help: "Sirve para el filtro de la bolsa de trabajo." },
  { k: "ubicacion", label: "Ubicación", half: true, ph: "Cancún, Q. Roo" },
  { k: "sueldo", label: "Sueldo", half: true, ph: "$12,000 mensuales" },
  { k: "dirigida", label: "Dirigida a", half: true, ph: "Egresados, estudiantes…" },
  { k: "fecha", type: "date", label: "Fecha de publicación", half: true },
  { k: "funciones", type: "lines", label: "Funciones", help: "Una por renglón. Opcional." },
  { k: "requisitos", type: "lines", label: "Requisitos", help: "Una por renglón. Opcional." },
  { k: "ofrecemos", type: "lines", label: "Ofrecemos", help: "Una por renglón. Opcional." }
];
function saveItem({ list, i, out, files, folder, file, what, name }) {
  const prev = i == null ? null : list[i];
  if (files.flyer) {
    const path = `${folder}/${slug(name)}-${uid()}.jpg`;
    addUpload(path, files.flyer.blob); out.flyer = path;
  }
  const item = clean({ ...(prev || {}), ...out });
  if (i == null) list.unshift(item); else list[i] = item;
  if (prev?.flyer && prev.flyer !== item.flyer) dropFile(prev.flyer);
  change(file, `${what}:${name}:${uid()}`, `${what} ${i == null ? "agregada" : "editada"}: ${name}`);
}
RENDER.vacantes = el => {
  const L = S.data.VACANTES;
  el.innerHTML = head("Bolsa de trabajo", "Vacantes", "Las vacantes aparecen en la sección Bolsa de trabajo. La primera de la lista se muestra primero.",
    `<button class="btn green" id="vAdd">${ICON.plus}Agregar vacante</button>`) +
    howto(["Haz clic en <b>Agregar vacante</b>.", "Sube el <b>cartel</b> (imagen JPG o PNG). El panel lo optimiza para que cargue rápido.", "Escribe el <b>puesto</b> y la <b>empresa</b>, y marca las <b>divisiones</b> afines.", "Haz clic en <b>Guardar</b>. Para quitar una vacante vencida usa <b>Eliminar</b>.", "Cuando termines, revisa con <b>Ver como</b> y luego <b>Publicar cambios</b>."]) +
    (L.length ? `<div class="cards">${L.map((v, i) => `<article class="card">
      <div class="thumb">${v.flyer ? `<img src="${esc(srcOf(v.flyer))}" alt="" loading="lazy">` : `<span class="none">Sin cartel</span>`}</div>
      <div class="info">${v.fecha ? `<span class="tag">Publicada ${esc(fmtDate(v.fecha))}</span>` : ""}<h3>${esc(v.puesto)}</h3><p>${esc(v.empresa)}</p><p>${[].concat(v.div || []).map(k => esc(S.data.DIVS[k]?.n || k)).join(" · ")}</p></div>
      <div class="acts"><button class="btn sm ghost" data-a="edit" data-i="${i}">${ICON.edit}Editar</button><button class="btn sm ghost" data-a="up" data-i="${i}" title="Subir">${ICON.up}</button><button class="btn sm ghost" data-a="down" data-i="${i}" title="Bajar">${ICON.down}</button><button class="btn sm ghost" data-a="del" data-i="${i}" style="color:var(--danger)">${ICON.del}Eliminar</button></div>
    </article>`).join("")}</div>` : `<div class="empty">No hay vacantes. La página mostrará un aviso de que pronto habrá nuevas.</div>`);
  const form = i => openForm({
    title: i == null ? "Nueva vacante" : "Editar vacante", fields: VAC_FIELDS(),
    values: i == null ? { fecha: todayISO() } : L[i],
    onSave: (out, files) => saveItem({ list: L, i, out, files, folder: "img/vacantes", file: "js/datos.js", what: "Vacante", name: `${out.empresa} ${out.puesto}` }) || RENDER.vacantes(el)
  });
  $("#vAdd").onclick = () => form(null);
  el.querySelector(".cards")?.addEventListener("click", async e => {
    const b = e.target.closest("[data-a]"); if (!b) return; const i = +b.dataset.i, v = L[i];
    if (b.dataset.a === "edit") form(i);
    if (b.dataset.a === "up" || b.dataset.a === "down") { if (moveIn(L, i, b.dataset.a === "up" ? -1 : 1)) { change("js/datos.js", "vac-orden", "Orden de vacantes cambiado"); RENDER.vacantes(el); } }
    if (b.dataset.a === "del" && await confirmBox("¿Eliminar vacante?", `Se quitará <b>${esc(v.puesto)}</b> de ${esc(v.empresa)} del sitio.`, "Eliminar")) {
      L.splice(i, 1); dropFile(v.flyer); change("js/datos.js", "vac-del-" + uid(), `Vacante eliminada: ${v.puesto} (${v.empresa})`); RENDER.vacantes(el);
    }
  });
};

/* ================= BENEFICIOS ================= */
RENDER.beneficios = el => {
  const L = S.data.BENEFICIOS;
  const tipos = [...new Set(["Hospedaje", "Restaurantes", "Compras", "Salud", "Educación", "Entretenimiento", "Servicios", ...L.map(b => b.tipo)])];
  el.innerHTML = head("Egresados", "Beneficios para la comunidad UT", "Los carteles de convenios y descuentos aparecen en la sección Egresados. Se ajustan solos si son horizontales o verticales.",
    `<button class="btn green" id="bAdd">${ICON.plus}Agregar beneficio</button>`) +
    howto(["Haz clic en <b>Agregar beneficio</b> y sube el cartel.", "Escribe la <b>empresa</b>, el <b>tipo</b> (Hospedaje, Salud…) y una frase corta con el beneficio.", "Cuando un convenio venza, usa <b>Eliminar</b>.", "Revisa con <b>Ver como</b> → sección Egresados, y publica."]) +
    (L.length ? `<div class="cards">${L.map((b, i) => `<article class="card">
      <div class="thumb">${b.flyer ? `<img src="${esc(srcOf(b.flyer))}" alt="" loading="lazy">` : `<span class="none">Sin cartel</span>`}</div>
      <div class="info"><span class="tag">${esc(b.tipo || "")}</span><h3>${esc(b.empresa)}</h3><p>${esc(b.detalle || "")}</p></div>
      <div class="acts"><button class="btn sm ghost" data-a="edit" data-i="${i}">${ICON.edit}Editar</button><button class="btn sm ghost" data-a="up" data-i="${i}" title="Subir">${ICON.up}</button><button class="btn sm ghost" data-a="down" data-i="${i}" title="Bajar">${ICON.down}</button><button class="btn sm ghost" data-a="del" data-i="${i}" style="color:var(--danger)">${ICON.del}Eliminar</button></div>
    </article>`).join("")}</div>` : `<div class="empty">No hay beneficios. La sección quedará vacía.</div>`);
  const form = i => openForm({
    title: i == null ? "Nuevo beneficio" : "Editar beneficio",
    fields: [{ k: "flyer", type: "image", label: "Cartel del beneficio", req: true }, { k: "empresa", label: "Empresa", req: true }, { k: "tipo", label: "Tipo de beneficio", list: tipos, half: true, ph: "Hospedaje" }, { k: "detalle", label: "Frase corta del beneficio", half: true, ph: "15 % de descuento", req: true }],
    values: i == null ? {} : L[i],
    onSave: (out, files) => { if (i == null) { saveItem({ list: L, i, out, files, folder: "img/beneficios", file: "js/datos.js", what: "Beneficio", name: out.empresa }); L.push(L.shift()); } else saveItem({ list: L, i, out, files, folder: "img/beneficios", file: "js/datos.js", what: "Beneficio", name: out.empresa }); RENDER.beneficios(el); }
  });
  $("#bAdd").onclick = () => form(null);
  el.querySelector(".cards")?.addEventListener("click", async e => {
    const b = e.target.closest("[data-a]"); if (!b) return; const i = +b.dataset.i, v = L[i];
    if (b.dataset.a === "edit") form(i);
    if (b.dataset.a === "up" || b.dataset.a === "down") { if (moveIn(L, i, b.dataset.a === "up" ? -1 : 1)) { change("js/datos.js", "ben-orden", "Orden de beneficios cambiado"); RENDER.beneficios(el); } }
    if (b.dataset.a === "del" && await confirmBox("¿Eliminar beneficio?", `Se quitará el beneficio de <b>${esc(v.empresa)}</b>.`, "Eliminar")) {
      L.splice(i, 1); dropFile(v.flyer); change("js/datos.js", "ben-del-" + uid(), `Beneficio eliminado: ${v.empresa}`); RENDER.beneficios(el);
    }
  });
};

/* ================= ESTADÍAS Y CUATRIMESTRE ================= */
RENDER.cuatri = el => {
  const d = S.data;
  el.innerHTML = head("Estadías", "Estadías y cuatrimestre", "Agenda en PDF, fechas de la ruta de 10 pasos, formatos y checklist. Actualízalo al inicio de cada cuatrimestre.") +
    howto(["Sube la <b>agenda nueva en PDF</b>. El botón «Descargar agenda» del sitio usará este archivo.", "En <b>Calendario</b>, cambia las fechas de inicio y fin de cada paso. Usa <b>Auto</b> para escribir el texto de la fecha automáticamente.", "En <b>Formatos</b>, corrige las fechas del texto y sube los archivos nuevos si cambiaron.", "Revisa con <b>Ver como</b> → Inicio y Estadías, y publica."], true) +
    `<div class="block"><h2>1. Agenda de actividades (PDF)</h2><p class="sub">Archivo actual: ${d.AGENDA_URL ? `<a href="${esc(srcOf(d.AGENDA_URL))}" target="_blank" rel="noopener">${esc(d.AGENDA_URL.split("/").pop())}</a>` : "ninguno"}</p>
      <label class="drop" id="agendaDrop"><span class="ph">${ICON.file}</span><p><b>Haz clic o arrastra aquí la agenda nueva</b><br><span class="muted">Solo PDF. Reemplaza a la anterior.</span></p><input type="file" accept="application/pdf" hidden></label></div>

    <div class="block"><h2>2. Calendario de la ruta</h2><p class="sub">Los pasos numerados forman la ruta de 10 pasos del Inicio. Las fechas clave (verde) se muestran entre los pasos. «Texto de la fecha» es lo que lee el estudiante.</p>
      <div id="stepList"></div>
      <button class="btn ghost" id="addMilestone" style="margin-top:12px">${ICON.plus}Agregar fecha clave</button></div>

    <div class="block"><h2>3. Formatos</h2><p class="sub">Enlaces y archivos de la sección «Lo que vas a necesitar».</p>
      <div class="scroll"><table class="tbl"><thead><tr><th>Formato</th><th>Texto de apoyo</th><th>Enlace o archivo</th><th></th></tr></thead><tbody id="fmtRows"></tbody></table></div>
      <button class="btn ghost" id="addFmt" style="margin-top:12px">${ICON.plus}Agregar formato</button></div>

    <div class="block"><h2>4. Checklist de seguimiento</h2><p class="sub">Una actividad por renglón. Si cambias el orden, el avance guardado de los estudiantes puede no coincidir.</p>
      <label class="field"><textarea id="checkTxt" rows="8">${esc(d.CHECK.join("\n"))}</textarea></label></div>`;

  // Agenda
  const zone = $("#agendaDrop"), input = $("input", zone);
  const takeAgenda = file => {
    if (!file) return; if (extOf(file.name) !== "pdf") return toast("La agenda debe ser PDF");
    const path = `docs/${slug(file.name.replace(/\.pdf$/i, ""))}.pdf`;
    const old = d.AGENDA_URL; addUpload(path, file); d.AGENDA_URL = path; if (old !== path) dropFile(old);
    change("js/datos.js", "agenda", `Agenda nueva: ${file.name}`); toast("Agenda lista para publicar"); RENDER.cuatri(el);
  };
  input.onchange = () => takeAgenda(input.files[0]);
  zone.ondragover = e => { e.preventDefault(); zone.classList.add("over"); }; zone.ondragleave = () => zone.classList.remove("over");
  zone.ondrop = e => { e.preventDefault(); takeAgenda(e.dataTransfer.files[0]); };

  // Calendario
  const drawSteps = () => {
    $("#stepList").innerHTML = d.STEPS.map((s, i) => `<div class="steprow" data-i="${i}">
      <span class="num ${s.m ? "m" : ""}">${s.m ? "Clave" : esc(s.n)}</span>
      <div class="fields">
        <label>Título<input class="inp" data-k="t" value="${esc(s.t)}"></label>
        <label>Inicio<input class="inp" type="date" data-k="s" value="${esc(s.s || "")}"></label>
        <label>Fin<input class="inp" type="date" data-k="e" value="${esc(s.e || "")}"></label>
        <label>Texto de la fecha<span class="wrow"><input class="inp" data-k="w" value="${esc(s.w || "")}"><button class="btn sm ghost" type="button" data-auto title="Escribir con las fechas">Auto</button></span></label>
        ${s.m ? `<div class="wide row"><button class="btn sm ghost" data-mv="-1">${ICON.up}Subir</button><button class="btn sm ghost" data-mv="1">${ICON.down}Bajar</button><button class="btn sm ghost" data-rm style="color:var(--danger)">${ICON.del}Quitar fecha clave</button></div>`
          : `<label class="wide">Descripción<input class="inp" data-k="d" value="${esc(s.d || "")}"></label>`}
      </div></div>`).join("");
  };
  drawSteps();
  $("#stepList").addEventListener("change", e => {
    const row = e.target.closest(".steprow"), k = e.target.dataset.k; if (!row || !k) return;
    const s = d.STEPS[+row.dataset.i]; const v = e.target.value.trim();
    if (v) s[k] = v; else delete s[k];
    if (k === "s" && s.s && (!s.e || s.e < s.s)) { s.e = s.s; $('[data-k="e"]', row).value = s.e; }
    change("js/datos.js", "step-" + (s.n || s.t), `Calendario: ${s.t}`);
  });
  $("#stepList").addEventListener("click", e => {
    const row = e.target.closest(".steprow"); if (!row) return; const i = +row.dataset.i, s = d.STEPS[i];
    if (e.target.closest("[data-auto]")) { s.w = rangeText(s.s, s.e); $('[data-k="w"]', row).value = s.w; if (!s.s) toast("Primero escribe la fecha de inicio"); else change("js/datos.js", "step-" + (s.n || s.t), `Calendario: ${s.t}`); }
    const mv = e.target.closest("[data-mv]"); if (mv && moveIn(d.STEPS, i, +mv.dataset.mv)) { change("js/datos.js", "steps-orden", "Orden del calendario cambiado"); drawSteps(); }
    if (e.target.closest("[data-rm]")) { d.STEPS.splice(i, 1); change("js/datos.js", "step-del-" + uid(), `Fecha clave quitada: ${s.t}`); drawSteps(); }
  });
  $("#addMilestone").onclick = () => openForm({
    title: "Nueva fecha clave", fields: [{ k: "t", label: "Título", req: true, ph: "Inicia tu estadía" }, { k: "s", type: "date", label: "Fecha", req: true }],
    onSave: out => {
      const m = { m: true, t: out.t, s: out.s, e: out.s, w: rangeText(out.s) };
      let at = d.STEPS.findIndex(s => s.s && s.s > out.s); if (at < 0) at = d.STEPS.length;
      d.STEPS.splice(at, 0, m); change("js/datos.js", "step-add-" + uid(), `Fecha clave agregada: ${out.t}`); drawSteps();
    }
  });

  // Formatos
  const drawFmt = () => {
    $("#fmtRows").innerHTML = d.FORMATOS.map((f, i) => `<tr><td><b>${esc(f.t)}</b></td><td class="muted">${esc(f.sub || "")}</td>
      <td><a href="${esc(srcOf(f.url))}" target="_blank" rel="noopener">${f.archivo ? "📄 " + esc(f.url.split("/").pop()) : "🔗 Enlace"}</a></td>
      <td class="acts"><button class="btn sm ghost" data-a="edit" data-i="${i}">${ICON.edit}</button><button class="btn sm ghost" data-a="up" data-i="${i}">${ICON.up}</button><button class="btn sm ghost" data-a="down" data-i="${i}">${ICON.down}</button><button class="btn sm ghost" data-a="del" data-i="${i}" style="color:var(--danger)">${ICON.del}</button></td></tr>`).join("") || `<tr><td colspan="4" class="muted">Sin formatos.</td></tr>`;
  };
  drawFmt();
  const fmtForm = i => openForm({
    title: i == null ? "Nuevo formato" : "Editar formato",
    fields: [{ k: "t", label: "Nombre del formato", req: true, ph: "Carta de liberación (Word)" }, { k: "sub", label: "Texto de apoyo", ph: "Paso 9 · pídela antes del 31 de marzo" },
      { k: "url", label: "Enlace", help: "Pega el enlace si el formato está en otra página. Si subes un archivo abajo, el enlace se llena solo.", ph: "https://…" },
      { k: "archivo", type: "file", label: "…o sube el archivo", help: "PDF, Word o Excel. Al hacer clic, el estudiante lo descarga." }],
    values: i == null ? {} : { ...d.FORMATOS[i], url: d.FORMATOS[i].url, archivo: d.FORMATOS[i].archivo ? d.FORMATOS[i].url : "" },
    onSave: (out, files) => {
      const prev = i == null ? null : d.FORMATOS[i];
      const f = { t: out.t, sub: out.sub, url: out.url };
      if (files.archivo) { const p = `docs/${slug(files.archivo.file.name.replace(/\.[^.]+$/, ""))}.${extOf(files.archivo.file.name) || "pdf"}`; addUpload(p, files.archivo.blob); f.url = p; f.archivo = true; }
      else if (prev?.archivo && out.url === prev.url) f.archivo = true;
      if (!f.url) { $("#formErr").textContent = "Escribe un enlace o sube un archivo."; return false; }
      clean(f);
      if (i == null) d.FORMATOS.push(f); else d.FORMATOS[i] = f;
      if (prev?.archivo && prev.url !== f.url) dropFile(prev.url);
      change("js/datos.js", "fmt-" + uid(), `Formato ${i == null ? "agregado" : "editado"}: ${f.t}`); drawFmt();
    }
  });
  $("#addFmt").onclick = () => fmtForm(null);
  $("#fmtRows").addEventListener("click", async e => {
    const b = e.target.closest("[data-a]"); if (!b) return; const i = +b.dataset.i, f = d.FORMATOS[i];
    if (b.dataset.a === "edit") fmtForm(i);
    if ((b.dataset.a === "up" || b.dataset.a === "down") && moveIn(d.FORMATOS, i, b.dataset.a === "up" ? -1 : 1)) { change("js/datos.js", "fmt-orden", "Orden de formatos cambiado"); drawFmt(); }
    if (b.dataset.a === "del" && await confirmBox("¿Quitar formato?", `Se quitará <b>${esc(f.t)}</b>.`, "Quitar")) { d.FORMATOS.splice(i, 1); if (f.archivo) dropFile(f.url); change("js/datos.js", "fmt-del-" + uid(), `Formato quitado: ${f.t}`); drawFmt(); }
  });

  // Checklist
  $("#checkTxt").addEventListener("change", e => {
    d.CHECK = e.target.value.split("\n").map(s => s.trim()).filter(Boolean);
    change("js/datos.js", "check", `Checklist actualizado (${d.CHECK.length} actividades)`);
  });
};

/* ================= EMPRESAS ================= */
let empQ = "", empShow = 50;
RENDER.empresas = el => {
  const L = S.empresas;
  const giros = [...new Set(L.map(e => e.s))].sort(), ubic = [...new Set(L.map(e => e.u))].sort();
  el.innerHTML = head("Empresas vinculadas", `Empresas vinculadas <span class="muted" style="font-size:1rem">(${L.length})</span>`, "El catálogo con buscador de la sección Empresas vinculadas.",
    `<button class="btn green" id="eAdd">${ICON.plus}Agregar empresa</button>`) +
    howto(["Busca la empresa por nombre, giro o ubicación.", "Usa <b>Editar</b> para corregir datos o <b>Eliminar</b> si el convenio terminó.", "Para una nueva, usa <b>Agregar empresa</b>. Escribe el nombre en MAYÚSCULAS, como el resto del listado.", "Actualiza la <b>fecha del listado</b> cuando recibas uno nuevo."]) +
    `<div class="block"><label class="field" style="max-width:360px"><span>Fecha de actualización del listado</span><input type="text" id="fechaLista" value="${esc(S.data.FECHA_LISTA)}" placeholder="6 de julio de 2026"><small>Se muestra en el sitio como «Listado actualizado al …».</small></label>
      <div class="row" style="margin-bottom:12px"><label class="search">${ICON.search}<input class="inp" id="eQ" placeholder="Buscar por nombre, giro o ubicación" value="${esc(empQ)}"></label><span class="muted small" id="eCount"></span></div>
      <div class="scroll"><table class="tbl"><thead><tr><th>Empresa</th><th>Giro</th><th>Ubicación</th><th>Divisiones</th><th></th></tr></thead><tbody id="eRows"></tbody></table></div>
      <div style="text-align:center;margin-top:12px"><button class="btn ghost" id="eMore">Ver más</button></div></div>`;
  const draw = () => {
    const q = norm(empQ);
    const rows = L.map((e, i) => [e, i]).filter(([e]) => !q || norm(`${e.n} ${e.g} ${e.s} ${e.u}`).includes(q));
    $("#eCount").textContent = `${rows.length} resultado${rows.length === 1 ? "" : "s"}`;
    $("#eRows").innerHTML = rows.slice(0, empShow).map(([e, i]) => `<tr><td><b>${esc(e.n)}</b><br><span class="muted small">${esc(e.g)}</span></td><td>${esc(e.s)}</td><td>${esc(e.u)}</td><td>${(e.d || []).map(k => esc(S.data.DIVS[k]?.n || k)).join("<br>")}</td>
      <td class="acts"><button class="btn sm ghost" data-a="edit" data-i="${i}">${ICON.edit}Editar</button><button class="btn sm ghost" data-a="del" data-i="${i}" style="color:var(--danger)">${ICON.del}</button></td></tr>`).join("") || `<tr><td colspan="5" class="muted">Sin resultados.</td></tr>`;
    $("#eMore").hidden = rows.length <= empShow;
  };
  draw();
  $("#eQ").oninput = e => { empQ = e.target.value; empShow = 50; draw(); };
  $("#eMore").onclick = () => { empShow += 100; draw(); };
  $("#fechaLista").onchange = e => { S.data.FECHA_LISTA = e.target.value.trim(); change("js/datos.js", "fecha-lista", `Fecha del listado de empresas: ${S.data.FECHA_LISTA}`); };
  const form = i => openForm({
    title: i == null ? "Nueva empresa vinculada" : "Editar empresa",
    fields: [{ k: "n", label: "Nombre comercial", req: true, ph: "NOMBRE EN MAYÚSCULAS" }, { k: "g", label: "Actividad comercial", ph: "SERVICIOS DE HOSPEDAJE" },
      { k: "s", label: "Giro (categoría del filtro)", list: giros, req: true, half: true, help: "Elige uno existente para que el filtro no se duplique." }, { k: "u", label: "Ubicación", list: ubic, half: true, ph: "CANCUN" },
      { k: "d", type: "divs", label: "Divisiones afines", req: true }],
    values: i == null ? {} : L[i],
    onSave: out => {
      const e = { n: out.n, g: out.g || "", s: out.s, d: out.d, u: out.u || "Por confirmar" };
      if (i == null) { L.push(e); L.sort((a, b) => a.n.localeCompare(b.n, "es")); } else L[i] = e;
      change("js/empresas.js", "emp-" + uid(), `Empresa ${i == null ? "agregada" : "editada"}: ${e.n}`); draw();
    }
  });
  $("#eAdd").onclick = () => form(null);
  $("#eRows").addEventListener("click", async e => {
    const b = e.target.closest("[data-a]"); if (!b) return; const i = +b.dataset.i, x = L[i];
    if (b.dataset.a === "edit") form(i);
    if (b.dataset.a === "del" && await confirmBox("¿Eliminar empresa?", `Se quitará <b>${esc(x.n)}</b> del listado.`, "Eliminar")) { L.splice(i, 1); change("js/empresas.js", "emp-del-" + uid(), `Empresa eliminada: ${x.n}`); draw(); }
  });
};

/* ================= CONTACTOS ================= */
RENDER.contactos = el => {
  const d = S.data;
  el.innerHTML = head("Contáctanos", "Contactos", "Personas del departamento y de las divisiones que aparecen en la sección Contáctanos y en el Inicio.") +
    howto(["Escribe directamente en las casillas. El cambio se guarda al salir de cada casilla.", "Marca <b>Destacado</b> para que la persona aparezca con fondo verde.", "La extensión se marca después del conmutador general."]) +
    `<div class="block"><label class="field" style="max-width:360px"><span>Teléfono del conmutador</span><input type="tel" id="tel" value="${esc(d.TEL)}"><small>Con lada internacional, sin espacios: +529988811900</small></label></div>
    <div class="block"><h2>Gestión Empresarial</h2><p class="sub">Orden en el que aparecen en el sitio.</p>
      <div class="scroll"><table class="tbl"><thead><tr><th>Área</th><th>Nombre</th><th>Correo</th><th>Ext.</th><th>Destacado</th><th></th></tr></thead><tbody id="geRows"></tbody></table></div>
      <button class="btn ghost" id="geAdd" style="margin-top:12px">${ICON.plus}Agregar persona</button></div>
    <div class="block"><h2>Divisiones académicas</h2><p class="sub">Contacto de cada división.</p>
      <div class="scroll"><table class="tbl"><thead><tr><th>División</th><th>Nombre</th><th>Correo</th></tr></thead><tbody id="divRows"></tbody></table></div></div>`;
  const inp = (list, i, k, v, type = "text") => `<input class="inp" type="${type}" data-l="${list}" data-i="${i}" data-k="${k}" value="${esc(v || "")}">`;
  const draw = () => {
    $("#geRows").innerHTML = d.PEOPLE_GE.map((p, i) => `<tr><td>${inp("PEOPLE_GE", i, "role", p.role)}</td><td>${inp("PEOPLE_GE", i, "name", p.name)}</td><td>${inp("PEOPLE_GE", i, "mail", p.mail, "email")}</td><td style="width:90px">${inp("PEOPLE_GE", i, "ext", p.ext)}</td>
      <td style="text-align:center"><input type="checkbox" data-l="PEOPLE_GE" data-i="${i}" data-k="feature" ${p.feature ? "checked" : ""}></td>
      <td class="acts"><button class="btn sm ghost" data-a="up" data-i="${i}">${ICON.up}</button><button class="btn sm ghost" data-a="down" data-i="${i}">${ICON.down}</button><button class="btn sm ghost" data-a="del" data-i="${i}" style="color:var(--danger)">${ICON.del}</button></td></tr>`).join("");
    $("#divRows").innerHTML = d.PEOPLE_DIV.map((p, i) => `<tr><td><b>${esc(p.role)}</b></td><td>${inp("PEOPLE_DIV", i, "name", p.name)}</td><td>${inp("PEOPLE_DIV", i, "mail", p.mail, "email")}</td></tr>`).join("");
  };
  draw();
  el.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "tel") { d.TEL = t.value.replace(/\s/g, ""); change("js/datos.js", "tel", "Teléfono del conmutador"); return; }
    if (!t.dataset.l) return;
    const p = d[t.dataset.l][+t.dataset.i];
    if (t.type === "checkbox") { if (t.checked) p.feature = true; else delete p.feature; }
    else p[t.dataset.k] = t.value.trim();
    change("js/datos.js", `contacto-${t.dataset.l}-${t.dataset.i}`, `Contacto actualizado: ${p.name || p.role}`);
  });
  el.addEventListener("click", async e => {
    const b = e.target.closest("[data-a]"); if (!b || !e.target.closest("#geRows")) return; const i = +b.dataset.i, p = d.PEOPLE_GE[i];
    if ((b.dataset.a === "up" || b.dataset.a === "down") && moveIn(d.PEOPLE_GE, i, b.dataset.a === "up" ? -1 : 1)) { change("js/datos.js", "ge-orden", "Orden de contactos cambiado"); draw(); }
    if (b.dataset.a === "del" && await confirmBox("¿Quitar contacto?", `Se quitará a <b>${esc(p.name)}</b>.`, "Quitar")) { d.PEOPLE_GE.splice(i, 1); change("js/datos.js", "ge-del-" + uid(), `Contacto quitado: ${p.name}`); draw(); }
  });
  $("#geAdd").onclick = () => openForm({
    title: "Nueva persona", fields: [{ k: "role", label: "Área", req: true, ph: "Estadías" }, { k: "name", label: "Nombre con título", req: true, ph: "Lic. Nombre Apellido" }, { k: "mail", type: "email", label: "Correo", half: true }, { k: "ext", label: "Extensión", half: true }, { k: "feature", type: "check", label: "Destacado" }],
    onSave: out => { d.PEOPLE_GE.push(clean(out)); change("js/datos.js", "ge-add-" + uid(), `Contacto agregado: ${out.name}`); draw(); }
  });
};

/* ================= APARIENCIA ================= */
const TOKENS = [
  ["green", "Verde principal", "Barra del menú, botones y acentos", "#39BEA3"],
  ["green-ink", "Verde oscuro", "Textos y enlaces verdes", "#00806C"],
  ["mint", "Verde claro", "Detalles y degradados", "#A2E3C5"],
  ["mist", "Verde muy claro", "Fondos de etiquetas y avisos", "#E6F6EF"],
  ["navy", "Azul marino", "Títulos, botones oscuros y menú activo", "#1A2640"],
  ["navy-2", "Azul marino secundario", "Al pasar el mouse sobre botones oscuros", "#24334F"],
  ["ink", "Texto principal", "Párrafos y títulos", "#1A2640"],
  ["muted", "Texto secundario", "Descripciones y notas", "#56607A"],
  ["band", "Gris de cabecera", "Cabecera y franjas de fondo", "#EDEEF2"],
  ["paper", "Fondo de la página", "Color de fondo general", "#FFFFFF"],
  ["line", "Bordes", "Líneas y contornos de tarjetas", "#DCE1E8"],
  ["div-eca", "División Económico-Administrativa", "Etiquetas y filtros", "#2B5BA8"],
  ["div-ing", "División Ingeniería y Tecnología", "Etiquetas y filtros", "#6A4BB8"],
  ["div-tur", "División Turismo", "Etiquetas y filtros", "#0E8F7A"],
  ["div-gas", "División Gastronomía", "Etiquetas y filtros", "#C0531A"]
];
const FONTS = [["Montserrat", "Institucional (actual)"], ["Poppins", "Redonda y moderna"], ["Nunito Sans", "Suave y legible"], ["Open Sans", "Clásica y neutra"], ["Lato", "Amable y seria"], ["Raleway", "Elegante"], ["Roboto", "Técnica"]];
const getToken = k => (S.css.match(new RegExp(`--${k}:\\s*(#[0-9a-fA-F]{3,8})`)) || [])[1] || "#000000";
const setToken = (k, v) => { S.css = S.css.replace(new RegExp(`(--${k}:\\s*)#[0-9a-fA-F]{3,8}`), `$1${v}`); };
const getFont = () => (S.css.match(/--f-display:\s*"([^"]+)"/) || [])[1] || "Montserrat";
function setFont(f) {
  S.css = S.css.replace(/(--f-display:\s*)"[^"]+"/, `$1"${f}"`).replace(/(--f-body:\s*)"[^"]+"/, `$1"${f}"`);
  S.index = S.index.replace(/https:\/\/fonts\.googleapis\.com\/css2\?family=[^"&]+(:[^"&]*)?/, `https://fonts.googleapis.com/css2?family=${f.replace(/ /g, "+")}:wght@400;500;600;700;800`);
}
let fontsLoaded = false;
RENDER.apariencia = el => {
  if (!fontsLoaded) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?" + FONTS.map(f => "family=" + f[0].replace(/ /g, "+") + ":wght@600;800").join("&") + "&display=swap"; document.head.appendChild(l); fontsLoaded = true; }
  const cur = getFont();
  el.innerHTML = head("Diseño", "Apariencia", "Colores, tipografía y logotipo del sitio. Los cambios se ven al instante en la muestra y en «Ver como».",
    `<button class="btn ghost" id="resetColors">Restaurar colores institucionales</button>`) +
    howto(["Haz clic en un círculo de color y elige el nuevo tono. La muestra de abajo cambia al instante.", "Abre <b>Ver como</b> para revisar el sitio completo con los nuevos colores.", "Si algo no te convence, usa <b>Restaurar colores institucionales</b>.", "Publica cuando estés conforme."]) +
    `<div class="block"><h2>Muestra</h2><p class="sub">Así se combinan los colores principales.</p><div class="mock" id="mock"></div></div>
    <div class="block"><h2>Colores</h2><p class="sub">Mantén buen contraste entre el texto y el fondo para que se lea bien.</p><div class="colors">${TOKENS.map(([k, n, h]) => `<label class="color"><input type="color" data-t="${k}" value="${getToken(k)}"><span><b>${n}</b><small>${h}</small><code data-c="${k}">${getToken(k)}</code></span></label>`).join("")}</div></div>
    <div class="block"><h2>Tipografía</h2><p class="sub">Se usa en todo el sitio.</p><div class="fontpick">${FONTS.map(([f, d]) => `<label><input type="radio" name="font" value="${f}" ${f === cur ? "checked" : ""}><b style="font-family:'${f}'">Aa Bb 123</b><span style="font-family:'${f}';font-weight:600">${f}</span><small>${d}</small></label>`).join("")}</div></div>
    <div class="block"><h2>Logotipo</h2><p class="sub">Aparece en la cabecera, el pie de página y la pestaña del navegador. Usa un PNG con fondo transparente.</p>
      <label class="drop" id="logoDrop"><img src="${esc(srcOf("img/logo-ut-cancun.png"))}" alt=""><p><b>Haz clic o arrastra aquí el logotipo nuevo</b><br><span class="muted">PNG con fondo transparente, de preferencia horizontal.</span></p><input type="file" accept="image/png,image/svg+xml,image/jpeg" hidden></label></div>`;
  const mock = () => {
    const t = k => getToken(k), f = getFont();
    $("#mock").style.fontFamily = `'${f}',sans-serif`;
    $("#mock").innerHTML = `<div class="m-top" style="background:${t("band")}"><img src="${esc(srcOf("img/logo-ut-cancun.png"))}" alt=""><b style="color:${t("ink")}">Gestión Empresarial</b></div>
      <div class="m-nav" style="background:${t("green")}"><span>INICIO</span><span>ESTADÍAS</span><span class="on" style="background:${t("navy")}">BOLSA DE TRABAJO</span><span>EGRESADOS</span></div>
      <div class="m-body" style="background:${t("paper")}"><span style="color:${t("green-ink")};font-size:.72rem;font-weight:700;letter-spacing:.12em">SEGUIMIENTO</span><h3 style="color:${t("ink")}">Tu camino a la vida profesional</h3><p style="color:${t("muted")}">Así se ven los párrafos y descripciones del sitio.</p>
      <span class="m-btn" style="background:${t("green")}">Botón principal</span> <span class="m-btn" style="background:${t("navy")}">Botón oscuro</span>
      <p style="margin-top:12px">${["eca", "ing", "tur", "gas"].map(k => `<span style="display:inline-block;margin-right:6px;padding:2px 10px;border-radius:999px;font-size:.75rem;font-weight:600;color:#fff;background:${t("div-" + k)}">${esc(S.data.DIVS[k]?.n || k)}</span>`).join("")}</p>
      <p style="margin-top:10px;background:${t("mist")};border:1px solid ${t("line")};padding:8px 12px;border-radius:10px;color:${t("green-ink")};font-size:.85rem">Aviso con fondo verde claro</p></div>`;
  };
  mock();
  el.querySelector(".colors").addEventListener("input", e => { const k = e.target.dataset.t; if (!k) return; setToken(k, e.target.value); $(`[data-c="${k}"]`).textContent = e.target.value; mock(); });
  el.querySelector(".colors").addEventListener("change", e => { const k = e.target.dataset.t; if (k) change("css/styles.css", "color-" + k, `Color cambiado: ${TOKENS.find(t => t[0] === k)[1]}`); });
  $("#resetColors").onclick = () => { TOKENS.forEach(([k, , , v]) => setToken(k, v)); change("css/styles.css", "colores-reset", "Colores institucionales restaurados"); RENDER.apariencia(el); toast("Colores institucionales restaurados"); };
  el.querySelector(".fontpick").addEventListener("change", e => { setFont(e.target.value); S.touched.add("index.html"); change("css/styles.css", "fuente", `Tipografía: ${e.target.value}`); mock(); });
  const zone = $("#logoDrop"), input = $("input", zone);
  const takeLogo = async file => {
    if (!file || !file.type.startsWith("image/")) return toast("El logotipo debe ser una imagen");
    addUpload("img/logo-ut-cancun.png", await processImage(file, { max: 800, png: true }));
    change("img/logo-ut-cancun.png", "logo", "Logotipo nuevo"); RENDER.apariencia(el); $("#brandLogo").src = srcOf("img/logo-ut-cancun.png");
  };
  input.onchange = () => takeLogo(input.files[0]);
  zone.ondragover = e => { e.preventDefault(); zone.classList.add("over"); }; zone.ondragleave = () => zone.classList.remove("over");
  zone.ondrop = e => { e.preventDefault(); takeLogo(e.dataTransfer.files[0]); };
};

/* ================= PUBLICAR ================= */
RENDER.publicar = el => {
  const items = [...S.log.values()], ups = Object.entries(S.uploads).filter(([, u]) => !u.published);
  el.innerHTML = head("Publicar", "Publicar cambios", "Guarda tus cambios en GitHub. El sitio de GitHub se actualiza en 1 a 3 minutos. Después descarga el código para el servidor de la universidad.") +
    howto(["Revisa la lista de cambios pendientes.", "Antes de publicar, ábrelos en <b>Ver como</b> para confirmar que todo se ve bien.", "Escribe una nota corta (opcional) y haz clic en <b>Publicar ahora</b>.", "Cuando termine, haz clic en <b>Descargar código</b> y entrega el ZIP para reemplazar la carpeta del servidor."], true) +
    (!S.token ? `<div class="notice">🔒 Para publicar necesitas conectar el panel con GitHub. <button class="btn sm green" type="button" id="pConnect">Conectar</button></div>` : "") +
    (items.length ? `<div class="block"><h2>Cambios pendientes (${items.length})</h2><p class="sub">Todavía no se publican. Si recargas o cierras esta página, se pierden.</p>
        <ul class="changes">${items.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
        ${ups.length ? `<p class="small muted" style="margin-top:10px">Archivos que se subirán: ${ups.map(([p]) => esc(p)).join(", ")}</p>` : ""}
        ${S.deletes.size ? `<p class="small muted">Archivos que se borrarán: ${[...S.deletes].map(esc).join(", ")}</p>` : ""}
        <label class="field" style="margin-top:14px"><span>Nota del cambio (opcional)</span><input type="text" id="pMsg" placeholder="Ej. Vacantes de noviembre"></label>
        <div class="row"><button class="btn green" id="pGo">Publicar ahora</button><button class="btn ghost" id="pPrev">Ver como</button><button class="btn ghost" id="pDiscard" style="color:var(--danger)">Descartar todos los cambios</button></div></div>`
      : `<div class="empty">No hay cambios pendientes. Todo lo que ves ya está publicado.</div>`) +
    `<div class="block" style="margin-top:18px"><h2>Para el servidor de la universidad</h2><p class="sub">El ZIP trae la última versión publicada del sitio, sin este panel. Descomprímelo y reemplaza el contenido de la carpeta del servidor.</p><button class="btn navy" id="pZip">Descargar código</button>
    <p class="small muted" style="margin-top:10px">Historial de cambios: <a href="https://github.com/${C.owner}/${C.repo}/commits/${C.branch}" target="_blank" rel="noopener">ver en GitHub</a></p></div>`;
  $("#pConnect")?.addEventListener("click", openConnect);
  $("#pGo")?.addEventListener("click", publish);
  $("#pPrev")?.addEventListener("click", openPreview);
  $("#pZip").onclick = downloadCode;
  $("#pDiscard")?.addEventListener("click", async () => { if (await confirmBox("¿Descartar cambios?", "Se perderán todos los cambios que no has publicado.", "Descartar")) { S.uploads = {}; await load(); toast("Cambios descartados"); } });
};

/* ---------------- Publicar en GitHub ---------------- */
const utf8b64 = s => { const b = new TextEncoder().encode(s); let bin = ""; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(bin); };
const blobB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
const stamp = () => { const t = new Date(), p = n => String(n).padStart(2, "0"); return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}${p(t.getHours())}${p(t.getMinutes())}`; };

async function publish() {
  if (!S.token) return openConnect();
  if (!S.log.size) return toast("No hay cambios por publicar");
  const note = $("#pMsg")?.value.trim();
  try {
    busy("Preparando archivos…");
    const files = {};
    if (S.touched.has("js/datos.js")) files["js/datos.js"] = utf8b64(genDatos());
    if (S.touched.has("js/empresas.js")) files["js/empresas.js"] = utf8b64(genEmpresas());
    if (S.touched.has("css/styles.css")) files["css/styles.css"] = utf8b64(S.css);
    if (Object.keys(files).length || S.touched.has("index.html")) {
      S.index = S.index.replace(/\?v=[\w-]+/g, "?v=" + stamp());   // obliga a los navegadores a descargar la versión nueva
      files["index.html"] = utf8b64(S.index);
    }
    for (const [p, u] of Object.entries(S.uploads)) if (!u.published) files[p] = await blobB64(u.blob);

    busy("Conectando con GitHub…");
    const ref = await gh(`${R}/git/ref/heads/${C.branch}`);
    const base = ref.object.sha, commit = await gh(`${R}/git/commits/${base}`);
    const full = await gh(`${R}/git/trees/${commit.tree.sha}?recursive=1`);
    const exists = new Set(full.tree.map(t => t.path));
    const tree = []; const list = Object.entries(files); let n = 0;
    for (const [path, content] of list) {
      busy(`Subiendo ${++n} de ${list.length}: ${path.split("/").pop()}`);
      const b = await gh(`${R}/git/blobs`, { method: "POST", body: { content, encoding: "base64" } });
      tree.push({ path, mode: "100644", type: "blob", sha: b.sha });
    }
    for (const p of S.deletes) if (!files[p] && exists.has(p)) tree.push({ path: p, mode: "100644", type: "blob", sha: null });
    busy("Guardando la nueva versión…");
    const t = await gh(`${R}/git/trees`, { method: "POST", body: { base_tree: commit.tree.sha, tree } });
    const msg = (note || "Actualización desde el Panel de control") + "\n\n" + [...S.log.values()].map(x => "- " + x).join("\n");
    const c = await gh(`${R}/git/commits`, { method: "POST", body: { message: msg, tree: t.sha, parents: [base] } });
    await gh(`${R}/git/refs/heads/${C.branch}`, { method: "PATCH", body: { sha: c.sha } });
    for (const u of Object.values(S.uploads)) u.published = true;
    S.touched.clear(); S.log.clear(); S.deletes.clear(); updateCount();
    busy(null); go("publicar");
    $(".view[data-view=publicar]").insertAdjacentHTML("afterbegin", `<div class="notice ok">✅ <span><b>¡Publicado!</b> El sitio de GitHub mostrará los cambios en 1 a 3 minutos: <a href="${esc(SITE)}" target="_blank" rel="noopener">abrir sitio</a>. Ahora puedes <b>Descargar código</b> para el servidor.</span></div>`);
    toast("Cambios publicados");
  } catch (e) { console.error(e); busy(null); toast(ghMessage(e)); alertBox("No se pudo publicar", ghMessage(e)); }
}
function alertBox(title, text) { $("#confirmTitle").textContent = title; $("#confirmText").textContent = text; const ok = $("#confirmOk"); ok.textContent = "Entendido"; ok.className = "btn green"; $("#confirmDlg").showModal(); }

/* ---------------- Descargar código ---------------- */
async function downloadCode() {
  if (S.log.size && !(await confirmBox("Tienes cambios sin publicar", "El ZIP trae la <b>versión publicada</b> en GitHub y <b>no</b> incluye tus cambios pendientes. Publica primero para incluirlos.<br><br>¿Descargar de todos modos?", "Descargar sin ellos", false))) return;
  try {
    busy("Buscando la última versión…");
    const ref = await gh(`${R}/git/ref/heads/${C.branch}`);
    const sha = ref.object.sha;
    const tree = await gh(`${R}/git/trees/${sha}?recursive=1`);
    const files = tree.tree.filter(t => t.type === "blob" && !C.excluir.some(x => t.path === x || t.path.startsWith(x)));
    const zip = new MiniZip(); let n = 0;
    for (const f of files) {
      busy(`Descargando ${++n} de ${files.length}: ${f.path.split("/").pop()}`);
      let bytes;
      if (S.token) { const b = await gh(`${R}/git/blobs/${f.sha}`); const bin = atob(b.content.replace(/\n/g, "")); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); }
      else { const r = await fetch(`https://raw.githubusercontent.com/${C.owner}/${C.repo}/${sha}/${encPath(f.path)}`); if (!r.ok) throw new Error("No se pudo descargar " + f.path); bytes = new Uint8Array(await r.arrayBuffer()); }
      zip.add(`${C.zipFolder}/${f.path}`, bytes);
    }
    busy("Armando el ZIP…");
    const a = document.createElement("a"); a.href = URL.createObjectURL(zip.blob()); a.download = `${C.zipFolder}-${todayISO()}.zip`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    busy(null); toast("ZIP descargado");
  } catch (e) { console.error(e); busy(null); alertBox("No se pudo descargar", e instanceof GhError ? ghMessage(e) : e.message); }
}

/* ---------------- Ver como ---------------- */
let pvSection = "inicio";
function buildPreview() {
  let html = S.index;
  html = html.replace(/<head>/i, `<head><base href="${SITE}">`);
  const safe = s => s.replace(/<\/script/gi, "<\\/script");
  html = html.replace(/<script src="js\/datos\.js[^"]*"><\/script>/, () => `<script>${safe(genDatos())}</script>`);
  if (S.touched.has("js/empresas.js")) html = html.replace(/<script src="js\/empresas\.js[^"]*"><\/script>/, () => `<script>${safe(genEmpresas())}</script>`);
  if (S.touched.has("css/styles.css")) html = html.replace(/<link rel="stylesheet" href="css\/styles\.css[^"]*">/, () => `<style>${S.css.replace(/<\/style/gi, "")}</style>`);
  for (const [p, u] of Object.entries(S.uploads)) html = html.split(p).join(u.url);
  return html;
}
function renderPreview() {
  const f = $("#pvFrame");
  f.onload = () => { try { f.contentWindow.location.hash = pvSection; } catch (e) {} };
  f.srcdoc = buildPreview();
}
function openPreview() {
  if (!S.data) return;
  $("#preview").hidden = false; document.body.style.overflow = "hidden"; renderPreview();
}
$("#previewBtn").onclick = openPreview;
$("#pvClose").onclick = () => { $("#preview").hidden = true; document.body.style.overflow = ""; };
$("#pvReload").onclick = renderPreview;
$("#pvSection").onchange = e => { pvSection = e.target.value; try { $("#pvFrame").contentWindow.location.hash = pvSection; } catch (err) { renderPreview(); } };
$("#pvDevice").onclick = e => { const b = e.target.closest("button"); if (!b) return; $$("#pvDevice button").forEach(x => x.classList.toggle("on", x === b)); $("#pvFrame").style.width = b.dataset.w; };

/* ---------------- Conexión ---------------- */
function openConnect() {
  $("#ownerName").textContent = C.owner; $("#repoName").textContent = C.repo;
  $("#tokenInput").value = ""; $("#connectMsg").textContent = ""; $("#connectMsg").className = "msg";
  $("#disconnectBtn").hidden = !S.token; $("#connectDlg").showModal();
}
$("#statusBtn").onclick = openConnect;
$("#publishBtn").onclick = () => S.log.size ? go("publicar") : (go("publicar"), toast("No hay cambios pendientes"));
$("#downloadBtn").onclick = downloadCode;
$("#disconnectBtn").onclick = () => { S.token = null; store.clear(); setStatus(); $("#connectDlg").close(); toast("Panel desconectado"); go(S.view); };
$("#connectForm").onsubmit = async e => {
  e.preventDefault();
  const t = $("#tokenInput").value.trim(), msg = $("#connectMsg");
  if (!t) return;
  msg.className = "msg"; msg.textContent = "Verificando…";
  const prev = S.token; S.token = t;
  try {
    const repo = await gh(R);
    if (repo.permissions && !repo.permissions.push) throw new GhError(403, "");
    store.set(t, $("#tokenRemember").checked); setStatus();
    $("#connectDlg").close(); toast("Conectado a GitHub");
    if (!S.log.size) await load(); else go(S.view);
  } catch (err) { S.token = prev; msg.className = "msg err"; msg.textContent = ghMessage(err); }
};

/* ---------------- Inicio ---------------- */
(async function init() {
  S.token = store.get(); setStatus();
  if (S.token) { try { await gh(R); } catch (e) { if (e instanceof GhError && e.status === 401) { S.token = null; store.clear(); setStatus(); toast("La llave guardada ya no es válida. Vuelve a conectar."); } } }
  await load();
})();
})();

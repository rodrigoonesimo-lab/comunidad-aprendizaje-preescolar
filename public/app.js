/* Comunidad de Aprendizaje Preescolar
   Elaborado por: M. en E. N. y A. Rodrigo Onesimo Pérez Rios
   Página conectada a Supabase (cuentas, datos y archivos) y a Stripe (cobros, mediante funciones de Netlify). */
(function () {
'use strict';

const TRIAL_DAYS = 7;
const AUTHOR = 'Elaborado por: M. en E. N. y A. Rodrigo Onesimo Pérez Rios';
const DAY = 86400000;
const CATS = ['Planeación y proyectos', 'Evaluación y seguimiento', 'Material imprimible', 'Formatos y familias'];
const CAMPOS = ['Lenguajes', 'Saberes y pensamiento científico', 'Ética, naturaleza y sociedades', 'De lo humano y lo comunitario'];
const GRADOS = ['1°', '2°', '3°'];
const TOOLS = [
  ['spark', 'Generador de planeaciones', 'Elige campo formativo, contenido y PDA, y arma tu proyecto.'],
  ['eye', 'Guía de visita al aula', 'Registra lo observado en cada visita y la retroalimentación a la docente.', 'autoridad'],
  ['report', 'Sistematización de resultados', 'Concentra la información de tus visitas y grupos para tomar decisiones.', 'autoridad'],
  ['obs', 'Registro de observaciones', 'Notas rápidas por alumno desde el celular.'],
  ['check', 'Listas de cotejo y rúbricas', 'Créalas y llénalas en línea.'],
  ['report', 'Reporte de evaluación', 'Redacción guiada del reporte para familias.'],
  ['folder', 'Expedientes electrónicos', 'Evidencias, avances y datos de cada niño en un solo lugar.'],
  ['alert', 'Bitácora de incidencias', 'Registra incidentes con fecha, hora y seguimiento.'],
  ['book', 'Diario de la educadora', 'Tu reflexión diaria sobre la jornada, siempre a la mano.']
];
const CAT_STYLE = {
  'Planeación y proyectos': ['plan', '#E4EAF5'], 'Evaluación y seguimiento': ['eval', '#E3F1E4'],
  'Material imprimible': ['print', '#FFF1BF'], 'Formatos y familias': ['family', '#F3EBDD']
};
const SESS_KEY = 'cap_device_session';

/* ================= CONEXIÓN ================= */
let sb = null;
const S = { session: null, profile: null, settings: null, resources: [], fresh: {} };

async function initClient() {
  const r = await fetch('/api/config');
  const cfg = await r.json();
  if (!r.ok || !cfg.supabaseUrl) throw new Error(cfg.error || 'Falta la configuración de Supabase.');
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
}
async function token() { const { data } = await sb.auth.getSession(); return data.session ? data.session.access_token : null; }
async function api(path, body) {
  const t = await token();
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Ocurrió un error. Intenta de nuevo.');
  return d;
}
function must(res, msg) { if (res.error) { console.error(res.error); throw new Error(msg || 'No se pudo completar. Intenta de nuevo.'); } return res.data; }

async function loadSettings() { S.settings = must(await sb.from('settings').select('data').eq('id', 1).single(), 'No se pudo leer la configuración.').data; }
async function loadResources() { S.resources = must(await sb.from('resources').select('*').order('created_at', { ascending: false })) || []; }
async function loadProfile() {
  const { data } = await sb.auth.getSession(); S.session = data.session; S.profile = null;
  if (!S.session) return null;
  const p = (await sb.from('profiles').select('*').eq('id', S.session.user.id).single()).data;
  if (!p) return null;
  if (p.blocked) { await doSignOut('Tu cuenta está bloqueada. Escríbenos por WhatsApp.'); return null; }
  const local = localStorage.getItem(SESS_KEY);
  if (!local || p.active_session !== local) { await doSignOut('Tu sesión se cerró porque entraste desde otro dispositivo.'); return null; }
  S.profile = p; return p;
}
async function claimDevice() {
  const id = crypto.randomUUID();
  localStorage.setItem(SESS_KEY, id);
  await sb.from('profiles').update({ active_session: id }).eq('id', (await sb.auth.getUser()).data.user.id);
}
async function doSignOut(msg) { localStorage.removeItem(SESS_KEY); await sb.auth.signOut({ scope: 'local' }); S.profile = null; S.session = null; if (msg) toast(msg); }

/* ================= ESTADO DE LA SUSCRIPCIÓN ================= */
const ts = v => (v ? new Date(v).getTime() : 0);
const isAdmin = p => !!p && p.role === 'admin';
function subState(p) {
  const n = Date.now();
  if (p.blocked) return { key: 'bloqueada', label: 'Bloqueada', access: false };
  const st = p.sub_status, end = Math.max(ts(p.current_period_end), ts(p.trial_end));
  if (st === 'trialing' && end > n) return { key: 'prueba', label: p.cancel_at_period_end ? 'En prueba (cancelada)' : 'En prueba', access: true };
  if (st === 'active' && end > n) return p.cancel_at_period_end ? { key: 'cancelada', label: 'Cancelada (con acceso)', access: true } : { key: 'activa', label: 'Activa', access: true };
  if (st === 'past_due' && end > n) return { key: 'pendiente', label: 'Pago pendiente', access: true };
  if (ts(p.courtesy_until) > n) return { key: 'cortesia', label: 'Cortesía', access: true };
  if (!p.stripe_subscription_id) return { key: 'sinplan', label: 'Sin plan', access: false };
  return { key: 'vencida', label: 'Vencida', access: false };
}
const hasAccess = p => !!p && (isAdmin(p) || subState(p).access);
const NIVEL_TXT = { docente: 'Docente', autoridad: 'Autoridad Escolar' };
const FUNCIONES = { docente: 'Docente frente a grupo', directivo: 'Directivo', supervisor: 'Supervisor', atp: 'ATP' };
// Nivel con el que la persona tiene acceso hoy (null si no tiene acceso).
const nivelDe = p => !p ? null : isAdmin(p) ? 'autoridad' : hasAccess(p) ? (p.nivel || 'docente') : null;
// ¿Puede abrir algo con este tipo de acceso? gratis · suscripcion (Docente y Autoridad) · autoridad (solo Autoridad Escolar)
const canAcc = (p, acc) => acc === 'gratis' || (acc === 'autoridad' ? nivelDe(p) === 'autoridad' : hasAccess(p));
const ACCESO_TXT = { gratis: 'Gratis', suscripcion: 'Plan Docente y Autoridad', autoridad: 'Solo Autoridad Escolar' };
function precios() { const s = S.settings || {}, d = s.precios || {}; return { docente: Object.assign({ mensual: 49.99, anual: 499.99 }, d.docente), autoridad: Object.assign({ mensual: 89.99, anual: 899.99 }, d.autoridad) }; }
const recomendado = p => (p && p.funcion && p.funcion !== 'docente' ? 'autoridad' : 'docente');
const planTxt = p => (p.nivel || p.plan ? `${NIVEL_TXT[p.nivel || 'docente']} ${p.plan || ''}`.trim() : '—');
const precioDe = p => (p.plan ? precios()[p.nivel || 'docente'][p.plan] : 0);
function visible(r) { const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }); return r.estado === 'publicado' || (r.estado === 'programado' && r.fecha_pub && r.fecha_pub <= today); }
const publicRes = () => S.resources.filter(visible);

/* ================= UTILIDADES ================= */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3800); }
function go(h) { if (location.hash === h) render(); else location.hash = h; }
const fmtDate = v => (v ? new Date(v).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const money = n => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
const daysLeft = v => Math.max(0, Math.ceil((ts(v) - Date.now()) / DAY));
const opt = (arr, sel) => arr.map(o => `<option${o === sel ? ' selected' : ''}>${esc(o)}</option>`).join('');
function ico(n, color = 'currentColor', size = 26) {
  const p = {
    plan: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    eval: '<path d="M9 11l2 2 4-4"/><rect x="4" y="3" width="16" height="18" rx="2"/>',
    print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
    family: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="9" r="2.5"/><path d="M3 20c0-3 2.5-5 5-5s5 2 5 5M13 20c0-2.5 1.5-4 3-4s3 1.5 3 4"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
    obs: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M13 7l4 4"/>',
    check: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h2M7 14h2M12 9h5M12 14h5"/>',
    report: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h6M9 16h6"/>',
    folder: '<path d="M3 7h6l2 2h10v10H3z"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
    book: '<path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1z"/><path d="M12 6v14"/>',
    home: '<path d="M4 11l8-7 8 7v9H4z"/>',
    star: '<path d="M12 4l2.5 5 5.5.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.5-.8z"/>',
    down: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
    card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    ok: '<path d="M5 12l4 4 10-10"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    tools: '<path d="M4 20l6-6M14 4a4 4 0 0 0 5 5l-9 9-3-3 9-9"/>',
    out: '<path d="M10 4H4v16h6M14 8l4 4-4 4M18 12H9"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .7 3.5 2.8 3.5 6"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
  }[n] || '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
function logo(w = 44, sep = '#FFFFFF') {
  return `<svg width="${w}" height="${Math.round(w * .9)}" viewBox="0 0 200 180" aria-hidden="true"><path d="M24,80 L100,20 L176,80" fill="none" stroke="#234386" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/><circle cx="68" cy="102" r="12" fill="#7FA77A"/><path d="M52,164 C52,122 84,122 84,164 Z" fill="#7FA77A"/><circle cx="132" cy="102" r="12" fill="#7FA77A"/><path d="M116,164 C116,122 148,122 148,164 Z" fill="#7FA77A"/><path d="M81,164 C81,110 119,110 119,164 Z" fill="#FFC400" stroke="${sep}" stroke-width="5"/><circle cx="100" cy="90" r="14" fill="#FFC400" stroke="${sep}" stroke-width="5"/></svg>`;
}
function waLink() { const d = (S.settings.whatsapp || '').replace(/\D/g, ''); return d ? 'https://wa.me/' + (d.length === 10 ? '52' + d : d) : '#/'; }
function waBtn(t) { return `<a class="wa" href="${waLink()}"${S.settings.whatsapp ? ' target="_blank" rel="noopener"' : ''}>${ico('chat', '#fff', 22)}<span>${t}</span></a>`; }
const safeUrl = v => (/^https?:\/\//i.test(v) ? v : '');

/* ================= PIEZAS PÚBLICAS ================= */
function header() {
  const p = S.profile;
  const acts = p
    ? `<a class="btn btn-y" href="${isAdmin(p) ? '#/admin' : '#/panel'}">${isAdmin(p) ? 'Ir a mi panel de administrador' : 'Ir a mi panel'}</a>`
    : `<a class="btn btn-o" href="#/acceso">Iniciar sesión</a><a class="btn btn-y" href="#/registro">Prueba gratis ${TRIAL_DAYS} días</a>`;
  return `<header class="site-hd"><div class="wrap hd">
<a class="brand" href="#/">${logo(46, "#FBF9F6")}<b>Comunidad de Aprendizaje<br><span>Preescolar</span></b></a>
<nav class="nav" aria-label="Principal"><a href="#/catalogo">Recursos</a><a href="#/#herramientas">Herramientas</a><a href="#/#planes">Planes</a><a href="#/#preguntas">Preguntas</a></nav>
<div class="row" style="gap:10px">${acts}</div></div></header>`;
}
function footer() {
  const redes = Object.entries(S.settings.redes || {}).map(([k, v]) => `<li>${safeUrl(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener">${k}</a>` : `${k}: ${v ? esc(v) : '[TU USUARIO]'}`}</li>`).join('');
  return `${wave('#234386')}<footer class="ft">${sprig('#6AA8DC', 'width:140px;right:4%;top:-40px;transform:rotate(-14deg)', 'hide-m')}<div class="wrap stack" style="gap:36px;position:relative">
<div class="grid" style="gap:32px">
<div class="stack" style="gap:12px"><div class="row" style="gap:12px"><span style="background:#FBF9F6;border-radius:50%;padding:10px;display:inline-flex">${logo(48, '#FBF9F6')}</span><p style="font-family:var(--f-display);font-size:26px;line-height:.95;letter-spacing:.04em;color:#fff;text-transform:uppercase">Comunidad de Aprendizaje<br>Preescolar</p></div><p class="script" style="color:#FFC400;font-size:30px">Construimos juntos la escuela que soñamos.</p></div>
<div class="stack" style="gap:12px"><p class="ft-t">La plataforma</p><ul><li><a href="#/catalogo">Recursos</a></li><li><a href="#/#herramientas">Herramientas en línea</a></li><li><a href="#/#planes">Planes y precios</a></li><li><a href="#/#preguntas">Preguntas frecuentes</a></li></ul></div>
<div class="stack" style="gap:12px"><p class="ft-t">Síguenos</p><ul>${redes}</ul></div>
<div class="stack" style="gap:12px"><p class="ft-t">Contacto</p><p>WhatsApp: ${esc(S.settings.whatsapp) || '[TU WHATSAPP]'}</p><p>Aviso de privacidad · Términos de uso</p></div>
</div>
<div class="row between" style="border-top:1px solid rgba(255,255,255,.3);padding-top:20px;font-size:14px"><p>© ${new Date().getFullYear()} Comunidad de Aprendizaje Preescolar</p><p>${AUTHOR}</p></div>
</div></footer>${waBtn('Escríbenos por WhatsApp')}`;
}
function coverUrl(path) { return sb.storage.from('portadas').getPublicUrl(path).data.publicUrl; }
function resAction(r) {
  const p = S.profile, free = r.acceso === 'gratis', can = canAcc(p, r.acceso);
  if (r.formato === 'Herramienta en línea') return `<a class="btn btn-o" href="${p ? '#/panel/herramientas' : '#/registro'}">${ico('tools', '#234386', 20)}Abrir herramienta</a>`;
  if (can) return `<button class="btn btn-y" data-act="download" data-id="${r.id}">${ico('down', '#FFFFFF', 20)}${free && !hasAccess(p) ? 'Descargar gratis' : 'Descargar'}</button>`;
  if (r.acceso === 'autoridad' && hasAccess(p)) return `<a class="btn btn-o" href="#/panel/suscripcion">${ico('lock', '#B4510F', 20)}Disponible en plan Autoridad Escolar</a>`;
  return p ? `<a class="btn btn-o" href="#/panel/suscripcion">${ico('lock', '#B4510F', 20)}Elige un plan para descargar</a>` : `<a class="btn btn-o" href="#/registro">${ico('lock', '#B4510F', 20)}Ver con prueba gratis</a>`;
}
function resCard(r, ctx) {
  const p = S.profile; const [icn, bg] = CAT_STYLE[r.categoria] || ['plan', '#E4EAF5'];
  const free = r.acceso === 'gratis';
  const isFav = p && (p.favoritos || []).includes(r.id);
  const fav = p && !isAdmin(p) ? `<button class="btn btn-o btn-sm" data-act="fav" data-id="${r.id}" aria-pressed="${!!isFav}">${ico('star', '#234386', 18)}${isFav ? 'Quitar de favoritos' : 'Guardar'}</button>` : '';
  const badge = ctx === 'nuevo' ? '<span class="tag tag-b">Nuevo</span>' : (free ? '<span class="tag tag-y">Gratis</span>' : r.acceso === 'autoridad' ? '<span class="tag tag-a">Autoridad Escolar</span>' : '<span class="tag tag-b">Con suscripción</span>');
  const act = resAction(r);
  const thumb = r.cover_path
    ? `<button type="button" class="cover" data-act="verPortada" data-id="${r.id}" aria-label="Ver la portada de ${esc(r.titulo)} en grande"><img src="${esc(coverUrl(r.cover_path))}" alt="Portada de ${esc(r.titulo)}" loading="lazy" decoding="async"></button>`
    : `<div class="cover cover-ico" style="background:${bg}">${ico(icn, '#234386', 52)}</div>`;
  return `<article class="card">${thumb}
<div class="row" style="gap:8px">${badge}<span class="tag tag-g">${esc(r.categoria)}</span></div>
<h3>${esc(r.titulo)}</h3>${r.descripcion ? `<p style="color:var(--tinta-suave)">${esc(r.descripcion)}</p>` : ''}
<div class="meta"><span>Grado: ${esc((r.grados || []).join(', '))}</span>${r.campo ? `<span>Campo: ${esc(r.campo)}</span>` : ''}<span>Formato: ${esc(r.formato)}</span></div>
<div class="row" style="margin-top:auto">${act}${fav}</div></article>`;
}
/* ---------- Decoración: ondas, manchas orgánicas y líneas botánicas ---------- */
function wave(fill, top) {
  return `<svg class="wave${top ? ' wave-top' : ''}" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true"><path d="M0,58 C160,20 300,8 470,30 C640,52 760,88 940,70 C1110,52 1250,14 1440,34 L1440,90 L0,90 Z" fill="${fill}"/></svg>`;
}
const BLOBS = [
  'M66,-58C84,-38,94,-10,89,16C84,42,64,66,38,78C12,90,-20,90,-46,77C-72,64,-92,38,-94,10C-96,-18,-80,-48,-56,-66C-32,-84,0,-90,24,-86C48,-82,48,-78,66,-58Z',
  'M58,-70C74,-56,84,-34,88,-10C92,14,90,40,74,58C58,76,30,86,2,84C-26,82,-52,68,-70,48C-88,28,-98,0,-92,-26C-86,-52,-64,-72,-40,-82C-16,-92,10,-92,30,-86C42,-82,46,-80,58,-70Z'
];
function blob(fill, i, style) { return `<svg class="deco" viewBox="-100 -100 200 200" style="${style}" aria-hidden="true"><path d="${BLOBS[i % 2]}" fill="${fill}"/></svg>`; }
// Rama botánica de línea (sin relleno), estilo grabado.
function sprig(color, style, cls = '') {
  return `<svg class="deco ${cls}" viewBox="0 0 160 220" style="${style}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="M80 214 C78 170 82 120 76 70 C72 40 80 18 92 4"/>
<path d="M78 180 C58 172 40 176 26 190 C44 196 62 194 78 180Z"/><path d="M78 180 C66 182 50 186 32 189"/>
<path d="M79 150 C100 138 120 140 136 152 C118 162 98 162 79 150Z"/><path d="M79 150 C96 150 114 151 132 152"/>
<path d="M77 118 C58 104 40 104 24 114 C40 126 60 128 77 118Z"/><path d="M77 118 C62 116 44 115 28 114"/>
<path d="M76 88 C94 72 112 70 128 78 C114 92 94 96 76 88Z"/><path d="M76 88 C92 84 110 80 124 78"/>
<path d="M78 56 C64 42 50 40 38 46 C48 60 64 64 78 56Z"/><path d="M78 56 C66 52 52 48 42 47"/>
<path d="M86 26 C96 14 108 12 118 16 C110 28 98 32 86 26Z"/>
<circle cx="92" cy="5" r="2.5"/></svg>`;
}
// Lápiz y crayón de línea.
function pencil(color, style, cls = '') {
  return `<svg class="deco ${cls}" viewBox="0 0 220 60" style="${style}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">
<path d="M14 30 L44 16 H186 a6 6 0 0 1 6 6 V38 a6 6 0 0 1 -6 6 H44 Z"/><path d="M14 30 L26 24 V36 Z"/><path d="M44 16 V44 M170 16 V44 M178 16 V44"/>
<path d="M50 24 H164 M50 30 H164 M50 36 H164" stroke-dasharray="2 5"/></svg>`;
}
function heroArt() {
  return `<div class="hero-art">
${blob('#FFC400', 0, 'width:78%;left:-6%;top:-4%')}${blob('#A2D3A6', 1, 'width:66%;right:-8%;bottom:-6%')}
${sprig('#6AA8DC', 'width:32%;right:-2%;top:-10%;transform:rotate(12deg)', 'hide-m')}
<svg viewBox="0 0 520 440" style="position:relative;width:100%;height:auto" role="img" aria-label="Ilustración: comunidad de educadoras y niños bajo el techo de la escuela">
<path d="M70,200 L260,62 L450,200" fill="none" stroke="#234386" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="168" cy="230" r="28" fill="#7FA77A"/><path d="M132,350 C132,262 204,262 204,350 Z" fill="#7FA77A"/>
<circle cx="352" cy="230" r="28" fill="#7FA77A"/><path d="M316,350 C316,262 388,262 388,350 Z" fill="#7FA77A"/>
<path d="M218,350 C218,238 302,238 302,350 Z" fill="#FFC400" stroke="#FBF9F6" stroke-width="9"/><circle cx="260" cy="206" r="32" fill="#FFC400" stroke="#FBF9F6" stroke-width="9"/>
<path d="M60,352 C160,340 360,340 460,352" fill="none" stroke="#234386" stroke-width="1.5"/>
<g fill="none" stroke="#234386" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="404" y="262" width="58" height="76" rx="4" fill="#fff"/><path d="M416 282h34M416 296h34M416 310h22"/><path d="M58 300 l26 -16 l18 30 l-26 16 Z" fill="#fff"/><path d="M84 284 l12 -8 l18 30 l-12 8"/></g></svg>
${pencil('#234386', 'width:44%;left:2%;bottom:-6%;transform:rotate(-8deg)', 'hide-m')}</div>`;
}
/* ================= PÁGINAS PÚBLICAS ================= */
async function pgInicio() {
  await loadResources();
  const s = S.settings, PR = precios();
  const descs = { 'Planeación y proyectos': 'Proyectos comunitarios, escolares y de aula listos para adaptar a tu grupo, y apoyo para tu plan analítico.', 'Evaluación y seguimiento': 'Listas de cotejo, rúbricas y formatos para registrar avances y elaborar reportes.', 'Material imprimible': 'Fichas de grafomotricidad, conteo, lectoescritura, emociones y efemérides.', 'Formatos y familias': 'Documentos administrativos, minutas de CTE, circulares y mensajes para madres y padres.' };
  const cats = CATS.map(c => { const [i, bg] = CAT_STYLE[c]; return `<article class="card"><div class="ic" style="background:${bg}">${ico(i, '#234386')}</div><h3>${c}</h3><p style="color:var(--tinta-suave)">${descs[c]}</p><a href="#/catalogo?cat=${encodeURIComponent(c)}" class="eyebrow" style="margin-top:auto;text-decoration:none">Ver recursos →</a></article>`; }).join('');
  const free = publicRes().filter(r => r.acceso === 'gratis').slice(0, 3).map(r => resCard(r)).join('') || '<p class="empty">Muy pronto habrá recursos gratuitos para descargar.</p>';
  const tools = TOOLS.map(([i, t, d, nv]) => `<article class="card"><div class="ic" style="background:#FFF1BF">${ico(i, '#234386')}</div><h3>${t}</h3><p style="color:var(--tinta-suave)">${d}</p>${nv === 'autoridad' ? '<span class="tag tag-a" style="margin-top:auto;align-self:flex-start">Plan Autoridad Escolar</span>' : ''}</article>`).join('');
  const li = arr => arr.map(f => `<li>${ico('ok', '#3F6B3B', 22)}<span>${f}</span></li>`).join('');
  const planCard = (nv, titulo, quien, feats, dest) => { const m = PR[nv].mensual, a = PR[nv].anual, ah = Math.max(0, m * 12 - a);
    return `<article class="card" style="padding:36px;gap:18px${dest ? ';outline:2px solid var(--indigo);outline-offset:-2px' : ''}"><h3 class="eyebrow">${titulo}</h3><p style="color:var(--tinta-suave)">${quien}</p><p class="price">${money(m)} <small>MXN al mes</small></p><p style="color:var(--tinta-suave)">o ${money(a)} al año${ah ? ` <span class="tag tag-y">Ahorras ${money(ah)}</span>` : ''}</p><ul class="feat">${li(feats)}</ul><a class="btn ${dest ? 'btn-y' : 'btn-o'}" href="#/registro" style="margin-top:auto">Empezar prueba gratis</a></article>`; };
  const faq = (s.faq || []).map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('');
  const steps = [[1, 'Crea tu cuenta', 'Tu nombre, tu correo y una contraseña. Confirma tu correo.'], [2, 'Elige tu plan', 'Registra tu tarjeta. No se cobra nada durante la prueba.'], [3, `Usa todo ${TRIAL_DAYS} días gratis`, 'Si no cancelas antes, se hace el primer cobro de tu plan.']].map(([n, t, d]) => `<div class="stack" style="gap:14px"><div class="num">${n}</div><h3>${t}</h3><p style="color:var(--tinta-suave)">${d}</p></div>`).join('');
  return `${header()}<main id="inicio">
<section class="wrap hero"><div class="stack" style="gap:22px">
<span class="eyebrow">Para educadoras de 1°, 2° y 3° de preescolar</span>
<h1>${esc(s.hero)}</h1>
<p class="script">Construimos juntos la escuela que soñamos.</p>
<p class="lead">Recursos y herramientas en línea alineados a la Nueva Escuela Mexicana, pensados para el trabajo diario en el Jardín de Niños.</p>
<div class="row"><a class="btn btn-y" href="#/registro">Prueba gratis ${TRIAL_DAYS} días</a><a class="btn btn-o" href="#/#gratis">Ver recursos gratuitos →</a></div>
<p class="muted">Cancela cuando quieras desde tu cuenta.</p></div>${heroArt()}</section>
${wave('#FFFFFF')}<section id="recursos" class="sec" style="background:#fff;padding-top:48px">${sprig('#234386', 'width:120px;left:-20px;top:20px;transform:rotate(-10deg)', 'hide-m')}<div class="wrap"><div class="sec-h"><span class="eyebrow">Catálogo</span><h2>Todo lo que usas en el aula, en un solo lugar</h2><p class="lead">Busca por grado, campo formativo y tipo de recurso.</p></div><div class="grid">${cats}</div><div style="margin-top:32px"><a class="btn btn-b" href="#/catalogo">Ver el catálogo completo</a></div></div></section>
${wave('#FFFFFF', true)}<section id="gratis" class="sec">${blob('#A2D3A6', 1, 'width:260px;right:-90px;top:30px;opacity:.55')}<div class="wrap"><div class="sec-h"><span class="eyebrow">Prueba sin registrarte</span><h2>Recursos gratuitos para empezar</h2><p class="lead">Descárgalos y conoce la calidad de nuestros materiales.</p></div><div class="grid">${free}</div></div></section>
${wave('#CF5C14')}<section id="herramientas" class="sec band-o" style="padding-top:40px">${pencil('#FFFFFF', 'width:240px;right:3%;top:28px;opacity:.6;transform:rotate(6deg)', 'hide-m')}<div class="wrap"><div class="sec-h"><span class="eyebrow">Herramientas en línea</span><h2>Llena, guarda y consulta desde tu celular</h2><p style="font-size:18px">Además de los recursos para descargar, tendrás herramientas que trabajan contigo.</p></div><div class="grid">${tools}</div></div></section>
${wave('#CF5C14', true)}<section class="sec">${sprig('#6AA8DC', 'width:110px;right:6%;top:40px;transform:rotate(16deg)', 'hide-m')}<div class="wrap"><div class="sec-h"><span class="eyebrow">Así de fácil</span><h2>Empieza hoy en tres pasos</h2></div><div class="grid">${steps}</div></div></section>
${wave('#FFFFFF')}<section id="planes" class="sec" style="background:#fff;padding-top:48px">${blob('#FFC400', 0, 'width:300px;left:-120px;bottom:40px;opacity:.5')}<div class="wrap"><div class="sec-h"><span class="eyebrow">Planes y precios</span><h2>Un plan para cada función</h2><p class="lead">Los dos planes empiezan con ${TRIAL_DAYS} días gratis. Elige pago mensual o anual.</p></div>
<div class="grid" style="max-width:880px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
${planCard('docente', 'Plan Docente', 'Para educadoras frente a grupo.', ['Recursos descargables (PDF y Word)', 'Herramientas en línea para el aula', 'Recursos nuevos cada mes', 'Para 1°, 2° y 3° de preescolar'], false)}
${planCard('autoridad', 'Plan Autoridad Escolar', 'Para directivos, supervisores y ATP.', ['Todo lo del plan Docente', 'Recursos exclusivos de gestión y acompañamiento', 'Herramientas de visita y sistematización', 'Recursos nuevos cada mes'], true)}
</div><div class="row" style="margin-top:24px;color:var(--tinta-suave)">${ico('card', '#4A5661', 22)}<span>Pago seguro con tarjeta de crédito o débito. Se renueva solo y puedes cancelar cuando quieras.</span></div></div></section>
${wave('#FFFFFF', true)}<section id="preguntas" class="sec"><div class="wrap" style="max-width:880px"><div class="sec-h"><span class="eyebrow">Preguntas frecuentes</span><h2>Resolvemos tus dudas</h2></div><div class="faq">${faq}</div></div></section>
<section class="sec" style="padding-top:24px"><div class="wrap"><div class="card" style="padding:48px 36px;align-items:flex-start;gap:16px;overflow:hidden">${blob('#FFC400', 1, 'width:260px;right:-60px;top:-80px;opacity:.9')}${sprig('#234386', 'width:110px;right:40px;bottom:-30px;transform:rotate(8deg)', 'hide-m')}<h2 style="position:relative;max-width:640px">Únete a la comunidad</h2><p class="script" style="position:relative">Construimos juntos la escuela que soñamos.</p><p class="lead" style="position:relative;max-width:560px">Prueba todos los recursos gratis durante ${TRIAL_DAYS} días.</p><a class="btn btn-y" href="#/registro" style="position:relative">Prueba gratis ${TRIAL_DAYS} días</a></div></div></section>
</main>${footer()}`;
}

const catF = { q: '', grado: 'Todos', campo: 'Todos los campos', tipo: 'Todos', cat: 'Todas', orden: 'Más recientes' };
function filtered() {
  let list = publicRes();
  const q = catF.q.trim().toLowerCase();
  if (q) list = list.filter(r => (r.titulo + ' ' + r.descripcion + ' ' + r.categoria + ' ' + r.campo).toLowerCase().includes(q));
  if (catF.grado !== 'Todos') list = list.filter(r => (r.grados || []).includes(catF.grado));
  if (catF.campo !== 'Todos los campos') list = list.filter(r => r.campo === catF.campo);
  if (catF.cat !== 'Todas') list = list.filter(r => r.categoria === catF.cat);
  if (catF.tipo === 'Descargable') list = list.filter(r => r.formato !== 'Herramienta en línea');
  if (catF.tipo === 'Herramienta en línea') list = list.filter(r => r.formato === 'Herramienta en línea');
  if (catF.orden === 'Más descargados') list.sort((a, b) => b.descargas - a.descargas);
  else if (catF.orden === 'A a Z') list.sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
  else list.sort((a, b) => ts(b.publicado_at || b.created_at) - ts(a.publicado_at || a.created_at));
  return list;
}
function chips(name, opts, cur, label) {
  return `<fieldset style="border:none;margin:0;padding:0"><legend class="lbl-t" style="padding:0;margin-bottom:8px">${label}</legend><div class="row" style="gap:8px">${opts.map(o => `<button type="button" class="chip${o === cur ? ' on' : ''}" data-act="filter" data-k="${name}" data-v="${esc(o)}" aria-pressed="${o === cur}">${esc(o)}</button>`).join('')}</div></fieldset>`;
}
function catResults() {
  const list = filtered();
  return `<div class="row between"><p style="font-weight:700">${list.length} ${list.length === 1 ? 'recurso encontrado' : 'recursos encontrados'}</p>
<div class="row" style="gap:8px"><label for="orden" class="lbl-t">Ordenar por</label><select id="orden" class="inp" style="width:auto" data-filter="orden">${opt(['Más recientes', 'Más descargados', 'A a Z'], catF.orden)}</select></div></div>
<div class="grid">${list.map(r => resCard(r)).join('') || '<p class="empty">No hay recursos con esos filtros todavía.</p>'}</div>`;
}
async function pgCatalogo(params) {
  await loadResources();
  if (params.cat && CATS.includes(params.cat)) catF.cat = params.cat;
  return `${header()}<main class="wrap stack" style="padding-top:40px;padding-bottom:72px;gap:28px">
<div class="sec-h" style="margin-bottom:0"><span class="eyebrow">Catálogo de recursos</span><h1 style="font-size:clamp(30px,4vw,44px)">Encuentra lo que necesitas para tu grupo</h1></div>
<div class="card" style="gap:20px">
<div class="field"><label for="buscar">Buscar recurso</label><input id="buscar" class="inp" type="search" value="${esc(catF.q)}" placeholder="Ej. proyecto de animales, lista de cotejo, emociones" data-filter="q"></div>
<div class="grid-s" style="align-items:start">${chips('grado', ['Todos', ...GRADOS], catF.grado, 'Grado')}
<div class="field"><label for="campo">Campo formativo</label><select id="campo" class="inp" data-filter="campo">${opt(['Todos los campos', ...CAMPOS], catF.campo)}</select></div>
${chips('tipo', ['Todos', 'Descargable', 'Herramienta en línea'], catF.tipo, 'Tipo')}</div>
${chips('cat', ['Todas', ...CATS], catF.cat, 'Categoría')}
</div><div id="cat-res" class="stack" style="gap:24px">${catResults()}</div></main>${footer()}`;
}

function accesoShell(inner) {
  const incl = ['Todos los recursos para descargar', 'Las herramientas en línea', 'Recursos nuevos cada mes', 'Cancela cuando quieras'].map(f => `<li>${ico('ok', '#FFC400', 22)}<span>${f}</span></li>`).join('');
  return `${header()}<main class="wrap" style="padding-top:48px;padding-bottom:72px">
<div style="display:grid;gap:32px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start">
<section class="band stack" style="border-radius:8px;padding:40px;gap:20px;position:relative;overflow:hidden">${sprig('#6AA8DC', 'width:120px;right:-10px;bottom:-20px;opacity:.7')}<div style="background:#FBF9F6;border-radius:50%;padding:18px;align-self:flex-start">${logo(96, '#FBF9F6')}</div>
<h2>Tu prueba gratis de ${TRIAL_DAYS} días incluye</h2><p class="script" style="color:#FFC400;font-size:30px">Construimos juntos la escuela que soñamos.</p><ul class="feat" style="font-size:17px">${incl}</ul>
<p style="color:#E6EEF5">Después: plan Docente desde ${money(precios().docente.mensual)} al mes o plan Autoridad Escolar desde ${money(precios().autoridad.mensual)} al mes.</p></section>
<section class="card" style="padding:32px;gap:18px">${inner}</section></div></main>${footer()}`;
}
function pgAcceso(mode) {
  if (S.profile) { go(isAdmin(S.profile) ? '#/admin' : '#/panel'); return ''; }
  const reg = mode === 'registro';
  const tabs = `<div class="row" style="gap:8px"><a class="chip${reg ? ' on' : ''}" href="#/registro" style="text-decoration:none">Crear cuenta</a><a class="chip${reg ? '' : ' on'}" href="#/acceso" style="text-decoration:none">Iniciar sesión</a></div>`;
  const form = reg ? `<h2 style="font-size:28px">Crea tu cuenta</h2>
<form class="stack" data-form="registro" novalidate>
<div class="field"><label for="nom">Nombre completo</label><input id="nom" name="nombre" class="inp" autocomplete="name" required></div>
<div class="field"><label for="mail">Correo electrónico</label><input id="mail" name="email" class="inp" type="email" autocomplete="email" required></div>
<div class="field"><label for="pass">Contraseña</label><input id="pass" name="pass" class="inp" type="password" autocomplete="new-password" minlength="8" required><span class="muted">Mínimo 8 caracteres.</span></div>
<div class="field"><label for="funcion">Tu función</label><select id="funcion" name="funcion" class="inp" required><option value="">Selecciona una opción</option>${Object.entries(FUNCIONES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><span class="muted">Te recomendaremos el plan que mejor te queda.</span></div>
<div class="field"><label for="grado">Grado que atiendes</label><select id="grado" name="grado" class="inp"><option value="">Selecciona una opción</option>${opt(['1° de preescolar', '2° de preescolar', '3° de preescolar', 'Grupo multigrado', 'No atiendo grupo'])}</select></div>
<label class="chk"><input type="checkbox" name="acepto"><span>Acepto el aviso de privacidad y los términos de uso.</span></label>
<p class="err" data-err hidden></p>
<button class="btn btn-y" type="submit" style="font-size:17px">Crear mi cuenta</button>
<p class="muted">Te enviaremos un correo para confirmar tu cuenta. Después eliges tu plan y empiezas tus ${TRIAL_DAYS} días gratis.</p></form>`
    : `<h2 style="font-size:28px">Inicia sesión</h2>
<form class="stack" data-form="login" novalidate>
<div class="field"><label for="mail2">Correo electrónico</label><input id="mail2" name="email" class="inp" type="email" autocomplete="email" required></div>
<div class="field"><label for="pass2">Contraseña</label><input id="pass2" name="pass" class="inp" type="password" autocomplete="current-password" required></div>
<p class="err" data-err hidden></p>
<div class="row between"><button type="button" class="btn btn-o btn-sm" data-act="forgot">¿Olvidaste tu contraseña?</button><button class="btn btn-b" type="submit">Entrar</button></div>
<p class="muted">Tu cuenta funciona en un dispositivo a la vez. Si entras en otro, la sesión anterior se cierra.</p></form>`;
  return accesoShell(tabs + form);
}
function pgRevisaCorreo() {
  return accesoShell(`<h2 style="font-size:28px">Revisa tu correo</h2><p>Te enviamos un enlace para confirmar tu cuenta. Ábrelo desde este mismo dispositivo para entrar directo.</p><p class="muted">Si no lo ves en unos minutos, busca en la carpeta de correo no deseado.</p><a class="btn btn-b" href="#/acceso" style="align-self:flex-start">Ir a iniciar sesión</a>`);
}
function pgNuevaContrasena() {
  if (!S.session) return accesoShell(`<h2 style="font-size:28px">El enlace ya no es válido</h2><p>Pide un enlace nuevo desde "¿Olvidaste tu contraseña?".</p><a class="btn btn-b" href="#/acceso" style="align-self:flex-start">Ir a iniciar sesión</a>`);
  return accesoShell(`<h2 style="font-size:28px">Crea tu nueva contraseña</h2><form class="stack" data-form="nueva" novalidate>
<div class="field"><label for="np">Nueva contraseña</label><input id="np" name="pass" class="inp" type="password" autocomplete="new-password" minlength="8" required><span class="muted">Mínimo 8 caracteres.</span></div>
<p class="err" data-err hidden></p><button class="btn btn-y" type="submit">Guardar contraseña</button></form>`);
}

/* ================= PANEL DE LA DOCENTE ================= */
function shell(active, content, admin) {
  const p = S.profile;
  const items = admin
    ? [['home', 'Resumen', '#/admin'], ['book', 'Recursos', '#/admin/recursos'], ['users', 'Suscriptoras', '#/admin/suscriptoras'], ['chat', 'Textos y avisos', '#/admin/textos'], ['tools', 'Herramientas', '#/admin/herramientas']]
    : [['home', 'Inicio', '#/panel'], ['book', 'Recursos', '#/catalogo'], ['tools', 'Herramientas', '#/panel/herramientas'], ['star', 'Favoritos', '#/panel/favoritos'], ['down', 'Descargas', '#/panel/descargas'], ['card', 'Mi suscripción', '#/panel/suscripcion']];
  const side = items.map(([i, t, h]) => `<a href="${h}"${t === active ? ' class="on" aria-current="page"' : ''}>${ico(i, t === active ? '#234386' : '#1E2530', 22)}<span>${t}</span></a>`).join('');
  return `<div class="app"><aside class="side" aria-label="Menú de la cuenta">
<a class="brand" href="#/" style="padding:4px 8px 4px;min-height:0">${logo(40)}<b class="lbl" style="font-size:15px">Comunidad de Aprendizaje<br><span>Preescolar</span></b></a>
<p class="side-role">${admin ? 'Administrador' : esc((p.nombre || p.email).split(' ')[0])}</p>${side}
<a href="#/" style="margin-top:auto">${ico('eye', '#1E2530', 22)}<span>Ver la página</span></a>
<button class="lnk" data-act="logout">${ico('out', '#1E2530', 22)}<span>Cerrar sesión</span></button></aside>
<main class="main">${content}<p class="muted" style="border-top:1px solid var(--borde);padding-top:16px">${AUTHOR}</p></main></div>${admin ? '' : waBtn('Ayuda por WhatsApp')}`;
}
function title(t, sub, btns = '') { return `<div class="row between" style="align-items:flex-end"><div class="stack" style="gap:6px"><h1 style="font-size:clamp(28px,3.5vw,38px)">${t}</h1>${sub ? `<p class="lead">${sub}</p>` : ''}</div><div class="row">${btns}</div></div>`; }
function needUser() { const p = S.profile; if (!p) { go('#/acceso'); return null; } if (isAdmin(p)) { go('#/admin'); return null; } return p; }
function subBanner(p) {
  const st = subState(p);
  const h = t => `<p style="font-family:var(--f-display);font-size:30px;letter-spacing:.03em;color:var(--indigo);line-height:1">${t}</p>`;
  if (st.key === 'sinplan') return `<section class="notice">${`<div class="stack" style="gap:4px">${h(p.trial_used ? 'Elige tu plan para continuar' : `Elige tu plan para empezar tus ${TRIAL_DAYS} días gratis`)}<p>${p.trial_used ? 'Contrata tu plan para descargar recursos y usar las herramientas.' : 'Registras tu tarjeta, pero no se cobra nada durante la prueba.'}</p></div>`}<a class="btn btn-b" href="#/panel/suscripcion">Elegir mi plan</a></section>`;
  if (st.key === 'prueba') { const d = daysLeft(p.trial_end); return `<section class="notice"><div class="stack" style="gap:4px">${h(`Te ${d === 1 ? 'queda 1 día' : `quedan ${d} días`} de prueba gratis`)}<p>${p.cancel_at_period_end ? 'Cancelaste tu plan: no se te cobrará.' : `El ${fmtDate(p.trial_end)} se hará el primer cobro de tu plan ${esc(planTxt(p))} (${money(precioDe(p))}).`}</p></div><a class="btn btn-o" href="#/panel/suscripcion">Ver mi suscripción</a></section>`; }
  if (st.key === 'pendiente') return `<section class="notice r"><div class="stack" style="gap:4px">${h('No pudimos cobrar tu plan')}<p>Actualiza tu tarjeta para no perder el acceso.</p></div><button class="btn btn-b" data-act="portal">Actualizar tarjeta</button></section>`;
  if (st.key === 'vencida') return `<section class="notice r"><div class="stack" style="gap:4px">${h('Tu acceso terminó')}<p>Contrata un plan para volver a descargar recursos y usar las herramientas.</p></div><a class="btn btn-b" href="#/panel/suscripcion">Elegir mi plan</a></section>`;
  if (st.key === 'cancelada') return `<section class="notice b"><p>Cancelaste la renovación. Tienes acceso hasta el <b>${fmtDate(p.current_period_end)}</b>.</p><button class="btn btn-o" data-act="portal">Reactivar</button></section>`;
  if (st.key === 'cortesia') return `<section class="notice b"><p>Tienes acceso de cortesía hasta el <b>${fmtDate(p.courtesy_until)}</b>.</p></section>`;
  return '';
}
async function myDescargas(limit) {
  let q = sb.from('descargas').select('resource_id, created_at').eq('user_id', S.profile.id).order('created_at', { ascending: false });
  if (limit) q = q.limit(limit);
  return must(await q) || [];
}
async function pgPanel(params) {
  const p = needUser(); if (!p) return '';
  if (params.pago === 'ok' && !S.fresh.pago) { S.fresh.pago = true; waitForPayment(); }
  await loadResources();
  const st = subState(p);
  const avisos = (must(await sb.from('avisos').select('*').eq('panel', true).gte('fecha', new Date(ts(p.created_at) - 30 * DAY).toISOString()).order('fecha', { ascending: false }).limit(10)) || [])
    .filter(a => !(p.avisos_cerrados || []).includes(a.id))
    .filter(a => a.destino === 'Todas las suscriptoras' || (a.destino === 'Solo en prueba' && st.key === 'prueba') || (a.destino === 'Solo plan mensual' && p.plan === 'mensual') || (a.destino === 'Solo plan anual' && p.plan === 'anual') || (a.destino === 'Solo plan Docente' && nivelDe(p) === 'docente') || (a.destino === 'Solo plan Autoridad Escolar' && nivelDe(p) === 'autoridad')).slice(0, 3);
  const dls = await myDescargas(5);
  const byId = id => S.resources.find(r => r.id === id);
  const tools = TOOLS.filter(x => x[3] !== 'autoridad' || nivelDe(p) === 'autoridad').map(([i, t], n) => `<a class="card" href="${n === 0 ? '#/panel/planeaciones' : '#/panel/herramientas'}" style="text-decoration:none;padding:18px;gap:10px"><div class="ic" style="background:#E4EAF5;width:44px;height:44px">${ico(i, '#234386', 22)}</div><span style="font-weight:700;color:var(--tinta)">${t}</span></a>`).join('');
  const nuevos = publicRes().filter(r => r.nuevo_mes).slice(0, 4).map(r => resCard(r, 'nuevo')).join('') || '<p class="empty">Este mes aún no hay recursos nuevos.</p>';
  const favs = (p.favoritos || []).map(byId).filter(Boolean).slice(0, 5);
  const av = avisos.map(a => `<section class="notice b"><div class="stack" style="gap:4px"><p style="font-weight:800">${esc(a.titulo)}</p><p>${esc(a.mensaje)}</p></div><button class="btn btn-o btn-sm" data-act="closeAviso" data-id="${a.id}">Cerrar aviso</button></section>`).join('');
  return shell('Inicio', `${title('Hola, ' + esc((p.nombre || '').split(' ')[0] || 'maestra'), '¿Qué vas a preparar hoy para tu grupo?', '<a class="btn btn-b" href="#/catalogo">Buscar recursos</a>')}
${av}${subBanner(p)}
<section class="stack"><h2 style="font-size:26px">Herramientas en línea</h2><div class="grid-s">${tools}</div></section>
<section class="stack"><div class="row between"><h2 style="font-size:26px">Recursos nuevos del mes</h2><a href="#/catalogo" style="font-weight:700">Ver todos</a></div><div class="grid">${nuevos}</div></section>
<div class="grid">
<section class="card"><div class="row">${ico('star', '#234386', 24)}<h3>Mis favoritos</h3></div>${favs.length ? `<ul class="list">${favs.map(r => `<li><span style="font-weight:600">${esc(r.titulo)}</span>${canAcc(p, r.acceso) ? `<button class="btn btn-o btn-sm" data-act="download" data-id="${r.id}">Descargar</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Guarda recursos con el botón "Guardar" para tenerlos a la mano.</p>'}</section>
<section class="card"><div class="row">${ico('down', '#234386', 24)}<h3>Descargas recientes</h3></div>${dls.length ? `<ul class="list">${dls.map(d => { const r = byId(d.resource_id); return `<li><span style="font-weight:600">${esc(r ? r.titulo : 'Recurso no disponible')}</span><span class="muted">${fmtDate(d.created_at)}</span></li>`; }).join('')}</ul>` : '<p class="muted">Aquí verás lo último que descargaste.</p>'}</section>
</div>`);
}
async function waitForPayment() {
  toast('Estamos confirmando tu pago…');
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 2500));
    const p = (await sb.from('profiles').select('*').eq('id', S.profile.id).single()).data;
    if (p && p.stripe_subscription_id) { toast('¡Listo! Tu plan quedó activo.'); history.replaceState(null, '', location.pathname + '#/panel'); S.fresh.pago = false; render(); return; }
  }
  toast('Tu pago se está procesando. Si no ves tu plan en unos minutos, recarga la página.');
  S.fresh.pago = false;
}
async function pgFavoritos() {
  const p = needUser(); if (!p) return ''; await loadResources();
  const favs = (p.favoritos || []).map(id => S.resources.find(r => r.id === id)).filter(Boolean);
  return shell('Favoritos', `${title('Mis favoritos', 'Los recursos que guardaste.')}<div class="grid">${favs.map(r => resCard(r)).join('') || '<p class="empty">Todavía no guardas recursos. Búscalos en el <a href="#/catalogo">catálogo</a>.</p>'}</div>`);
}
async function pgDescargas() {
  const p = needUser(); if (!p) return ''; await loadResources();
  const dls = await myDescargas(200);
  return shell('Descargas', `${title('Mis descargas', 'Todo lo que has descargado.')}${dls.length ? `<section class="card"><ul class="list">${dls.map(d => { const r = S.resources.find(x => x.id === d.resource_id); return `<li><span style="font-weight:600">${esc(r ? r.titulo : 'Recurso no disponible')}</span><span class="row"><span class="muted">${fmtDate(d.created_at)}</span>${r && canAcc(p, r.acceso) ? `<button class="btn btn-o btn-sm" data-act="download" data-id="${r.id}">Descargar de nuevo</button>` : ''}</span></li>`; }).join('')}</ul></section>` : '<p class="empty">Aún no descargas recursos.</p>'}`);
}
function pgHerramientas() {
  const p = needUser(); if (!p) return '';
  return shell('Herramientas', `${title('Herramientas en línea', 'El generador de planeaciones ya está listo. Te avisaremos en tu panel cuando las demás herramientas estén disponibles.')}
<div class="grid">${TOOLS.map(([i, t, d, nv], n) => `<article class="card"><div class="ic" style="background:#E4EAF5">${ico(i, '#234386')}</div><h3>${t}</h3><p style="color:var(--tinta-suave)">${d}</p>${nv === 'autoridad' ? '<span class="tag tag-b" style="align-self:flex-start">Plan Autoridad Escolar</span>' : ''}${n === 0 ? '<a class="btn btn-y" href="#/panel/planeaciones" style="align-self:flex-start;margin-top:auto">Abrir</a>' : '<span class="tag tag-a" style="margin-top:auto;align-self:flex-start">Próximamente</span>'}</article>`).join('')}</div>`);
}
async function pgSuscripcion() {
  const p = needUser(); if (!p) return '';
  const st = subState(p), PR = precios();
  const pagos = must(await sb.from('payments').select('*').eq('user_id', p.id).order('fecha', { ascending: false })) || [];
  const hasSub = !!p.stripe_subscription_id && ['prueba', 'activa', 'cancelada', 'pendiente'].includes(st.key);
  let body;
  if (hasSub) {
    const nv = p.nivel || 'docente', otro = nv === 'docente' ? 'autoridad' : 'docente';
    const rows = [['Plan', `${planTxt(p)} · ${money(precioDe(p))}`], ['Estado', st.label],
      st.key === 'prueba' ? ['Termina la prueba', fmtDate(p.trial_end)] : [p.cancel_at_period_end ? 'Acceso hasta el' : 'Se renueva el', fmtDate(p.current_period_end)], ['Sesión activa', 'Este dispositivo']];
    const pend = p.nivel_siguiente && p.nivel_siguiente !== nv;
    const cambio = st.key === 'pendiente' ? '<p class="muted">Para cambiar de plan, primero actualiza tu tarjeta.</p>'
      : pend ? `<section class="notice b"><p>Tu plan cambiará a <b>${NIVEL_TXT[p.nivel_siguiente]}</b> el ${fmtDate(p.current_period_end)}. Hasta entonces conservas ${NIVEL_TXT[nv]}.</p><button class="btn btn-o" data-act="cambiarPlan" data-nivel="${nv}">Conservar ${NIVEL_TXT[nv]}</button></section>`
      : `<div class="stack" style="gap:8px"><h3>${otro === 'autoridad' ? '¿Necesitas las herramientas de Autoridad Escolar?' : '¿Prefieres el plan Docente?'}</h3><p class="muted">Plan ${NIVEL_TXT[otro]} ${p.plan}: ${money(PR[otro][p.plan])} ${p.plan === 'anual' ? 'al año' : 'al mes'}.</p><button class="btn ${otro === 'autoridad' ? 'btn-y' : 'btn-o'}" data-act="cambiarPlan" data-nivel="${otro}" style="align-self:flex-start">Cambiar a plan ${NIVEL_TXT[otro]}</button></div>`;
    body = `<section class="card" style="padding:28px;gap:18px"><ul class="list">${rows.map(([a, b]) => `<li><span>${a}</span><span style="font-weight:700">${esc(b)}</span></li>`).join('')}</ul>
${cambio}
<div class="row"><button class="btn btn-b" data-act="portal">Tarjeta, facturas o cancelar</button></div>
<p class="muted">Se abre la página segura de Stripe. Tu plan se renueva solo con tu tarjeta. Si cancelas, conservas el acceso hasta el final del periodo pagado. No hay reembolsos.</p></section>`;
  } else {
    const trial = !p.trial_used, rec = recomendado(p);
    const card = (nv, quien, feats) => `<article class="card" style="background:var(--marfil)${rec === nv ? ';border:3px solid var(--azul)' : ''}"><div class="row between"><h3>Plan ${NIVEL_TXT[nv]}</h3>${rec === nv ? '<span class="tag tag-y">Recomendado para ti</span>' : ''}</div><p class="muted">${quien}</p><ul class="feat">${feats.map(f => `<li>${ico('ok', '#3F6B3B', 20)}<span>${f}</span></li>`).join('')}</ul>
<div class="stack" style="gap:10px;margin-top:auto"><button class="btn btn-o" data-act="checkout" data-nivel="${nv}" data-periodo="mensual">${trial ? 'Prueba gratis · luego' : 'Mensual ·'} ${money(PR[nv].mensual)} al mes</button><button class="btn btn-y" data-act="checkout" data-nivel="${nv}" data-periodo="anual">${trial ? 'Prueba gratis · luego' : 'Anual ·'} ${money(PR[nv].anual)} al año</button></div></article>`;
    body = `<section class="card" style="padding:28px;gap:18px"><h2 style="font-size:24px">${trial ? `Elige tu plan y empieza tus ${TRIAL_DAYS} días gratis` : 'Elige tu plan'}</h2>
<p>${trial ? `Registras tu tarjeta en la página segura de Stripe. No se cobra nada durante ${TRIAL_DAYS} días; si no cancelas antes, se hace el primer cobro del plan que elijas.` : 'Se cobra hoy y se renueva automáticamente. Puedes cancelar cuando quieras.'}</p>
<div class="grid">${card('docente', 'Para educadoras frente a grupo.', ['Recursos descargables', 'Herramientas para el aula', 'Recursos nuevos cada mes'])}${card('autoridad', 'Para directivos, supervisores y ATP.', ['Todo lo del plan Docente', 'Recursos exclusivos de gestión', 'Herramientas de visita y sistematización'])}</div>
<p class="muted">Después puedes cambiar de plan desde esta página. ${ico('lock', '#4A5661', 16)} Pago con tarjeta de crédito o débito procesado por Stripe. Nunca vemos ni guardamos los datos de tu tarjeta.</p></section>`;
  }
  return shell('Mi suscripción', `${title('Mi suscripción', '')}${subBanner(p)}${body}
<section class="card"><h3>Historial de pagos</h3>${pagos.length ? `<ul class="list">${pagos.map(x => `<li><span>${esc(x.concepto)} · ${money(x.monto)}</span><span class="muted">${fmtDate(x.fecha)}</span></li>`).join('')}</ul>` : '<p class="muted">Todavía no hay pagos.</p>'}</section>`);
}
// Aviso antes de cambiar de plan, con el monto exacto que calcula el servidor.
function avisoCambio(v) {
  const nombre = NIVEL_TXT[v.nivel], per = v.periodo === 'anual' ? 'año' : 'mes', perS = v.periodo === 'anual' ? 'anualidad' : 'mes';
  const txt = {
    subir: `<p>Se cobrará <b>hoy ${money(v.monto)}</b> a tu tarjeta: solo la parte proporcional de la diferencia por los días que faltan de tu ${perS}.</p><p>A partir de tu siguiente renovación (${fmtDate(v.fecha)}) se cobrará el ${perS} completo: <b>${money(v.precioNuevo)}</b> al ${per}.</p><p class="muted">Tienes acceso a todo lo del plan ${nombre} en cuanto se confirme el cobro.</p>`,
    bajar: `<p>Conservas el plan Autoridad Escolar hasta el <b>${fmtDate(v.fecha)}</b>. Desde esa renovación se cobrará el plan ${nombre}: <b>${money(v.precioNuevo)}</b> al ${per}.</p><p class="muted">No hay reembolso por la diferencia del periodo que ya pagaste. Al cambiar dejarás de ver los recursos y herramientas exclusivos de Autoridad Escolar.</p>`,
    prueba: `<p>Estás en tu prueba gratis: el cambio es inmediato y <b>no se cobra nada hoy</b>.</p><p>Al terminar la prueba (${fmtDate(v.fecha)}) se cobrará el plan ${nombre}: <b>${money(v.precioNuevo)}</b> al ${per}.</p>`,
    conservar: `<p>Se cancela el cambio programado y conservas tu plan ${nombre}. Tu siguiente renovación será el ${fmtDate(v.fecha)} con el mismo precio de siempre.</p>`,
  }[v.tipo];
  const btn = v.tipo === 'subir' ? `Pagar ${money(v.monto)} y cambiar` : v.tipo === 'conservar' ? `Conservar plan ${nombre}` : `Cambiar a plan ${nombre}`;
  modal(`<h2 style="font-size:28px">${v.tipo === 'conservar' ? 'Conservar tu plan' : `Cambiar a plan ${nombre}`}</h2>${txt}<div class="row between" style="margin-top:8px"><button type="button" class="btn btn-o" data-act="closeModal">Cancelar</button><button type="button" class="btn btn-y" data-act="confirmarCambio" data-nivel="${v.nivel}" data-fp="${v.fechaProrrateo || ''}">${btn}</button></div>`);
}

/* ================= ADMINISTRADOR ================= */
function needAdmin() { const p = S.profile; if (!p) { go('#/acceso'); return null; } if (!isAdmin(p)) { go('#/panel'); return null; } return p; }
function stat(l, v, n = '') { return `<div class="stat"><span class="muted" style="font-weight:700">${l}</span><b>${v}</b>${n ? `<span class="muted">${n}</span>` : ''}</div>`; }
async function docentes() { return (must(await sb.from('profiles').select('*').neq('role', 'admin').order('created_at', { ascending: false })) || []); }
async function pgAdmin() {
  if (!needAdmin()) return '';
  await loadResources();
  const ds = await docentes(), n = Date.now(), m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
  const pagos = must(await sb.from('payments').select('monto, fecha').gte('fecha', m0.toISOString())) || [];
  const states = ds.map(subState);
  const cnt = k => states.filter(s => s.key === k).length;
  const ingresos = pagos.reduce((s, x) => s + Number(x.monto), 0);
  const prox = ds.filter(u => ['active', 'trialing'].includes(u.sub_status) && !u.cancel_at_period_end && !u.blocked).filter(u => { const e = u.sub_status === 'trialing' ? ts(u.trial_end) : ts(u.current_period_end); return e > n && e < n + 7 * DAY; }).reduce((s, u) => s + precioDe(u), 0);
  const pruebasFin = ds.filter(u => u.sub_status === 'trialing' && ts(u.trial_end) > n && ts(u.trial_end) < n + 7 * DAY).length;
  const top = S.resources.slice().sort((x, y) => y.descargas - x.descargas).slice(0, 5);
  const pubMes = S.resources.filter(r => visible(r) && ts(r.publicado_at) >= m0.getTime()).slice(0, 5);
  return shell('Resumen', `${title('Resumen', 'Así va tu comunidad este mes.', '<a class="btn btn-o" href="#/admin/textos">Enviar aviso</a><a class="btn btn-y" href="#/admin/recurso/nuevo">Subir recurso</a>')}
<section class="stack"><h2 style="font-size:24px">Suscriptoras</h2><div class="grid-s">${stat('Activas', cnt('activa') + cnt('cancelada') + cnt('pendiente'), 'Con plan pagado')}${stat('En prueba', cnt('prueba'), `${TRIAL_DAYS} días gratis`)}${stat('Plan Docente', ds.filter((u, i) => u.plan && (u.nivel || 'docente') === 'docente' && states[i].access).length, 'Mensual y anual')}${stat('Plan Autoridad Escolar', ds.filter((u, i) => u.plan && u.nivel === 'autoridad' && states[i].access).length, 'Mensual y anual')}${stat('Pago mensual', ds.filter((u, i) => u.plan === 'mensual' && states[i].access).length)}${stat('Pago anual', ds.filter((u, i) => u.plan === 'anual' && states[i].access).length)}${stat('Sin plan o vencidas', cnt('sinplan') + cnt('vencida'))}${stat('Cancelaron la renovación', ds.filter(u => u.cancel_at_period_end).length)}</div></section>
<section class="stack"><h2 style="font-size:24px">Ingresos</h2><div class="grid-s">${stat('Ingresos del mes', money(ingresos), 'Cobros con tarjeta')}${stat('Próximos cobros (7 días)', money(prox), 'Renovaciones y fin de pruebas')}${stat('Pruebas que terminan esta semana', pruebasFin)}</div></section>
<div class="grid"><section class="card"><div class="row">${ico('down', '#234386', 24)}<h3>Recursos más descargados</h3></div>${top.length ? `<ul class="list">${top.map(r => `<li><span style="font-weight:600">${esc(r.titulo)}</span><span class="muted">${r.descargas} ${r.descargas === 1 ? 'descarga' : 'descargas'}</span></li>`).join('')}</ul>` : '<p class="muted">Aún no subes recursos.</p>'}</section>
<section class="card"><div class="row">${ico('star', '#234386', 24)}<h3>Publicados este mes</h3></div>${pubMes.length ? `<ul class="list">${pubMes.map(r => `<li><span style="font-weight:600">${esc(r.titulo)}</span><span class="muted">${fmtDate(r.publicado_at)}</span></li>`).join('')}</ul>` : '<p class="muted">Aún no publicas recursos este mes.</p>'}</section></div>`, true);
}
const admF = { q: '', estado: 'Todos' };
function estadoTag(r) { if (r.estado === 'programado') return visible(r) ? '<span class="tag tag-g">Publicado</span>' : `<span class="tag tag-b">Programado: ${esc(r.fecha_pub)}</span>`; return { publicado: '<span class="tag tag-g">Publicado</span>', borrador: '<span class="tag tag-a">Borrador</span>', oculto: '<span class="tag tag-r">Oculto</span>' }[r.estado]; }
async function pgAdminRecursos() {
  if (!needAdmin()) return ''; await loadResources();
  const map = { Publicados: 'publicado', Borradores: 'borrador', Programados: 'programado', Ocultos: 'oculto' };
  let list = S.resources.slice();
  if (admF.estado !== 'Todos') list = list.filter(r => r.estado === map[admF.estado]);
  if (admF.q) list = list.filter(r => r.titulo.toLowerCase().includes(admF.q.toLowerCase()));
  const rows = list.map(r => `<tr><td style="font-weight:700">${esc(r.titulo)}</td><td>${esc(r.categoria)}</td><td>${esc((r.grados || []).join(', '))}</td><td>${ACCESO_TXT[r.acceso] || r.acceso}</td><td>${estadoTag(r)}</td><td>${r.descargas}</td><td><div class="row" style="gap:8px;flex-wrap:nowrap"><a class="btn btn-o btn-sm" href="#/admin/recurso/${r.id}">Editar</a><button class="btn btn-o btn-sm" data-act="toggleHide" data-id="${r.id}">${r.estado === 'oculto' ? 'Mostrar' : 'Ocultar'}</button></div></td></tr>`).join('');
  return shell('Recursos', `${title('Recursos', 'Sube, revisa y publica los recursos del catálogo.', '<a class="btn btn-y" href="#/admin/recurso/nuevo">Subir recurso</a>')}
<div class="card" style="gap:16px"><div class="field"><label for="br">Buscar recurso</label><input id="br" class="inp" type="search" value="${esc(admF.q)}" data-admq></div>
<div class="row" style="gap:8px">${['Todos', 'Publicados', 'Borradores', 'Programados', 'Ocultos'].map(e => `<button class="chip${admF.estado === e ? ' on' : ''}" data-act="admEstado" data-v="${e}" aria-pressed="${admF.estado === e}">${e}</button>`).join('')}</div></div>
<div class="tbox"><table class="tbl"><thead><tr><th>Recurso</th><th>Categoría</th><th>Grado</th><th>Acceso</th><th>Estado</th><th>Descargas</th><th>Acciones</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No hay recursos con ese filtro.</td></tr>'}</tbody></table></div>`, true);
}
async function pgAdminRecurso(id) {
  if (!needAdmin()) return ''; await loadResources();
  const r = id === 'nuevo' ? { id: '', cover_path: '', titulo: '', descripcion: '', categoria: CATS[0], campo: CAMPOS[0], grados: [], formato: 'PDF', acceso: 'suscripcion', nuevo_mes: true, estado: 'borrador', fecha_pub: '', file_name: '' } : S.resources.find(x => x.id === id);
  if (!r) return shell('Recursos', '<p class="empty">Ese recurso no existe.</p>', true);
  return shell('Recursos', `${title(id === 'nuevo' ? 'Subir un recurso nuevo' : 'Editar recurso', '', '<a class="btn btn-o" href="#/admin/recursos">Volver a la lista</a>')}
<form class="card stack" style="padding:28px;gap:20px" data-form="recurso" data-id="${esc(r.id)}" novalidate>
<div class="field"><label for="arch">Archivo (PDF o Word)</label><input id="arch" name="file" class="inp" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="padding:10px"><span class="muted">${r.file_name ? 'Archivo actual: ' + esc(r.file_name) + '. Sube otro solo si quieres reemplazarlo.' : 'Para herramientas en línea no se sube archivo. Máximo 50 MB.'}</span></div>
<div class="field"><label for="portada">Imagen de portada (opcional)</label>
<div class="row" style="align-items:flex-start;gap:16px">${r.cover_path ? `<img src="${esc(coverUrl(r.cover_path))}" alt="Portada actual" style="width:96px;aspect-ratio:3/4;object-fit:contain;background:#F3EBDD;border-radius:6px">` : ''}
<div class="stack" style="gap:8px;flex:1;min-width:220px"><input id="portada" name="cover" class="inp" type="file" accept="image/jpeg,image/png,image/webp" style="padding:10px"><span class="muted">JPG, PNG o WebP. Se ajusta sola a formato vertical tipo libro. Si no subes imagen, se muestra el ícono de la categoría.</span>
${r.cover_path ? '<label class="chk"><input type="checkbox" name="quitar_portada"><span>Quitar la portada actual</span></label>' : ''}</div></div></div>
<div class="field"><label for="rn">Nombre del recurso</label><input id="rn" name="titulo" class="inp" value="${esc(r.titulo)}" placeholder="Ej. Proyecto de aula: Las plantas de mi jardín" required></div>
<div class="field"><label for="rd">Descripción breve</label><textarea id="rd" name="descripcion" class="inp" placeholder="Qué es y cómo se usa en el aula">${esc(r.descripcion)}</textarea></div>
<div class="grid-s" style="align-items:start">
<div class="field"><label for="rc">Categoría</label><select id="rc" name="categoria" class="inp">${opt(CATS, r.categoria)}</select></div>
<div class="field"><label for="rf">Campo formativo</label><select id="rf" name="campo" class="inp">${opt([...CAMPOS, 'No aplica'], r.campo || 'No aplica')}</select></div>
<div class="field"><label for="rt">Formato</label><select id="rt" name="formato" class="inp">${opt(['PDF', 'Word', 'Herramienta en línea'], r.formato)}</select></div></div>
<fieldset style="border:none;margin:0;padding:0"><legend class="lbl-t" style="padding:0;margin-bottom:6px">Grado</legend><div class="row" style="gap:20px">${GRADOS.map(g => `<label class="chk"><input type="checkbox" name="grados" value="${g}"${(r.grados || []).includes(g) ? ' checked' : ''}><span>${g}</span></label>`).join('')}</div></fieldset>
<fieldset style="border:none;margin:0;padding:0"><legend class="lbl-t" style="padding:0;margin-bottom:6px">Acceso</legend><div class="row" style="gap:20px">${[['gratis', 'Gratis (muestra)'], ['suscripcion', 'Plan Docente y Autoridad'], ['autoridad', 'Solo Autoridad Escolar']].map(([v, t]) => `<label class="chk"><input type="radio" name="acceso" value="${v}"${(r.acceso || 'suscripcion') === v ? ' checked' : ''}><span>${t}</span></label>`).join('')}</div></fieldset>
<label class="chk"><input type="checkbox" name="nuevo_mes"${r.nuevo_mes ? ' checked' : ''}><span>Mostrar en "Recursos nuevos del mes"</span></label>
<div class="field" style="max-width:320px"><label for="rp">Fecha de publicación (para programar)</label><input id="rp" name="fecha_pub" class="inp" type="date" value="${esc(r.fecha_pub || '')}"></div>
<p class="muted">Estado actual: ${r.id ? estadoTag(r) : '<span class="tag tag-a">Nuevo</span>'}</p>
<p class="err" data-err hidden></p>
<div class="row"><button class="btn btn-o" type="submit" data-estado="borrador">Guardar como borrador</button><button class="btn btn-b" type="submit" data-estado="programado">Programar publicación</button><button class="btn btn-y" type="submit" data-estado="publicado">Publicar ahora</button></div>
${r.id ? `<button type="button" class="btn btn-r" data-act="delRes" data-id="${r.id}" style="align-self:flex-start">Eliminar recurso</button>` : ''}
</form>`, true);
}
const subF = { q: '', f: 'Todas' };
async function pgAdminSubs() {
  if (!needAdmin()) return '';
  const fm = { 'En prueba': 'prueba', Activas: 'activa', Canceladas: 'cancelada', 'Sin plan': 'sinplan', Vencidas: 'vencida', Bloqueadas: 'bloqueada' };
  let list = await docentes();
  if (subF.f === 'Mensual' || subF.f === 'Anual') list = list.filter(u => u.plan === subF.f.toLowerCase() && subState(u).access);
  if (subF.f === 'Docente') list = list.filter(u => u.plan && (u.nivel || 'docente') === 'docente' && subState(u).access);
  if (subF.f === 'Autoridad Escolar') list = list.filter(u => u.plan && u.nivel === 'autoridad' && subState(u).access);
  else if (subF.f !== 'Todas') list = list.filter(u => subState(u).key === fm[subF.f]);
  if (subF.q) list = list.filter(u => ((u.nombre || '') + ' ' + u.email).toLowerCase().includes(subF.q.toLowerCase()));
  const tag = k => ({ activa: 'tag-g', prueba: 'tag-b', cortesia: 'tag-b', cancelada: 'tag-a', vencida: 'tag-a', sinplan: 'tag-a', pendiente: 'tag-r', bloqueada: 'tag-r' }[k]);
  const fin = u => (u.sub_status === 'trialing' ? u.trial_end : u.current_period_end || u.courtesy_until);
  const rows = list.map(u => { const st = subState(u); return `<tr><td style="font-weight:700">${esc(u.nombre || '—')}</td><td>${esc(u.email)}</td><td>${esc(u.plan ? planTxt(u) : '—')}</td><td><span class="tag ${tag(st.key)}">${st.label}</span></td><td>${fmtDate(fin(u))}</td><td><a class="btn btn-o btn-sm" href="#/admin/suscriptora/${u.id}">Ver ficha</a></td></tr>`; }).join('');
  return shell('Suscriptoras', `${title('Suscriptoras', 'Consulta a cada docente, su plan y su estado.')}
<div class="card" style="gap:16px"><div class="field"><label for="bs">Buscar por nombre o correo</label><input id="bs" class="inp" type="search" value="${esc(subF.q)}" data-subq></div>
<div class="row" style="gap:8px">${['Todas', 'En prueba', 'Activas', 'Docente', 'Autoridad Escolar', 'Mensual', 'Anual', 'Canceladas', 'Sin plan', 'Vencidas', 'Bloqueadas'].map(e => `<button class="chip${subF.f === e ? ' on' : ''}" data-act="subFil" data-v="${e}" aria-pressed="${subF.f === e}">${e}</button>`).join('')}</div></div>
<div class="tbox"><table class="tbl"><thead><tr><th>Docente</th><th>Correo</th><th>Plan</th><th>Estado</th><th>Vence</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6">Aún no hay docentes con ese filtro.</td></tr>'}</tbody></table></div>`, true);
}
async function pgAdminSub(id) {
  if (!needAdmin()) return '';
  const u = (await sb.from('profiles').select('*').eq('id', id).single()).data;
  if (!u || isAdmin(u)) return shell('Suscriptoras', '<p class="empty">No se encontró a la docente.</p>', true);
  const pagos = must(await sb.from('payments').select('*').eq('user_id', id).order('fecha', { ascending: false })) || [];
  const cort = must(await sb.from('cortesias').select('*').eq('user_id', id).order('fecha', { ascending: false })) || [];
  const ndl = (await sb.from('descargas').select('id', { count: 'exact', head: true }).eq('user_id', id)).count || 0;
  const st = subState(u);
  const dat = [['Correo', u.email], ['Función', FUNCIONES[u.funcion] || '—'], ['Grado que atiende', u.grado || '—'], ['Fecha de alta', fmtDate(u.created_at)], ['Plan', u.plan ? planTxt(u) + ' · ' + money(precioDe(u)) : '—'], ...(u.nivel_siguiente ? [['Cambia en su renovación a', 'Plan ' + NIVEL_TXT[u.nivel_siguiente]]] : []), ['Prueba termina', fmtDate(u.trial_end)], [u.cancel_at_period_end ? 'Acceso hasta' : 'Siguiente cobro', fmtDate(u.sub_status === 'trialing' ? u.trial_end : u.current_period_end)], ['Cortesía hasta', fmtDate(u.courtesy_until)], ['Descargas', ndl]];
  return shell('Suscriptoras', `${title(esc(u.nombre || u.email), '', '<a class="btn btn-o" href="#/admin/suscriptoras">Volver a la lista</a>')}
<section class="card" style="padding:28px;gap:20px"><div class="row between"><h2 style="font-size:24px">Datos y plan</h2><span class="tag ${st.key === 'bloqueada' ? 'tag-r' : st.key === 'activa' ? 'tag-g' : 'tag-b'}">${st.label}</span></div>
<div class="grid"><ul class="list">${dat.map(([x, y]) => `<li><span>${x}</span><span style="font-weight:700">${esc(y)}</span></li>`).join('')}</ul>
<div class="stack" style="gap:8px"><h3>Historial de pagos</h3>${pagos.length ? `<ul class="list">${pagos.map(x => `<li><span>${esc(x.concepto)} · ${money(x.monto)}</span><span class="muted">${fmtDate(x.fecha)}</span></li>`).join('')}</ul>` : '<p class="muted">Sin pagos todavía.</p>'}
${cort.length ? `<h3 style="margin-top:12px">Cortesías</h3><ul class="list">${cort.map(c => `<li><span>${c.dias} días · ${esc(c.motivo || 'Sin motivo')}</span><span class="muted">${fmtDate(c.fecha)}</span></li>`).join('')}</ul>` : ''}</div></div></section>
<div class="grid" style="align-items:start">
<form class="card" style="gap:14px" data-form="cortesia" data-id="${u.id}" novalidate><h3>Dar días de cortesía</h3>
<p class="muted">${u.stripe_subscription_id && st.access ? 'Su siguiente cobro se recorrerá estos días.' : 'Le da acceso sin plan durante estos días.'}</p>
<div class="field"><label for="dc">Número de días</label><input id="dc" name="dias" class="inp" type="number" min="1" max="365" placeholder="Ej. 30" required></div>
<div class="field"><label for="mc">Motivo (solo lo ves tú)</label><input id="mc" name="motivo" class="inp" placeholder="Ej. Regalo por recomendar a una colega"></div>
<p class="err" data-err hidden></p><button class="btn btn-b" type="submit">Agregar días</button></form>
<form class="card" style="gap:14px" data-form="bloqueo" data-id="${u.id}" data-bloq="${u.blocked ? 1 : 0}"><h3>${u.blocked ? 'Cuenta bloqueada' : 'Bloquear cuenta'}</h3>
<p style="color:var(--tinta-suave)">${u.blocked ? 'Motivo: ' + esc(u.block_reason || '—') : 'Úsalo si detectas que la contraseña se comparte. La docente no podrá entrar hasta que la desbloquees. Su cobro en Stripe no se detiene; si quieres cancelarlo, hazlo desde tu panel de Stripe.'}</p>
${u.blocked ? '<button class="btn btn-b" type="submit">Desbloquear cuenta</button>' : '<div class="field"><label for="mb">Motivo (solo lo ves tú)</label><input id="mb" name="motivo" class="inp"></div><button class="btn btn-r" type="submit">Bloquear cuenta</button>'}</form></div>`, true);
}
async function pgAdminTextos() {
  if (!needAdmin()) return '';
  const s = S.settings;
  const avisos = must(await sb.from('avisos').select('*').order('fecha', { ascending: false }).limit(20)) || [];
  const hist = avisos.map(v => `<li><span style="font-weight:600">${esc(v.titulo)}</span><span class="row"><span class="muted">${esc(v.destino)} · ${fmtDate(v.fecha)}</span><button type="button" class="btn btn-r btn-sm" data-act="delAviso" data-id="${v.id}">Quitar</button></span></li>`).join('');
  const faq = (s.faq || []).map(([q, a], i) => `<div class="card" style="background:var(--marfil);gap:12px"><div class="field"><label for="q${i}">Pregunta ${i + 1}</label><input id="q${i}" name="q${i}" class="inp" value="${esc(q)}"></div><div class="field"><label for="a${i}">Respuesta</label><textarea id="a${i}" name="a${i}" class="inp">${esc(a)}</textarea></div><div class="row"><button type="button" class="btn btn-o btn-sm" data-act="faqMove" data-i="${i}" data-d="-1"${i === 0 ? ' disabled' : ''}>Subir</button><button type="button" class="btn btn-o btn-sm" data-act="faqMove" data-i="${i}" data-d="1"${i === s.faq.length - 1 ? ' disabled' : ''}>Bajar</button><button type="button" class="btn btn-r btn-sm" data-act="faqDel" data-i="${i}">Quitar</button></div></div>`).join('');
  return shell('Textos y avisos', `${title('Textos y avisos', 'Cambia la información de la página y comunícate con tu comunidad.')}
<form class="card" style="padding:28px;gap:18px" data-form="aviso" novalidate><div class="row">${ico('chat', '#234386', 24)}<h2 style="font-size:26px">Enviar un aviso</h2></div>
<div class="field"><label for="at">Título del aviso</label><input id="at" name="titulo" class="inp" placeholder="Ej. Ya están los recursos de diciembre" required></div>
<div class="field"><label for="am">Mensaje</label><textarea id="am" name="mensaje" class="inp" required></textarea></div>
<div class="field"><label for="ad">Enviar a</label><select id="ad" name="destino" class="inp">${opt(['Todas las suscriptoras', 'Solo en prueba', 'Solo plan Docente', 'Solo plan Autoridad Escolar', 'Solo plan mensual', 'Solo plan anual'])}</select></div>
<p class="muted">El aviso aparece en el panel de las docentes. El envío por correo se activará más adelante.</p>
<p class="err" data-err hidden></p><div class="row"><button class="btn btn-y" type="submit">Publicar aviso</button></div>
<h3 style="margin-top:8px">Avisos publicados</h3>${hist ? `<ul class="list">${hist}</ul>` : '<p class="muted">Aún no publicas avisos.</p>'}</form>
<form class="card" style="padding:28px;gap:18px" data-form="textos" novalidate><h2 style="font-size:26px">Textos de la página</h2>
<div class="field"><label for="mp">Mensaje principal de la portada</label><input id="mp" name="hero" class="inp" value="${esc(s.hero)}"></div>
<div class="grid-s">${[['docente', 'mensual', 'Docente mensual'], ['docente', 'anual', 'Docente anual'], ['autoridad', 'mensual', 'Autoridad Escolar mensual'], ['autoridad', 'anual', 'Autoridad Escolar anual']].map(([n, q, t]) => `<div class="field"><label for="p_${n}_${q}">Precio ${t} que se muestra (MXN)</label><input id="p_${n}_${q}" name="p_${n}_${q}" class="inp" type="number" min="1" step="0.01" value="${precios()[n][q]}"></div>`).join('')}</div>
<p class="notice b" style="padding:12px 16px">Importante: el cobro real lo define el precio que tienes en Stripe. Si cambias un precio aquí, crea también el precio nuevo en Stripe y actualiza su clave en Netlify.</p>
<h3>Contacto y redes</h3><div class="grid-s"><div class="field"><label for="wa">WhatsApp (10 dígitos)</label><input id="wa" name="whatsapp" class="inp" type="tel" value="${esc(s.whatsapp)}" placeholder="[TU WHATSAPP]"></div>
${Object.keys(s.redes || {}).map(k => `<div class="field"><label for="r${k}">${k}</label><input id="r${k}" name="red_${k}" class="inp" value="${esc(s.redes[k])}" placeholder="https://… enlace a tu perfil"></div>`).join('')}</div>
<h3>Preguntas frecuentes</h3>${faq}
<button type="button" class="btn btn-o" data-act="faqAdd" style="align-self:flex-start">Agregar pregunta</button>
<div class="row" style="border-top:1px solid var(--borde);padding-top:18px"><button class="btn btn-y" type="submit">Guardar cambios</button><span class="muted">Los cambios se ven en la página en cuanto guardas.</span></div></form>`, true);
}
const herrF = { campo: 'Todos', edit: null };
async function pgAdminHerr() {
  if (!needAdmin()) return '';
  const contenidos = must(await sb.from('contenidos').select('*').order('orden').order('created_at')) || [];
  const plantillas = must(await sb.from('plantillas').select('*').order('created_at')) || [];
  S.plantillas = plantillas;
  const list = herrF.campo === 'Todos' ? contenidos : contenidos.filter(c => c.campo === herrF.campo);
  const e = herrF.edit ? (contenidos.find(c => c.id === herrF.edit) || { id: 'nuevo', campo: CAMPOS[0], contenido: '', pda1: '', pda2: '', pda3: '' }) : null;
  const rows = list.map(c => `<tr><td>${esc(c.campo)}</td><td>${esc(c.contenido)}</td><td>${[c.pda1, c.pda2, c.pda3].filter(Boolean).length} de 3 grados</td><td><div class="row" style="gap:8px;flex-wrap:nowrap"><button class="btn btn-o btn-sm" data-act="editCont" data-id="${c.id}">Editar</button><button class="btn btn-r btn-sm" data-act="delCont" data-id="${c.id}">Quitar</button></div></td></tr>`).join('');
  const pl = plantillas.map(p => `<li><span><b>${esc(p.nombre)}</b> <span class="muted">· ${esc(p.tipo)} · ${p.criterios.split('\n').filter(Boolean).length} criterios</span></span><div class="row" style="gap:8px"><button class="btn btn-o btn-sm" data-act="editPlant" data-id="${p.id}">Editar</button><button class="btn btn-o btn-sm" data-act="dupPlant" data-id="${p.id}">Duplicar</button><button class="btn btn-r btn-sm" data-act="delPlant" data-id="${p.id}">Quitar</button></div></li>`).join('');
  return shell('Herramientas', `${title('Herramientas en línea', 'Edita las listas y plantillas que usarán las herramientas.')}
<section class="card" style="padding:28px;gap:18px"><div class="row between"><h2 style="font-size:26px">Contenidos y PDA del generador</h2><div class="row">${contenidos.length ? '' : '<button class="btn btn-b" data-act="importFase2">Cargar programa oficial Fase 2</button>'}<button class="btn btn-y" data-act="editCont" data-id="nuevo">Agregar contenido</button></div></div>${contenidos.length ? `<p class="muted">${contenidos.length} contenidos cargados.</p>` : '<p class="notice b" style="padding:12px 16px">Puedes cargar de una vez los 34 contenidos y sus PDA de 1°, 2° y 3° del Programa Sintético de la Fase 2.</p>'}
<div class="field" style="max-width:420px"><label for="hc">Campo formativo</label><select id="hc" class="inp" data-herrcampo>${opt(['Todos', ...CAMPOS], herrF.campo)}</select></div>
<div class="tbox"><table class="tbl"><thead><tr><th>Campo formativo</th><th>Contenido</th><th>PDA</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4">Aún no cargas contenidos. Agrega los del programa sintético de la Fase 2.</td></tr>'}</tbody></table></div></section>
${e ? `<form class="card" style="padding:28px;gap:18px" data-form="contenido" data-id="${e.id}" novalidate><h2 style="font-size:24px">${e.id === 'nuevo' ? 'Agregar contenido' : 'Editar contenido'}</h2>
<div class="field"><label for="ec">Campo formativo</label><select id="ec" name="campo" class="inp">${opt(CAMPOS, e.campo)}</select></div>
<div class="field"><label for="et">Contenido</label><textarea id="et" name="contenido" class="inp" placeholder="Texto del contenido tal como aparece en el programa" required>${esc(e.contenido)}</textarea></div>
<div class="grid">${[1, 2, 3].map(n => `<div class="field"><label for="p${n}">PDA de ${n}°</label><textarea id="p${n}" name="pda${n}" class="inp">${esc(e['pda' + n])}</textarea></div>`).join('')}</div>
<p class="err" data-err hidden></p><div class="row"><button type="button" class="btn btn-o" data-act="cancelCont">Cancelar</button><button class="btn btn-y" type="submit">Guardar</button></div></form>` : ''}
<section class="card" style="padding:28px;gap:18px"><div class="row between"><h2 style="font-size:24px">Plantillas de listas de cotejo y rúbricas</h2><button class="btn btn-b" data-act="editPlant" data-id="nuevo">Nueva plantilla</button></div>${pl ? `<ul class="list">${pl}</ul>` : '<p class="muted">Aún no hay plantillas.</p>'}</section>`, true);
}

/* ================= MODALES ================= */
function modal(html) { document.getElementById('modal-root').innerHTML = `<div class="back" data-act="closeModalBg"><div class="dlg" role="dialog" aria-modal="true">${html}</div></div>`; const f = document.querySelector('#modal-root input,#modal-root select,#modal-root textarea,#modal-root button'); if (f) f.focus(); }
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
function plantModal(id) {
  const p = id === 'nuevo' ? { id: 'nuevo', nombre: '', tipo: 'Lista de cotejo', criterios: '' } : (S.plantillas || []).find(x => x.id === id);
  if (!p) return;
  modal(`<h2 style="font-size:24px">${id === 'nuevo' ? 'Nueva plantilla' : 'Editar plantilla'}</h2>
<form class="stack" data-form="plantilla" data-id="${p.id}" novalidate>
<div class="field"><label for="pn">Nombre</label><input id="pn" name="nombre" class="inp" value="${esc(p.nombre)}" required></div>
<div class="field"><label for="pt">Tipo</label><select id="pt" name="tipo" class="inp">${opt(['Lista de cotejo', 'Rúbrica'], p.tipo)}</select></div>
<div class="field"><label for="pc">Criterios (uno por línea)</label><textarea id="pc" name="criterios" class="inp" style="min-height:160px">${esc(p.criterios)}</textarea></div>
<p class="err" data-err hidden></p><div class="row"><button type="button" class="btn btn-o" data-act="closeModal">Cancelar</button><button class="btn btn-y" type="submit">Guardar</button></div></form>`);
}
function forgotModal() {
  modal(`<h2 style="font-size:24px">Recuperar contraseña</h2><p>Escribe tu correo y te enviaremos un enlace para crear una contraseña nueva.</p>
<form class="stack" data-form="forgot" novalidate><div class="field"><label for="fm">Correo electrónico</label><input id="fm" name="email" class="inp" type="email" autocomplete="email" required></div>
<p class="err" data-err hidden></p><div class="row"><button type="button" class="btn btn-o" data-act="closeModal">Cancelar</button><button class="btn btn-b" type="submit">Enviar enlace</button></div></form>`);
}

/* ================= ACCIONES ================= */
async function doDownload(id) {
  const r = S.resources.find(x => x.id === id); if (!r) return;
  if (!r.file_path) return toast('Este recurso todavía no tiene archivo.');
  if (!canAcc(S.profile, r.acceso)) return go(S.profile ? '#/panel/suscripcion' : '#/registro');
  const { data, error } = await sb.storage.from('recursos').createSignedUrl(r.file_path, 120, { download: r.file_name || true });
  if (error || !data) return toast('No tienes acceso a este recurso o el archivo no está disponible.');
  if (!isAdmin(S.profile)) await sb.rpc('registrar_descarga', { rid: r.id });
  const a = document.createElement('a'); a.href = data.signedUrl; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  r.descargas++; toast('Descarga iniciada.');
}
function formData(f) { const o = {}; new FormData(f).forEach((v, k) => { o[k] = o[k] !== undefined ? [].concat(o[k], v) : v; }); return o; }
function showErr(f, msg) { const e = f.querySelector('[data-err]'); if (e) { e.textContent = msg; e.hidden = false; } toast(msg); }
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
function busy(f, on) { f.querySelectorAll('button').forEach(b => { b.disabled = on; }); }
function authMsg(err) {
  const m = (err && err.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'El correo o la contraseña no coinciden.';
  if (m.includes('email not confirmed')) return 'Primero confirma tu correo con el enlace que te enviamos.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Ya existe una cuenta con ese correo. Inicia sesión.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Demasiados intentos. Espera unos minutos.';
  if (m.includes('password')) return 'La contraseña no es válida. Usa al menos 8 caracteres.';
  return 'No se pudo completar. Intenta de nuevo.';
}
const back = () => location.origin + location.pathname;

async function onSubmit(ev) {
  const f = ev.target.closest('form[data-form]'); if (!f) return;
  ev.preventDefault();
  const d = formData(f), kind = f.dataset.form;
  busy(f, true);
  try {
    if (kind === 'registro') {
      const email = (d.email || '').trim().toLowerCase();
      if (!d.nombre || !d.nombre.trim()) return showErr(f, 'Escribe tu nombre.');
      if (!emailOk(email)) return showErr(f, 'Escribe un correo válido.');
      if ((d.pass || '').length < 8) return showErr(f, 'La contraseña debe tener al menos 8 caracteres.');
      if (!FUNCIONES[d.funcion]) return showErr(f, 'Elige tu función.');
      if (!d.acepto) return showErr(f, 'Debes aceptar el aviso de privacidad y los términos.');
      const { data, error } = await sb.auth.signUp({ email, password: d.pass, options: { data: { nombre: d.nombre.trim(), grado: d.grado || '', funcion: d.funcion }, emailRedirectTo: back() + '?next=confirmado' } });
      if (error) return showErr(f, authMsg(error));
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return showErr(f, 'Ya existe una cuenta con ese correo. Inicia sesión.');
      if (data.session) { await claimDevice(); await loadProfile(); return go('#/panel/suscripcion'); }
      go('#/revisa-tu-correo');
    } else if (kind === 'login') {
      const email = (d.email || '').trim().toLowerCase();
      const { error } = await sb.auth.signInWithPassword({ email, password: d.pass || '' });
      if (error) return showErr(f, authMsg(error));
      await claimDevice(); const p = await loadProfile();
      if (!p) return;
      go(isAdmin(p) ? '#/admin' : (subState(p).key === 'sinplan' ? '#/panel/suscripcion' : '#/panel'));
    } else if (kind === 'forgot') {
      const email = (d.email || '').trim().toLowerCase();
      if (!emailOk(email)) return showErr(f, 'Escribe un correo válido.');
      await sb.auth.resetPasswordForEmail(email, { redirectTo: back() + '?next=nueva' });
      closeModal(); toast('Si el correo está registrado, te llegará un enlace en unos minutos.');
    } else if (kind === 'nueva') {
      if ((d.pass || '').length < 8) return showErr(f, 'La contraseña debe tener al menos 8 caracteres.');
      const { error } = await sb.auth.updateUser({ password: d.pass });
      if (error) return showErr(f, authMsg(error));
      await claimDevice(); const p = await loadProfile(); toast('Contraseña actualizada.');
      go(p && isAdmin(p) ? '#/admin' : '#/panel');
    } else if (kind === 'recurso') {
      const estado = (ev.submitter && ev.submitter.dataset.estado) || 'borrador';
      const grados = [].concat(d.grados || []);
      if (!d.titulo || !d.titulo.trim()) return showErr(f, 'Escribe el nombre del recurso.');
      if (!grados.length) return showErr(f, 'Elige al menos un grado.');
      if (estado === 'programado' && !d.fecha_pub) return showErr(f, 'Elige la fecha de publicación para programarlo.');
      const id = f.dataset.id, old = id ? S.resources.find(x => x.id === id) : null;
      const file = f.querySelector('input[name=file]').files[0];
      const cover = f.querySelector('input[name=cover]').files[0];
      if (cover && !/^image\/(jpeg|png|webp)$/.test(cover.type)) return showErr(f, 'La portada debe ser JPG, PNG o WebP.');
      if (cover && cover.size > 15 * 1024 * 1024) return showErr(f, 'La imagen de portada pesa más de 15 MB.');
      if (file && file.size > 50 * 1024 * 1024) return showErr(f, 'El archivo pesa más de 50 MB.');
      if (estado !== 'borrador' && d.formato !== 'Herramienta en línea' && !file && !(old && old.file_path)) return showErr(f, 'Sube el archivo del recurso antes de publicarlo.');
      const row = { titulo: d.titulo.trim(), descripcion: (d.descripcion || '').trim(), categoria: d.categoria, campo: d.campo === 'No aplica' ? '' : d.campo, formato: d.formato, grados, acceso: ACCESO_TXT[d.acceso] ? d.acceso : 'suscripcion', nuevo_mes: !!d.nuevo_mes, estado, fecha_pub: d.fecha_pub || null };
      if (estado === 'publicado' && !(old && old.estado === 'publicado')) row.publicado_at = new Date().toISOString();
      if (estado === 'programado') row.publicado_at = new Date(d.fecha_pub + 'T06:00:00Z').toISOString();
      if (file) {
        toast('Subiendo archivo…');
        const clean = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '-');
        const path = crypto.randomUUID() + '/' + clean;
        must(await sb.storage.from('recursos').upload(path, file, { contentType: file.type || undefined }), 'No se pudo subir el archivo.');
        if (old && old.file_path) await sb.storage.from('recursos').remove([old.file_path]);
        row.file_path = path; row.file_name = file.name;
      }
      if (cover) {
        toast('Subiendo portada…');
        const blob = await prepararPortada(cover);
        const cpath = crypto.randomUUID() + '.' + (blob.type === 'image/webp' ? 'webp' : 'jpg');
        must(await sb.storage.from('portadas').upload(cpath, blob, { contentType: blob.type, cacheControl: '31536000' }), 'No se pudo subir la portada.');
        if (old && old.cover_path) await sb.storage.from('portadas').remove([old.cover_path]);
        row.cover_path = cpath;
      } else if (d.quitar_portada && old && old.cover_path) {
        await sb.storage.from('portadas').remove([old.cover_path]);
        row.cover_path = null;
      }
      if (old) must(await sb.from('resources').update(row).eq('id', old.id), 'No se pudo guardar el recurso.');
      else must(await sb.from('resources').insert(row), 'No se pudo guardar el recurso.');
      toast({ borrador: 'Guardado como borrador.', programado: 'Publicación programada.', publicado: 'Recurso publicado.' }[estado]); go('#/admin/recursos');
    } else if (kind === 'cortesia') {
      const dias = parseInt(d.dias, 10); if (!(dias > 0 && dias <= 365)) return showErr(f, 'Escribe un número de días entre 1 y 365.');
      await api('/api/admin/cortesia', { userId: f.dataset.id, dias, motivo: (d.motivo || '').trim() });
      toast(`Se agregaron ${dias} días.`); render();
    } else if (kind === 'bloqueo') {
      const bloquear = f.dataset.bloq !== '1';
      if (bloquear && !window.confirm('¿Bloquear esta cuenta? La docente no podrá entrar.')) return;
      must(await sb.rpc('admin_set_block', { uid: f.dataset.id, bloquear, motivo: (d.motivo || '').trim() }), 'No se pudo cambiar el bloqueo.');
      toast(bloquear ? 'Cuenta bloqueada.' : 'Cuenta desbloqueada.'); render();
    } else if (kind === 'aviso') {
      if (!d.titulo || !d.titulo.trim() || !d.mensaje || !d.mensaje.trim()) return showErr(f, 'Escribe el título y el mensaje del aviso.');
      must(await sb.from('avisos').insert({ titulo: d.titulo.trim(), mensaje: d.mensaje.trim(), destino: d.destino, panel: true, correo: false }), 'No se pudo publicar el aviso.');
      toast('Aviso publicado.'); render();
    } else if (kind === 'textos') {
      const s = JSON.parse(JSON.stringify(S.settings)), pr = {};
      for (const n of ['docente', 'autoridad']) { pr[n] = {}; for (const q of ['mensual', 'anual']) { const v = parseFloat(d[`p_${n}_${q}`]); if (!(v > 0)) return showErr(f, 'Los precios deben ser mayores que cero.'); pr[n][q] = v; } }
      s.hero = (d.hero || '').trim() || s.hero; s.precios = pr; delete s.precioMensual; delete s.precioAnual; s.whatsapp = (d.whatsapp || '').trim();
      Object.keys(s.redes || {}).forEach(k => { s.redes[k] = (d['red_' + k] || '').trim(); });
      s.faq = (s.faq || []).map((_, i) => [(d['q' + i] || '').trim(), (d['a' + i] || '').trim()]).filter(([q]) => q);
      await saveSettings(s); toast('Cambios guardados.'); render();
    } else if (kind === 'contenido') {
      if (!d.contenido || !d.contenido.trim()) return showErr(f, 'Escribe el contenido.');
      const row = { campo: d.campo, contenido: d.contenido.trim(), pda1: (d.pda1 || '').trim(), pda2: (d.pda2 || '').trim(), pda3: (d.pda3 || '').trim() };
      if (f.dataset.id === 'nuevo') must(await sb.from('contenidos').insert(row)); else must(await sb.from('contenidos').update(row).eq('id', f.dataset.id));
      herrF.edit = null; P.contenidos = null; toast('Contenido guardado.'); render();
    } else if (kind === 'plantilla') {
      if (!d.nombre || !d.nombre.trim()) return showErr(f, 'Escribe el nombre de la plantilla.');
      const row = { nombre: d.nombre.trim(), tipo: d.tipo, criterios: (d.criterios || '').trim() };
      if (f.dataset.id === 'nuevo') must(await sb.from('plantillas').insert(row)); else must(await sb.from('plantillas').update(row).eq('id', f.dataset.id));
      closeModal(); toast('Plantilla guardada.'); render();
    }
  } catch (e) { showErr(f, e.message || 'Ocurrió un error.'); }
  finally { if (document.body.contains(f)) busy(f, false); }
}
// Reduce la portada (máx. 900×1200) y la convierte a WebP para que cargue rápido.
async function prepararPortada(file) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 900 / bmp.width, 1200 / bmp.height);
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const webp = await new Promise(res => c.toBlob(res, 'image/webp', 0.85));
    if (webp && webp.type === 'image/webp') return webp;
    return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
  } catch (e) { return file; }
}
async function saveSettings(s) { must(await sb.from('settings').update({ data: s }).eq('id', 1), 'No se pudieron guardar los cambios.'); S.settings = s; }
async function onClick(ev) {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  try {
    if (act === 'closeModalBg') { if (ev.target === el) closeModal(); return; }
    if (act === 'closeModal') return closeModal();
    if (act.startsWith('pl')) return await planClick(el, act, id);
    if (act === 'reload') return location.reload();
    if (act === 'download') { closeModal(); return await doDownload(id); }
    if (act === 'verPortada') { const r = S.resources.find(x => x.id === id); if (!r) return; return modal(`<button type="button" class="btn btn-o btn-sm" data-act="closeModal" style="align-self:flex-end">Cerrar ✕</button><img src="${esc(coverUrl(r.cover_path))}" alt="Portada de ${esc(r.titulo)}" style="width:100%;max-height:70vh;object-fit:contain;background:#F3EBDD;border-radius:8px"><h2 style="font-size:32px">${esc(r.titulo)}</h2>${r.descripcion ? `<p style="color:var(--tinta-suave)">${esc(r.descripcion)}</p>` : ''}<div class="meta"><span>Grado: ${esc((r.grados || []).join(', '))}</span>${r.campo ? `<span>Campo: ${esc(r.campo)}</span>` : ''}<span>Formato: ${esc(r.formato)}</span></div><div class="row">${resAction(r)}</div>`); }
    if (act === 'logout') { await doSignOut('Sesión cerrada.'); return go('#/'); }
    if (act === 'forgot') return forgotModal();
    if (act === 'filter') { catF[el.dataset.k] = el.dataset.v; return render(); }
    if (act === 'fav') { const p = S.profile; if (!p) return; const favs = (p.favoritos || []).slice(); const i = favs.indexOf(id); i >= 0 ? favs.splice(i, 1) : favs.push(id); must(await sb.from('profiles').update({ favoritos: favs }).eq('id', p.id)); p.favoritos = favs; toast(i >= 0 ? 'Quitado de favoritos.' : 'Guardado en favoritos.'); return render(); }
    if (act === 'closeAviso') { const p = S.profile; const c = (p.avisos_cerrados || []).concat(id); must(await sb.from('profiles').update({ avisos_cerrados: c }).eq('id', p.id)); p.avisos_cerrados = c; return render(); }
    if (act === 'checkout' || act === 'portal') { el.disabled = true; toast('Abriendo la página segura de Stripe…'); try { const r = await api(act === 'checkout' ? '/api/checkout' : '/api/portal', { nivel: el.dataset.nivel, periodo: el.dataset.periodo }); location.href = r.url; } finally { el.disabled = false; } return; }
    if (act === 'cambiarPlan') { el.disabled = true; try { return avisoCambio(await api('/api/cambiar-plan', { nivel: el.dataset.nivel, vista: true })); } finally { el.disabled = false; } }
    if (act === 'confirmarCambio') { el.disabled = true; try { const r = await api('/api/cambiar-plan', { nivel: el.dataset.nivel, fechaProrrateo: el.dataset.fp ? +el.dataset.fp : undefined }); closeModal(); await loadProfile(); toast(r.tipo === 'bajar' ? 'Listo. El cambio se aplicará en tu siguiente renovación.' : r.tipo === 'conservar' ? 'Listo. Conservas tu plan actual.' : '¡Listo! Tu plan cambió.'); return render(); } finally { el.disabled = false; } }
    if (act === 'toggleHide') { const r = S.resources.find(x => x.id === id); const estado = r.estado === 'oculto' ? 'publicado' : 'oculto'; must(await sb.from('resources').update({ estado, ...(estado === 'publicado' && !r.publicado_at ? { publicado_at: new Date().toISOString() } : {}) }).eq('id', id)); return render(); }
    if (act === 'delRes') { const r = S.resources.find(x => x.id === id); if (!window.confirm('¿Eliminar "' + r.titulo + '"? No se puede deshacer.')) return; if (r.file_path) await sb.storage.from('recursos').remove([r.file_path]); if (r.cover_path) await sb.storage.from('portadas').remove([r.cover_path]); must(await sb.from('resources').delete().eq('id', id)); toast('Recurso eliminado.'); return go('#/admin/recursos'); }
    if (act === 'admEstado') { admF.estado = el.dataset.v; return render(); }
    if (act === 'subFil') { subF.f = el.dataset.v; return render(); }
    if (act === 'delAviso') { if (!window.confirm('¿Quitar este aviso?')) return; must(await sb.from('avisos').delete().eq('id', id)); return render(); }
    if (act === 'faqAdd') { const s = JSON.parse(JSON.stringify(S.settings)); s.faq = (s.faq || []).concat([['Nueva pregunta', '']]); await saveSettings(s); return render(); }
    if (act === 'faqDel') { const s = JSON.parse(JSON.stringify(S.settings)); s.faq.splice(+el.dataset.i, 1); await saveSettings(s); return render(); }
    if (act === 'faqMove') { const s = JSON.parse(JSON.stringify(S.settings)); const i = +el.dataset.i, j = i + +el.dataset.d; [s.faq[i], s.faq[j]] = [s.faq[j], s.faq[i]]; await saveSettings(s); return render(); }
    if (act === 'editCont') { herrF.edit = id; await render(); const f = document.querySelector('form[data-form=contenido]'); if (f) f.scrollIntoView({ behavior: 'smooth' }); return; }
    if (act === 'importFase2') { if (!window.confirm('¿Cargar los 34 contenidos y PDA del programa oficial de la Fase 2?')) return; el.disabled = true; const r = await fetch('/datos/fase2-contenidos.json'); const data = await r.json(); must(await sb.from('contenidos').insert(data.map((c, i) => ({ ...c, orden: i + 1 }))), 'No se pudieron cargar los contenidos.'); P.contenidos = null; toast('Contenidos cargados.'); return render(); }
    if (act === 'cancelCont') { herrF.edit = null; return render(); }
    if (act === 'delCont') { if (!window.confirm('¿Quitar este contenido?')) return; must(await sb.from('contenidos').delete().eq('id', id)); return render(); }
    if (act === 'editPlant') return plantModal(id);
    if (act === 'dupPlant') { const p = S.plantillas.find(x => x.id === id); must(await sb.from('plantillas').insert({ nombre: p.nombre + ' (copia)', tipo: p.tipo, criterios: p.criterios })); return render(); }
    if (act === 'delPlant') { if (!window.confirm('¿Quitar esta plantilla?')) return; must(await sb.from('plantillas').delete().eq('id', id)); return render(); }
  } catch (e) { el.disabled = false; toast(e.message || 'Ocurrió un error.'); }
}
let inputT;
function onInput(ev) {
  const t = ev.target;
  if (t.dataset.pf !== undefined || t.dataset.ps !== undefined) return planInput(t);
  if (t.dataset.filter) { catF[t.dataset.filter] = t.value; const box = document.getElementById('cat-res'); if (box) box.innerHTML = catResults(); return; }
  const refocus = idSel => { clearTimeout(inputT); inputT = setTimeout(async () => { await render(); const i = document.getElementById(idSel); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 350); };
  if (t.hasAttribute('data-admq')) { admF.q = t.value; return refocus('br'); }
  if (t.hasAttribute('data-subq')) { subF.q = t.value; return refocus('bs'); }
  if (t.hasAttribute('data-herrcampo')) { herrF.campo = t.value; return render(); }
}

/* ================= GENERADOR DE PLANEACIONES ================= */
const EJES = ['Inclusión', 'Pensamiento crítico', 'Interculturalidad crítica', 'Igualdad de género', 'Vida saludable', 'Apropiación de las culturas a través de la lectura y la escritura', 'Artes y experiencias estéticas'];
const METODOS = ['Aprendizaje basado en proyectos comunitarios', 'Aprendizaje basado en indagación (STEAM)', 'Aprendizaje basado en problemas (ABP)', 'Aprendizaje servicio (AS)', 'Otra'];
const METODO_CAMPO = { 'Lenguajes': METODOS[0], 'Saberes y pensamiento científico': METODOS[1], 'Ética, naturaleza y sociedades': METODOS[2], 'De lo humano y lo comunitario': METODOS[3] };
const ESCENARIOS = ['Aula', 'Escuela', 'Comunidad'];
const INSTRUMENTOS = ['Lista de cotejo', 'Rúbrica', 'Registro anecdótico', 'Diario de la educadora', 'Portafolio de evidencias', 'Escala estimativa', 'Guía de observación'];
const P = { plan: null, id: null, dirty: false, contenidos: null };

function planVacia() {
  return { titulo: '', jardin: '', cct: '', grado: '2°', grupo: '', educadora: (S.profile && S.profile.nombre) || '', inicio: '', fin: '', duracion: '', escenario: 'Aula', problematica: '', proposito: '',
    sel: {}, ejes: [], metodologia: '', metodoManual: false, sesiones: [{ titulo: 'Sesión 1', fecha: '', inicio: '', desarrollo: '', cierre: '', recursos: '' }],
    evaluacion: '', instrumentos: [], observaciones: '' };
}
async function loadContenidos() {
  if (!P.contenidos) P.contenidos = must(await sb.from('contenidos').select('*').order('orden').order('created_at')) || [];
  return P.contenidos;
}
const pdaLines = (c, g) => (c['pda' + ({ '1°': 1, '2°': 2, '3°': 3 }[g] || 2)] || '').split('\n').map(x => x.trim()).filter(Boolean);
function sugerirMetodo() {
  const p = P.plan; if (p.metodoManual) return;
  const first = P.contenidos.find(c => p.sel[c.id]);
  p.metodologia = first ? METODO_CAMPO[first.campo] || '' : '';
}
function needPlanAccess() {
  const p = needUser(); if (!p) return null;
  if (!hasAccess(p)) { go('#/panel/suscripcion'); toast('Necesitas una suscripción activa para usar el generador.'); return null; }
  return p;
}

async function pgPlaneaciones() {
  const p = needUser(); if (!p) return '';
  const list = must(await sb.from('planeaciones').select('id, titulo, datos, updated_at').order('updated_at', { ascending: false })) || [];
  const rows = list.map(x => `<li><span class="stack" style="gap:2px"><b>${esc(x.titulo || 'Planeación sin título')}</b><span class="muted">${esc([x.datos.grado, x.datos.grupo && 'Grupo ' + x.datos.grupo, x.datos.inicio && fmtDate(x.datos.inicio + 'T12:00:00')].filter(Boolean).join(' · '))} · Editada ${fmtDate(x.updated_at)}</span></span>
<span class="row" style="gap:8px"><a class="btn btn-o btn-sm" href="#/panel/planeacion/${x.id}">Editar</a><button class="btn btn-o btn-sm" data-act="plPdf" data-id="${x.id}">PDF</button><button class="btn btn-o btn-sm" data-act="plDup" data-id="${x.id}">Duplicar</button><button class="btn btn-r btn-sm" data-act="plDel" data-id="${x.id}">Eliminar</button></span></li>`).join('');
  return shell('Herramientas', `${title('Mis planeaciones', 'Arma, guarda y descarga tus planeaciones.', hasAccess(p) ? '<a class="btn btn-y" href="#/panel/planeacion/nueva">Nueva planeación</a>' : '<a class="btn btn-y" href="#/panel/suscripcion">Elegir plan</a>')}
${hasAccess(p) ? '' : subBanner(p)}
${list.length ? `<section class="card"><ul class="list">${rows}</ul></section>` : `<p class="empty">Todavía no tienes planeaciones. ${hasAccess(p) ? '<a href="#/panel/planeacion/nueva">Crea la primera</a>.' : ''}</p>`}`);
}

async function pgPlaneacion(id) {
  const p = needPlanAccess(); if (!p) return '';
  await loadContenidos();
  if (P.id !== id || !P.plan) {
    if (id === 'nueva') { P.plan = planVacia(); P.id = 'nueva'; }
    else {
      const row = (await sb.from('planeaciones').select('*').eq('id', id).single()).data;
      if (!row) return shell('Herramientas', '<p class="empty">No se encontró la planeación.</p>');
      P.plan = Object.assign(planVacia(), row.datos, { titulo: row.titulo }); P.id = id;
    }
    P.dirty = false;
  }
  return shell('Herramientas', planEditor());
}
function fld(key, label, type = 'text', extra = '') {
  const v = P.plan[key] || '';
  return `<div class="field"><label for="pf-${key}">${label}</label>${type === 'textarea' ? `<textarea id="pf-${key}" class="inp" data-pf="${key}" ${extra}>${esc(v)}</textarea>` : `<input id="pf-${key}" class="inp" type="${type}" data-pf="${key}" value="${esc(v)}" ${extra}>`}</div>`;
}
function planEditor() {
  const pl = P.plan, g = pl.grado;
  const porCampo = CAMPOS.map(campo => {
    const cs = P.contenidos.filter(c => c.campo === campo); if (!cs.length) return '';
    const nsel = cs.filter(c => pl.sel[c.id]).length;
    return `<details${nsel ? ' open' : ''} style="background:#fff;border:1px solid var(--linea);border-radius:8px;padding:14px 18px"><summary>${campo}${nsel ? ` <span class="tag tag-b" style="margin-left:6px">${nsel}</span>` : ''}</summary>
<div class="stack" style="gap:14px;margin-top:14px">${cs.map(c => {
      const on = !!pl.sel[c.id];
      const pdas = pdaLines(c, g);
      const chosen = on ? (pl.sel[c.id].pdas || pdas) : [];
      return `<div style="border-top:1px solid var(--linea);padding-top:12px"><label class="chk" style="align-items:flex-start"><input type="checkbox" data-act="plCont" data-id="${c.id}"${on ? ' checked' : ''}><span style="font-weight:700">${esc(c.contenido)}</span></label>
${on ? `<div class="stack" style="gap:6px;margin:6px 0 0 32px"><p class="lbl-t">PDA de ${g}</p>${pdas.map((t, i) => `<label class="chk" style="align-items:flex-start;min-height:36px"><input type="checkbox" data-act="plPda" data-id="${c.id}" data-i="${i}"${chosen.includes(t) ? ' checked' : ''}><span>${esc(t)}</span></label>`).join('') || '<p class="muted">Sin PDA para este grado.</p>'}</div>` : ''}</div>`;
    }).join('')}</div></details>`;
  }).join('') || '<p class="empty">Todavía no hay contenidos cargados. Pide al administrador que los cargue.</p>';
  const sesiones = pl.sesiones.map((s, i) => `<div class="card" style="gap:12px;box-shadow:none;border:1px solid var(--linea)">
<div class="row between"><h3>Sesión ${i + 1}</h3><div class="row" style="gap:6px"><button type="button" class="btn btn-o btn-sm" data-act="plSesMove" data-i="${i}" data-d="-1"${i === 0 ? ' disabled' : ''} aria-label="Subir sesión">↑</button><button type="button" class="btn btn-o btn-sm" data-act="plSesMove" data-i="${i}" data-d="1"${i === pl.sesiones.length - 1 ? ' disabled' : ''} aria-label="Bajar sesión">↓</button><button type="button" class="btn btn-r btn-sm" data-act="plSesDel" data-i="${i}"${pl.sesiones.length === 1 ? ' disabled' : ''}>Quitar</button></div></div>
<div class="grid-s"><div class="field"><label for="ps-t${i}">Nombre de la sesión</label><input id="ps-t${i}" class="inp" data-ps="${i}" data-k="titulo" value="${esc(s.titulo)}"></div><div class="field"><label for="ps-f${i}">Fecha</label><input id="ps-f${i}" class="inp" type="date" data-ps="${i}" data-k="fecha" value="${esc(s.fecha)}"></div></div>
${['inicio', 'desarrollo', 'cierre', 'recursos'].map(k => `<div class="field"><label for="ps-${k}${i}">${{ inicio: 'Inicio', desarrollo: 'Desarrollo', cierre: 'Cierre', recursos: 'Recursos y materiales' }[k]}</label><textarea id="ps-${k}${i}" class="inp" data-ps="${i}" data-k="${k}" style="min-height:${k === 'desarrollo' ? 140 : 90}px">${esc(s[k])}</textarea></div>`).join('')}</div>`).join('');
  const chk = (list, arr, act) => `<div class="stack" style="gap:2px">${list.map(x => `<label class="chk"><input type="checkbox" data-act="${act}" data-v="${esc(x)}"${arr.includes(x) ? ' checked' : ''}><span>${esc(x)}</span></label>`).join('')}</div>`;
  return `${title(P.id === 'nueva' ? 'Nueva planeación' : 'Editar planeación', 'Llena cada apartado; puedes guardar y seguir después.', '<a class="btn btn-o" href="#/panel/planeaciones">Mis planeaciones</a>')}
<div class="card" style="padding:28px;gap:18px"><h2>1. Datos generales</h2>${fld('titulo', 'Nombre del proyecto o planeación', 'text', 'maxlength="200" placeholder="Ej. Conozco mi comunidad"')}
<div class="grid-s">${fld('jardin', 'Jardín de Niños', 'text', 'maxlength="150"')}${fld('cct', 'CCT', 'text', 'maxlength="20"')}
<div class="field"><label for="pf-grado">Grado</label><select id="pf-grado" class="inp" data-pf="grado">${opt(GRADOS, g)}</select></div>${fld('grupo', 'Grupo', 'text', 'maxlength="20"')}</div>
<div class="grid-s">${fld('educadora', 'Educadora', 'text', 'maxlength="120"')}${fld('inicio', 'Fecha de inicio', 'date')}${fld('fin', 'Fecha de término', 'date')}${fld('duracion', 'Duración', 'text', 'maxlength="60" placeholder="Ej. 2 semanas"')}</div>
<div class="grid-s"><div class="field"><label for="pf-escenario">Escenario</label><select id="pf-escenario" class="inp" data-pf="escenario">${opt(ESCENARIOS, pl.escenario)}</select></div></div>
${fld('problematica', 'Problemática o situación del grupo', 'textarea')}${fld('proposito', 'Propósito', 'textarea')}</div>
<div class="card" style="padding:28px;gap:18px"><h2>2. Campos, contenidos y PDA</h2><p class="muted">Elige uno o varios contenidos de cualquier campo formativo. Los PDA se muestran según el grado (${g}); desmarca los que no vayas a trabajar.</p>${porCampo}</div>
<div class="card" style="padding:28px;gap:18px"><h2>3. Ejes articuladores y metodología</h2><p class="lbl-t">Ejes articuladores</p>${chk(EJES, pl.ejes, 'plEje')}
<div class="field"><label for="pf-metodologia">Metodología${pl.metodoManual ? '' : ' (sugerida según el campo)'}</label><select id="pf-metodologia" class="inp" data-pf="metodologia"><option value="">Selecciona una opción</option>${opt(METODOS, pl.metodologia)}</select></div></div>
<div class="card" style="padding:28px;gap:18px"><h2>4. Secuencia de actividades</h2>${sesiones}<button type="button" class="btn btn-o" data-act="plSesAdd" style="align-self:flex-start">+ Agregar sesión</button></div>
<div class="card" style="padding:28px;gap:18px"><h2>5. Evaluación</h2>${fld('evaluacion', '¿Qué y cómo vas a evaluar?', 'textarea')}<p class="lbl-t">Instrumentos</p>${chk(INSTRUMENTOS, pl.instrumentos, 'plInst')}${fld('observaciones', 'Observaciones', 'textarea')}</div>
<div class="row" style="position:sticky;bottom:12px;z-index:5;background:rgba(251,249,246,.95);padding:12px;border-radius:32px;box-shadow:var(--sombra-suave)"><button class="btn btn-y" data-act="plSave">Guardar</button><button class="btn btn-o" data-act="plSavePdf">Guardar y descargar PDF</button><span class="muted" id="pl-estado">${P.dirty ? 'Cambios sin guardar' : ''}</span></div>`;
}
function planMarkDirty() { P.dirty = true; const e = document.getElementById('pl-estado'); if (e) e.textContent = 'Cambios sin guardar'; }
function planInput(t) {
  const pl = P.plan; if (!pl) return;
  if (t.dataset.pf !== undefined) {
    const k = t.dataset.pf; pl[k] = t.value;
    if (k === 'metodologia') pl.metodoManual = true;
    if (k === 'grado') { Object.keys(pl.sel).forEach(id => { pl.sel[id].pdas = null; }); planMarkDirty(); return rerenderPlan(); }
  } else if (t.dataset.ps !== undefined) { pl.sesiones[+t.dataset.ps][t.dataset.k] = t.value; }
  planMarkDirty();
}
async function rerenderPlan() { const y = window.scrollY; await render(); window.scrollTo(0, y); }
function toggleIn(arr, v) { const i = arr.indexOf(v); i >= 0 ? arr.splice(i, 1) : arr.push(v); }
async function planClick(el, act, id) {
  const pl = P.plan;
  if (act === 'plCont') { if (pl.sel[id]) delete pl.sel[id]; else pl.sel[id] = { pdas: null }; sugerirMetodo(); planMarkDirty(); return rerenderPlan(); }
  if (act === 'plPda') { const c = P.contenidos.find(x => x.id === id), all = pdaLines(c, pl.grado), t = all[+el.dataset.i]; const cur = (pl.sel[id].pdas || all).slice(); toggleIn(cur, t); pl.sel[id].pdas = cur; return planMarkDirty(); }
  if (act === 'plEje') { toggleIn(pl.ejes, el.dataset.v); return planMarkDirty(); }
  if (act === 'plInst') { toggleIn(pl.instrumentos, el.dataset.v); return planMarkDirty(); }
  if (act === 'plSesAdd') { pl.sesiones.push({ titulo: 'Sesión ' + (pl.sesiones.length + 1), fecha: '', inicio: '', desarrollo: '', cierre: '', recursos: '' }); planMarkDirty(); return rerenderPlan(); }
  if (act === 'plSesDel') { if (!window.confirm('¿Quitar esta sesión?')) return; pl.sesiones.splice(+el.dataset.i, 1); planMarkDirty(); return rerenderPlan(); }
  if (act === 'plSesMove') { const i = +el.dataset.i, j = i + +el.dataset.d; [pl.sesiones[i], pl.sesiones[j]] = [pl.sesiones[j], pl.sesiones[i]]; planMarkDirty(); return rerenderPlan(); }
  if (act === 'plSave' || act === 'plSavePdf') { el.disabled = true; try { await planGuardar(); if (act === 'plSavePdf') await planPdf(P.plan); } finally { el.disabled = false; } return; }
  if (act === 'plPdf') { const row = (await sb.from('planeaciones').select('*').eq('id', id).single()).data; if (row) { await loadContenidos(); await planPdf(Object.assign(planVacia(), row.datos, { titulo: row.titulo })); } return; }
  if (act === 'plDup') { if (!hasAccess(S.profile)) return go('#/panel/suscripcion'); const row = (await sb.from('planeaciones').select('*').eq('id', id).single()).data; must(await sb.from('planeaciones').insert({ titulo: (row.titulo + ' (copia)').slice(0, 200), datos: row.datos }), 'No se pudo duplicar.'); toast('Planeación duplicada.'); return render(); }
  if (act === 'plDel') { if (!window.confirm('¿Eliminar esta planeación? No se puede deshacer.')) return; must(await sb.from('planeaciones').delete().eq('id', id), 'No se pudo eliminar.'); toast('Planeación eliminada.'); return render(); }
}
async function planGuardar() {
  const pl = P.plan, titulo = (pl.titulo || '').trim().slice(0, 200) || 'Planeación sin título';
  const datos = JSON.parse(JSON.stringify(pl)); delete datos.titulo;
  if (P.id === 'nueva') {
    const r = must(await sb.from('planeaciones').insert({ titulo, datos }).select('id').single(), 'No se pudo guardar. Revisa que tu suscripción esté activa.');
    P.id = r.id; history.replaceState(null, '', location.pathname + '#/panel/planeacion/' + r.id); lastPath = '/panel/planeacion/' + r.id;
  } else must(await sb.from('planeaciones').update({ titulo, datos, updated_at: new Date().toISOString() }).eq('id', P.id), 'No se pudo guardar.');
  P.dirty = false; const e = document.getElementById('pl-estado'); if (e) e.textContent = 'Guardado ✓'; toast('Planeación guardada.');
}
function cargarScript(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el generador de PDF.')); document.head.appendChild(s); }); }
async function planPdf(pl) {
  toast('Preparando PDF…');
  await cargarScript('/jspdf.min.js');
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48, CW = W - M * 2; let y = M;
  const IND = [35, 67, 134], NAR = [180, 81, 15], TXT = [30, 37, 48];
  const clean = s => String(s || '').replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—‘’“”•…]/g, '');
  const need = h => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const text = (s, { size = 10, bold = false, color = TXT, indent = 0, gap = 4 } = {}) => {
    s = clean(s); if (!s.trim()) return;
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
    for (const par of s.split('\n')) { const lines = doc.splitTextToSize(par, CW - indent); for (const l of lines) { need(size * 1.35); doc.text(l, M + indent, y + size); y += size * 1.35; } }
    y += gap;
  };
  const h2 = s => { y += 8; need(28); doc.setFillColor(...IND); doc.rect(M, y, CW, 22, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255, 255, 255); doc.text(clean(s).toUpperCase(), M + 10, y + 15); y += 30; };
  const kv = (k, v) => { if (!v) return; text(k + ': ' + v, { size: 10 }); };
  // Encabezado
  doc.setFillColor(251, 249, 246); doc.rect(0, 0, W, 86, 'F');
  doc.setDrawColor(...IND); doc.setLineWidth(3); doc.line(M, 52, M + 20, 36); doc.line(M + 20, 36, M + 40, 52);
  doc.setFillColor(127, 167, 122); doc.circle(M + 11, 58, 4, 'F'); doc.circle(M + 29, 58, 4, 'F'); doc.setFillColor(255, 196, 0); doc.circle(M + 20, 55, 4.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...IND); doc.text('COMUNIDAD DE APRENDIZAJE PREESCOLAR', M + 52, 44);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...NAR); doc.text('Planeación didáctica · Fase 2', M + 52, 58);
  y = 108; text(pl.titulo || 'Planeación sin título', { size: 18, bold: true, color: IND, gap: 8 });
  h2('1. Datos generales');
  kv('Jardín de Niños', pl.jardin); kv('CCT', pl.cct); kv('Grado y grupo', [pl.grado, pl.grupo].filter(Boolean).join(' ')); kv('Educadora', pl.educadora);
  kv('Periodo', [pl.inicio && fmtDate(pl.inicio + 'T12:00:00'), pl.fin && fmtDate(pl.fin + 'T12:00:00')].filter(Boolean).join(' al ')); kv('Duración', pl.duracion); kv('Escenario', pl.escenario);
  if (pl.problematica) { text('Problemática o situación del grupo', { bold: true, color: IND, gap: 2 }); text(pl.problematica); }
  if (pl.proposito) { text('Propósito', { bold: true, color: IND, gap: 2 }); text(pl.proposito); }
  h2('2. Campos formativos, contenidos y PDA');
  const sel = P.contenidos.filter(c => pl.sel[c.id]);
  if (!sel.length) text('Sin contenidos seleccionados.', { color: [74, 86, 97] });
  CAMPOS.forEach(campo => { const cs = sel.filter(c => c.campo === campo); if (!cs.length) return; text(campo, { size: 11, bold: true, color: NAR, gap: 2 });
    cs.forEach(c => { text('Contenido: ' + c.contenido, { bold: true, gap: 2 }); const pd = pl.sel[c.id].pdas || pdaLines(c, pl.grado); text('PDA (' + pl.grado + '):', { size: 9.5, bold: true, color: IND, gap: 1 }); pd.forEach(t => text('•  ' + t, { size: 9.5, indent: 10, gap: 1 })); y += 6; }); });
  h2('3. Ejes articuladores y metodología');
  kv('Ejes articuladores', pl.ejes.join(', ') || '—'); kv('Metodología', pl.metodologia || '—');
  h2('4. Secuencia de actividades');
  pl.sesiones.forEach((s, i) => { need(60); text(`Sesión ${i + 1}${s.titulo && s.titulo !== 'Sesión ' + (i + 1) ? ': ' + s.titulo : ''}${s.fecha ? ' · ' + fmtDate(s.fecha + 'T12:00:00') : ''}`, { size: 11, bold: true, color: IND, gap: 2 });
    [['Inicio', s.inicio], ['Desarrollo', s.desarrollo], ['Cierre', s.cierre], ['Recursos y materiales', s.recursos]].forEach(([k, v]) => { if (v) { text(k, { bold: true, gap: 1 }); text(v, { indent: 10 }); } }); y += 4; });
  h2('5. Evaluación');
  if (pl.evaluacion) text(pl.evaluacion); kv('Instrumentos', pl.instrumentos.join(', ')); if (pl.observaciones) { text('Observaciones', { bold: true, gap: 1 }); text(pl.observaciones); }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(74, 86, 97); doc.text('Comunidad de Aprendizaje Preescolar · Construimos juntos la escuela que soñamos.', M, H - 24); doc.text(`${i} / ${n}`, W - M, H - 24, { align: 'right' }); }
  const name = (clean(pl.titulo) || 'planeacion').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'planeacion';
  doc.save(name + '.pdf');
}

/* ================= RUTAS ================= */
function parse() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?'); const params = {};
  (qs || '').split('&').filter(Boolean).forEach(p => { const [k, v] = p.split('='); params[k] = decodeURIComponent(v || ''); });
  return { path, params };
}
let lastPath = '', renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  let { path, params } = parse(), anchor = null;
  if (path.startsWith('/#')) { anchor = path.slice(2); path = '/'; }
  const seg = path.split('/').filter(Boolean);
  let html;
  try {
    await Promise.all([loadSettings(), loadProfile()]);
    if (!seg.length) html = await pgInicio();
    else if (seg[0] === 'catalogo') html = await pgCatalogo(params);
    else if (seg[0] === 'acceso') html = pgAcceso('login');
    else if (seg[0] === 'registro') html = pgAcceso('registro');
    else if (seg[0] === 'revisa-tu-correo') html = pgRevisaCorreo();
    else if (seg[0] === 'nueva-contrasena') html = pgNuevaContrasena();
    else if (seg[0] === 'panel') html = await ({ favoritos: pgFavoritos, descargas: pgDescargas, herramientas: pgHerramientas, suscripcion: pgSuscripcion, planeaciones: pgPlaneaciones, planeacion: () => pgPlaneacion(seg[2] || 'nueva') }[seg[1]] || pgPanel)(params);
    else if (seg[0] === 'admin') html = await ({ recursos: pgAdminRecursos, recurso: () => pgAdminRecurso(seg[2]), suscriptoras: pgAdminSubs, suscriptora: () => pgAdminSub(seg[2]), textos: pgAdminTextos, herramientas: pgAdminHerr }[seg[1]] || pgAdmin)();
    else html = await pgInicio();
  } catch (e) {
    console.error(e);
    html = `<main class="wrap" style="padding:64px 24px"><div class="card stack"><h1 style="font-size:28px">Algo salió mal</h1><p>${esc(e.message || 'No se pudo cargar la página.')}</p><button class="btn btn-b" data-act="reload" style="align-self:flex-start">Intentar de nuevo</button></div></main>`;
  }
  if (seq !== renderSeq || html === '') return;
  document.getElementById('app').innerHTML = html;
  const titles = { catalogo: 'Catálogo', acceso: 'Iniciar sesión', registro: 'Crear cuenta', panel: 'Mi panel', admin: 'Administrador' };
  document.title = (seg[0] && titles[seg[0]] ? titles[seg[0]] + ' · ' : '') + 'Comunidad de Aprendizaje Preescolar';
  if (anchor) { const el = document.getElementById(anchor); if (el) setTimeout(() => el.scrollIntoView(), 0); }
  else if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
}

async function start() {
  try { await initClient(); }
  catch (e) { document.getElementById('app').innerHTML = `<main style="padding:64px 24px;font-family:sans-serif;max-width:640px;margin:auto"><h1>La página aún no está configurada</h1><p>${esc(e.message)}</p></main>`; return; }
  // Regreso desde los correos de Supabase (confirmar cuenta o recuperar contraseña).
  const qs = new URLSearchParams(location.search), next = qs.get('next');
  const hadCode = qs.has('code'), urlError = qs.get('error_description');
  sb.auth.onAuthStateChange(evt => { if (evt === 'PASSWORD_RECOVERY') setTimeout(async () => { await claimDevice(); history.replaceState(null, '', location.pathname + '#/nueva-contrasena'); render(); }, 0); });
  const { data } = await sb.auth.getSession();
  if (next === 'nueva' && data.session) await claimDevice();
  if (next || hadCode || urlError) {
    let target = '#/';
    if (urlError) { toast('El enlace ya no es válido o expiró. Pide uno nuevo.'); target = '#/acceso'; }
    else if (next === 'nueva') target = '#/nueva-contrasena';
    else if (next === 'confirmado') {
      if (data.session) { await claimDevice(); toast('¡Correo confirmado! Ahora elige tu plan.'); target = '#/panel/suscripcion'; }
      else { toast('Correo confirmado. Ya puedes iniciar sesión.'); target = '#/acceso'; }
    }
    history.replaceState(null, '', location.pathname + target);
    if (next === 'confirmado' && data.session) { const p = (await sb.from('profiles').select('role').eq('id', data.session.user.id).single()).data; if (p && p.role === 'admin') history.replaceState(null, '', location.pathname + '#/admin'); }
  }
  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('input', onInput);
  document.addEventListener('change', e => { if (e.target.matches('select[data-filter],[data-herrcampo]')) onInput(e); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.querySelector('#modal-root .back')) closeModal(); });
  window.addEventListener('hashchange', () => { closeModal(); render(); });
  render();
}
start();
})();

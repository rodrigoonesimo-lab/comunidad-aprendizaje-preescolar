/* Comunidad de Aprendizaje Preescolar — Herramienta "Contenidos y PDA Fase 2"
   Guía de observación por grado con indicadores, registro, valoración y evidencias fotográficas.
   Los registros se guardan en la cuenta (tabla guias_pda) y las fotos en el almacenamiento privado "evidencias".
   Elaborado por: M. en E. N. y A. Rodrigo Onesimo Pérez Rios */
(function () {
'use strict';

const NOMBRE = 'Contenidos y PDA Fase 2';
const AUTOR = 'Comunidad de Aprendizaje Preescolar';
const MARCA = 'Comunidad de Aprendizaje Preescolar';
const CAMPOS = { L: 'Lenguajes', S: 'Saberes y Pensamiento Científico', E: 'Ética, Naturaleza y Sociedades', H: 'De lo Humano y lo Comunitario' };
const CORTO = { L: 'Lenguajes', S: 'Saberes y P. C.', E: 'Ética, N. y S.', H: 'De lo Humano y lo C.' };
const VAL = { 1: 'Requiere apoyo', 2: 'En proceso', 3: 'Logrado' };
const MESES = ['Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio'];
const RGB = { L: [180, 81, 15], S: [35, 67, 134], E: [63, 107, 59], H: [122, 90, 46] };
const TINT = { L: [253, 235, 221], S: [228, 234, 245], E: [227, 241, 228], H: [243, 235, 221] };
const VRGB = { 1: [163, 58, 43], 2: [138, 99, 0], 3: [63, 107, 59] };
const IND = [35, 67, 134], MIEL = [255, 196, 0], NAR = [180, 81, 15], TXT = [30, 37, 48], MUT = [74, 86, 97], LIN = [214, 208, 196], PAPEL = [251, 249, 246];
const MAXF = 3, BUCKET = 'evidencias';

let DATA = null, rows = [];
let C = null; // contexto: sb, uid, toast
let G = null; // guía abierta { id, h, d, g }
let root = null, f = null, abiertos = {}, urls = {}, fotoId = null;
let dirty = false, saving = null, saveT = null;

/* ---------- Utilidades ---------- */
const $ = s => root.querySelector(s);
const $$ = s => Array.from(root.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const D = id => G.d[id] || (G.d[id] = {});
const gd = (id, k) => { const d = G.d[id]; return d ? d[k] : undefined; };
const nf = id => ((G.d[id] || {}).f || []).length;
const hoy = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const toast = m => C.toast(m);
function cicloActual() { const d = new Date(), y = d.getFullYear(); return d.getMonth() >= 7 ? y + '-' + (y + 1) : (y - 1) + '-' + y; }
function cargarScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res;
    s.onerror = () => { s.remove(); rej(new Error('No se pudo cargar la herramienta de exportación. Revisa tu conexión a internet.')); };
    document.head.appendChild(s);
  });
}
async function cargarDatos() {
  if (DATA) return;
  const r = await fetch('/datos/pda-indicadores.json');
  if (!r.ok) throw new Error('No se pudieron cargar los contenidos y PDA.');
  DATA = await r.json();
  rows = DATA.map((r, i) => ({ id: i, g: r[0], c: r[1], ci: r[2], cont: r[3], pda: r[4], ind: r[5], hay: norm(r[3] + ' ' + r[4] + ' ' + r[5].join(' ')) }));
}
function tituloDe(h, g) {
  const t = [(h.grado || g || 1) + '° grado', h.grupo && 'Grupo ' + h.grupo.trim(), h.ciclo && h.ciclo.trim(), h.jardin && h.jardin.trim()].filter(Boolean).join(' · ');
  return t.slice(0, 200) || 'Guía sin título';
}
function descargar(nombre, blob) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = nombre; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 60000);
  toast('Descargando: ' + nombre);
}
function blobADataURL(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }); }
function dims(src) { return new Promise(res => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ w: 4, h: 3 }); i.src = src; }); }
function comprimir(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const M = 1280, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, M / Math.max(w, h));
      const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob(b => b ? res(b) : rej(new Error('formato')), 'image/jpeg', 0.78);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('formato')); };
    img.src = url;
  });
}

/* ---------- Capas (diálogos) ---------- */
function capa(html) { const c = $('.gp-capa'); c.innerHTML = html; c.hidden = false; document.body.style.overflow = 'hidden'; return c; }
function cerrarCapa() { const c = $('.gp-capa'); if (!c) return; c.hidden = true; c.innerHTML = ''; c.onclick = null; document.body.style.overflow = ''; }
function cargando(msg) { capa(`<div class="gp-cargando"><div class="gp-spin"></div><div>${esc(msg)}</div></div>`); }
function confirmar(titulo, texto, btn) {
  return new Promise(res => {
    const c = capa(`<div class="gp-dialogo" role="dialog" aria-modal="true"><h3>${esc(titulo)}</h3><p>${esc(texto)}</p><div class="row" style="justify-content:flex-end"><button class="btn btn-o btn-sm" type="button" data-r="0">Cancelar</button><button class="btn btn-b btn-sm" type="button" data-r="1">${esc(btn)}</button></div></div>`);
    c.querySelector('[data-r="1"]').focus();
    c.onclick = e => { const b = e.target.closest('[data-r]'); if (b) { cerrarCapa(); res(b.dataset.r === '1'); } else if (e.target === c) { cerrarCapa(); res(false); } };
  });
}
function onKey(e) { if (e.key === 'Escape' && root && !$('.gp-capa').hidden && !$('.gp-spin')) { const b = $('.gp-capa [data-r="0"]'); if (b) b.click(); else cerrarCapa(); } }

/* ---------- Guardado en la cuenta ---------- */
function estadoGuardado(t) { const e = root && $('#gp-guardado'); if (e) e.textContent = t; }
function save() { dirty = true; estadoGuardado('Guardando…'); clearTimeout(saveT); saveT = setTimeout(flush, 1200); }
async function flush() {
  clearTimeout(saveT);
  if (!G || !dirty) return;
  if (saving) { await saving; return flush(); }
  dirty = false;
  const id = G.id, titulo = tituloDe(G.h, G.g), datos = { h: G.h, d: G.d, g: G.g };
  saving = (async () => await C.sb.from('guias_pda').update({ titulo, datos, updated_at: new Date().toISOString() }).eq('id', id))();
  const r = await saving; saving = null;
  if (r.error) { console.error(r.error); dirty = true; estadoGuardado('Sin guardar'); toast('No se pudo guardar. Revisa tu conexión o que tu suscripción esté activa.'); }
  else if (!dirty) estadoGuardado('Guardado ✓');
}
function onUnload(e) { if (dirty || saving) { flush(); e.preventDefault(); e.returnValue = ''; } }

/* ---------- Fotografías ---------- */
async function urlsDe(paths) {
  const falta = paths.filter(p => !urls[p]);
  if (falta.length) {
    const { data, error } = await C.sb.storage.from(BUCKET).createSignedUrls(falta, 3600);
    if (!error && data) data.forEach(x => { if (x.signedUrl) urls[x.path] = x.signedUrl; });
  }
  return paths.map(p => urls[p] || '');
}
async function fotosComoDataURL(paths) {
  const out = [];
  for (const p of paths) {
    const { data, error } = await C.sb.storage.from(BUCKET).download(p);
    if (!error && data) out.push(await blobADataURL(data));
  }
  return out;
}

/* ---------- Estructura ---------- */
const ICAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
const IGAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
function plantilla() {
  const h = G.h;
  const inp = (k, lbl, ph) => `<div class="gp-campo"><label for="gp_${k}">${lbl}</label><input id="gp_${k}" data-h="${k}" value="${esc(h[k] || '')}" placeholder="${ph}" autocomplete="off" maxlength="160"></div>`;
  return `<div class="gp">
<section class="gp-ficha" aria-label="Datos generales">
  <div class="gp-ficha-top"><div><p class="eyebrow" style="color:var(--miel)">Programa sintético · Educación preescolar</p><p class="gp-h1">${NOMBRE}</p></div>
  <p class="gp-meta">Guía de observación con indicadores, registro y evidencias · <span id="gp-guardado">Guardado ✓</span></p></div>
  <div class="gp-campos">
    ${inp('jardin', 'Nombre del Jardín de Niños', 'Ej. Jardín de Niños “Benito Juárez”')}
    ${inp('docente', 'Nombre del docente', 'Nombre completo')}
    <div class="gp-campo"><label for="gp_grado">Grado</label><select id="gp_grado">${[1, 2, 3].map(g => `<option value="${g}"${G.g === g ? ' selected' : ''}>${g}°</option>`).join('')}</select></div>
    ${inp('grupo', 'Grupo', 'Ej. A')}
    ${inp('ciclo', 'Ciclo escolar', cicloActual())}
  </div>
</section>
<div class="gp-tabs" role="tablist" aria-label="Grado">
  ${[1, 2, 3].map(g => `<button class="gp-tab" role="tab" data-g="${g}" id="gp-tab${g}" aria-selected="false">${g}° grado<span class="n"></span></button>`).join('')}
  <button class="gp-tab" role="tab" data-g="0" id="gp-tab0" aria-selected="false">Cómo usar</button>
</div>
<section class="gp-panel" id="gp-guia">
  <div class="gp-archivo">
    <span class="gp-lbl">Descargar</span>
    <button class="btn btn-b btn-sm" type="button" id="gp-pdf">Exportar PDF</button>
    <button class="btn btn-o btn-sm" type="button" id="gp-xls">Exportar Excel</button>
    <span class="gp-nota" id="gp-nota"></span>
  </div>
  <div class="gp-resumen" id="gp-resumen"></div>
  <div class="gp-filtros">
    <label class="gp-grp"><span>Buscar</span><input type="search" id="gp-q" placeholder="Palabra en contenido, PDA o indicador" enterkeyhint="search"></label>
    <label class="gp-grp"><span>Contenido</span><select id="gp-cont"></select></label>
    <label class="gp-grp"><span>Mes</span><select id="gp-mes"><option value="">Todos</option><option value="-">Sin mes</option>${MESES.map(m => `<option>${m}</option>`).join('')}</select></label>
    <div class="gp-grp"><span>Mostrar</span><div class="gp-seg" id="gp-vista"><button type="button" data-v="todos" aria-pressed="true">Todos</button><button type="button" data-v="sel" aria-pressed="false">Trabajados</button><button type="button" data-v="pend" aria-pressed="false">Sin valorar</button></div></div>
    <div class="gp-grp"><span>Valoración</span><div class="gp-seg" id="gp-val"><button type="button" data-v="0" aria-pressed="true">Todas</button>${[1, 2, 3].map(n => `<button type="button" data-v="${n}" aria-pressed="false">${VAL[n]}</button>`).join('')}</div></div>
    <div class="gp-fin"><button class="btn btn-o btn-sm" type="button" id="gp-selvis">Marcar visibles como trabajados</button><button class="btn btn-o btn-sm" type="button" id="gp-limpiar">Quitar filtros</button></div>
  </div>
  <div class="gp-estado" id="gp-estado"></div>
  <div class="gp-tbl"><table><thead><tr><th>Campo formativo</th><th>Contenido</th><th>PDA</th><th>Indicadores: ¿qué observar?</th><th>Mes en el que se trabajó</th><th>Situación o proyecto en el que se abordó el contenido</th><th>Valoración y evidencias</th><th>Trabajado</th></tr></thead><tbody id="gp-tb"></tbody></table></div>
  <p class="empty" id="gp-vacio" hidden>No hay PDA que coincidan con estos filtros. Prueba con otra palabra o pulsa “Quitar filtros”.</p>
</section>
<section class="gp-panel" id="gp-uso" hidden><div class="gp-usos">
  <div><h3>Registro</h3><ol><li>Llena los datos del Jardín de Niños, docente, grado, grupo y ciclo escolar.</li><li>Filtra por campo formativo (tarjetas de colores), contenido, mes o con el buscador.</li><li>En cada PDA elige el mes en que se trabajó y escribe la situación o proyecto.</li><li>Registra la valoración: Requiere apoyo, En proceso o Logrado.</li><li>Marca la casilla “Trabajado” en los PDA que ya abordaste y usa el filtro “Trabajados” para ver solo esos.</li></ol></div>
  <div><h3>Evidencias</h3><ol><li>Pulsa “Agregar evidencias” en el PDA.</li><li>Escribe lo que la niña o el niño dijo, hizo o produjo.</li><li>Agrega hasta 3 fotografías con “Tomar foto” o “Galería”. Toca una foto para verla en grande o la ✕ para borrarla.</li></ol></div>
  <div><h3>Exportar</h3><ol><li>“Exportar PDF” y “Exportar Excel” generan un archivo tamaño carta (horizontal) con lo que ves en pantalla: aplica antes los filtros que quieras.</li><li>Las fotografías se incluyen en un anexo de evidencias al final del archivo.</li></ol></div>
  <div><h3>Guardado</h3><p>Todo se guarda solo en tu cuenta mientras escribes. Puedes abrir esta guía desde tu celular o tu computadora al iniciar sesión. Crea una guía por cada grupo o ciclo escolar desde “Mis guías”.</p></div>
  <div><h3>Campos formativos</h3><div class="gp-leyenda">${Object.keys(CAMPOS).map(c => `<span><i style="background:var(--gp-${c})"></i>${CAMPOS[c]}</span>`).join('')}</div>
  <p style="margin-top:12px">Contenidos y PDA del Programa Sintético Fase 2. Los indicadores son preguntas de observación propuestas; ajústalos a tu contexto.</p></div>
</div></section>
<input type="file" id="gp-cam" class="gp-oculto" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true">
<input type="file" id="gp-gal" class="gp-oculto" accept="image/*" multiple tabindex="-1" aria-hidden="true">
<div class="gp-capa" hidden></div>
</div>`;
}

/* ---------- Pestañas y filtros ---------- */
function filtrosIniciales() { return { campos: { L: 1, S: 1, E: 1, H: 1 }, q: '', cont: '', mes: '', vista: 'todos', val: '0' }; }
const ncampos = () => Object.keys(f.campos).length;
let tab = 1;
function setTab(g) {
  tab = g;
  $$('.gp-tab').forEach(t => t.setAttribute('aria-selected', String(+t.dataset.g === g)));
  $('#gp-guia').hidden = g === 0; $('#gp-uso').hidden = g !== 0;
  if (g) {
    if (G.g !== g) { G.g = g; G.h.grado = g; save(); }
    $('#gp_grado').value = String(g); f.cont = ''; abiertos = {}; llenarContenidos(); pintar();
  }
}
function contarTabs() { [1, 2, 3].forEach(g => { const n = rows.filter(r => r.g === g && gd(r.id, 'sel')).length; $('#gp-tab' + g + ' .n').textContent = n ? n + ' trab.' : ''; }); }
function llenarContenidos() {
  const s = $('#gp-cont'), seen = {}, orden = [];
  rows.forEach(r => { if (r.g !== G.g || !f.campos[r.c]) return; const k = r.c + '|' + r.ci; if (!seen[k]) { seen[k] = r; orden.push(k); } });
  let h = '<option value="">Todos los contenidos</option>', last = '';
  orden.forEach(k => {
    const r = seen[k];
    if (r.c !== last) { if (last) h += '</optgroup>'; h += `<optgroup label="${esc(CAMPOS[r.c])}">`; last = r.c; }
    const t = r.cont.length > 80 ? r.cont.slice(0, 78) + '…' : r.cont;
    h += `<option value="${k}">${r.ci}. ${esc(t)}</option>`;
  });
  if (last) h += '</optgroup>';
  s.innerHTML = h; if (f.cont && seen[f.cont]) s.value = f.cont; else { f.cont = ''; s.value = ''; }
}
function visibles() {
  const terms = norm(f.q).split(/\s+/).filter(Boolean);
  return rows.filter(r => {
    if (r.g !== G.g || !f.campos[r.c]) return false;
    if (f.cont && f.cont !== r.c + '|' + r.ci) return false;
    const d = G.d[r.id] || {};
    if (f.vista === 'sel' && !d.sel) return false;
    if (f.vista === 'pend' && d.val) return false;
    if (f.val !== '0' && String(d.val || '') !== f.val) return false;
    if (f.mes === '-' && d.mes) return false;
    if (f.mes && f.mes !== '-' && d.mes !== f.mes) return false;
    return terms.every(t => r.hay.indexOf(t) > -1);
  });
}
function hl(text) {
  const terms = norm(f.q).split(/\s+/).filter(t => t.length > 1);
  if (!terms.length) return esc(text);
  const n = norm(text), marks = [];
  terms.forEach(t => { let i = 0; while ((i = n.indexOf(t, i)) > -1) { marks.push([i, i + t.length]); i += t.length; } });
  if (!marks.length) return esc(text);
  marks.sort((a, b) => a[0] - b[0]); const m = [];
  marks.forEach(x => { if (m.length && x[0] <= m[m.length - 1][1]) m[m.length - 1][1] = Math.max(m[m.length - 1][1], x[1]); else m.push(x.slice()); });
  let out = '', p = 0; m.forEach(x => { out += esc(text.slice(p, x[0])) + '<mark>' + esc(text.slice(x[0], x[1])) + '</mark>'; p = x[1]; });
  return out + esc(text.slice(p));
}

/* ---------- Resumen y tabla ---------- */
function resumen() {
  $('#gp-resumen').innerHTML = ['L', 'S', 'E', 'H'].map(c => {
    const rs = rows.filter(r => r.g === G.g && r.c === c), n = rs.length || 1; let sel = 0; const v = [0, 0, 0, 0], cs = {};
    rs.forEach(r => { const d = G.d[r.id] || {}; if (d.sel) sel++; v[d.val || 0]++; cs[r.ci] = 1; });
    const pct = x => (x / n * 100).toFixed(1) + '%';
    return `<button type="button" class="gp-res" style="--c:var(--gp-${c})" data-c="${c}" aria-pressed="${!!f.campos[c]}"><span class="nm">${CAMPOS[c]}</span><span class="ct">${Object.keys(cs).length} contenidos · ${rs.length} PDA${sel ? ' · ' + sel + ' trabajados' : ''}</span><span class="bar" title="Logrado ${v[3]} · En proceso ${v[2]} · Requiere apoyo ${v[1]}"><i style="width:${pct(v[3])};background:var(--gp-ok)"></i><i style="width:${pct(v[2])};background:var(--gp-mid)"></i><i style="width:${pct(v[1])};background:var(--gp-low)"></i></span></button>`;
  }).join('');
}
function evLabel(id) {
  const d = G.d[id] || {}, n = nf(id), t = (d.ev || '').trim(), parts = [];
  if (t) parts.push('texto'); if (n) parts.push(n + (n === 1 ? ' foto' : ' fotos'));
  return { has: !!(t || n), html: ICAM + '<span>' + (parts.length ? 'Evidencias · ' + parts.join(' y ') : 'Agregar evidencias') + '</span>' };
}
const mesOpts = v => '<option value="">Mes…</option>' + MESES.map(m => `<option${m === v ? ' selected' : ''}>${m}</option>`).join('');
function filaHTML(r, first) {
  const d = G.d[r.id] || {}, v = d.val || 0, e = evLabel(r.id);
  return `<tr class="r${d.sel ? ' sel' : ''}" data-id="${r.id}" style="--c:var(--gp-${r.c});--ct:var(--gp-${r.c}-t)">
<td class="c-campo">${CORTO[r.c]}</td>
<td class="c-cont${first ? '' : ' rep'}"><span class="gp-num">${CORTO[r.c]} · Contenido ${r.ci}</span><div class="ct-t">${hl(r.cont)}</div></td>
<td class="c-pda">${hl(r.pda)}</td>
<td class="c-ind"><ul>${r.ind.map(q => '<li>' + hl(q) + '</li>').join('')}</ul></td>
<td class="c-mes"><label class="mlabel" for="gpmes${r.id}">Mes en el que se trabajó</label><select class="mes${d.mes ? ' has' : ''}" id="gpmes${r.id}">${mesOpts(d.mes)}</select></td>
<td class="c-sit"><label class="mlabel" for="gpsit${r.id}">Situación o proyecto</label><textarea class="sit" id="gpsit${r.id}" rows="3" maxlength="2000" placeholder="¿En qué situación o proyecto se abordó?">${esc(d.sit || '')}</textarea></td>
<td class="c-val"><span class="mlabel">Valoración</span><div class="val" role="group" aria-label="Valoración">${[1, 2, 3].map(n => `<button type="button" data-v="${n}" aria-pressed="${v === n}">${VAL[n]}</button>`).join('')}</div><button type="button" class="ev-btn${e.has ? ' has' : ''}" aria-expanded="${!!abiertos[r.id]}">${e.html}</button></td>
<td class="c-sel"><input type="checkbox" id="gpsel${r.id}" aria-label="Trabajado"${d.sel ? ' checked' : ''}></td></tr>${abiertos[r.id] ? evRowHTML(r) : ''}`;
}
function evRowHTML(r) {
  const d = G.d[r.id] || {}, n = nf(r.id); let slots = '';
  for (let i = 0; i < MAXF; i++) slots += `<div class="slot" data-i="${i}">${i < n ? '<span>Cargando…</span>' : 'Foto ' + (i + 1)}</div>`;
  const full = n >= MAXF ? ' off' : '';
  return `<tr class="ev-row" data-for="${r.id}" style="--c:var(--gp-${r.c})"><td colspan="8"><div class="ev">
<div><h4><label for="gpevt${r.id}">Evidencia escrita</label></h4><textarea class="evt" id="gpevt${r.id}" maxlength="4000" placeholder="Lo que la niña o el niño dijo, hizo o produjo…">${esc(d.ev || '')}</textarea></div>
<div><h4>Evidencias fotográficas <span class="cnt">(${n} de ${MAXF})</span></h4><div class="fotos">${slots}</div>
<div class="ev-acts"><label class="btn btn-o btn-sm${full}" for="gp-cam" data-foto="${r.id}">${ICAM}Tomar foto</label><label class="btn btn-o btn-sm${full}" for="gp-gal" data-foto="${r.id}">${IGAL}Galería</label><span class="hint">Máximo ${MAXF} fotografías</span></div></div>
</div></td></tr>`;
}
async function pintarFotos(id) {
  const tr = root.querySelector(`tr.ev-row[data-for="${id}"]`); if (!tr) return;
  const paths = ((G.d[id] || {}).f || []).slice(), src = await urlsDe(paths), n = paths.length;
  const sl = tr.querySelectorAll('.slot');
  for (let i = 0; i < MAXF; i++) sl[i].innerHTML = i < n ? `<img src="${esc(src[i])}" alt="Evidencia ${i + 1}" data-i="${i}"><button type="button" class="del" data-i="${i}" aria-label="Borrar foto ${i + 1}">×</button>` : 'Foto ' + (i + 1);
  tr.querySelector('.cnt').textContent = `(${n} de ${MAXF})`;
  tr.querySelectorAll('label[data-foto]').forEach(l => l.classList.toggle('off', n >= MAXF));
  actEvBtn(id);
}
function actEvBtn(id) { const b = root.querySelector(`tr.r[data-id="${id}"] .ev-btn`); if (!b) return; const e = evLabel(id); b.classList.toggle('has', e.has); b.innerHTML = e.html; }
function pintar() {
  resumen(); contarTabs();
  const vs = visibles(); let h = '', last = '';
  vs.forEach(r => { const k = r.c + '|' + r.ci; h += filaHTML(r, k !== last); last = k; });
  $('#gp-tb').innerHTML = h; $('#gp-vacio').hidden = vs.length > 0;
  Object.keys(abiertos).forEach(id => pintarFotos(+id));
  estado(vs.length);
}
function estado(nvis) {
  let tot = 0, sel = 0, val = 0, mes = 0;
  rows.forEach(r => { if (r.g !== G.g) return; tot++; const d = G.d[r.id]; if (!d) return; if (d.sel) sel++; if (d.val) val++; if (d.mes) mes++; });
  if (nvis == null) nvis = root.querySelectorAll('#gp-tb tr.r').length;
  $('#gp-estado').innerHTML = `<span>Mostrando <b>${nvis}</b> de ${tot} PDA</span><span><b>${sel}</b> trabajados</span><span><b>${val}</b> valorados</span><span><b>${mes}</b> con mes asignado</span>`;
  $('#gp-nota').textContent = `Se exportan los ${nvis} PDA que ves en pantalla (${G.g}° grado).`;
}

/* ---------- Eventos ---------- */
function enlazar() {
  $$('[data-h]').forEach(el => el.addEventListener('input', () => { G.h[el.dataset.h] = el.value; save(); }));
  $('#gp_grado').addEventListener('change', e => setTab(+e.target.value));
  $$('.gp-tab').forEach(t => t.addEventListener('click', () => setTab(+t.dataset.g)));
  $('#gp-cont').addEventListener('change', e => { f.cont = e.target.value; pintar(); });
  $('#gp-mes').addEventListener('change', e => { f.mes = e.target.value; pintar(); });
  const seg = (id, key) => $$('#' + id + ' button').forEach(b => b.addEventListener('click', () => { f[key] = b.dataset.v; $$('#' + id + ' button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); pintar(); }));
  seg('gp-vista', 'vista'); seg('gp-val', 'val');
  let qt; $('#gp-q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { f.q = e.target.value; pintar(); }, 180); });
  $('#gp-limpiar').addEventListener('click', () => {
    f = filtrosIniciales(); $('#gp-q').value = ''; $('#gp-mes').value = '';
    $$('#gp-vista button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === 'todos')));
    $$('#gp-val button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === '0')));
    llenarContenidos(); pintar();
  });
  $('#gp-resumen').addEventListener('click', e => {
    const b = e.target.closest('.gp-res'); if (!b) return; const c = b.dataset.c;
    if (f.campos[c] && ncampos() === 4) { f.campos = {}; f.campos[c] = 1; }
    else if (f.campos[c]) { delete f.campos[c]; if (!ncampos()) f.campos = { L: 1, S: 1, E: 1, H: 1 }; }
    else f.campos[c] = 1;
    llenarContenidos(); pintar();
  });
  $('#gp-selvis').addEventListener('click', () => {
    const vs = visibles(), all = vs.length && vs.every(r => gd(r.id, 'sel'));
    vs.forEach(r => { if (all) delete D(r.id).sel; else D(r.id).sel = 1; });
    save(); pintar(); toast(all ? `Se desmarcaron ${vs.length} PDA como trabajados` : `${vs.length} PDA marcados como trabajados`);
  });
  const tb = $('#gp-tb');
  tb.addEventListener('click', async e => {
    const lab = e.target.closest('label[data-foto]'); if (lab) { fotoId = +lab.dataset.foto; return; }
    const del = e.target.closest('.slot .del');
    if (del) {
      const id0 = +del.closest('tr').dataset.for, i0 = +del.dataset.i;
      if (!(await confirmar('Borrar fotografía', `La foto ${i0 + 1} se eliminará de tu cuenta.`, 'Borrar'))) return;
      const arr = (D(id0).f || []).slice(), [p] = arr.splice(i0, 1);
      if (arr.length) D(id0).f = arr; else delete D(id0).f;
      save(); await flush();
      if (p) await C.sb.storage.from(BUCKET).remove([p]);
      pintarFotos(id0); toast('Fotografía borrada'); return;
    }
    const img = e.target.closest('.slot img');
    if (img) { const c = capa(`<div class="gp-visor"><img src="${esc(img.src)}" alt="Evidencia"><button class="btn btn-w btn-sm" type="button" data-r="0">Cerrar</button></div>`); c.onclick = () => cerrarCapa(); return; }
    const tr = e.target.closest('tr.r'); if (!tr) return; const id = +tr.dataset.id;
    const vb = e.target.closest('.val button');
    if (vb) {
      const n = +vb.dataset.v, d = D(id); if (d.val === n) delete d.val; else d.val = n; save();
      tr.querySelectorAll('.val button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.v === d.val)));
      resumen(); estado(); return;
    }
    const eb = e.target.closest('.ev-btn');
    if (eb) {
      const nx = tr.nextElementSibling;
      if (nx && nx.classList.contains('ev-row')) { nx.remove(); delete abiertos[id]; eb.setAttribute('aria-expanded', 'false'); }
      else { abiertos[id] = 1; tr.insertAdjacentHTML('afterend', evRowHTML(rows[id])); eb.setAttribute('aria-expanded', 'true'); pintarFotos(id); }
    }
  });
  tb.addEventListener('change', e => {
    const t = e.target, tr = t.closest('tr.r'); if (!tr) return; const id = +tr.dataset.id;
    if (t.type === 'checkbox') { if (t.checked) D(id).sel = 1; else delete D(id).sel; tr.classList.toggle('sel', t.checked); save(); resumen(); contarTabs(); estado(); }
    else if (t.classList.contains('mes')) { if (t.value) D(id).mes = t.value; else delete D(id).mes; t.classList.toggle('has', !!t.value); save(); estado(); }
  });
  tb.addEventListener('input', e => {
    const t = e.target;
    if (t.classList.contains('sit')) { const id = +t.closest('tr').dataset.id; D(id).sit = t.value; save(); }
    else if (t.classList.contains('evt')) { const id2 = +t.closest('tr').dataset.for; D(id2).ev = t.value; save(); actEvBtn(id2); }
  });
  $('#gp-cam').addEventListener('change', function () { recibirFotos(this); });
  $('#gp-gal').addEventListener('change', function () { recibirFotos(this); });
  $('#gp-pdf').addEventListener('click', exportarPdf);
  $('#gp-xls').addEventListener('click', exportarExcel);
}
async function recibirFotos(input) {
  let files = Array.from(input.files || []); input.value = '';
  const id = fotoId; if (id == null || !files.length) return;
  const libres = MAXF - nf(id);
  if (libres <= 0) return toast(`Este PDA ya tiene ${MAXF} fotografías.`);
  if (files.length > libres) toast(`Solo se agregaron ${libres} de ${files.length} fotos (máximo ${MAXF}).`);
  files = files.slice(0, libres);
  const tr = root.querySelector(`tr.ev-row[data-for="${id}"]`); if (tr) tr.querySelector('.cnt').textContent = '(subiendo…)';
  let malas = 0, fallo = false;
  for (const fl of files) {
    let b; try { b = await comprimir(fl); } catch (e) { malas++; continue; }
    const path = `${C.uid}/${G.id}/${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await C.sb.storage.from(BUCKET).upload(path, b, { contentType: 'image/jpeg', upsert: false });
    if (error) { console.error(error); fallo = true; continue; }
    const d = D(id); d.f = (d.f || []).concat(path).slice(0, MAXF);
  }
  if (malas) toast('Algunas imágenes no se pudieron leer. Usa fotos JPG o PNG.');
  if (fallo) toast('No se pudo subir alguna foto. Revisa tu conexión o que tu suscripción esté activa.');
  save(); await flush(); pintarFotos(id);
}

/* ---------- Datos para exportar ---------- */
function ficha() { const h = G.h; return { jardin: (h.jardin || '').trim(), docente: (h.docente || '').trim(), grupo: (h.grupo || '').trim(), ciclo: (h.ciclo || '').trim(), grado: G.g + '°' }; }
function spans(vs) {
  const sk = [];
  for (let i = 0; i < vs.length; i++) {
    sk[i] = 0;
    if (i === 0 || vs[i].c !== vs[i - 1].c || vs[i].ci !== vs[i - 1].ci) { let k = i; while (k < vs.length && vs[k].c === vs[i].c && vs[k].ci === vs[i].ci) k++; sk[i] = k - i; }
  }
  return { k: sk };
}
async function preparar(msg) {
  await flush();
  const vs = visibles();
  if (!vs.length) { toast('No hay PDA en pantalla para exportar. Quita filtros.'); return null; }
  cargando(msg);
  const fotos = {}, conF = vs.filter(r => nf(r.id));
  for (const r of conF) { fotos[r.id] = await fotosComoDataURL(G.d[r.id].f); r._dims = await Promise.all(fotos[r.id].map(dims)); }
  return { vs, fotos, conF: conF.filter(r => fotos[r.id].length) };
}
function evTexto(r, fotos) {
  const d = G.d[r.id] || {}, n = (fotos[r.id] || []).length; let t = (d.ev || '').trim();
  if (n) t += (t ? '\n' : '') + '(' + n + (n === 1 ? ' fotografía' : ' fotografías') + ' en el anexo)';
  return t;
}
const nombreArchivo = ext => { const fi = ficha(); return `${NOMBRE} - ${fi.grado} grado${fi.grupo ? ' ' + fi.grupo : ''}.${ext}`.replace(/[\\/:*?"<>|]/g, '-'); };

/* ---------- PDF ---------- */
async function exportarPdf(ev) {
  const btn = ev.currentTarget; btn.disabled = true;
  try {
    const [data] = await Promise.all([preparar('Generando PDF…'), cargarScript('/jspdf.min.js').then(() => cargarScript('/vendor/jspdf.plugin.autotable.min.js'))]);
    if (!data) return;
    const { fotos, vs } = data, fi = ficha();
    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 30, TOP = 96;
    const sp = spans(vs), body = [];
    vs.forEach((r, i) => {
      const d = G.d[r.id] || {}, row = [];
      if (sp.k[i]) {
        row.push({ content: CAMPOS[r.c], rowSpan: sp.k[i], styles: { fillColor: RGB[r.c], textColor: [255, 255, 255], fontStyle: 'bold' } });
        row.push({ content: 'Contenido ' + r.ci + '\n' + r.cont, rowSpan: sp.k[i], styles: { fillColor: TINT[r.c] } });
      }
      row.push(r.pda, r.ind.join('\n'), d.mes || '', d.sit || '');
      row.push(d.val ? { content: VAL[d.val], styles: { textColor: VRGB[d.val], fontStyle: 'bold' } } : '');
      row.push(evTexto(r, fotos));
      body.push(row);
    });
    doc.autoTable({
      startY: TOP, margin: { top: TOP, left: M, right: M, bottom: 40 },
      head: [['Campo formativo', 'Contenido', 'PDA', 'Indicadores: ¿qué observar?', 'Mes', 'Situación o proyecto', 'Valoración', 'Evidencias']],
      body, theme: 'grid', rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 7.2, cellPadding: 4, textColor: TXT, lineColor: LIN, lineWidth: 0.5, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: IND, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.6, halign: 'center', valign: 'middle' },
      columnStyles: { 0: { cellWidth: 58 }, 1: { cellWidth: 104 }, 2: { cellWidth: 122 }, 3: { cellWidth: 128 }, 4: { cellWidth: 50, halign: 'center' }, 5: { cellWidth: 100 }, 6: { cellWidth: 56, halign: 'center' }, 7: { cellWidth: 114 } }
    });
    let yc = doc.lastAutoTable.finalY + 22;
    if (yc + 30 > H - 40) { doc.addPage(); yc = TOP + 10; }
    doc.setDrawColor(...MIEL); doc.setLineWidth(1.2); doc.line(M, yc - 12, M + 170, yc - 12);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...NAR); doc.text('ELABORADO POR', M, yc);
    doc.setFontSize(10.5); doc.setTextColor(...TXT); doc.text(AUTOR, M, yc + 14);
    if (data.conF.length) {
      doc.addPage(); let y = TOP + 14;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...IND);
      doc.text('Anexo · Evidencias fotográficas', M, y); y += 8;
      doc.setDrawColor(...MIEL); doc.setLineWidth(1.2); doc.line(M, y, M + 190, y); y += 16;
      const BW = (W - 2 * M - 24) / 3, BH = BW * 0.72;
      data.conF.forEach(r => {
        const tit = CAMPOS[r.c] + ' · Contenido ' + r.ci, pda = doc.splitTextToSize('PDA: ' + r.pda, W - 2 * M - 10);
        if (y + 14 + pda.length * 10 + BH + 24 > H - 44) { doc.addPage(); y = TOP; }
        doc.setFillColor(...RGB[r.c]); doc.rect(M, y - 9, 4, 12 + pda.length * 10, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...RGB[r.c]); doc.text(tit, M + 10, y);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(...TXT); doc.text(pda, M + 10, y + 12);
        y += 14 + pda.length * 10;
        fotos[r.id].forEach((src, i) => {
          const dm = r._dims[i] || { w: 4, h: 3 }, k = Math.min(BW / dm.w, BH / dm.h), w = dm.w * k, h = dm.h * k, x = M + i * (BW + 12);
          doc.setFillColor(246, 247, 249); doc.setDrawColor(...LIN); doc.setLineWidth(0.5); doc.rect(x, y, BW, BH, 'FD');
          try { doc.addImage(src, 'JPEG', x + (BW - w) / 2, y + (BH - h) / 2, w, h); } catch (e) { /* imagen ilegible */ }
        });
        y += BH + 22;
      });
    }
    const n = doc.internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFillColor(...IND); doc.rect(0, 0, W, 58, 'F');
      doc.setFillColor(...MIEL); doc.rect(0, 58, W, 2.5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...MIEL);
      doc.text('PROGRAMA SINTÉTICO · EDUCACIÓN PREESCOLAR', M, 22);
      doc.setFontSize(17); doc.setTextColor(255, 255, 255); doc.text(NOMBRE, M, 43);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text('Grado: ' + fi.grado + '     Grupo: ' + (fi.grupo || '—') + '     Ciclo escolar: ' + (fi.ciclo || '—'), W - M, 43, { align: 'right' });
      doc.setFillColor(...PAPEL); doc.rect(M, 68, W - 2 * M, 18, 'F');
      doc.setFontSize(8.5); doc.setTextColor(...MUT); doc.setFont('helvetica', 'bold');
      doc.text('Jardín de Niños:', M + 8, 80); doc.text('Docente:', W / 2 + 8, 80);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...TXT);
      doc.text(doc.splitTextToSize(fi.jardin || '—', W / 2 - M - 90)[0], M + 82, 80);
      doc.text(doc.splitTextToSize(fi.docente || '—', W / 2 - M - 60)[0], W / 2 + 52, 80);
      doc.setDrawColor(...LIN); doc.setLineWidth(0.5); doc.line(M, H - 28, W - M, H - 28);
      doc.setFontSize(7.5); doc.setTextColor(...MUT);
      doc.text(NOMBRE + ' · ' + fi.grado + ' grado · Generado el ' + hoy(), M, H - 16);
      doc.text('Elaborado por: ' + AUTOR, W / 2, H - 16, { align: 'center' });
      doc.text('Página ' + i + ' de ' + n, W - M, H - 16, { align: 'right' });
    }
    cerrarCapa();
    descargar(nombreArchivo('pdf'), doc.output('blob'));
  } catch (e) { console.error(e); cerrarCapa(); toast(e && e.message ? e.message : 'No se pudo generar el PDF.'); }
  finally { btn.disabled = false; }
}

/* ---------- Excel ---------- */
const hex = a => 'FF' + a.map(x => ('0' + x.toString(16)).slice(-2)).join('').toUpperCase();
function lineas(t, ancho) { if (!t) return 1; let n = 0; String(t).split('\n').forEach(p => { n += Math.max(1, Math.ceil(p.length / (ancho * 1.3))); }); return n; }
async function exportarExcel(ev) {
  const btn = ev.currentTarget; btn.disabled = true;
  try {
    const [data] = await Promise.all([preparar('Generando Excel…'), cargarScript('/vendor/exceljs.min.js')]);
    if (!data) return;
    const { fotos, vs } = data, fi = ficha();
    const wb = new window.ExcelJS.Workbook(); wb.creator = fi.docente || MARCA; wb.created = new Date();
    const borde = { style: 'thin', color: { argb: hex(LIN) } }, B = { top: borde, left: borde, bottom: borde, right: borde };
    const fill = c => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: hex(c) } });
    const fnt = 'Calibri';
    const encabezado = (ws, ncol, subt) => {
      const L = String.fromCharCode(64 + ncol);
      ws.mergeCells('A1:' + L + '1'); ws.mergeCells('A2:' + L + '2');
      const a1 = ws.getCell('A1'); a1.value = NOMBRE; a1.font = { name: fnt, size: 18, bold: true, color: { argb: 'FFFFFFFF' } }; a1.fill = fill(IND); a1.alignment = { vertical: 'middle', indent: 1 };
      const a2 = ws.getCell('A2'); a2.value = subt; a2.font = { name: fnt, size: 9, bold: true, color: { argb: hex(MIEL) } }; a2.fill = fill(IND); a2.alignment = { vertical: 'middle', indent: 1 };
      ws.getRow(1).height = 32; ws.getRow(2).height = 18;
      for (let c = 1; c <= ncol; c++) ws.getRow(2).getCell(c).border = { bottom: { style: 'medium', color: { argb: hex(MIEL) } } };
    };
    const datos = (ws, pares, fila) => {
      pares.forEach(p => {
        const l = ws.getRow(fila).getCell(p[0]); l.value = p[1]; l.font = { name: fnt, size: 9, bold: true, color: { argb: hex(MUT) } }; l.fill = fill(PAPEL); l.alignment = { vertical: 'middle', horizontal: 'right' }; l.border = B;
        if (p[3] > p[2]) ws.mergeCells(fila, p[2], fila, p[3]);
        const v = ws.getRow(fila).getCell(p[2]); v.value = p[4] || ''; v.font = { name: fnt, size: 10.5, bold: true, color: { argb: hex(TXT) } }; v.fill = fill(PAPEL); v.alignment = { vertical: 'middle', indent: 1 }; v.border = B;
      });
      ws.getRow(fila).height = 20;
    };
    const pagina = (ws, titulos) => {
      ws.pageSetup = { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.35, right: 0.35, top: 0.45, bottom: 0.5, header: 0.2, footer: 0.25 }, printTitlesRow: titulos };
      ws.headerFooter = { oddFooter: '&L&8' + NOMBRE + ' · ' + fi.grado + ' grado&C&8Elaborado por: ' + AUTOR + '&R&8Página &P de &N' };
    };
    const ws = wb.addWorksheet('Contenidos y PDA', { views: [{ state: 'frozen', ySplit: 6, showGridLines: false }] });
    const cols = [['Campo formativo', 13], ['Contenido', 30], ['PDA', 34], ['Indicadores: ¿qué observar?', 36], ['Mes en el que se trabajó', 12], ['Situación o proyecto en el que se abordó el contenido', 26], ['Valoración', 13], ['Evidencias', 30]];
    ws.columns = cols.map(c => ({ width: c[1] }));
    encabezado(ws, 8, 'PROGRAMA SINTÉTICO · EDUCACIÓN PREESCOLAR');
    datos(ws, [[1, 'Jardín de Niños', 2, 4, fi.jardin], [5, 'Docente', 6, 8, fi.docente]], 3);
    datos(ws, [[1, 'Grado', 2, 2, fi.grado], [3, 'Grupo', 4, 4, fi.grupo], [5, 'Ciclo escolar', 6, 8, fi.ciclo]], 4);
    ws.getRow(5).height = 6;
    const hr = ws.getRow(6); cols.forEach((c, i) => { const x = hr.getCell(i + 1); x.value = c[0]; x.font = { name: fnt, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; x.fill = fill(IND); x.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; x.border = B; });
    hr.height = 34;
    const sp = spans(vs), r0 = 7;
    vs.forEach((r, i) => {
      const d = G.d[r.id] || {}, row = ws.getRow(r0 + i);
      const vals = [CAMPOS[r.c], 'Contenido ' + r.ci + '\n' + r.cont, r.pda, r.ind.join('\n'), d.mes || '', d.sit || '', d.val ? VAL[d.val] : '', evTexto(r, fotos)];
      vals.forEach((v, j) => { const c = row.getCell(j + 1); c.value = v; c.font = { name: fnt, size: 9.5, color: { argb: hex(TXT) } }; c.alignment = { vertical: 'top', wrapText: true, horizontal: (j === 4 || j === 6) ? 'center' : 'left' }; c.border = B; });
      row.getCell(1).fill = fill(RGB[r.c]); row.getCell(1).font = { name: fnt, size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
      row.getCell(2).fill = fill(TINT[r.c]);
      if (d.val) row.getCell(7).font = { name: fnt, size: 9.5, bold: true, color: { argb: hex(VRGB[d.val]) } };
      const ln = Math.max(lineas(r.pda, 34), lineas(vals[3], 36), lineas(vals[5], 26), lineas(vals[7], 30), sp.k[i] === 1 ? lineas(vals[1], 30) : 1);
      row.height = Math.max(28, Math.min(400, ln * 12.2 + 6));
    });
    vs.forEach((r, i) => {
      if (sp.k[i] > 1) {
        ws.mergeCells(r0 + i, 1, r0 + i + sp.k[i] - 1, 1); ws.mergeCells(r0 + i, 2, r0 + i + sp.k[i] - 1, 2);
        let tot = 0; for (let j = 0; j < sp.k[i]; j++) tot += ws.getRow(r0 + i + j).height;
        const need = lineas('Contenido ' + r.ci + '\n' + r.cont, 30) * 12.2 + 6;
        if (need > tot) ws.getRow(r0 + i + sp.k[i] - 1).height += need - tot;
      }
    });
    const fc = r0 + vs.length + 1;
    ws.mergeCells(fc, 1, fc, 8);
    const c1 = ws.getCell(fc, 1); c1.value = 'Elaborado por: ' + AUTOR; c1.font = { name: fnt, size: 11, bold: true, color: { argb: hex(TXT) } }; c1.border = { top: { style: 'medium', color: { argb: hex(MIEL) } } };
    ws.getRow(fc).height = 22;
    pagina(ws, '6:6');
    if (data.conF.length) {
      const we = wb.addWorksheet('Evidencias', { views: [{ showGridLines: false }] });
      we.columns = [{ width: 38 }, { width: 32 }, { width: 32 }, { width: 32 }];
      encabezado(we, 4, 'ANEXO · EVIDENCIAS FOTOGRÁFICAS · ' + fi.grado + ' GRADO' + (fi.grupo ? ' · GRUPO ' + fi.grupo.toUpperCase() : ''));
      datos(we, [[1, 'Jardín de Niños · Docente', 2, 4, [fi.jardin, fi.docente].filter(Boolean).join(' · ')]], 3);
      const h = we.getRow(5); ['PDA', 'Fotografía 1', 'Fotografía 2', 'Fotografía 3'].forEach((t, i) => { const x = h.getCell(i + 1); x.value = t; x.font = { name: fnt, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; x.fill = fill(IND); x.alignment = { horizontal: 'center', vertical: 'middle' }; x.border = B; });
      h.height = 22;
      const PXW = 212, PXH = 160; let fila = 6;
      data.conF.forEach(r => {
        const row = we.getRow(fila), c = row.getCell(1), evt = (G.d[r.id] || {}).ev;
        c.value = { richText: [{ text: CAMPOS[r.c] + ' · Contenido ' + r.ci + '\n', font: { name: fnt, size: 9.5, bold: true, color: { argb: hex(RGB[r.c]) } } }, { text: r.pda + (evt ? '\n\nEvidencia escrita: ' + evt : ''), font: { name: fnt, size: 9.5, color: { argb: hex(TXT) } } }] };
        c.alignment = { vertical: 'top', wrapText: true }; c.border = B; c.fill = fill(TINT[r.c]);
        for (let j = 2; j <= 4; j++) row.getCell(j).border = B;
        row.height = PXH * 0.75 + 12;
        fotos[r.id].forEach((src, i) => {
          const dm = r._dims[i] || { w: 4, h: 3 }, k = Math.min(PXW / dm.w, PXH / dm.h);
          const idImg = wb.addImage({ base64: src, extension: 'jpeg' });
          we.addImage(idImg, { tl: { col: 1 + i + 0.04, row: fila - 1 + 0.04 }, ext: { width: Math.round(dm.w * k), height: Math.round(dm.h * k) }, editAs: 'oneCell' });
        });
        fila++;
      });
      pagina(we, '5:5');
    }
    const buf = await wb.xlsx.writeBuffer();
    cerrarCapa();
    descargar(nombreArchivo('xlsx'), new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  } catch (e) { console.error(e); cerrarCapa(); toast(e && e.message ? e.message : 'No se pudo generar el Excel.'); }
  finally { btn.disabled = false; }
}

/* ---------- API pública ---------- */
window.CAPGuia = {
  nuevaGuia(nombre) { return { h: { docente: nombre || '', ciclo: cicloActual(), grado: 1 }, d: {}, g: 1 }; },
  tituloDe,
  async mount(el, ctx, row) {
    await cargarDatos();
    if (G && (dirty || saving)) await flush();
    C = ctx; root = el; f = filtrosIniciales(); abiertos = {}; dirty = false;
    const dt = row.datos || {};
    G = { id: row.id, h: Object.assign({ ciclo: cicloActual() }, dt.h || {}), d: dt.d || {}, g: [1, 2, 3].includes(+dt.g) ? +dt.g : 1 };
    el.innerHTML = plantilla();
    enlazar();
    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    setTab(G.g);
  },
  unmount() {
    if (!root) return;
    if (dirty || saving) flush();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', onUnload);
    document.body.style.overflow = '';
    root = null;
  }
};
})();

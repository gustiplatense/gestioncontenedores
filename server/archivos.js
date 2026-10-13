// Archivos que genera el asistente: Excel, CSV, PDF y HTML (informe con gráficos para abrir en el navegador).
// El contenido se describe con "bloques"; las tablas y gráficos traen sus datos con una consulta SQL que
// ejecuta el servidor, así los datos no tienen que pasar por el modelo de lenguaje.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { db, DATA_DIR } from './db.js';
import { svgGrafico, PALETA_CLARA, PALETA_CSS } from './graficos.js';

const require = createRequire(import.meta.url);
const PdfPrinter = require('pdfmake');
const vfs = require('pdfmake/build/vfs_fonts');
const fuentes = vfs.pdfMake ? vfs.pdfMake.vfs : vfs;
const impresora = new PdfPrinter({ Roboto: {
  normal: Buffer.from(fuentes['Roboto-Regular.ttf'], 'base64'), bold: Buffer.from(fuentes['Roboto-Medium.ttf'], 'base64'),
  italics: Buffer.from(fuentes['Roboto-Italic.ttf'], 'base64'), bolditalics: Buffer.from(fuentes['Roboto-MediumItalic.ttf'], 'base64'),
} });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ARCHIVOS_DIR = path.join(DATA_DIR, 'archivos');
fs.mkdirSync(ARCHIVOS_DIR, { recursive: true });
db.exec(`CREATE TABLE IF NOT EXISTS archivos (
  id TEXT PRIMARY KEY, nombre TEXT NOT NULL, formato TEXT NOT NULL, usuario_email TEXT NOT NULL, bytes INTEGER, ts TEXT NOT NULL)`);
const LOGO = fs.readFileSync(path.join(__dirname, '..', 'public', 'logo.png'));
const LOGO_URL = 'data:image/png;base64,' + LOGO.toString('base64');

export const FORMATOS = { xlsx: 'Excel', csv: 'CSV', pdf: 'PDF', html: 'HTML' };
const TIPOS_MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8', pdf: 'application/pdf', html: 'text/html; charset=utf-8' };
export const mime = (f) => TIPOS_MIME[f] || 'application/octet-stream';
const MAX_FILAS = { xlsx: 50000, csv: 50000, html: 5000, pdf: 1000 };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtCelda = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('es-AR') : v.toLocaleString('es-AR', { maximumFractionDigits: 2 })) : String(v ?? ''));
const ahora = () => new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'long', timeStyle: 'short' });

// Markdown mínimo a HTML (texto de informes y cuerpo de mails)
export function mdHtml(texto) {
  const inline = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const out = []; let lista = null;
  for (const l of String(texto || '').split('\n')) {
    const item = /^\s*[-*]\s+(.*)/.exec(l);
    if (item) { (lista ||= []).push(`<li>${inline(item[1])}</li>`); continue; }
    if (lista) { out.push(`<ul>${lista.join('')}</ul>`); lista = null; }
    const h = /^#{1,4}\s+(.*)/.exec(l);
    if (h) out.push(`<h3>${inline(h[1])}</h3>`); else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  if (lista) out.push(`<ul>${lista.join('')}</ul>`);
  return out.join('');
}
// Mismo texto, en el formato de párrafos de pdfmake
function mdPdf(texto) {
  const partes = (t) => t.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((p) => (/^\*\*/.test(p) ? { text: p.slice(2, -2), bold: true } : p));
  const out = []; let lista = null;
  for (const l of String(texto || '').split('\n')) {
    const item = /^\s*[-*]\s+(.*)/.exec(l);
    if (item) { (lista ||= []).push({ text: partes(item[1]) }); continue; }
    if (lista) { out.push({ ul: lista, margin: [0, 0, 0, 6] }); lista = null; }
    const h = /^#{1,4}\s+(.*)/.exec(l);
    if (h) out.push({ text: h[1], style: 'subtitulo' }); else if (l.trim()) out.push({ text: partes(l), margin: [0, 0, 0, 6] });
  }
  if (lista) out.push({ ul: lista, margin: [0, 0, 0, 6] });
  return out;
}

// Convierte las filas de una consulta en datos de gráfico
function datosGrafico(b, r) {
  const cols = r.columnas, x = b.x && cols.includes(b.x) ? b.x : cols[0];
  let ys = (Array.isArray(b.y) ? b.y : b.y ? [b.y] : []).filter((c) => cols.includes(c));
  if (!ys.length) ys = cols.filter((c) => c !== x && r.filas.some((f) => typeof f[c] === 'number'));
  if (!ys.length) throw new Error(`El gráfico "${b.titulo || ''}" necesita al menos una columna numérica`);
  return { etiquetas: r.filas.map((f) => f[x] ?? '(vacío)'), series: ys.map((c) => ({ nombre: c, valores: r.filas.map((f) => Number(f[c]) || 0) })) };
}

/**
 * spec: { formato, nombre, titulo, bloques: [
 *   { tipo: 'texto', texto } | { tipo: 'indicadores', indicadores: [{ etiqueta, valor }] } |
 *   { tipo: 'tabla', titulo, sql } | { tipo: 'grafico', titulo, sql, grafico: 'barras'|'lineas'|'torta', x, y } ] }
 */
export async function generarArchivo(spec, usuario, ejecutarSQL) {
  const formato = String(spec?.formato || '').toLowerCase();
  if (!FORMATOS[formato]) throw new Error('Formato inválido: usá xlsx, csv, pdf o html');
  const titulo = String(spec.titulo || 'Informe').slice(0, 150);
  const base = String(spec.nombre || titulo).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'informe';
  const bloques = (Array.isArray(spec.bloques) ? spec.bloques : []).slice(0, 20);
  if (!bloques.length) throw new Error('El archivo no tiene contenido (bloques vacío)');

  // Resuelve las consultas de tablas y gráficos
  const resumen = [];
  for (const b of bloques) {
    if (b.tipo === 'tabla' || b.tipo === 'grafico') {
      const r = ejecutarSQL(b.sql, MAX_FILAS[formato]);
      if (r.error) throw new Error(`Bloque "${b.titulo || b.tipo}": ${r.error}`);
      b._datos = r;
      if (b.tipo === 'grafico') b._grafico = datosGrafico(b, r);
      resumen.push({ bloque: b.titulo || b.tipo, filas: r.filas.length, truncado: r.truncado });
    }
  }
  const tablas = bloques.filter((b) => b._datos);
  if ((formato === 'csv' || formato === 'xlsx') && !tablas.length) throw new Error(`Un archivo ${FORMATOS[formato]} necesita al menos un bloque de tabla con su consulta SQL`);

  let contenido;
  if (formato === 'csv') {
    const { columnas, filas } = (tablas.find((b) => b.tipo === 'tabla') || tablas[0])._datos;
    const celda = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    // Separador ";" y marca BOM para que Excel en español lo abra con acentos y columnas correctas
    contenido = Buffer.from('﻿' + [columnas.map(celda).join(';'), ...filas.map((f) => columnas.map((c) => celda(f[c])).join(';'))].join('\r\n'), 'utf8');
  } else if (formato === 'xlsx') {
    const libro = new ExcelJS.Workbook(); libro.creator = 'Hassa Inventario';
    const textos = bloques.filter((b) => b.tipo === 'texto' || b.tipo === 'indicadores');
    if (textos.length) {
      const h = libro.addWorksheet('Resumen'); h.getColumn(1).width = 40; h.getColumn(2).width = 30;
      h.addRow([titulo]).font = { bold: true, size: 14, color: { argb: 'FF0F6B4A' } };
      h.addRow([`Generado el ${ahora()} por ${usuario.email}`]).font = { italic: true, color: { argb: 'FF62716B' } };
      h.addRow([]);
      for (const b of textos) {
        if (b.tipo === 'texto') String(b.texto || '').split('\n').forEach((l) => h.addRow([l.replace(/\*\*/g, '').replace(/^\s*[-*]\s+/, '• ')]));
        else (b.indicadores || []).forEach((k) => { const r = h.addRow([k.etiqueta, k.valor]); r.getCell(1).font = { bold: true }; });
        h.addRow([]);
      }
    }
    const usados = new Set();
    tablas.forEach((b, i) => {
      let nom = String(b.titulo || `Datos ${i + 1}`).replace(/[\\/*?:[\]]/g, ' ').slice(0, 31).trim() || `Datos ${i + 1}`;
      while (usados.has(nom)) nom = `${nom.slice(0, 28)} ${i + 1}`; usados.add(nom);
      const h = libro.addWorksheet(nom, { views: [{ state: 'frozen', ySplit: 1 }] });
      const { columnas, filas } = b._datos;
      h.columns = columnas.map((c) => ({ header: c, key: c, width: Math.min(50, Math.max(10, c.length + 2, ...filas.slice(0, 200).map((f) => String(f[c] ?? '').length + 2))) }));
      filas.forEach((f) => h.addRow(f));
      const enc = h.getRow(1); enc.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      enc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F6B4A' } };
      if (columnas.length) h.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
    });
    contenido = Buffer.from(await libro.xlsx.writeBuffer());
  } else if (formato === 'html') {
    contenido = Buffer.from(informeHtml(titulo, bloques, usuario), 'utf8');
  } else {
    contenido = await informePdf(titulo, bloques, usuario);
  }

  const id = crypto.randomUUID(), nombre = `${base}.${formato}`;
  fs.writeFileSync(path.join(ARCHIVOS_DIR, `${id}.${formato}`), contenido);
  db.prepare('INSERT INTO archivos VALUES (?,?,?,?,?,?)').run(id, nombre, formato, usuario.email, contenido.length, new Date().toISOString());
  return { id, nombre, formato, url: `/api/archivos/${id}`, bytes: contenido.length, resumen };
}

export function archivoDe(id, usuario) {
  const a = db.prepare('SELECT * FROM archivos WHERE id = ?').get(String(id || ''));
  if (!a || (a.usuario_email !== usuario.email && usuario.rol !== 'admin')) return null;
  return { ...a, ruta: path.join(ARCHIVOS_DIR, `${a.id}.${a.formato}`) };
}

// Borra los archivos generados hace más de 7 días
export function limpiarArchivos() {
  const corte = new Date(Date.now() - 7 * 86400e3).toISOString();
  for (const a of db.prepare('SELECT id, formato FROM archivos WHERE ts < ?').all(corte)) {
    fs.rmSync(path.join(ARCHIVOS_DIR, `${a.id}.${a.formato}`), { force: true });
    db.prepare('DELETE FROM archivos WHERE id = ?').run(a.id);
  }
}

// ---------- Informe HTML autocontenido (se abre sin conexión en cualquier navegador) ----------
function informeHtml(titulo, bloques, usuario) {
  const cuerpo = bloques.map((b) => {
    if (b.tipo === 'texto') return `<section class="texto">${mdHtml(b.texto)}</section>`;
    if (b.tipo === 'indicadores') return `<section class="kpis">${(b.indicadores || []).map((k) => `<div class="kpi"><b>${esc(k.valor)}</b><span>${esc(k.etiqueta)}</span></div>`).join('')}</section>`;
    const cab = b.titulo ? `<h2>${esc(b.titulo)}</h2>` : '';
    if (b.tipo === 'grafico') return `<section class="tarjeta">${cab}<div class="grafico">${svgGrafico(b.grafico, b._grafico, PALETA_CSS)}</div>
      <details><summary>Ver datos</summary>${tablaHtml(b._datos)}</details></section>`;
    if (b.tipo === 'tabla') return `<section class="tarjeta">${cab}${tablaHtml(b._datos)}</section>`;
    return '';
  }).join('\n');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<style>
:root { color-scheme: light; --fondo:#f3f5f4; --superficie:#ffffff; --texto:#0b0b0b; --texto2:#52514e; --grilla:#e4e3df; --borde:#dfe5e2; --marca:#0f6b4a;
  --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --s6:#008300; --s7:#6250d6; --s8:#e34948; }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; --fondo:#121413; --superficie:#1a1a19; --texto:#f0efec; --texto2:#c3c2b7; --grilla:#33332f; --borde:#33332f; --marca:#4cc38a;
  --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --s6:#008300; --s7:#9085e9; --s8:#e66767; } }
* { box-sizing: border-box; } body { margin:0; background:var(--fondo); color:var(--texto); font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; }
main { max-width: 1000px; margin: 0 auto; padding: 24px 16px 48px; }
header { display:flex; align-items:center; gap:16px; border-bottom:3px solid var(--marca); padding-bottom:14px; margin-bottom:20px; }
header img { height:40px; background:#fff; border-radius:8px; padding:4px 8px; } h1 { font-size:24px; margin:0; } .meta { color:var(--texto2); font-size:13px; }
h2 { font-size:16px; margin:0 0 12px; } h3 { font-size:15px; margin:14px 0 6px; }
.tarjeta, .texto { background:var(--superficie); border:1px solid var(--borde); border-radius:12px; padding:16px; margin-bottom:16px; }
.texto p { margin:0 0 8px; } .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin-bottom:16px; }
.kpi { background:var(--superficie); border:1px solid var(--borde); border-left:4px solid var(--marca); border-radius:12px; padding:12px 14px; }
.kpi b { display:block; font-size:26px; } .kpi span { color:var(--texto2); font-size:13px; }
.grafico { overflow-x:auto; } .grafico svg { max-width:100%; height:auto; }
.tabla { overflow:auto; max-height:560px; } table { width:100%; border-collapse:collapse; font-size:13.5px; }
th { position:sticky; top:0; background:var(--superficie); text-align:left; color:var(--texto2); font-size:12px; text-transform:uppercase; letter-spacing:.03em; cursor:pointer; user-select:none; }
th, td { padding:7px 10px; border-bottom:1px solid var(--borde); } td.n { text-align:right; font-variant-numeric:tabular-nums; }
summary { cursor:pointer; color:var(--texto2); font-size:13px; margin-top:8px; } .pie { color:var(--texto2); font-size:12px; margin-top:6px; }
@media print { body { background:#fff; } .tabla { max-height:none; overflow:visible; } }
</style></head><body><main>
<header><img src="${LOGO_URL}" alt="Hassa"><div><h1>${esc(titulo)}</h1><div class="meta">Generado el ${esc(ahora())} · ${esc(usuario.email)}</div></div></header>
${cuerpo}
</main>
<script>
// Ordenar tablas al tocar el encabezado
document.querySelectorAll('table').forEach(function (t) {
  t.querySelectorAll('th').forEach(function (th, i) {
    th.title = 'Ordenar'; var asc = true;
    th.onclick = function () {
      var tb = t.tBodies[0], filas = Array.prototype.slice.call(tb.rows);
      filas.sort(function (a, b) { var x = a.cells[i].dataset.v, y = b.cells[i].dataset.v, nx = parseFloat(x), ny = parseFloat(y);
        var r = (!isNaN(nx) && !isNaN(ny)) ? nx - ny : String(x).localeCompare(String(y), 'es'); return asc ? r : -r; });
      asc = !asc; filas.forEach(function (f) { tb.appendChild(f); });
    };
  });
});
</script></body></html>`;
}
function tablaHtml({ columnas, filas, truncado }) {
  return `<div class="tabla"><table><thead><tr>${columnas.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
    filas.map((f) => `<tr>${columnas.map((c) => `<td${typeof f[c] === 'number' ? ' class="n"' : ''} data-v="${esc(f[c])}">${esc(fmtCelda(f[c]))}</td>`).join('')}</tr>`).join('')
  }</tbody></table></div><div class="pie">${filas.length.toLocaleString('es-AR')} filas${truncado ? ' (se muestran las primeras)' : ''}</div>`;
}

// ---------- Informe PDF ----------
function informePdf(titulo, bloques, usuario) {
  const apaisado = bloques.some((b) => b.tipo === 'tabla' && b._datos.columnas.length > 6);
  const anchoUtil = apaisado ? 762 : 515;
  const contenido = [
    { columns: [{ image: LOGO_URL, width: 120 }, { stack: [{ text: titulo, style: 'titulo' }, { text: `Generado el ${ahora()} · ${usuario.email}`, style: 'meta' }], margin: [16, 2, 0, 0] }] },
    { canvas: [{ type: 'line', x1: 0, y1: 6, x2: anchoUtil, y2: 6, lineWidth: 2, lineColor: '#0f6b4a' }], margin: [0, 6, 0, 14] },
  ];
  for (const b of bloques) {
    if (b.tipo === 'texto') contenido.push(...mdPdf(b.texto));
    if (b.tipo === 'indicadores' && b.indicadores?.length) {
      const ks = b.indicadores.slice(0, 8);
      contenido.push({ table: { widths: ks.map(() => '*'), body: [ks.map((k) => ({ stack: [{ text: String(k.valor), fontSize: 18, bold: true }, { text: k.etiqueta, fontSize: 8, color: '#52514e' }], fillColor: '#eef4f1', margin: [4, 4, 4, 4] }))] },
        layout: { hLineWidth: () => 0, vLineWidth: () => 4, vLineColor: () => '#ffffff' }, margin: [0, 0, 0, 12] });
    }
    if (b.titulo && b.tipo === 'tabla') contenido.push({ text: b.titulo, style: 'subtitulo' });
    // Título y gráfico juntos, sin cortarse entre páginas
    if (b.tipo === 'grafico') contenido.push({ unbreakable: true, stack: [...(b.titulo ? [{ text: b.titulo, style: 'subtitulo' }] : []),
      { svg: svgGrafico(b.grafico, b._grafico, PALETA_CLARA), width: Math.min(anchoUtil, 515), margin: [0, 0, 0, 14] }] });
    if (b.tipo === 'tabla') {
      const { columnas, filas, truncado } = b._datos;
      contenido.push({
        table: { headerRows: 1, widths: columnas.map(() => (columnas.length > 4 ? '*' : 'auto')),
          body: [columnas.map((c) => ({ text: c, bold: true, color: '#ffffff', fillColor: '#0f6b4a' })),
            ...filas.map((f) => columnas.map((c) => ({ text: fmtCelda(f[c]), alignment: typeof f[c] === 'number' ? 'right' : 'left' })))] },
        layout: { hLineWidth: (i) => (i === 0 ? 0 : 0.5), vLineWidth: () => 0, hLineColor: () => '#dfe5e2', paddingTop: () => 3, paddingBottom: () => 3 },
        fontSize: columnas.length > 6 ? 7 : 8.5, margin: [0, 0, 0, 4],
      });
      contenido.push({ text: `${filas.length.toLocaleString('es-AR')} filas${truncado ? ' (se muestran las primeras 1.000; el archivo Excel admite más)' : ''}`, style: 'meta', margin: [0, 0, 0, 14] });
    }
  }
  const doc = impresora.createPdfKitDocument({
    pageSize: 'A4', pageOrientation: apaisado ? 'landscape' : 'portrait', pageMargins: [40, 40, 40, 44],
    info: { title: titulo, author: 'Hassa Inventario' }, content: contenido,
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#17231e' },
    styles: { titulo: { fontSize: 18, bold: true }, subtitulo: { fontSize: 12, bold: true, color: '#0f6b4a', margin: [0, 6, 0, 6] }, meta: { fontSize: 8, color: '#62716b' } },
    footer: (pag, total) => ({ text: `${titulo} · Página ${pag} de ${total}`, alignment: 'right', fontSize: 8, color: '#62716b', margin: [40, 14, 40, 0] }),
  });
  return new Promise((ok, mal) => { const partes = []; doc.on('data', (d) => partes.push(d)); doc.on('end', () => ok(Buffer.concat(partes))); doc.on('error', mal); doc.end(); });
}

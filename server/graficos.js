// Gráficos en SVG para los informes que genera el asistente (HTML y PDF usan el mismo dibujo).
// Paleta categórica validada (orden fijo, nunca rotado). En HTML se pasan variables CSS para tener modo oscuro;
// en PDF se pasan los colores literales.
export const PALETA_CLARA = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  superficie: '#ffffff', texto: '#0b0b0b', texto2: '#52514e', grilla: '#e4e3df',
};
export const PALETA_CSS = {
  series: Array.from({ length: 8 }, (_, i) => `var(--s${i + 1})`),
  superficie: 'var(--superficie)', texto: 'var(--texto)', texto2: 'var(--texto2)', grilla: 'var(--grilla)',
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (Math.abs(n) >= 1000 || Number.isInteger(n) ? Math.round(n).toLocaleString('es-AR') : n.toLocaleString('es-AR', { maximumFractionDigits: 2 }));
const corto = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const FUENTE = 'font-family="Helvetica, Arial, sans-serif"';

// Escala "linda" para el eje: 0 a un máximo redondeado, con 4 o 5 marcas
function escala(max) {
  if (max <= 0) return { tope: 1, paso: 0.25 };
  const crudo = max / 4, mag = 10 ** Math.floor(Math.log10(crudo));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= crudo);
  return { tope: Math.ceil(max / paso) * paso, paso };
}

function leyenda(series, c, x, y) {
  let dx = x;
  return series.map((s, i) => {
    const g = `<rect x="${dx}" y="${y - 9}" width="10" height="10" rx="2" fill="${c.series[i]}"/><text x="${dx + 15}" y="${y}" font-size="12" fill="${c.texto2}" ${FUENTE}>${esc(corto(s.nombre, 28))}</text>`;
    dx += 30 + Math.min(28, String(s.nombre).length) * 6.5;
    return g;
  }).join('');
}

// Barras horizontales: una fila por categoría (se leen bien las etiquetas largas)
function barras({ etiquetas, series }, c, ancho) {
  const multi = series.length > 1, alto = multi ? 14 : 18, sep = 2, banda = series.length * (alto + sep) + 12;
  const izq = Math.min(220, 20 + Math.max(...etiquetas.map((e) => String(e).length)) * 6.6), der = 70;
  const sup = multi ? 30 : 8, h = sup + etiquetas.length * banda + 24;
  const max = Math.max(0, ...series.flatMap((s) => s.valores));
  const { tope, paso } = escala(max), escX = (v) => izq + (Math.max(0, v) / tope) * (ancho - izq - der);
  let s = multi ? leyenda(series, c, izq, 16) : '';
  for (let v = 0; v <= tope + 1e-9; v += paso) {
    s += `<line x1="${escX(v)}" x2="${escX(v)}" y1="${sup}" y2="${h - 22}" stroke="${c.grilla}" stroke-width="1"/>`;
    s += `<text x="${escX(v)}" y="${h - 6}" font-size="11" fill="${c.texto2}" text-anchor="middle" ${FUENTE}>${fmt(v)}</text>`;
  }
  etiquetas.forEach((e, i) => {
    const y0 = sup + i * banda + 6;
    s += `<text x="${izq - 8}" y="${y0 + (series.length * (alto + sep)) / 2 + 2}" font-size="12" fill="${c.texto}" text-anchor="end" dominant-baseline="middle" ${FUENTE}>${esc(corto(e, 32))}</text>`;
    series.forEach((se, k) => {
      const v = se.valores[i] ?? 0, y = y0 + k * (alto + sep), w = Math.max(0, escX(v) - izq), r = Math.min(4, w / 2);
      // Extremo de datos redondeado (4px) y recto sobre la línea base
      const d = `M${izq},${y} h${Math.max(0, w - r)} a${r},${r} 0 0 1 ${r},${r} v${alto - 2 * r} a${r},${r} 0 0 1 ${-r},${r} h${-Math.max(0, w - r)} z`;
      s += `<path d="${d}" fill="${c.series[k]}"><title>${esc(e)}${multi ? ` · ${esc(se.nombre)}` : ''}: ${fmt(v)}</title></path>`;
      if (!multi || series.length <= 2) s += `<text x="${izq + w + 6}" y="${y + alto / 2}" font-size="11" fill="${c.texto2}" dominant-baseline="middle" ${FUENTE}>${fmt(v)}</text>`;
    });
  });
  s += `<line x1="${izq}" x2="${izq}" y1="${sup}" y2="${h - 22}" stroke="${c.texto2}" stroke-width="1"/>`;
  return { s, h };
}

// Líneas: evolución en el tiempo (eje X = categorías en orden)
function lineas({ etiquetas, series }, c, ancho) {
  const multi = series.length > 1, izq = 56, der = 44, sup = multi ? 34 : 12, h = 300, inf = 44;
  const max = Math.max(0, ...series.flatMap((s) => s.valores)), { tope, paso } = escala(max);
  const n = etiquetas.length, escX = (i) => izq + (n === 1 ? (ancho - izq - der) / 2 : (i / (n - 1)) * (ancho - izq - der));
  const escY = (v) => h - inf - (v / tope) * (h - inf - sup);
  let s = multi ? leyenda(series, c, izq, 16) : '';
  for (let v = 0; v <= tope + 1e-9; v += paso) {
    s += `<line x1="${izq}" x2="${ancho - der}" y1="${escY(v)}" y2="${escY(v)}" stroke="${c.grilla}" stroke-width="1"/>`;
    s += `<text x="${izq - 8}" y="${escY(v)}" font-size="11" fill="${c.texto2}" text-anchor="end" dominant-baseline="middle" ${FUENTE}>${fmt(v)}</text>`;
  }
  const cada = Math.ceil(n / 10);
  etiquetas.forEach((e, i) => { if (i % cada === 0 || i === n - 1) s += `<text x="${escX(i)}" y="${h - inf + 18}" font-size="11" fill="${c.texto2}" text-anchor="middle" ${FUENTE}>${esc(corto(e, 12))}</text>`; });
  series.forEach((se, k) => {
    s += `<polyline points="${se.valores.map((v, i) => `${escX(i)},${escY(v ?? 0)}`).join(' ')}" fill="none" stroke="${c.series[k]}" stroke-width="2" stroke-linejoin="round"/>`;
    se.valores.forEach((v, i) => { s += `<circle cx="${escX(i)}" cy="${escY(v ?? 0)}" r="4" fill="${c.series[k]}" stroke="${c.superficie}" stroke-width="2"><title>${esc(etiquetas[i])}${multi ? ` · ${esc(se.nombre)}` : ''}: ${fmt(v ?? 0)}</title></circle>`; });
  });
  return { s, h };
}

// Torta (anillo): partes de un total. Más de 6 categorías se agrupan en "Otros".
function torta({ etiquetas, series }, c, ancho) {
  let pares = etiquetas.map((e, i) => [e, Math.max(0, series[0].valores[i] ?? 0)]).sort((a, b) => b[1] - a[1]);
  if (pares.length > 6) pares = [...pares.slice(0, 5), ['Otros', pares.slice(5).reduce((a, p) => a + p[1], 0)]];
  const total = pares.reduce((a, p) => a + p[1], 0) || 1, R = 110, r = 66, cx = 140, cy = 130, h = 270;
  let ang = -Math.PI / 2, s = '';
  pares.forEach(([e, v], i) => {
    const a2 = ang + (v / total) * Math.PI * 2, grande = a2 - ang > Math.PI ? 1 : 0;
    const p = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
    const d = v >= total ? `M${cx - R},${cy} a${R},${R} 0 1 0 ${2 * R},0 a${R},${R} 0 1 0 ${-2 * R},0 M${cx - r},${cy} a${r},${r} 0 1 1 ${2 * r},0 a${r},${r} 0 1 1 ${-2 * r},0`
      : `M${p(R, ang)} A${R},${R} 0 ${grande} 1 ${p(R, a2)} L${p(r, a2)} A${r},${r} 0 ${grande} 0 ${p(r, ang)} Z`;
    s += `<path d="${d}" fill="${c.series[i]}" stroke="${c.superficie}" stroke-width="2" fill-rule="evenodd"><title>${esc(e)}: ${fmt(v)} (${((v / total) * 100).toFixed(1)}%)</title></path>`;
    const y = 40 + i * 30;
    s += `<rect x="${cx + R + 50}" y="${y - 10}" width="12" height="12" rx="2" fill="${c.series[i]}"/>`;
    s += `<text x="${cx + R + 70}" y="${y}" font-size="13" fill="${c.texto}" ${FUENTE}>${esc(corto(e, 34))}</text>`;
    s += `<text x="${ancho - 10}" y="${y}" font-size="13" fill="${c.texto2}" text-anchor="end" ${FUENTE}>${fmt(v)} · ${((v / total) * 100).toFixed(1)}%</text>`;
    ang = a2;
  });
  s += `<text x="${cx}" y="${cy - 4}" font-size="20" font-weight="bold" fill="${c.texto}" text-anchor="middle" ${FUENTE}>${fmt(total)}</text><text x="${cx}" y="${cy + 16}" font-size="11" fill="${c.texto2}" text-anchor="middle" ${FUENTE}>total</text>`;
  return { s, h };
}

/** datos: { etiquetas: [...], series: [{ nombre, valores: [...] }] } */
export function svgGrafico(clase, datos, colores = PALETA_CLARA, ancho = 720) {
  const d = { etiquetas: datos.etiquetas.slice(0, clase === 'lineas' ? 400 : 40), series: datos.series.slice(0, 8).map((s) => ({ ...s, valores: s.valores.slice(0, 400) })) };
  const { s, h } = (clase === 'lineas' ? lineas : clase === 'torta' ? torta : barras)(d, colores, ancho);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${h}" viewBox="0 0 ${ancho} ${h}" role="img">${s}</svg>`;
}

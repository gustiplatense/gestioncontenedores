// Recorrido óptimo entre paradas. Usa el servicio público de rutas de OpenStreetMap (OSRM), que
// ordena las paradas y devuelve el trazado por calles. Si no responde, ordena localmente en línea recta.
const OSRM = 'https://router.project-osrm.org';

const dist = (a, b) => {
  const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Vecino más cercano + mejora 2-opt (recorrido abierto que empieza en el primer punto)
function ordenLocal(pts) {
  const n = pts.length, orden = [0], libres = new Set(pts.keys()); libres.delete(0);
  while (libres.size) {
    const ult = pts[orden[orden.length - 1]];
    let mejor = -1, dm = Infinity;
    for (const i of libres) { const d = dist(ult, pts[i]); if (d < dm) { dm = d; mejor = i; } }
    orden.push(mejor); libres.delete(mejor);
  }
  for (let mejora = true, vueltas = 0; mejora && vueltas < 50; vueltas++) {
    mejora = false;
    for (let i = 1; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
      const a = pts[orden[i - 1]], b = pts[orden[i]], c = pts[orden[j]], d = orden[j + 1] !== undefined ? pts[orden[j + 1]] : null;
      const antes = dist(a, b) + (d ? dist(c, d) : 0), despues = dist(a, c) + (d ? dist(b, d) : 0);
      if (despues + 1e-9 < antes) { orden.splice(i, j - i + 1, ...orden.slice(i, j + 1).reverse()); mejora = true; }
    }
  }
  return orden;
}

/**
 * @param paradas [{lat, lng}]  puntos a visitar
 * @param inicio  {lat, lng} | null  posición de partida (GPS del operario)
 * @returns { orden: índices de `paradas` en orden de visita, linea: [[lat,lng]], km, min, porCalles }
 */
export async function calcularRuta(paradas, inicio = null) {
  if (!paradas.length) return { orden: [], linea: [], km: 0, min: 0, porCalles: false };
  // Sin punto de partida se empieza por la parada más al norte, para que el resultado sea estable
  const base = inicio ? 0 : paradas.reduce((m, p, i) => (p.lat > paradas[m].lat ? i : m), 0);
  const pts = inicio ? [inicio, ...paradas] : [paradas[base], ...paradas.filter((_, i) => i !== base)];
  const aParada = (i) => (inicio ? i - 1 : i === 0 ? base : i - 1 < base ? i - 1 : i);

  if (pts.length >= 2) {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
      const coords = pts.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
      const r = await fetch(`${OSRM}/trip/v1/driving/${coords}?source=first&destination=any&roundtrip=false&geometries=geojson&overview=full`, { signal: ctl.signal });
      clearTimeout(t);
      const j = await r.json();
      if (j.code === 'Ok') {
        const orden = j.waypoints.map((w, i) => [w.waypoint_index, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i)
          .filter((i) => !(inicio && i === 0)).map(aParada);
        return {
          orden, linea: j.trips[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          km: j.trips[0].distance / 1000, min: Math.round(j.trips[0].duration / 60), porCalles: true,
        };
      }
    } catch { /* sin servicio de rutas: se ordena localmente */ }
  }
  const ord = ordenLocal(pts);
  let km = 0;
  for (let i = 1; i < ord.length; i++) km += dist(pts[ord[i - 1]], pts[ord[i]]);
  return {
    orden: ord.filter((i) => !(inicio && i === 0)).map(aParada),
    linea: ord.map((i) => [pts[i].lat, pts[i].lng]), km, min: null, porCalles: false,
  };
}

// Dibuja el recorrido en un mapa Leaflet: línea + paradas numeradas. Devuelve la capa para poder quitarla.
export function dibujarRuta(mapa, paradasEnOrden, ruta, alTocar) {
  const capa = L.layerGroup().addTo(mapa);
  L.polyline(ruta.linea, { color: '#1f6fd6', weight: 4, opacity: 0.8, dashArray: ruta.porCalles ? null : '6 8' }).addTo(capa);
  paradasEnOrden.forEach((p, i) => {
    const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<div class="parada">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(capa);
    if (p.titulo) m.bindTooltip(p.titulo);
    if (alTocar) m.on('click', () => alTocar(p, i));
  });
  return capa;
}
export const resumenRuta = (r) => `${r.km.toFixed(1)} km${r.min ? ` · ${r.min} min en vehículo` : ''}${r.porCalles ? '' : ' (en línea recta: sin servicio de rutas)'}`;

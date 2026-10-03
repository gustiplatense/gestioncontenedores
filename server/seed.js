// Datos de ejemplo FICTICIOS para la demo (ubicaciones y direcciones generadas al azar).
import { db, tx, distanciaM, DEPOSITO } from './db.js';

const TIPOS = [
  [1, 'Contenedor tapa Buzón 3.200 L', 3200, 'contenedor', 0.14],
  [2, 'Contenedor 3.200 L New', 3200, 'contenedor', 0.12],
  [3, 'Contenedor 3.200 L a pedal', 3200, 'contenedor', 0.10],
  [4, 'Contenedor carga Bilateral 2.800 L', 2800, 'contenedor', 0.08],
  [5, 'Contenedor 1.100 L', 1100, 'contenedor', 0.12],
  [6, 'Cesto 500 L', 500, 'cesto', 0.06],
  [7, 'Cesto papelero Towny 50 L', 50, 'cesto', 0.20],
  [8, 'Cesto papelero City 50 L', 50, 'cesto', 0.18],
];
const BARRIOS = [
  ['Nueva Pompeya', -34.652, -58.418], ['Palermo', -34.580, -58.425], ['Caballito', -34.619, -58.442],
  ['Belgrano', -34.562, -58.456], ['Flores', -34.632, -58.463], ['Almagro', -34.609, -58.421],
  ['Recoleta', -34.588, -58.395], ['San Telmo', -34.621, -58.372], ['Villa Urquiza', -34.573, -58.487],
  ['Barracas', -34.645, -58.381], ['Balvanera', -34.609, -58.403], ['Villa Crespo', -34.599, -58.439],
  ['Mataderos', -34.658, -58.502], ['Villa Devoto', -34.600, -58.512], ['Parque Patricios', -34.637, -58.401],
];
const CALLES = ['Av. Rivadavia', 'Av. Corrientes', 'Av. Santa Fe', 'Av. Cabildo', 'Av. La Plata', 'Av. Sáenz',
  'Av. Caseros', 'Av. Juan B. Justo', 'Av. Directorio', 'Av. San Juan', 'Av. Independencia', 'Av. Córdoba',
  'Av. Scalabrini Ortiz', 'Av. Triunvirato', 'Av. Nazca', 'Av. Boedo', 'Av. Entre Ríos', 'Av. Montes de Oca'];
const MOTIVOS_REP = ['Tapa rota', 'Pedal trabado', 'Rueda dañada', 'Vandalismo / incendio', 'Cuerpo fisurado'];

// PRNG determinístico para que la demo sea siempre igual
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function seedSiVacio(n = Number(process.env.SEED_N || 3000)) {
  if (db.prepare('SELECT COUNT(*) c FROM contenedores').get().c > 0) return false;
  const rnd = mulberry32(20261003);
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 0.58; // ~N(0,1)
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const hex = (len) => Array.from({ length: len }, () => '0123456789ABCDEF'[Math.floor(rnd() * 16)]).join('');
  const now = Date.now(), H = 3600e3;
  const iso = (ms) => new Date(ms).toISOString();

  tx(() => {
    const insT = db.prepare('INSERT INTO tipos VALUES (?,?,?,?)');
    for (const t of TIPOS) insT.run(t[0], t[1], t[2], t[3]);

    const insU = db.prepare('INSERT OR IGNORE INTO usuarios VALUES (?,?,?,1)');
    insU.run('admin@demo.hassa', 'Administración (demo)', 'admin');
    insU.run('operador@demo.hassa', 'Operador de calle (demo)', 'operador');
    insU.run('consulta@demo.hassa', 'Consulta (demo)', 'consulta');
    db.prepare('INSERT OR IGNORE INTO api_keys VALUES (?,?)').run(process.env.API_KEY || 'demo-key', 'Integrador demo');

    const insC = db.prepare(`INSERT INTO contenedores
      (id,nro_inventario,tag_id,tipo_id,estado,lat,lng,direccion,barrio,fecha_alta,ult_lectura_ts,ult_lat,ult_lng,ult_desvio_m)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insL = db.prepare('INSERT OR IGNORE INTO lecturas (tag_id,lat,lng,ts,origen) VALUES (?,?,?,?,?)');
    const insG = db.prepare(`INSERT INTO gestiones
      (contenedor_id,tipo,estado,motivo,observaciones,lat,lng,usuario_email,ts) VALUES (?,?,?,?,?,?,?,?,?)`);

    for (let i = 1; i <= n; i++) {
      let r = rnd(), tipo = TIPOS[TIPOS.length - 1][0];
      for (const t of TIPOS) { if ((r -= t[4]) < 0) { tipo = t[0]; break; } }
      const e = rnd();
      const estado = e < 0.85 ? 'en_servicio' : e < 0.94 ? 'en_deposito' : e < 0.98 ? 'reparacion' : 'baja';
      const nro = 'HAS-' + String(i).padStart(6, '0');
      const tag = 'E280' + hex(20);
      const alta = iso(now - (30 + rnd() * 1400) * 24 * H).slice(0, 10);

      let lat, lng, dir, barrio;
      if (estado === 'en_deposito') {
        ({ lat, lng, direccion: dir, barrio } = DEPOSITO);
      } else {
        const b = pick(BARRIOS);
        barrio = b[0]; lat = b[1] + gauss() * 0.006; lng = b[2] + gauss() * 0.007;
        dir = `${pick(CALLES)} ${100 + Math.floor(rnd() * 5900)}`;
      }

      // Lecturas: 3 por día. La mayoría reciente; algunas sin lectura >48 h; algunas fuera de su ubicación.
      let ultTs = null, ultLat = null, ultLng = null, desvio = null;
      if (estado !== 'baja') {
        const a = rnd();
        const sinLectura = estado === 'en_servicio' && a < 0.03;
        const fuera = estado === 'en_servicio' && a >= 0.03 && a < 0.045;
        const horasUlt = sinLectura ? 50 + rnd() * 200 : rnd() * 8;
        for (let k = 2; k >= 0; k--) {
          const ts = now - (horasUlt + k * 8) * H;
          const off = fuera && k === 0 ? 0.002 + rnd() * 0.006 : 0.00008;
          const la = lat + gauss() * off, ln = lng + gauss() * off;
          insL.run(tag, la, ln, iso(ts), 'seed');
          if (k === 0) { ultTs = iso(ts); ultLat = la; ultLng = ln; desvio = distanciaM(lat, lng, la, ln); }
        }
      }
      insC.run(i, nro, tag, tipo, estado, lat, lng, dir, barrio, alta, ultTs, ultLat, ultLng, desvio);

      if (estado === 'reparacion') {
        insG.run(i, 'reparacion', 'pendiente', pick(MOTIVOS_REP), null, lat, lng, 'operador@demo.hassa', iso(now - rnd() * 240 * H));
      } else if (estado === 'baja') {
        insG.run(i, 'baja', 'registrada', 'Fin de vida útil', null, lat, lng, 'operador@demo.hassa', iso(now - rnd() * 2000 * H));
      } else if (estado === 'en_servicio' && rnd() < 0.01) {
        insG.run(i, 'movimiento', 'registrada', null, 'Reubicación solicitada por la comuna', lat, lng, 'operador@demo.hassa', iso(now - rnd() * 500 * H));
      }
    }
  });
  return true;
}

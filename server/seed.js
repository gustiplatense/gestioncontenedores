// Carga inicial de la demo.
// - Equipos y puntos de recolección: REALES, tomados del inventario (server/datos/inventario.json).
// - Tag ID, estados, lecturas, gestiones y reclamos: SIMULADOS para poder mostrar el sistema funcionando.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, tx, distanciaM, DEPOSITO, MOTIVOS_RECLAMO } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOTIVOS_REP = ['Tapa rota', 'Pedal trabado', 'Rueda dañada', 'Vandalismo / incendio', 'Cuerpo fisurado'];
const OBS_RECLAMO = ['La tapa no cierra', 'Está roto de un costado', 'Le faltan las calcomanías', 'Hace días que está así', 'Pierde líquido', ''];

// PRNG determinístico para que la demo sea siempre igual
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function seedSiVacio() {
  if (db.prepare('SELECT COUNT(*) c FROM contenedores').get().c > 0) return false;
  const inv = JSON.parse(fs.readFileSync(path.join(__dirname, 'datos', 'inventario.json'), 'utf8'));
  const rnd = mulberry32(20261007);
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 0.58; // ~N(0,1)
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const hex = (len) => Array.from({ length: len }, () => '0123456789ABCDEF'[Math.floor(rnd() * 16)]).join('');
  const now = Date.now(), H = 3600e3, DIA = 24 * H;
  const iso = (ms) => new Date(ms).toISOString();
  const pesoBarrio = inv.barrios.map(() => 0.5 + rnd() * 1.3);   // barrios con más o menos actividad de lectura

  tx(() => {
    const insT = db.prepare('INSERT INTO tipos VALUES (?,?,?)');
    inv.tipos.forEach((n, i) => insT.run(i + 1, n, /cesto/i.test(n) ? 'cesto' : 'contenedor'));

    const insU = db.prepare('INSERT OR IGNORE INTO usuarios VALUES (?,?,?,1)');
    insU.run('admin@demo.hassa', 'Administración (demo)', 'admin');
    insU.run('operador@demo.hassa', 'Operario Juan (demo)', 'operador');
    insU.run('operador2@demo.hassa', 'Operario María (demo)', 'operador');
    insU.run('consulta@demo.hassa', 'Consulta (demo)', 'consulta');
    db.prepare('INSERT OR IGNORE INTO api_keys VALUES (?,?)').run(process.env.API_KEY || 'demo-key', 'Integrador demo');
    db.prepare('INSERT OR IGNORE INTO config VALUES (?,?)').run('empresa_email', process.env.EMPRESA_EMAIL || '');

    const insP = db.prepare('INSERT INTO puntos VALUES (?,?,?,?,?,?,?)');
    const insC = db.prepare(`INSERT INTO contenedores
      (id,nro_inventario,tag_id,tipo_id,estado,punto_id,lat,lng,direccion,calle,altura,barrio,clase,posicion,emplazamiento,
       fecha_alta,ult_lectura_ts,ult_lat,ult_lng,ult_desvio_m) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insL = db.prepare('INSERT OR IGNORE INTO lecturas (tag_id,lat,lng,ts,origen) VALUES (?,?,?,?,?)');
    const insG = db.prepare(`INSERT INTO gestiones
      (contenedor_id,tipo,estado,motivo,observaciones,lat,lng,usuario_email,ts) VALUES (?,?,?,?,?,?,?,?,?)`);
    const enCalle = [];

    for (const [id, puntoId, iCalle, altura, iTipo, iClase, iPos, iEmpl, iBarrio, lat, lng] of inv.filas) {
      const calle = inv.calles[iCalle], barrio = inv.barrios[iBarrio], tipo = iTipo + 1;
      insP.run(puntoId, calle, altura, barrio, lat, lng, tipo);

      // Estados simulados. Los "en depósito" y "baja" dejan su punto vacío (retirado sin reposición).
      const e = rnd();
      const estado = e < 0.015 ? 'en_deposito' : e < 0.022 ? 'baja' : e < 0.04 ? 'reparacion' : 'en_servicio';
      const enPunto = estado === 'en_servicio' || estado === 'reparacion';
      const tag = 'E280' + hex(20);

      // Lecturas simuladas de los últimos 7 días; la cantidad varía por barrio (para el mapa de calor).
      let ultTs = null, ultLat = null, ultLng = null, desvio = null;
      if (enPunto) {
        const a = rnd();
        const sinLecturasLargo = estado === 'en_servicio' && a < 0.012;          // +7 días: cuenta como punto vacío
        const sinLectura48 = estado === 'en_servicio' && a >= 0.012 && a < 0.035;
        const fuera = estado === 'en_servicio' && a >= 0.035 && a < 0.05;
        const horasUlt = sinLecturasLargo ? (8 + rnd() * 30) * 24 : sinLectura48 ? 50 + rnd() * 100 : rnd() * 8;
        const n = sinLecturasLargo || sinLectura48 ? 1 : 1 + Math.floor(rnd() * rnd() * 12 * pesoBarrio[iBarrio]);
        for (let k = n - 1; k >= 0; k--) {
          const ts = now - (horasUlt + k * (150 / n)) * H;
          const off = fuera && k === 0 ? 0.002 + rnd() * 0.004 : 0.00006;
          const la = lat + gauss() * off, ln = lng + gauss() * off;
          insL.run(tag, la, ln, iso(ts), 'seed');
          if (k === 0) { ultTs = iso(ts); ultLat = la; ultLng = ln; desvio = distanciaM(lat, lng, la, ln); }
        }
      }
      const u = estado === 'en_deposito' ? DEPOSITO : { lat, lng, direccion: `${calle} ${altura}`, barrio };
      insC.run(id, String(id), tag, tipo, estado, enPunto ? puntoId : null, u.lat, u.lng, u.direccion,
        enPunto || estado === 'baja' ? calle : null, enPunto || estado === 'baja' ? altura : null, u.barrio,
        inv.clases[iClase], inv.posiciones[iPos], inv.emplazamientos[iEmpl], '2014-10-01', ultTs, ultLat, ultLng, desvio);

      if (estado === 'reparacion') insG.run(id, 'reparacion', 'pendiente', pick(MOTIVOS_REP), null, lat, lng, 'operador@demo.hassa', iso(now - rnd() * 10 * DIA));
      else if (estado === 'baja') insG.run(id, 'baja', 'registrada', 'Fin de vida útil', null, lat, lng, 'operador@demo.hassa', iso(now - (5 + rnd() * 60) * DIA));
      else if (estado === 'en_servicio') enCalle.push({ id, lat, lng, calle, altura, barrio });
    }

    // Reclamos de vecinos de ejemplo: 20 ya programados para un operario (con su ruta) y 10 pendientes sin asignar.
    const insR = db.prepare(`INSERT INTO reclamos
      (contenedor_id,motivo,observaciones,lat,lng,calle,altura,barrio,nombre,email,estado,operario_email,programado_ts,ts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const elegir = (zona, n) => {
      const c = enCalle.filter((x) => x.lat > zona[0] && x.lat < zona[1] && x.lng > zona[2] && x.lng < zona[3]);
      const out = [];
      while (out.length < n && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]);
      return out;
    };
    const cargar = (lista, estado, operario) => lista.forEach((c, i) => {
      const ts = now - (0.2 + rnd() * 5) * DIA;
      insR.run(c.id, MOTIVOS_RECLAMO[i % MOTIVOS_RECLAMO.length], pick(OBS_RECLAMO) || null, c.lat + gauss() * 0.00005, c.lng + gauss() * 0.00005,
        c.calle, String(c.altura), c.barrio, `Vecino de ejemplo ${i + 1}`, null, estado, operario, operario ? iso(ts + 2 * H) : null, iso(ts));
    });
    cargar(elegir([-34.626, -34.611, -58.386, -58.368], 20), 'programado', 'operador@demo.hassa');   // San Telmo / Monserrat
    cargar(elegir([-34.601, -34.590, -58.386, -58.370], 10), 'pendiente', null);                     // Retiro / San Nicolás
  });
  return true;
}

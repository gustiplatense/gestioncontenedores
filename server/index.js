import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { OAuth2Client } from 'google-auth-library';
import { db, tx, distanciaM, DEPOSITO, FOTOS_DIR } from './db.js';
import { seedSiVacio } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
const MODO_DEMO = !GOOGLE_CLIENT_ID;
const HORAS_SIN_LECTURA = 48, DESVIO_MAX_M = 150;

if (seedSiVacio()) console.log('Base de datos creada con datos de ejemplo.');
if (ADMIN_EMAIL) {
  db.prepare(`INSERT INTO usuarios (email,nombre,rol,activo) VALUES (?,?,'admin',1)
              ON CONFLICT(email) DO UPDATE SET rol='admin', activo=1`).run(ADMIN_EMAIL, ADMIN_EMAIL);
}

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '12mb' }));

// ---------- Autenticación ----------
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function cookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function crearSesion(req, res, email) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesiones VALUES (?,?,?)').run(token, email, new Date().toISOString());
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 86400}${secure}`);
}
function usuarioDe(req) {
  const sid = cookie(req, 'sid');
  if (!sid) return null;
  return db.prepare(`SELECT u.email, u.nombre, u.rol FROM sesiones s
    JOIN usuarios u ON u.email = s.email WHERE s.token = ? AND u.activo = 1`).get(sid) || null;
}
const auth = (...roles) => (req, res, next) => {
  const u = usuarioDe(req);
  if (!u) return res.status(401).json({ error: 'No autenticado' });
  if (roles.length && !roles.includes(u.rol)) return res.status(403).json({ error: 'Sin permiso para esta acción' });
  req.usuario = u; next();
};

app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: GOOGLE_CLIENT_ID || null,
    demo: MODO_DEMO,
    usuariosDemo: MODO_DEMO ? db.prepare("SELECT email,nombre,rol FROM usuarios WHERE email LIKE '%@demo.hassa'").all() : [],
  });
});

// Login con Google: el navegador obtiene un ID token y el backend lo verifica.
// Solo entran los usuarios dados de alta y activos en la tabla `usuarios`.
app.post('/api/auth/google', async (req, res) => {
  if (!googleClient) return res.status(400).json({ error: 'Login con Google no configurado' });
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p.email_verified) return res.status(403).json({ error: 'Email no verificado' });
    const email = p.email.toLowerCase();
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ? AND activo = 1').get(email);
    if (!u) return res.status(403).json({ error: `La cuenta ${email} no está habilitada. Pedile acceso a un administrador.` });
    if (p.name && u.nombre === u.email) db.prepare('UPDATE usuarios SET nombre=? WHERE email=?').run(p.name, email);
    crearSesion(req, res, email);
    res.json({ ok: true });
  } catch {
    res.status(401).json({ error: 'Token de Google inválido' });
  }
});
app.post('/api/auth/demo', (req, res) => {
  if (!MODO_DEMO) return res.status(404).end();
  const u = db.prepare("SELECT email FROM usuarios WHERE email = ? AND email LIKE '%@demo.hassa' AND activo = 1").get(req.body.email || '');
  if (!u) return res.status(403).json({ error: 'Usuario demo inexistente' });
  crearSesion(req, res, u.email);
  res.json({ ok: true });
});
app.post('/api/auth/salir', (req, res) => {
  const sid = cookie(req, 'sid');
  if (sid) db.prepare('DELETE FROM sesiones WHERE token = ?').run(sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', auth(), (req, res) => res.json(req.usuario));

// ---------- Consultas ----------
const corteSinLectura = () => new Date(Date.now() - HORAS_SIN_LECTURA * 3600e3).toISOString();

function filtros(q) {
  const w = [], p = [];
  if (q.tipo) { w.push('c.tipo_id = ?'); p.push(Number(q.tipo)); }
  if (q.categoria) { w.push('t.categoria = ?'); p.push(q.categoria); }
  if (q.estado) { w.push('c.estado = ?'); p.push(q.estado); }
  if (q.barrio) { w.push('c.barrio = ?'); p.push(q.barrio); }
  if (q.alerta === 'sin_lectura') { w.push("c.estado='en_servicio' AND (c.ult_lectura_ts IS NULL OR c.ult_lectura_ts < ?)"); p.push(corteSinLectura()); }
  if (q.alerta === 'desvio') { w.push("c.estado='en_servicio' AND c.ult_desvio_m > ?"); p.push(DESVIO_MAX_M); }
  if (q.q) {
    w.push('(c.nro_inventario LIKE ? OR c.tag_id LIKE ? OR c.direccion LIKE ?)');
    const s = `%${q.q.trim()}%`; p.push(s, s, s);
  }
  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', params: p };
}

app.get('/api/tipos', auth(), (req, res) => {
  res.json({
    tipos: db.prepare('SELECT * FROM tipos ORDER BY id').all(),
    barrios: db.prepare("SELECT DISTINCT barrio FROM contenedores WHERE barrio IS NOT NULL ORDER BY barrio").all().map(r => r.barrio),
  });
});

app.get('/api/resumen', auth(), (req, res) => {
  const porEstado = Object.fromEntries(db.prepare('SELECT estado, COUNT(*) n FROM contenedores GROUP BY estado').all().map(r => [r.estado, r.n]));
  res.json({
    total: Object.values(porEstado).reduce((a, b) => a + b, 0),
    porEstado,
    porTipo: db.prepare(`SELECT t.id, t.nombre, t.categoria, COUNT(c.id) n FROM tipos t
      LEFT JOIN contenedores c ON c.tipo_id = t.id AND c.estado != 'baja' GROUP BY t.id ORDER BY t.id`).all(),
    sinLectura: db.prepare("SELECT COUNT(*) n FROM contenedores WHERE estado='en_servicio' AND (ult_lectura_ts IS NULL OR ult_lectura_ts < ?)").get(corteSinLectura()).n,
    fueraDeUbicacion: db.prepare("SELECT COUNT(*) n FROM contenedores WHERE estado='en_servicio' AND ult_desvio_m > ?").get(DESVIO_MAX_M).n,
    lecturas24h: db.prepare('SELECT COUNT(*) n FROM lecturas WHERE ts > ?').get(new Date(Date.now() - 86400e3).toISOString()).n,
    reparacionesPendientes: db.prepare("SELECT COUNT(*) n FROM gestiones WHERE tipo='reparacion' AND estado='pendiente'").get().n,
  });
});

// Puntos para el mapa, en formato compacto: [id, lat, lng, tipo_id, estado, alerta]
app.get('/api/contenedores/mapa', auth(), (req, res) => {
  const { where, params } = filtros(req.query);
  const corte = corteSinLectura();
  const filas = db.prepare(`SELECT c.id, c.lat, c.lng, c.tipo_id, c.estado, c.ult_lectura_ts, c.ult_desvio_m
    FROM contenedores c JOIN tipos t ON t.id = c.tipo_id ${where}`).all(...params);
  res.json(filas.filter(f => f.lat != null).map(f => [
    f.id, +f.lat.toFixed(6), +f.lng.toFixed(6), f.tipo_id, f.estado,
    f.estado !== 'en_servicio' ? '' : (!f.ult_lectura_ts || f.ult_lectura_ts < corte) ? 'sin_lectura' : f.ult_desvio_m > DESVIO_MAX_M ? 'desvio' : '',
  ]));
});

app.get('/api/contenedores', auth(), (req, res) => {
  const { where, params } = filtros(req.query);
  const limit = Math.min(Number(req.query.limit) || 50, 200), offset = Number(req.query.offset) || 0;
  const total = db.prepare(`SELECT COUNT(*) n FROM contenedores c JOIN tipos t ON t.id = c.tipo_id ${where}`).get(...params).n;
  const items = db.prepare(`SELECT c.*, t.nombre tipo FROM contenedores c JOIN tipos t ON t.id = c.tipo_id
    ${where} ORDER BY c.id LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.json({ total, items });
});

// Busca por id interno, número de inventario o tag id
function buscarContenedor(ref) {
  const s = String(ref || '').trim();
  return db.prepare(`SELECT c.*, t.nombre tipo, t.categoria, t.capacidad_l FROM contenedores c
    JOIN tipos t ON t.id = c.tipo_id
    WHERE c.nro_inventario = ? COLLATE NOCASE OR c.tag_id = ? COLLATE NOCASE OR c.id = ?`)
    .get(s, s, /^\d+$/.test(s) ? Number(s) : -1);
}

app.get('/api/contenedores/:ref', auth(), (req, res) => {
  const c = buscarContenedor(req.params.ref);
  if (!c) return res.status(404).json({ error: 'Contenedor no encontrado' });
  c.sin_lectura = c.estado === 'en_servicio' && (!c.ult_lectura_ts || c.ult_lectura_ts < corteSinLectura());
  c.fuera_de_ubicacion = c.estado === 'en_servicio' && c.ult_desvio_m > DESVIO_MAX_M;
  c.lecturas = db.prepare('SELECT lat,lng,ts,origen FROM lecturas WHERE tag_id = ? ORDER BY ts DESC LIMIT 10').all(c.tag_id);
  c.gestiones = db.prepare(`SELECT g.*, r.nro_inventario reemplazo FROM gestiones g
    LEFT JOIN contenedores r ON r.id = g.reemplazo_id
    WHERE g.contenedor_id = ? OR g.reemplazo_id = ? ORDER BY g.ts DESC LIMIT 20`).all(c.id, c.id);
  res.json(c);
});

// QR que se imprime en el contenedor: abre la app de campo directamente en ese contenedor
app.get('/api/contenedores/:ref/qr.svg', auth(), async (req, res) => {
  const c = buscarContenedor(req.params.ref);
  if (!c) return res.status(404).end();
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  const svg = await QRCode.toString(`${base}/campo/?c=${c.nro_inventario}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});

// ---------- Gestiones (bajas, movimientos, recambios, reparaciones) ----------
function guardarFoto(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const nombre = `${crypto.randomUUID()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(FOTOS_DIR, nombre), Buffer.from(m[2], 'base64'));
  return nombre;
}
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

app.post('/api/gestiones', auth('admin', 'operador'), (req, res) => {
  const b = req.body || {};
  const c = buscarContenedor(b.contenedor);
  if (!c) return res.status(404).json({ error: 'Contenedor no encontrado' });
  if (!['movimiento', 'recambio', 'reparacion', 'baja'].includes(b.tipo)) return res.status(400).json({ error: 'Tipo de gestión inválido' });
  if (c.estado === 'baja') return res.status(409).json({ error: 'El contenedor ya está dado de baja' });
  const lat = num(b.lat), lng = num(b.lng);

  let nuevo = null;
  if (b.tipo === 'movimiento' && (lat === null || lng === null)) {
    return res.status(400).json({ error: 'El movimiento necesita la ubicación (GPS) del nuevo emplazamiento' });
  }
  if (b.tipo === 'recambio') {
    nuevo = buscarContenedor(b.reemplazo);
    if (!nuevo) return res.status(404).json({ error: 'Contenedor de reemplazo no encontrado' });
    if (nuevo.id === c.id) return res.status(400).json({ error: 'El reemplazo no puede ser el mismo contenedor' });
    if (nuevo.estado !== 'en_deposito') return res.status(409).json({ error: `El reemplazo ${nuevo.nro_inventario} no está en depósito` });
    if (c.estado !== 'en_servicio' && c.estado !== 'reparacion') return res.status(409).json({ error: 'El contenedor a reemplazar no está en la vía pública' });
  }

  const foto = guardarFoto(b.foto);
  const ts = new Date().toISOString();
  const id = tx(() => {
    const upd = (sql, ...p) => db.prepare(sql).run(...p);
    if (b.tipo === 'baja') upd("UPDATE contenedores SET estado='baja' WHERE id=?", c.id);
    if (b.tipo === 'reparacion') upd("UPDATE contenedores SET estado='reparacion' WHERE id=?", c.id);
    if (b.tipo === 'movimiento') {
      upd("UPDATE contenedores SET lat=?, lng=?, direccion=COALESCE(?,direccion), estado='en_servicio', ult_desvio_m=NULL WHERE id=?",
        lat, lng, b.direccion || null, c.id);
    }
    if (b.tipo === 'recambio') {
      // El nuevo ocupa el lugar del viejo; el viejo vuelve al depósito.
      upd("UPDATE contenedores SET estado='en_servicio', lat=?, lng=?, direccion=?, barrio=?, ult_desvio_m=NULL WHERE id=?",
        c.lat, c.lng, c.direccion, c.barrio, nuevo.id);
      upd("UPDATE contenedores SET estado='en_deposito', lat=?, lng=?, direccion=?, barrio=?, ult_desvio_m=NULL WHERE id=?",
        DEPOSITO.lat, DEPOSITO.lng, DEPOSITO.direccion, DEPOSITO.barrio, c.id);
    }
    return db.prepare(`INSERT INTO gestiones
      (contenedor_id,tipo,estado,motivo,observaciones,lat,lng,foto,reemplazo_id,usuario_email,ts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(c.id, b.tipo, b.tipo === 'reparacion' ? 'pendiente' : 'registrada',
      b.motivo || null, b.observaciones || null, lat, lng, foto, nuevo ? nuevo.id : null, req.usuario.email, ts).lastInsertRowid;
  });
  res.status(201).json({ id: Number(id), ts });
});

app.get('/api/gestiones', auth(), (req, res) => {
  const w = [], p = [];
  if (req.query.tipo) { w.push('g.tipo = ?'); p.push(req.query.tipo); }
  if (req.query.estado) { w.push('g.estado = ?'); p.push(req.query.estado); }
  if (req.query.mias) { w.push('g.usuario_email = ?'); p.push(req.usuario.email); }
  res.json(db.prepare(`SELECT g.*, c.nro_inventario, c.direccion, c.barrio, t.nombre tipo_contenedor, r.nro_inventario reemplazo
    FROM gestiones g JOIN contenedores c ON c.id = g.contenedor_id JOIN tipos t ON t.id = c.tipo_id
    LEFT JOIN contenedores r ON r.id = g.reemplazo_id
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY g.ts DESC LIMIT ?`).all(...p, Math.min(Number(req.query.limit) || 100, 300)));
});

app.post('/api/gestiones/:id/resolver', auth('admin'), (req, res) => {
  const g = db.prepare("SELECT * FROM gestiones WHERE id = ? AND tipo='reparacion' AND estado='pendiente'").get(Number(req.params.id));
  if (!g) return res.status(404).json({ error: 'Solicitud pendiente no encontrada' });
  tx(() => {
    db.prepare("UPDATE gestiones SET estado='resuelta' WHERE id=?").run(g.id);
    db.prepare("UPDATE contenedores SET estado='en_servicio' WHERE id=? AND estado='reparacion'").run(g.contenedor_id);
  });
  res.json({ ok: true });
});

// ---------- Usuarios (administración de accesos) ----------
app.get('/api/usuarios', auth('admin'), (req, res) => res.json(db.prepare('SELECT * FROM usuarios ORDER BY email').all()));
app.post('/api/usuarios', auth('admin'), (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const rol = req.body.rol;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Email inválido' });
  if (!['admin', 'operador', 'consulta'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  const activo = req.body.activo === false ? 0 : 1;
  if (email === req.usuario.email && (rol !== 'admin' || !activo)) return res.status(400).json({ error: 'No podés quitarte tu propio acceso de administrador' });
  db.prepare(`INSERT INTO usuarios (email,nombre,rol,activo) VALUES (?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET rol=excluded.rol, activo=excluded.activo, nombre=COALESCE(NULLIF(?, ''), nombre)`)
    .run(email, req.body.nombre || email, rol, activo, req.body.nombre || '');
  if (!activo) db.prepare('DELETE FROM sesiones WHERE email = ?').run(email);
  res.json({ ok: true });
});

// ---------- API para aplicaciones de terceros (lecturas de tags) ----------
const authApiKey = (req, res, next) => {
  const k = db.prepare('SELECT * FROM api_keys WHERE clave = ?').get(req.get('x-api-key') || '');
  if (!k) return res.status(401).json({ error: 'API key inválida' });
  req.integrador = k.integrador; next();
};

// POST /api/v1/lecturas  { lecturas: [{ tag_id, lat, lng, ts? }] }  (lote, idempotente)
app.post('/api/v1/lecturas', authApiKey, (req, res) => {
  const lote = Array.isArray(req.body?.lecturas) ? req.body.lecturas : null;
  if (!lote) return res.status(400).json({ error: 'Se espera { lecturas: [...] }' });
  if (lote.length > 5000) return res.status(413).json({ error: 'Máximo 5000 lecturas por lote' });
  const ins = db.prepare('INSERT OR IGNORE INTO lecturas (tag_id,lat,lng,ts,origen) VALUES (?,?,?,?,?)');
  const sel = db.prepare('SELECT id, lat, lng, ult_lectura_ts FROM contenedores WHERE tag_id = ?');
  const upd = db.prepare('UPDATE contenedores SET ult_lectura_ts=?, ult_lat=?, ult_lng=?, ult_desvio_m=? WHERE id=?');
  const r = { recibidas: lote.length, aceptadas: 0, duplicadas: 0, rechazadas: [] };
  tx(() => {
    lote.forEach((l, i) => {
      const lat = num(l?.lat), lng = num(l?.lng), tag = String(l?.tag_id || '').toUpperCase();
      const d = l?.ts ? new Date(l.ts) : new Date();
      if (!tag || lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || isNaN(d)) {
        return r.rechazadas.push({ indice: i, motivo: 'datos inválidos' });
      }
      const c = sel.get(tag);
      if (!c) return r.rechazadas.push({ indice: i, motivo: 'tag desconocido' });
      const ts = d.toISOString();
      if (ins.run(tag, lat, lng, ts, req.integrador).changes === 0) return r.duplicadas++;
      r.aceptadas++;
      if (!c.ult_lectura_ts || ts > c.ult_lectura_ts) {
        upd.run(ts, lat, lng, c.lat != null ? distanciaM(c.lat, c.lng, lat, lng) : null, c.id);
      }
    });
  });
  res.json(r);
});
app.get('/api/v1/tags', authApiKey, (req, res) => {
  res.json(db.prepare("SELECT tag_id, lat, lng FROM contenedores WHERE estado='en_servicio' ORDER BY RANDOM() LIMIT ?")
    .all(Math.min(Number(req.query.limit) || 100, 5000)));
});

// ---------- Archivos estáticos ----------
app.use('/fotos', auth(), express.static(FOTOS_DIR));
app.use('/vendor/leaflet', express.static(path.join(ROOT, 'node_modules/leaflet/dist')));
app.use('/vendor/markercluster', express.static(path.join(ROOT, 'node_modules/leaflet.markercluster/dist')));
app.use('/vendor/html5-qrcode', express.static(path.join(ROOT, 'node_modules/html5-qrcode')));
app.use(express.static(path.join(ROOT, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Error interno' });
});

app.listen(PORT, () => {
  console.log(`Hassa demo en http://localhost:${PORT}  (backoffice)  y  http://localhost:${PORT}/campo/  (app de campo)`);
  console.log(MODO_DEMO ? 'Modo demo: login sin Google (definí GOOGLE_CLIENT_ID para activarlo).' : 'Login con Google activo.');
});

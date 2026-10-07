// Base de datos de la demo: SQLite embebido (node:sqlite, sin dependencias nativas).
// En producción este mismo esquema va a PostgreSQL + PostGIS.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
export const FOTOS_DIR = path.join(DATA_DIR, 'fotos');
fs.mkdirSync(FOTOS_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'hassa.db'));
db.exec('PRAGMA journal_mode = WAL;');

// Si la base es de una versión anterior de la demo, se descarta y se vuelve a generar.
const VERSION = 2;
if (db.prepare('PRAGMA user_version').get().user_version !== VERSION) {
  for (const t of ['mails', 'reclamos', 'config', 'gestiones', 'lecturas', 'contenedores', 'puntos', 'tipos', 'sesiones', 'usuarios', 'api_keys']) {
    db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  db.exec(`PRAGMA user_version = ${VERSION}`);
}
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS tipos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL            -- contenedor | cesto
);
-- Punto de recolección: el lugar de la vía pública donde debe haber un equipo
CREATE TABLE IF NOT EXISTS puntos (
  id INTEGER PRIMARY KEY,            -- ID_PUNTO_RECO
  calle TEXT, altura INTEGER, barrio TEXT,
  lat REAL NOT NULL, lng REAL NOT NULL,
  tipo_id INTEGER NOT NULL REFERENCES tipos(id)
);
CREATE TABLE IF NOT EXISTS contenedores (
  id INTEGER PRIMARY KEY,            -- ID_EQUIPO
  nro_inventario TEXT NOT NULL UNIQUE,
  tag_id TEXT NOT NULL UNIQUE,
  tipo_id INTEGER NOT NULL REFERENCES tipos(id),
  estado TEXT NOT NULL,              -- en_servicio | en_deposito | reparacion | baja
  punto_id INTEGER REFERENCES puntos(id),   -- punto que ocupa (NULL si no está en un punto)
  lat REAL, lng REAL,                -- ubicación asignada
  direccion TEXT, calle TEXT, altura INTEGER, barrio TEXT,
  clase TEXT, posicion TEXT, emplazamiento TEXT,
  fecha_alta TEXT NOT NULL,
  ult_lectura_ts TEXT, ult_lat REAL, ult_lng REAL, ult_desvio_m REAL
);
CREATE INDEX IF NOT EXISTS ix_cont_estado ON contenedores(estado);
CREATE INDEX IF NOT EXISTS ix_cont_punto ON contenedores(punto_id);
CREATE TABLE IF NOT EXISTS lecturas (
  id INTEGER PRIMARY KEY,
  tag_id TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  ts TEXT NOT NULL,
  origen TEXT NOT NULL,
  UNIQUE(tag_id, ts, origen)         -- idempotencia ante reintentos del integrador
);
CREATE INDEX IF NOT EXISTS ix_lect_tag ON lecturas(tag_id, ts);
CREATE INDEX IF NOT EXISTS ix_lect_ts ON lecturas(ts);
CREATE TABLE IF NOT EXISTS gestiones (
  id INTEGER PRIMARY KEY,
  contenedor_id INTEGER NOT NULL REFERENCES contenedores(id),
  tipo TEXT NOT NULL,                -- movimiento | recambio | reparacion | baja
  estado TEXT NOT NULL,              -- registrada | pendiente | resuelta
  motivo TEXT, observaciones TEXT,
  lat REAL, lng REAL, foto TEXT,
  reemplazo_id INTEGER REFERENCES contenedores(id),
  usuario_email TEXT NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_gest_cont ON gestiones(contenedor_id);
-- Reclamos cargados por vecinos o empresas desde la app pública
CREATE TABLE IF NOT EXISTS reclamos (
  id INTEGER PRIMARY KEY,
  contenedor_id INTEGER NOT NULL REFERENCES contenedores(id),
  motivo TEXT NOT NULL,
  observaciones TEXT,
  fotos TEXT NOT NULL DEFAULT '[]',  -- JSON con nombres de archivo
  lat REAL, lng REAL,                -- GPS del celular del vecino
  calle TEXT, altura TEXT, barrio TEXT,
  nombre TEXT, email TEXT,
  estado TEXT NOT NULL,              -- pendiente | programado | resuelto
  operario_email TEXT, programado_ts TEXT,
  resolucion TEXT, foto_resolucion TEXT, resuelto_por TEXT, resuelto_ts TEXT,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_recl_estado ON reclamos(estado);
CREATE TABLE IF NOT EXISTS mails (
  id INTEGER PRIMARY KEY,
  reclamo_id INTEGER,
  para TEXT NOT NULL, asunto TEXT NOT NULL,
  estado TEXT NOT NULL,              -- enviado | error
  error TEXT,
  ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT
);
CREATE TABLE IF NOT EXISTS usuarios (
  email TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL,                 -- admin | operador | consulta
  activo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sesiones (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  creado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  clave TEXT PRIMARY KEY,
  integrador TEXT NOT NULL
);
`);

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Distancia en metros entre dos puntos (haversine)
export function distanciaM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const config = {
  get: (clave) => db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave)?.valor ?? null,
  set: (clave, valor) => db.prepare('INSERT INTO config VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(clave, valor),
};

export const DEPOSITO = { lat: -34.6515, lng: -58.4135, direccion: 'Depósito Hassa - Tabaré 1760', barrio: 'Nueva Pompeya' };
export const MOTIVOS_RECLAMO = ['Rotura', 'Recambio', 'Falta de Tapa', 'Falta de Bujes', 'Falta de Gráficas'];

// Asistente de IA: responde preguntas sobre la base de datos usando el modelo de lenguaje (LLM)
// que configure el cliente con su propia cuenta (Anthropic, OpenAI, Google Gemini o compatible con OpenAI).
//
// Seguridad:
// - El modelo solo puede LEER: las consultas corren en una conexión de solo lectura, una sentencia por vez,
//   y se rechazan las tablas con datos sensibles (sesiones y claves de integradores).
// - Las claves de API del LLM se guardan en un archivo aparte (secretos.db) que esa conexión no puede leer.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR, db } from './db.js';

// ---------- Configuración del proveedor ----------
const secretos = new DatabaseSync(path.join(DATA_DIR, 'secretos.db'));
secretos.exec('CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT)');
const leer = (k) => secretos.prepare('SELECT valor FROM ajustes WHERE clave = ?').get(k)?.valor || '';
const escribir = (k, v) => secretos.prepare('INSERT INTO ajustes VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(k, v);

export const PROVEEDORES = {
  anthropic: { nombre: 'Anthropic (Claude)', base: 'https://api.anthropic.com' },
  openai: { nombre: 'OpenAI (ChatGPT)', base: 'https://api.openai.com/v1' },
  gemini: { nombre: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta' },
  compatible: { nombre: 'Compatible con OpenAI (DeepSeek, Groq, Mistral, Ollama, etc.)', base: '' },
};

// Lo guardado en Ajustes tiene prioridad; si no hay nada, se usan las variables de entorno LLM_*
export function configLLM() {
  const guardado = leer('proveedor');
  const c = guardado
    ? { proveedor: guardado, api_key: leer('api_key'), modelo: leer('modelo'), base_url: leer('base_url'), desde_entorno: false }
    : { proveedor: process.env.LLM_PROVEEDOR || '', api_key: process.env.LLM_API_KEY || '', modelo: process.env.LLM_MODELO || '',
        base_url: process.env.LLM_BASE_URL || '', desde_entorno: Boolean(process.env.LLM_PROVEEDOR) };
  c.base = (c.base_url || PROVEEDORES[c.proveedor]?.base || '').replace(/\/+$/, '');
  c.configurado = Boolean(PROVEEDORES[c.proveedor] && c.modelo && c.base && (c.api_key || c.proveedor === 'compatible'));
  return c;
}
export function configPublica() {
  const c = configLLM();
  return { proveedor: c.proveedor, modelo: c.modelo, base_url: c.base_url, configurado: c.configurado, desde_entorno: c.desde_entorno,
    clave_configurada: Boolean(c.api_key), clave_fin: c.api_key ? c.api_key.slice(-4) : '' };
}
export function guardarConfig({ proveedor, modelo, base_url, api_key }) {
  if (!PROVEEDORES[proveedor]) throw Object.assign(new Error('Proveedor inválido'), { status: 400 });
  if (base_url && !/^https?:\/\/\S+$/.test(base_url)) throw Object.assign(new Error('URL base inválida'), { status: 400 });
  const anterior = leer('proveedor');
  escribir('proveedor', proveedor);
  escribir('modelo', String(modelo || '').trim());
  escribir('base_url', String(base_url || '').trim());
  // La clave solo se reemplaza si se escribe una nueva; al cambiar de proveedor se descarta la anterior
  if (api_key) escribir('api_key', String(api_key).trim());
  else if (anterior && anterior !== proveedor) escribir('api_key', '');
}

// ---------- Llamadas HTTP a los proveedores ----------
async function pedir(url, opciones, quien) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 90000);
  let r;
  try { r = await fetch(url, { ...opciones, signal: ctl.signal }); }
  catch (e) { throw new Error(`No se pudo conectar con ${quien}: ${e.name === 'AbortError' ? 'tiempo de espera agotado' : e.message}`); }
  finally { clearTimeout(t); }
  const texto = await r.text();
  let j; try { j = JSON.parse(texto); } catch { j = null; }
  if (!r.ok) {
    const msg = j?.error?.message || j?.error?.status || j?.message || texto.slice(0, 300);
    throw new Error(`${quien} respondió ${r.status}: ${msg}`);
  }
  return j;
}
const encabezados = (c) => {
  if (c.proveedor === 'anthropic') return { 'x-api-key': c.api_key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  if (c.proveedor === 'gemini') return { 'x-goog-api-key': c.api_key, 'content-type': 'application/json' };
  return { ...(c.api_key ? { authorization: `Bearer ${c.api_key}` } : {}), 'content-type': 'application/json' };
};

export async function listarModelos(c) {
  const nombre = PROVEEDORES[c.proveedor]?.nombre || 'el proveedor';
  if (c.proveedor === 'anthropic') {
    const j = await pedir(`${c.base}/v1/models?limit=100`, { headers: encabezados(c) }, nombre);
    return j.data.map((m) => m.id);
  }
  if (c.proveedor === 'gemini') {
    const j = await pedir(`${c.base}/models?pageSize=200`, { headers: encabezados(c) }, nombre);
    return j.models.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  }
  const j = await pedir(`${c.base}/models`, { headers: encabezados(c) }, nombre);
  return (j.data || []).map((m) => m.id).sort();
}

// ---------- Herramienta de consulta (solo lectura) ----------
const lectura = new DatabaseSync(path.join(DATA_DIR, 'hassa.db'), { readOnly: true });
const PROHIBIDAS = /\b(sesiones|api_keys|secretos)\b|\b(attach|detach|pragma\s+\w+\s*=|load_extension)\b/i;
const MAX_FILAS = 200;

export function ejecutarSQL(sql) {
  const s = String(sql || '').trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(s)) return { error: 'Solo se permiten consultas SELECT.' };
  if (s.includes(';')) return { error: 'Enviá una sola consulta por vez.' };
  if (PROHIBIDAS.test(s)) return { error: 'La consulta usa tablas o comandos no permitidos.' };
  try {
    const st = lectura.prepare(s);
    const filas = [];
    for (const f of st.iterate()) { if (filas.length >= MAX_FILAS) return { columnas: Object.keys(filas[0]), filas, truncado: true }; filas.push({ ...f }); }
    return { columnas: filas[0] ? Object.keys(filas[0]) : st.columns().map((c) => c.name), filas, truncado: false };
  } catch (e) { return { error: `Error de SQL: ${e.message}` }; }
}

function esquema() {
  return db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT IN ('sesiones','api_keys') AND name NOT LIKE 'sqlite_%'")
    .all().map((t) => t.sql).join('\n\n');
}

function instrucciones() {
  const hoy = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'full', timeStyle: 'short' });
  return `Sos el asistente de datos del sistema de inventario de contenedores y cestos de Hassa (Ciudad de Buenos Aires).
Respondés preguntas de usuarios internos consultando la base de datos SQLite con la herramienta consultar_base.

Reglas:
- Usá siempre la herramienta para obtener los datos; nunca inventes cifras. Si una consulta falla, corregila y reintentá.
- Respondé en español rioplatense, en forma breve y clara. Para listados usá tablas en Markdown (máximo 20 filas; si hay más, decilo y resumí).
- No muestres el SQL en la respuesta salvo que te lo pidan.
- Ahora es ${hoy} (hora de Argentina, UTC-3). Las fechas de la base están en UTC en formato ISO: para mostrarlas o agrupar por día usá datetime(ts, '-3 hours'). Para "hoy", "esta semana", etc. compará contra datetime('now').
- Solo podés leer datos; si te piden modificar algo, explicá que se hace desde el backoffice.

Significado de los datos:
- contenedores: cada equipo (cesto o contenedor). id = nro_inventario = ID de equipo. Estados: en_servicio (en la vía pública), en_deposito, reparacion, baja.
- puntos: puntos de recolección de la vía pública. Un contenedor ocupa un punto mediante contenedores.punto_id.
- Punto vacío: punto sin contenedor en estado en_servicio o reparacion, o cuyo contenedor en_servicio no tiene lecturas hace más de 7 días.
- lecturas: lecturas georreferenciadas de los tags (tag_id se vincula con contenedores.tag_id). ult_lectura_ts en contenedores es la última.
- Alertas: "sin lectura" = en_servicio sin lecturas hace más de 48 h; "fuera de ubicación" = ult_desvio_m > 150 metros.
- gestiones: acciones de los operarios (movimiento, recambio, reparacion, baja).
- reclamos: cargados por vecinos. Estados: pendiente, programado (asignado a un operario: operario_email), resuelto. Motivos: Rotura, Recambio, Falta de Tapa, Falta de Bujes, Falta de Gráficas.
- usuarios: usuarios del sistema y sus roles. mails: registro de mails enviados.
- Los nombres de calle están como en el inventario oficial (ej.: "CEVALLOS, Virrey"). Para buscar por calle usá LIKE sin distinguir mayúsculas.

Esquema:
${esquema()}`;
}

const HERRAMIENTA = {
  nombre: 'consultar_base',
  descripcion: 'Ejecuta UNA consulta SQL de solo lectura (SELECT o WITH) en la base SQLite y devuelve hasta 200 filas.',
  parametros: { type: 'object', properties: { sql: { type: 'string', description: 'Consulta SQL (SQLite) de solo lectura' } }, required: ['sql'] },
};
const MAX_PASOS = 8;

/**
 * @param mensajes [{ rol: 'usuario'|'asistente', texto }]  historial de la conversación (solo texto)
 * @returns { respuesta, consultas: [{ sql, filas, error }] }
 */
export async function preguntar(mensajes) {
  const c = configLLM();
  if (!c.configurado) throw Object.assign(new Error('El asistente no está configurado. Un administrador debe cargar el proveedor de IA en Ajustes.'), { status: 409 });
  const historial = mensajes.slice(-20).map((m) => ({ rol: m.rol === 'asistente' ? 'asistente' : 'usuario', texto: String(m.texto || '').slice(0, 4000) }))
    .filter((m) => m.texto);
  if (!historial.length || historial[historial.length - 1].rol !== 'usuario') throw Object.assign(new Error('Falta la pregunta'), { status: 400 });
  const consultas = [];
  const usarHerramienta = (args) => {
    const r = ejecutarSQL(args?.sql);
    consultas.push({ sql: args?.sql || '', filas: r.filas?.length ?? null, error: r.error || null });
    return r;
  };
  const sistema = instrucciones(), nombre = PROVEEDORES[c.proveedor].nombre;

  if (c.proveedor === 'anthropic') {
    const msgs = historial.map((m) => ({ role: m.rol === 'usuario' ? 'user' : 'assistant', content: m.texto }));
    for (let paso = 0; paso < MAX_PASOS; paso++) {
      const j = await pedir(`${c.base}/v1/messages`, { method: 'POST', headers: encabezados(c), body: JSON.stringify({
        model: c.modelo, max_tokens: 4096, system: sistema, messages: msgs,
        tools: [{ name: HERRAMIENTA.nombre, description: HERRAMIENTA.descripcion, input_schema: HERRAMIENTA.parametros }],
      }) }, nombre);
      const usos = j.content.filter((b) => b.type === 'tool_use');
      if (j.stop_reason !== 'tool_use' || !usos.length) return { respuesta: j.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(), consultas };
      msgs.push({ role: 'assistant', content: j.content });
      msgs.push({ role: 'user', content: usos.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(usarHerramienta(u.input)) })) });
    }
  } else if (c.proveedor === 'gemini') {
    const contenidos = historial.map((m) => ({ role: m.rol === 'usuario' ? 'user' : 'model', parts: [{ text: m.texto }] }));
    for (let paso = 0; paso < MAX_PASOS; paso++) {
      const j = await pedir(`${c.base}/models/${encodeURIComponent(c.modelo)}:generateContent`, { method: 'POST', headers: encabezados(c), body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema }] }, contents: contenidos,
        tools: [{ functionDeclarations: [{ name: HERRAMIENTA.nombre, description: HERRAMIENTA.descripcion, parameters: HERRAMIENTA.parametros }] }],
      }) }, nombre);
      const contenido = j.candidates?.[0]?.content;
      if (!contenido) throw new Error(`${nombre} no devolvió respuesta (${j.promptFeedback?.blockReason || j.candidates?.[0]?.finishReason || 'sin detalle'})`);
      const llamadas = (contenido.parts || []).filter((p) => p.functionCall);
      if (!llamadas.length) return { respuesta: (contenido.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('\n').trim(), consultas };
      contenidos.push(contenido);
      contenidos.push({ role: 'user', parts: llamadas.map((p) => ({ functionResponse: { name: p.functionCall.name, response: usarHerramienta(p.functionCall.args) } })) });
    }
  } else {
    const msgs = [{ role: 'system', content: sistema }, ...historial.map((m) => ({ role: m.rol === 'usuario' ? 'user' : 'assistant', content: m.texto }))];
    for (let paso = 0; paso < MAX_PASOS; paso++) {
      const j = await pedir(`${c.base}/chat/completions`, { method: 'POST', headers: encabezados(c), body: JSON.stringify({
        model: c.modelo, messages: msgs,
        tools: [{ type: 'function', function: { name: HERRAMIENTA.nombre, description: HERRAMIENTA.descripcion, parameters: HERRAMIENTA.parametros } }],
      }) }, nombre);
      const m = j.choices?.[0]?.message;
      if (!m) throw new Error(`${nombre} no devolvió respuesta`);
      if (!m.tool_calls?.length) return { respuesta: String(m.content || '').trim(), consultas };
      msgs.push({ role: 'assistant', content: m.content || null, tool_calls: m.tool_calls });
      for (const tc of m.tool_calls) {
        let args; try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(usarHerramienta(args)) });
      }
    }
  }
  return { respuesta: 'No llegué a una respuesta con las consultas disponibles. Probá reformular la pregunta o hacerla más específica.', consultas };
}

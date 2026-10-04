import { api, esc, $, GESTIONES, haceCuanto, fecha, chipEstado, requerirLogin, salir } from '/common.js';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/campo/sw.js').catch(() => {});

const raiz = $('#raiz');
const yo = await requerirLogin(raiz);
const puedeGestionar = yo.rol !== 'consulta';

const MOTIVOS = {
  reparacion: ['Tapa rota', 'Pedal trabado', 'Rueda dañada', 'Vandalismo / incendio', 'Cuerpo fisurado', 'Otro'],
  baja: ['Fin de vida útil', 'Destrucción / incendio', 'Robo / extravío', 'Otro'],
};
const AYUDA = {
  movimiento: 'Queda en una nueva ubicación',
  recambio: 'Se reemplaza por otra unidad',
  reparacion: 'Pedir arreglo al taller',
  baja: 'Sale del inventario',
};
let lector = null;

function marco(titulo, cuerpo, volver) {
  raiz.innerHTML = `
    <div class="movil">
      <header class="${volver ? '' : 'claro'}">
        ${volver ? '<button class="volver" id="volver" aria-label="Volver">←</button>' : '<img class="logo-img" src="/logo.png" alt="Hassa">'}
        ${volver ? `<b>${esc(titulo)}</b>` : ''}
        ${volver ? '' : '<button id="salir">Salir</button>'}
      </header>
      <div class="cuerpo">${cuerpo}</div>
    </div>`;
  if (volver) $('#volver').onclick = async () => { await pararLector(); volver(); };
  else $('#salir').onclick = salir;
  window.scrollTo(0, 0);
}

// El QR impreso contiene una URL del tipo https://.../campo/?c=HAS-000123 (también se acepta el código solo)
function codigoDe(texto) {
  try { const c = new URL(texto).searchParams.get('c'); if (c) return c; } catch { /* no es URL */ }
  return texto.trim();
}
async function pararLector() {
  if (!lector) return;
  try { await lector.stop(); } catch { /* ya estaba detenido */ }
  lector = null;
}
function escanear(titulo, alLeer, volver) {
  marco(titulo, `<div id="lector"></div><p class="suave" id="estado-lector">Apuntá la cámara al QR del contenedor.</p>`, volver);
  lector = new Html5Qrcode('lector');
  lector.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, async (texto) => {
    await pararLector();
    alLeer(codigoDe(texto));
  }).catch(() => {
    $('#estado-lector').innerHTML = '<span class="error">No se pudo abrir la cámara. Revisá los permisos (la cámara requiere HTTPS) o ingresá el número a mano.</span>';
  });
}

// ---------------- Inicio ----------------
async function inicio(mensaje) {
  marco('Hassa · Campo', `
    <button class="btn grande" id="escanear">Escanear QR del contenedor</button>
    <form class="tarjeta" id="buscar">
      <label>O ingresá el número de inventario
        <span class="fila"><input name="c" placeholder="HAS-000123" autocapitalize="characters" required><button class="btn">Buscar</button></span>
      </label>
      <p class="error" id="err">${esc(mensaje || '')}</p>
    </form>
    <div class="tarjeta"><b>Mis últimas gestiones</b><div id="mias"><p class="suave">Cargando…</p></div></div>
    <p class="suave" style="text-align:center;font-size:13px">${esc(yo.nombre)} · <a href="/">Ir al backoffice</a></p>`);
  $('#escanear').onclick = () => escanear('Escanear contenedor', abrir, inicio);
  $('#buscar').onsubmit = (e) => { e.preventDefault(); abrir(new FormData(e.target).get('c')); };
  const mias = await api('/api/gestiones?mias=1&limit=8');
  const caja = $('#mias'); if (!caja) return;
  caja.innerHTML = mias.map((g) => `<div class="item"><span><b>${esc(GESTIONES[g.tipo])}</b> · ${esc(g.nro_inventario)}</span><span class="suave">${haceCuanto(g.ts)}</span></div>`).join('')
    || '<p class="suave">Todavía no registraste gestiones.</p>';
}

// ---------------- Contenedor ----------------
async function abrir(ref) {
  let c;
  try { c = await api('/api/contenedores/' + encodeURIComponent(codigoDe(String(ref)))); }
  catch (e) { return inicio(e.status === 404 ? `No existe el contenedor "${ref}".` : e.message); }
  const enCalle = c.estado === 'en_servicio' || c.estado === 'reparacion';
  const hab = { movimiento: c.estado !== 'baja', recambio: enCalle, reparacion: c.estado === 'en_servicio', baja: c.estado !== 'baja' };
  marco(c.nro_inventario, `
    <div class="tarjeta">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:start">
        <div><b style="font-size:17px">${esc(c.tipo)}</b><div class="suave">${esc(c.direccion)}${c.barrio ? ', ' + esc(c.barrio) : ''}</div></div>
        ${chipEstado(c.estado)}
      </div>
      <dl class="datos" style="margin-bottom:0">
        <dt>Tag ID</dt><dd class="mono">${esc(c.tag_id)}</dd>
        <dt>Última lectura</dt><dd>${haceCuanto(c.ult_lectura_ts)}</dd>
        <dt>Última gestión</dt><dd>${c.gestiones[0] ? `${esc(GESTIONES[c.gestiones[0].tipo])} · ${fecha(c.gestiones[0].ts)}` : '—'}</dd>
      </dl>
    </div>
    ${puedeGestionar ? `<div class="acciones">
      ${Object.keys(GESTIONES).map((t) => `<button class="accion ${t === 'baja' ? 'peligro' : ''}" data-tipo="${t}" ${hab[t] ? '' : 'disabled'}>${GESTIONES[t]}<small>${AYUDA[t]}</small></button>`).join('')}
    </div>` : '<p class="aviso">Tu usuario es de solo consulta: no puede registrar gestiones.</p>'}`, inicio);
  const acc = $('.acciones');
  if (acc) acc.onclick = (e) => { const b = e.target.closest('button'); if (b && !b.disabled) formulario(c, b.dataset.tipo); };
}

// ---------------- Formulario de gestión ----------------
// Marca de agua: escribe los datos de la gestión sobre la foto (abajo a la derecha), para que
// la imagen conserve fecha, lugar, contenedor y usuario aunque circule fuera del sistema.
function estampar(dataUrl, lineas) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      const margen = Math.round(cv.width * 0.025);
      let tam = Math.round(Math.max(cv.width, cv.height) / 36);
      const fuente = () => { g.font = `500 ${tam}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`; };
      fuente();
      // Si alguna línea no entra en el ancho, se achica la letra
      const ancho = Math.max(...lineas.map((l) => g.measureText(l).width));
      if (ancho > cv.width - 2 * margen) { tam = Math.floor(tam * (cv.width - 2 * margen) / ancho); fuente(); }
      const alto = Math.round(tam * 1.25);
      g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
      const base = cv.height - margen - (lineas.length - 1) * alto;
      const sombra = g.createLinearGradient(0, base - alto * 2, 0, cv.height);
      sombra.addColorStop(0, 'rgba(0,0,0,0)'); sombra.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = sombra; g.fillRect(0, base - alto * 2, cv.width, cv.height - base + alto * 2);
      lineas.forEach((l, i) => {
        const y = base + i * alto;
        g.lineWidth = Math.max(2, tam / 7); g.strokeStyle = 'rgba(0,0,0,0.75)'; g.strokeText(l, cv.width - margen, y);
        g.fillStyle = '#fff'; g.fillText(l, cv.width - margen, y);
      });
      ok(cv.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = mal;
    img.src = dataUrl;
  });
}

function reducirFoto(archivo, max = 1600) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      ok(cv.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = mal;
    img.src = URL.createObjectURL(archivo);
  });
}

function formulario(c, tipo, previo = {}) {
  const datos = { foto: null, fotoOriginal: null, fotoTs: null, precision: null, lat: null, lng: null, reemplazo: '', observaciones: '', motivo: '', ...previo };
  const motivos = MOTIVOS[tipo];
  marco(`${GESTIONES[tipo]} · ${c.nro_inventario}`, `
    <form class="gestion">
      ${tipo === 'recambio' ? `<label>Contenedor nuevo (debe estar en depósito)
        <span class="fila"><input name="reemplazo" placeholder="HAS-000456" value="${esc(datos.reemplazo)}" required><button type="button" class="btn sec" id="esc-reemplazo">Escanear</button></span></label>` : ''}
      ${motivos ? `<label>Motivo<select name="motivo" required>${motivos.map((m) => `<option ${m === datos.motivo ? 'selected' : ''}>${m}</option>`).join('')}</select></label>` : ''}
      ${tipo === 'movimiento' ? `<label>Nueva dirección<input name="direccion" placeholder="Calle y altura" required></label>` : ''}
      <label class="foto-btn"><span id="foto-vista">${datos.foto ? `<img src="${datos.foto}" alt="Foto tomada">Cambiar foto` : 'Tomar foto del contenedor'}</span>
        <input type="file" accept="image/*" capture="environment" id="foto"></label>
      <label>Observaciones<textarea name="observaciones" placeholder="Opcional">${esc(datos.observaciones)}</textarea></label>
      <div class="gps" id="gps">Obteniendo ubicación GPS…</div>
      <p class="error" id="err"></p>
      <button class="btn grande ${tipo === 'baja' ? 'peligro' : ''}">Confirmar ${GESTIONES[tipo].toLowerCase()}</button>
    </form>`, () => abrir(c.nro_inventario));
  const form = $('form.gestion');

  // Texto de la marca de agua. Se vuelve a generar cuando llega el GPS y al confirmar,
  // para que la foto guardada tenga siempre los datos finales.
  const lineasMarca = () => {
    const f = datos.fotoTs;
    const lugar = [tipo === 'movimiento' ? (datos.direccion || '').trim() : c.direccion, tipo === 'movimiento' ? '' : c.barrio].filter(Boolean).join(', ');
    return [
      `${f.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })} ${f.toLocaleTimeString('es-AR', { hour12: false })}`,
      lugar,
      datos.lat != null ? `GPS ${datos.lat.toFixed(5)}, ${datos.lng.toFixed(5)}${datos.precision != null ? ` (±${datos.precision} m)` : ''}` : 'Sin ubicación GPS',
      `${c.nro_inventario} · ${c.tipo}`,
      `${GESTIONES[tipo]} · ${yo.email}`,
    ].filter(Boolean);
  };
  const marcarFoto = async () => {
    if (!datos.fotoOriginal) return;
    leer();
    datos.foto = await estampar(datos.fotoOriginal, lineasMarca());
    const v = $('#foto-vista'); if (v) v.innerHTML = `<img src="${datos.foto}" alt="Foto tomada">Cambiar foto`;
  };

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((p) => {
      datos.lat = p.coords.latitude; datos.lng = p.coords.longitude; datos.precision = Math.round(p.coords.accuracy); marcarFoto();
      const g = $('#gps'); if (g) { g.className = 'gps ok'; g.textContent = `Ubicación registrada: ${datos.lat.toFixed(5)}, ${datos.lng.toFixed(5)} (±${Math.round(p.coords.accuracy)} m)`; }
    }, () => { const g = $('#gps'); if (g) g.textContent = 'Sin ubicación GPS: activá la ubicación del dispositivo.'; },
    { enableHighAccuracy: true, timeout: 15000 });
  } else $('#gps').textContent = 'Este dispositivo no informa ubicación.';

  $('#foto').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { datos.fotoOriginal = await reducirFoto(f); datos.fotoTs = new Date(); await marcarFoto(); }
    catch { $('#err').textContent = 'No se pudo leer la foto.'; }
  };
  const leer = () => { const f = new FormData(form); for (const k of ['reemplazo', 'motivo', 'observaciones', 'direccion']) if (f.has(k)) datos[k] = f.get(k); };
  const escR = $('#esc-reemplazo');
  if (escR) escR.onclick = () => { leer(); escanear('Escanear contenedor nuevo', (cod) => formulario(c, tipo, { ...datos, reemplazo: cod }), () => formulario(c, tipo, datos)); };

  form.onsubmit = async (e) => {
    e.preventDefault(); leer();
    const btn = form.querySelector('button.grande'); btn.disabled = true; $('#err').textContent = '';
    try {
      await marcarFoto();
      const { fotoOriginal, fotoTs, precision, ...envio } = datos;
      await api('/api/gestiones', { body: { contenedor: c.nro_inventario, tipo, ...envio } });
      marco('Gestión registrada', `
        <div class="tarjeta ok-pantalla"><div class="tilde">✓</div>
          <h2>${esc(GESTIONES[tipo])} registrada</h2>
          <p class="suave">${esc(c.nro_inventario)}${tipo === 'recambio' ? ' → ' + esc(datos.reemplazo.toUpperCase()) : ''}<br>Ya se ve en el backoffice.</p>
        </div>
        <button class="btn grande" id="otra">Registrar otra gestión</button>`);
      $('#otra').onclick = () => inicio();
    } catch (err) { $('#err').textContent = err.message; btn.disabled = false; }
  };
}

const inicial = new URLSearchParams(location.search).get('c');
if (inicial) { history.replaceState(null, '', '/campo/'); abrir(inicial); } else inicio();

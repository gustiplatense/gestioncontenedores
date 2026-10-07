import { api, esc, $, GESTIONES, haceCuanto, fecha, chipEstado, requerirLogin, salir, codigoDe } from '/common.js';
import { estampar, reducirFoto } from '/fotos.js';
import { calcularRuta, dibujarRuta, resumenRuta } from '/ruta.js';

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
      <label>O ingresá el ID del equipo
        <span class="fila"><input name="c" placeholder="Ej.: 516" inputmode="numeric" required><button class="btn">Buscar</button></span>
      </label>
      <p class="error" id="err">${esc(mensaje || '')}</p>
    </form>
    <div class="tarjeta" id="relev"><b>Relevamientos asignados</b><p class="suave" style="margin:6px 0 0">Cargando…</p></div>
    <div class="tarjeta"><b>Mis últimas gestiones</b><div id="mias"><p class="suave">Cargando…</p></div></div>
    <p class="suave" style="text-align:center;font-size:13px">${esc(yo.nombre)} · <a href="/">Ir al backoffice</a></p>`);
  $('#escanear').onclick = () => escanear('Escanear contenedor', abrir, inicio);
  $('#buscar').onsubmit = (e) => { e.preventDefault(); abrir(new FormData(e.target).get('c')); };
  api('/api/reclamos?mios=1').then((rs) => {
    const caja = $('#relev'); if (!caja) return;
    caja.innerHTML = `<b>Relevamientos asignados</b>` + (rs.length
      ? `<p class="suave" style="margin:6px 0 10px">Tenés ${rs.length} ${rs.length === 1 ? 'reclamo' : 'reclamos'} para relevar.</p><button class="btn ancho" id="ver-ruta">Ver recorrido en el mapa</button>`
      : '<p class="suave" style="margin:6px 0 0">No tenés relevamientos pendientes.</p>');
    if (rs.length) $('#ver-ruta').onclick = () => recorrido();
  }).catch(() => {});
  const mias = await api('/api/gestiones?mias=1&limit=8');
  const caja = $('#mias'); if (!caja) return;
  caja.innerHTML = mias.map((g) => `<div class="item"><span><b>${esc(GESTIONES[g.tipo])}</b> · ${esc(g.nro_inventario)}</span><span class="suave">${haceCuanto(g.ts)}</span></div>`).join('')
    || '<p class="suave">Todavía no registraste gestiones.</p>';
}

// ---------------- Relevamientos asignados y recorrido ----------------
const posicion = (ms = 6000) => new Promise((ok) => {
  if (!navigator.geolocation) return ok(null);
  navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy) }),
    () => ok(null), { enableHighAccuracy: true, timeout: ms });
});
let mapaRuta = null;

async function recorrido() {
  marco('Mis relevamientos', `
    <div id="mapa-ruta"></div>
    <p class="suave" id="ruta-info" style="margin:0">Calculando el recorrido óptimo…</p>
    <div class="tarjeta" id="ruta-lista" style="padding:6px 14px"></div>`, () => { if (mapaRuta) { mapaRuta.remove(); mapaRuta = null; } inicio(); });
  const [rs, yoEstoy] = await Promise.all([api('/api/reclamos?mios=1'), posicion()]);
  if (!$('#mapa-ruta')) return;
  if (!rs.length) { $('#ruta-info').textContent = 'No tenés relevamientos pendientes.'; return; }
  const ruta = await calcularRuta(rs.map((r) => ({ lat: r.c_lat, lng: r.c_lng })), yoEstoy);
  if (!$('#mapa-ruta')) return;
  const enOrden = ruta.orden.map((i) => rs[i]);
  if (mapaRuta) mapaRuta.remove();
  mapaRuta = L.map('mapa-ruta');
  // El encuadre va antes de dibujar: Leaflet necesita una vista definida para agregar capas
  mapaRuta.fitBounds(L.latLngBounds([...enOrden.map((r) => [r.c_lat, r.c_lng]), ...(yoEstoy ? [[yoEstoy.lat, yoEstoy.lng]] : [])]).pad(0.12));
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapaRuta);
  dibujarRuta(mapaRuta, enOrden.map((r) => ({ lat: r.c_lat, lng: r.c_lng, titulo: `#${r.id} · ${r.motivo}` })), ruta, (_, i) => relevamiento(enOrden[i]));
  if (yoEstoy) L.circleMarker([yoEstoy.lat, yoEstoy.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#111827', fillOpacity: 1 }).addTo(mapaRuta).bindTooltip('Tu posición');
  $('#ruta-info').textContent = `${enOrden.length} paradas · ${resumenRuta(ruta)}${yoEstoy ? '' : ' · sin GPS: empieza por la parada más al norte'}`;
  $('#ruta-lista').innerHTML = enOrden.map((r, i) => `
    <div class="item" data-i="${i}" style="cursor:pointer"><span><span class="parada" style="display:inline-grid;margin-right:8px">${i + 1}</span><b>${esc(r.motivo)}</b> · Equipo ${esc(r.nro_inventario)}
      <div class="suave" style="margin-left:34px">${esc(r.c_direccion)} · ${esc(r.tipo_contenedor)}</div></span><span class="suave">›</span></div>`).join('');
  $('#ruta-lista').onclick = (e) => { const it = e.target.closest('[data-i]'); if (it) relevamiento(enOrden[Number(it.dataset.i)]); };
}

function relevamiento(r) {
  if (mapaRuta) { mapaRuta.remove(); mapaRuta = null; }
  const datos = { original: null, foto: null, ts: null, gps: null };
  marco(`Reclamo #${r.id}`, `
    <div class="tarjeta">
      <b style="font-size:17px">${esc(r.motivo)}</b>
      <div class="suave">Equipo ${esc(r.nro_inventario)} · ${esc(r.tipo_contenedor)}</div>
      <dl class="datos" style="margin-bottom:0">
        <dt>Dirección</dt><dd>${esc(r.c_direccion)}${r.barrio ? ', ' + esc(r.barrio) : ''}</dd>
        <dt>Observaciones</dt><dd>${esc(r.observaciones) || '—'}</dd>
        <dt>Cargado</dt><dd>${fecha(r.ts)} · ${esc(r.nombre)}</dd>
      </dl>
      ${r.fotos.map((f) => `<img src="/fotos/${esc(f)}" alt="Foto del reclamo" style="width:100%;border-radius:10px;margin-top:10px">`).join('')}
    </div>
    <button class="btn sec ancho" id="ir-equipo" style="margin:0">Abrir equipo (registrar gestión)</button>
    <form class="gestion tarjeta" id="f-relev">
      <b>Resolver el reclamo</b>
      <label>Qué se hizo<textarea name="resolucion" required placeholder="Ej.: se colocó la tapa faltante"></textarea></label>
      <label class="foto-btn"><span id="foto-vista">Tomar foto de cómo quedó</span><input type="file" accept="image/*" capture="environment" id="foto"></label>
      <p class="error" id="err"></p>
      <button class="btn grande">Marcar como resuelto</button>
    </form>`, recorrido);
  $('#ir-equipo').onclick = () => abrir(r.nro_inventario);
  posicion(15000).then((p) => { datos.gps = p; marcar(); });
  const marcar = async () => {
    if (!datos.original) return;
    datos.foto = await estampar(datos.original, [
      `${datos.ts.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })} ${datos.ts.toLocaleTimeString('es-AR', { hour12: false })}`,
      [r.c_direccion, r.barrio].filter(Boolean).join(', '),
      datos.gps ? `GPS ${datos.gps.lat.toFixed(5)}, ${datos.gps.lng.toFixed(5)} (±${datos.gps.precision} m)` : 'Sin ubicación GPS',
      `Equipo ${r.nro_inventario} · ${r.tipo_contenedor}`,
      `Reclamo #${r.id} resuelto · ${yo.email}`,
    ]);
    const v = $('#foto-vista'); if (v) v.innerHTML = `<img src="${datos.foto}" alt="Foto tomada">Cambiar foto`;
  };
  $('#foto').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { datos.original = await reducirFoto(f); datos.ts = new Date(); await marcar(); } catch { $('#err').textContent = 'No se pudo leer la foto.'; }
  };
  $('#f-relev').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button.grande'); btn.disabled = true; $('#err').textContent = '';
    try {
      const res = await api(`/api/reclamos/${r.id}/resolver`, { body: { resolucion: new FormData(e.target).get('resolucion'), foto: datos.foto } });
      marco('Reclamo resuelto', `
        <div class="tarjeta ok-pantalla"><div class="tilde">✓</div><h2>Reclamo #${r.id} resuelto</h2>
          <p class="suave">${res.mail.ok ? 'Se envió el mail de aviso.' : 'Quedó resuelto, pero el mail de aviso no se pudo enviar.'}</p></div>
        <button class="btn grande" id="seguir">Seguir con el recorrido</button>`);
      $('#seguir').onclick = () => recorrido();
    } catch (err) { $('#err').textContent = err.message; btn.disabled = false; }
  };
}

// ---------------- Contenedor ----------------
async function abrir(ref) {
  let c;
  try { c = await api('/api/contenedores/' + encodeURIComponent(codigoDe(String(ref)))); }
  catch (e) { return inicio(e.status === 404 ? `No existe el contenedor "${ref}".` : e.message); }
  const enCalle = c.estado === 'en_servicio' || c.estado === 'reparacion';
  const hab = { movimiento: c.estado !== 'baja', recambio: enCalle, reparacion: c.estado === 'en_servicio', baja: c.estado !== 'baja' };
  marco(`Equipo ${c.nro_inventario}`, `
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
function formulario(c, tipo, previo = {}) {
  const datos = { foto: null, fotoOriginal: null, fotoTs: null, precision: null, lat: null, lng: null, reemplazo: '', observaciones: '', motivo: '', ...previo };
  const motivos = MOTIVOS[tipo];
  marco(`${GESTIONES[tipo]} · ${c.nro_inventario}`, `
    <form class="gestion">
      ${tipo === 'recambio' ? `<label>Contenedor nuevo (debe estar en depósito)
        <span class="fila"><input name="reemplazo" placeholder="ID del equipo nuevo" value="${esc(datos.reemplazo)}" required><button type="button" class="btn sec" id="esc-reemplazo">Escanear</button></span></label>` : ''}
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
      `Equipo ${c.nro_inventario} · ${c.tipo}`,
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

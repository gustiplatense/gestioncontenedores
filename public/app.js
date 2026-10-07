import { api, esc, $, ESTADOS, ALERTAS, GESTIONES, RECLAMOS, ROLES, haceCuanto, fecha, nro, chipEstado, requerirLogin, salir } from '/common.js';
import { calcularRuta, dibujarRuta, resumenRuta } from '/ruta.js';

const raiz = $('#raiz');
const yo = await requerirLogin(raiz);
const { tipos, barrios } = await api('/api/tipos');
const tipoPorId = Object.fromEntries(tipos.map((t) => [t.id, t]));
const puedeGestionar = yo.rol !== 'consulta';

const VISTAS = { mapa: 'Mapa', inventario: 'Inventario', gestiones: 'Gestiones', reclamos: 'Reclamos', ...(yo.rol === 'admin' ? { usuarios: 'Usuarios', ajustes: 'Ajustes' } : {}) };
const VACIO = { color: '#111827', nombre: 'Punto vacío' };
const capas = { vacios: true, soloVacios: false, calor: false };
let vista = 'mapa';
let filtro = { tipo: '', estado: '', barrio: '', alerta: '', q: '' };
let mapa = null, capa = null, capaVacios = null, capaCalor = null, pagina = 0;

raiz.innerHTML = `
  <div class="app">
    <header class="top">
      <div class="marca"><img class="logo-img" src="/logo.png" alt="Hassa"></div>
      <nav class="tabs">${Object.entries(VISTAS).map(([k, v]) => `<button data-vista="${k}">${v}</button>`).join('')}</nav>
      <div class="usuario">
        <span>${esc(yo.nombre)} · ${esc(ROLES[yo.rol])}</span>
        <a class="btn sec chico" href="/campo/">App de campo</a>
        <button class="btn sec chico" id="salir">Salir</button>
      </div>
    </header>
    <main id="main"></main>
  </div>
  <aside class="ficha" id="ficha" hidden></aside>`;
const main = $('#main'), ficha = $('#ficha');
$('#salir').onclick = salir;
$('nav.tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) ir(b.dataset.vista); };

function ir(v) {
  vista = v; pagina = 0; ficha.hidden = true;
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('activo', b.dataset.vista === v));
  if (mapa) { mapa.remove(); mapa = null; }
  ({ mapa: verMapa, inventario: verInventario, gestiones: verGestiones, reclamos: verReclamos, usuarios: verUsuarios, ajustes: verAjustes })[v]();
}
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();
const opciones = (lista, sel, vacio) => `<option value="">${vacio}</option>` +
  lista.map(([v, n]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(n)}</option>`).join('');
const selectores = () => `
  <label>Tipo<select data-f="tipo">${opciones(tipos.map((t) => [t.id, t.nombre]), filtro.tipo, 'Todos')}</select></label>
  <label>Estado<select data-f="estado">${opciones(Object.entries(ESTADOS).map(([k, v]) => [k, v.nombre]), filtro.estado, 'Todos')}</select></label>
  <label>Barrio<select data-f="barrio">${opciones(barrios.map((b) => [b, b]), filtro.barrio, 'Todos')}</select></label>
  <label>Alerta<select data-f="alerta">${opciones(Object.entries(ALERTAS).map(([k, v]) => [k, v.nombre]), filtro.alerta, 'Ninguna')}</select></label>`;

// ---------------- Mapa ----------------
const fondoMapa = (m) => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);

async function verMapa() {
  const r = await api('/api/resumen');
  const kpi = (n, txt, color, f) => `<button class="kpi" style="--c:${color}" data-kpi='${JSON.stringify(f)}'><b>${nro(n)}</b><span>${txt}</span></button>`;
  const maxTipo = Math.max(...r.porTipo.map((t) => t.n), 1);
  const check = (k, txt) => `<label class="check"><input type="checkbox" data-capa="${k}" ${capas[k] ? 'checked' : ''}> ${txt}</label>`;
  main.innerHTML = `
    <div class="vista-mapa">
      <div class="kpis">
        ${kpi(r.total, 'Unidades en inventario', '#0f6b4a', {})}
        ${Object.entries(ESTADOS).map(([k, v]) => kpi(r.porEstado[k] || 0, v.nombre, v.color, { estado: k })).join('')}
        ${kpi(r.sinLectura, ALERTAS.sin_lectura.nombre, ALERTAS.sin_lectura.color, { alerta: 'sin_lectura' })}
        ${kpi(r.fueraDeUbicacion, ALERTAS.desvio.nombre, ALERTAS.desvio.color, { alerta: 'desvio' })}
        ${kpi(r.puntosVacios, 'Puntos vacíos', VACIO.color, { vacios: true })}
      </div>
      <div class="mapa-fila">
        <div class="panel">
          <h3>Filtros</h3>
          <div class="filtros">${selectores()}<button class="btn sec chico" id="limpiar">Limpiar filtros</button></div>
          <p class="suave" id="cuenta" style="font-size:13px"></p>
          <h3>Capas</h3>
          <div class="filtros" id="capas">
            ${check('vacios', 'Puntos vacíos')}
            ${check('soloVacios', 'Ver solo puntos vacíos')}
            ${check('calor', 'Mapa de calor de lecturas (7 días)')}
          </div>
          <p class="suave" style="font-size:12.5px">Punto vacío: su equipo fue retirado y no se repuso, o no registra lecturas hace más de 7 días.</p>
          <h3>Unidades activas por tipo</h3>
          ${r.porTipo.map((t) => `<div class="barra"><span>${esc(t.nombre)}</span><b>${nro(t.n)}</b><i style="--p:${(t.n / maxTipo) * 100}%"></i></div>`).join('')}
          <p class="suave" style="font-size:12.5px">Lecturas recibidas en 24 h: <b>${nro(r.lecturas24h)}</b></p>
        </div>
        <div id="mapa"></div>
      </div>
    </div>`;
  mapa = L.map('mapa', { preferCanvas: true }).setView([-34.607, -58.375], 14);
  fondoMapa(mapa);
  capa = capaVacios = capaCalor = null;
  const ley = L.control({ position: 'bottomright' });
  ley.onAdd = () => {
    const d = L.DomUtil.create('div', 'leyenda');
    d.innerHTML = [...Object.values(ESTADOS), ...Object.values(ALERTAS)].map((e) => `<div><i style="background:${e.color}"></i>${e.nombre}</div>`).join('') +
      `<div><i style="background:#fff;box-shadow:inset 0 0 0 3px ${VACIO.color}"></i>${VACIO.nombre}</div>`;
    return d;
  };
  ley.addTo(mapa);

  main.querySelector('.filtros').onchange = (e) => { filtro[e.target.dataset.f] = e.target.value; cargarPuntos(); };
  $('#capas').onchange = (e) => {
    capas[e.target.dataset.capa] = e.target.checked;
    if (capas.soloVacios && !capas.vacios) { capas.vacios = true; $('[data-capa=vacios]').checked = true; }
    cargarPuntos(true);
  };
  $('#limpiar').onclick = () => { filtro = { tipo: '', estado: '', barrio: '', alerta: '', q: '' }; capas.soloVacios = false; verMapa(); };
  main.querySelector('.kpis').onclick = (e) => {
    const b = e.target.closest('.kpi'); if (!b) return;
    const f = JSON.parse(b.dataset.kpi);
    capas.soloVacios = Boolean(f.vacios); if (f.vacios) capas.vacios = true;
    if (!f.vacios) filtro = { ...filtro, estado: '', alerta: '', ...f };
    main.querySelectorAll('[data-f]').forEach((s) => { s.value = filtro[s.dataset.f]; });
    main.querySelectorAll('[data-capa]').forEach((c) => { c.checked = capas[c.dataset.capa]; });
    cargarPuntos(true);
  };
  cargarPuntos(true);
}

async function cargarPuntos(sinEncuadrar) {
  const { q, ...f } = filtro;
  const [puntos, vacios, calor] = await Promise.all([
    capas.soloVacios ? [] : api('/api/contenedores/mapa?' + qs(f)),
    capas.vacios ? api('/api/puntos-vacios') : [],
    capas.calor ? api('/api/lecturas/calor?dias=7') : [],
  ]);
  if (!mapa) return;
  for (const c of [capa, capaVacios, capaCalor]) if (c) mapa.removeLayer(c);
  capaCalor = null;
  if (calor.length) {
    const max = Math.max(...calor.map((c) => c[2]));
    capaCalor = L.heatLayer(calor.map(([la, ln, n]) => [la, ln, n / max]), { radius: 24, blur: 20, max: 0.7, minOpacity: 0.3 }).addTo(mapa);
  }
  capa = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 55, disableClusteringAtZoom: 17 });
  capa.addLayers(puntos.map(([id, lat, lng, tipo, estado, alerta]) => {
    const m = L.circleMarker([lat, lng], {
      radius: 7, weight: alerta ? 3 : 1.5, color: alerta ? ALERTAS[alerta].color : '#fff',
      fillColor: ESTADOS[estado].color, fillOpacity: 0.95,
    });
    m.bindTooltip(tipoPorId[tipo].nombre);
    m.on('click', () => abrirFicha(id));
    return m;
  }));
  mapa.addLayer(capa);
  const vac = vacios.filter((v) => !filtro.barrio || v.barrio === filtro.barrio);
  capaVacios = L.layerGroup(vac.map((v) => {
    const m = L.circleMarker([v.lat, v.lng], { radius: 8, weight: 3.5, color: VACIO.color, fillColor: '#fff', fillOpacity: 1 });
    m.bindPopup(`<b>Punto vacío</b><br>${esc(v.direccion)}, ${esc(v.barrio)}<br>${esc(v.tipo)}<br>` +
      (v.motivo === 'retirado' ? 'Equipo retirado, sin reposición' : `Sin lecturas hace ${v.dias ?? 'muchos'} días · <a href="#" data-ficha="${v.contenedor_id}">ver equipo</a>`));
    return m;
  })).addTo(mapa);
  $('#cuenta').textContent = `${nro(puntos.length)} unidades · ${nro(vac.length)} puntos vacíos`;
  if (!sinEncuadrar && puntos.length) mapa.fitBounds(capa.getBounds().pad(0.1), { maxZoom: 16 });
}
document.addEventListener('click', (e) => { const a = e.target.closest('[data-ficha]'); if (a) { e.preventDefault(); abrirFicha(a.dataset.ficha); } });

// ---------------- Inventario ----------------
function verInventario() {
  main.innerHTML = `
    <div class="pagina">
      <div class="herramientas">
        <input type="search" id="q" placeholder="Buscar por ID de equipo, tag o dirección" value="${esc(filtro.q)}">
        ${selectores()}
      </div>
      <div class="tabla-caja"><table>
        <thead><tr><th>ID equipo</th><th>Tag ID</th><th>Tipo</th><th>Estado</th><th>Dirección</th><th>Barrio</th><th>Última lectura</th></tr></thead>
        <tbody id="filas"></tbody>
      </table></div>
      <div class="pie"><span id="total"></span><span><button class="btn sec chico" id="ant">Anterior</button> <button class="btn sec chico" id="sig">Siguiente</button></span></div>
    </div>`;
  let t;
  $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { filtro.q = e.target.value; pagina = 0; cargarTabla(); }, 250); };
  main.querySelector('.herramientas').onchange = (e) => { if (e.target.dataset.f) { filtro[e.target.dataset.f] = e.target.value; pagina = 0; cargarTabla(); } };
  $('#ant').onclick = () => { pagina--; cargarTabla(); };
  $('#sig').onclick = () => { pagina++; cargarTabla(); };
  $('#filas').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) abrirFicha(tr.dataset.id); };
  cargarTabla();
}
async function cargarTabla() {
  const POR = 50;
  const { total, items } = await api('/api/contenedores?' + qs({ ...filtro, limit: POR, offset: pagina * POR }));
  if (vista !== 'inventario') return;
  $('#filas').innerHTML = items.map((c) => `
    <tr class="clic" data-id="${c.id}">
      <td><b>${esc(c.nro_inventario)}</b></td><td class="mono">${esc(c.tag_id)}</td><td>${esc(c.tipo)}</td>
      <td>${chipEstado(c.estado)}</td><td>${esc(c.direccion)}</td><td>${esc(c.barrio)}</td><td>${haceCuanto(c.ult_lectura_ts)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="suave">Sin resultados</td></tr>';
  $('#total').textContent = total ? `${nro(pagina * POR + 1)}–${nro(pagina * POR + items.length)} de ${nro(total)}` : '';
  $('#ant').disabled = pagina === 0;
  $('#sig').disabled = (pagina + 1) * POR >= total;
}

// ---------------- Ficha de contenedor ----------------
async function abrirFicha(ref) {
  const c = await api('/api/contenedores/' + encodeURIComponent(ref));
  ficha.hidden = false;
  ficha.innerHTML = `
    <button class="btn sec chico cerrar" aria-label="Cerrar">Cerrar</button>
    <h2>Equipo ${esc(c.nro_inventario)}</h2>
    <div>${chipEstado(c.estado)}
      ${c.sin_lectura ? `<span class="chip" style="--c:${ALERTAS.sin_lectura.color}">${ALERTAS.sin_lectura.nombre}</span>` : ''}
      ${c.fuera_de_ubicacion ? `<span class="chip" style="--c:${ALERTAS.desvio.color}">A ${nro(Math.round(c.ult_desvio_m))} m de su ubicación</span>` : ''}
    </div>
    <dl class="datos">
      <dt>Tipo</dt><dd>${esc(c.tipo)}</dd>
      <dt>Tag ID</dt><dd class="mono">${esc(c.tag_id)}</dd>
      <dt>Ubicación</dt><dd>${esc(c.direccion)}${c.barrio ? ', ' + esc(c.barrio) : ''}</dd>
      <dt>Punto</dt><dd>${c.punto_id ?? '— (sin punto asignado)'}</dd>
      <dt>Clase</dt><dd>${esc(c.clase)}</dd>
      <dt>Posición</dt><dd>${esc(c.posicion)} · ${esc(c.emplazamiento)}</dd>
      <dt>Alta</dt><dd>${esc(c.fecha_alta)}</dd>
      <dt>Última lectura</dt><dd>${haceCuanto(c.ult_lectura_ts)}</dd>
    </dl>
    <div class="qr">
      <img src="/api/contenedores/${c.id}/qr.svg" alt="Código QR de ${esc(c.nro_inventario)}">
      <div><b>QR del contenedor</b><p class="suave" style="margin:4px 0 8px;font-size:13px">Con la cámara del celular abre la app del vecino; la app de campo lo lee desde su propio lector.</p>
      ${puedeGestionar ? `<a class="btn chico" href="/campo/?c=${encodeURIComponent(c.nro_inventario)}">Registrar gestión</a>` : ''}</div>
    </div>
    <h3>Gestiones</h3>
    ${c.gestiones.map((g) => `<div class="linea"><b>${esc(GESTIONES[g.tipo])}</b>${g.tipo === 'reparacion' ? ` · ${esc(g.estado)}` : ''}
      <div class="suave">${fecha(g.ts)} · ${esc(g.usuario_email)}</div>
      ${g.reemplazo ? `<div>Reemplazo: ${esc(g.reemplazo)}</div>` : ''}
      ${g.motivo ? `<div>${esc(g.motivo)}</div>` : ''}${g.observaciones ? `<div>${esc(g.observaciones)}</div>` : ''}
      ${g.foto ? `<img src="/fotos/${esc(g.foto)}" alt="Foto de la gestión">` : ''}</div>`).join('') || '<p class="suave">Sin gestiones registradas.</p>'}
    <h3>Últimas lecturas del tag</h3>
    ${c.lecturas.map((l) => `<div class="linea">${fecha(l.ts)} <span class="suave">· ${l.lat.toFixed(5)}, ${l.lng.toFixed(5)} · ${esc(l.origen)}</span></div>`).join('') || '<p class="suave">Sin lecturas.</p>'}`;
  $('.cerrar', ficha).onclick = () => { ficha.hidden = true; };
  if (mapa && c.lat != null) mapa.setView([c.lat, c.lng], Math.max(mapa.getZoom(), 16));
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ficha.hidden = true; });

// ---------------- Gestiones ----------------
async function verGestiones() {
  const lista = await api('/api/gestiones?limit=200');
  if (vista !== 'gestiones') return;
  main.innerHTML = `
    <div class="pagina">
      <div class="tabla-caja"><table>
        <thead><tr><th>Fecha</th><th>Gestión</th><th>Contenedor</th><th>Ubicación</th><th>Detalle</th><th>Usuario</th><th>Foto</th><th></th></tr></thead>
        <tbody>${lista.map((g) => `
          <tr>
            <td>${fecha(g.ts)}</td>
            <td><b>${esc(GESTIONES[g.tipo])}</b>${g.tipo === 'reparacion' ? `<br><span class="chip" style="--c:${g.estado === 'pendiente' ? '#e08a00' : '#1a9d5f'}">${esc(g.estado)}</span>` : ''}</td>
            <td><a href="#" data-ref="${g.contenedor_id}">${esc(g.nro_inventario)}</a><br><span class="suave">${esc(g.tipo_contenedor)}</span></td>
            <td>${esc(g.direccion)}<br><span class="suave">${esc(g.barrio)}</span></td>
            <td class="largo">${esc([g.motivo, g.reemplazo && 'Reemplazo: ' + g.reemplazo, g.observaciones].filter(Boolean).join(' · '))}</td>
            <td>${esc(g.usuario_email)}</td>
            <td>${g.foto ? `<a href="/fotos/${esc(g.foto)}" target="_blank"><img class="mini" src="/fotos/${esc(g.foto)}" alt="Foto"></a>` : ''}</td>
            <td>${g.tipo === 'reparacion' && g.estado === 'pendiente' && yo.rol === 'admin' ? `<button class="btn chico" data-resolver="${g.id}">Marcar reparado</button>` : ''}</td>
          </tr>`).join('') || '<tr><td colspan="8" class="suave">Sin gestiones</td></tr>'}</tbody>
      </table></div>
    </div>`;
  main.querySelector('tbody').onclick = async (e) => {
    const a = e.target.closest('[data-ref]'), b = e.target.closest('[data-resolver]');
    if (a) { e.preventDefault(); abrirFicha(a.dataset.ref); }
    if (b) { b.disabled = true; await api(`/api/gestiones/${b.dataset.resolver}/resolver`, { method: 'POST' }); verGestiones(); }
  };
}

// ---------------- Usuarios ----------------
async function verUsuarios() {
  const lista = await api('/api/usuarios');
  if (vista !== 'usuarios') return;
  const roles = (sel) => Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
  main.innerHTML = `
    <div class="pagina" style="max-width:900px">
      <form class="herramientas" id="alta">
        <input type="email" name="email" placeholder="cuenta@gmail.com o del dominio de la empresa" required style="flex:1 1 260px">
        <select name="rol">${roles('operador')}</select>
        <button class="btn">Habilitar usuario</button>
        <span class="error" id="err"></span>
      </form>
      <p class="suave" style="font-size:13px">Solo las cuentas de Google de esta lista pueden ingresar al backoffice y a la app de campo.</p>
      <div class="tabla-caja"><table>
        <thead><tr><th>Cuenta de Google</th><th>Nombre</th><th>Rol</th><th>Acceso</th></tr></thead>
        <tbody>${lista.map((u) => `
          <tr data-email="${esc(u.email)}">
            <td>${esc(u.email)}</td><td>${esc(u.nombre)}</td>
            <td><select data-campo="rol" aria-label="Rol">${roles(u.rol)}</select></td>
            <td><button class="btn sec chico" data-campo="activo" data-valor="${u.activo ? 0 : 1}">${u.activo ? 'Habilitado · bloquear' : 'Bloqueado · habilitar'}</button></td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  const guardar = async (body) => {
    try { await api('/api/usuarios', { body }); verUsuarios(); } catch (e) { await verUsuarios(); $('#err').textContent = e.message; }
  };
  $('#alta').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api('/api/usuarios', { body: { email: f.get('email'), rol: f.get('rol') } }); verUsuarios(); }
    catch (err) { $('#err').textContent = err.message; }
  };
  const fila = (el) => { const tr = el.closest('tr'); return { email: tr.dataset.email, rol: $('select', tr).value }; };
  main.querySelector('tbody').onchange = (e) => { if (e.target.dataset.campo === 'rol') guardar({ ...fila(e.target), activo: !e.target.closest('tr').querySelector('[data-valor="1"]') }); };
  main.querySelector('tbody').onclick = (e) => { const b = e.target.closest('button[data-campo]'); if (b) guardar({ ...fila(b), activo: b.dataset.valor === '1' }); };
}

// ---------------- Reclamos ----------------
const recl = { estado: 'pendiente', operario: '', sel: new Set(), lista: [], operarios: [], capa: null, capaRuta: null, zona: false };
const chipReclamo = (e) => `<span class="chip" style="--c:${RECLAMOS[e].color}">${RECLAMOS[e].nombre}</span>`;

async function verReclamos() {
  [recl.lista, recl.operarios] = await Promise.all([api('/api/reclamos'), api('/api/operarios')]);
  if (vista !== 'reclamos') return;
  recl.sel = new Set([...recl.sel].filter((id) => recl.lista.some((r) => r.id === id && r.estado !== 'resuelto')));
  const cuenta = (e) => recl.lista.filter((r) => r.estado === e).length;
  const ops = (sel, vacio) => `<option value="">${vacio}</option>` + recl.operarios.map((o) => `<option value="${esc(o.email)}" ${o.email === sel ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('');
  main.innerHTML = `
    <div class="vista-mapa">
      <div class="herramientas" style="margin:0">
        <span class="segmento" id="r-estado">${Object.entries(RECLAMOS).map(([k, v]) => `<button data-e="${k}" class="${recl.estado === k ? 'activo' : ''}">${v.nombre} (${cuenta(k)})</button>`).join('')}</span>
        <label class="en-linea">Operario <select id="r-operario">${ops(recl.operario, 'Todos')}</select></label>
        ${yo.rol === 'admin' ? `<span class="separador"></span>
          <button class="btn sec" id="r-zona" title="Arrastrá el mouse sobre el mapa para marcar una zona">Seleccionar zona</button>
          <label class="en-linea">Asignar a <select id="r-asignar-a">${ops('', 'Elegir operario')}</select></label>
          <button class="btn" id="r-asignar" disabled>Asignar</button>
          <button class="btn sec" id="r-quitar" disabled>Desasignar</button>` : ''}
        <span class="suave" id="r-ayuda" style="font-size:13px"></span><span class="error" id="r-err"></span>
      </div>
      <div class="mapa-fila reclamos">
        <div id="mapa"></div>
        <div class="panel"><h3 id="r-titulo"></h3><p class="suave" id="r-ruta" style="font-size:13px;margin:0 0 8px"></p><div id="r-lista"></div></div>
      </div>
    </div>`;
  mapa = L.map('mapa', { preferCanvas: true }).setView([-34.607, -58.375], 14);
  fondoMapa(mapa);
  recl.capa = recl.capaRuta = null; recl.zona = false;

  $('#r-estado').onclick = (e) => { const b = e.target.closest('button'); if (b) { recl.estado = b.dataset.e; recl.sel.clear(); verReclamos(); } };
  $('#r-operario').onchange = (e) => { recl.operario = e.target.value; recl.sel.clear(); pintarReclamos(true); };
  $('#r-lista').onclick = (e) => {
    const chk = e.target.closest('input[type=checkbox]'), item = e.target.closest('[data-id]');
    if (chk) { alternarSel(Number(item.dataset.id)); return; }
    if (item) abrirReclamo(Number(item.dataset.id));
  };
  if (yo.rol === 'admin') {
    $('#r-zona').onclick = () => modoZona(!recl.zona);
    const asignar = async (operario) => {
      try { await api('/api/reclamos/asignar', { body: { ids: [...recl.sel], operario } }); recl.sel.clear(); verReclamos(); }
      catch (err) { $('#r-err').textContent = err.message; }
    };
    $('#r-asignar').onclick = () => { const o = $('#r-asignar-a').value; if (!o) { $('#r-err').textContent = 'Elegí un operario'; return; } asignar(o); };
    $('#r-quitar').onclick = () => asignar(null);
    // Selección por zona: se arrastra el mouse para dibujar un rectángulo sobre el mapa
    let inicio = null, rect = null;
    mapa.on('mousedown', (e) => { if (!recl.zona) return; inicio = e.latlng; rect = L.rectangle([inicio, inicio], { color: '#1f6fd6', weight: 2, dashArray: '5 5' }).addTo(mapa); });
    mapa.on('mousemove', (e) => { if (rect) rect.setBounds([inicio, e.latlng]); });
    mapa.on('mouseup', () => {
      if (!rect) return;
      const b = rect.getBounds(); mapa.removeLayer(rect); rect = null;
      for (const r of visibles()) if (r.estado !== 'resuelto' && b.contains([r.c_lat, r.c_lng])) recl.sel.add(r.id);
      modoZona(false); pintarReclamos();
    });
  }
  pintarReclamos(true);
}
const visibles = () => recl.lista.filter((r) => r.estado === recl.estado && (!recl.operario || r.operario_email === recl.operario));
function alternarSel(id) { recl.sel.has(id) ? recl.sel.delete(id) : recl.sel.add(id); pintarReclamos(); }
function modoZona(activo) {
  recl.zona = activo;
  mapa.dragging[activo ? 'disable' : 'enable']();
  $('#mapa').classList.toggle('eligiendo', activo);
  const b = $('#r-zona'); b.textContent = activo ? 'Cancelar selección' : 'Seleccionar zona'; b.classList.toggle('sec', !activo);
  $('#r-err').textContent = ''; $('#r-ayuda').textContent = activo ? 'Arrastrá el mouse sobre el mapa para marcar la zona.' : '';
  mapa.invalidateSize();
}

async function pintarReclamos(encuadrar) {
  const lista = visibles();
  if (recl.capa) mapa.removeLayer(recl.capa);
  if (recl.capaRuta) { mapa.removeLayer(recl.capaRuta); recl.capaRuta = null; }
  recl.capa = L.layerGroup(lista.map((r) => {
    const sel = recl.sel.has(r.id);
    const m = L.circleMarker([r.c_lat, r.c_lng], { radius: sel ? 11 : 8, weight: sel ? 4 : 2, color: sel ? '#111827' : '#fff', fillColor: RECLAMOS[r.estado].color, fillOpacity: 0.95 });
    m.bindTooltip(`#${r.id} · ${r.motivo} · ${r.c_direccion}`);
    m.on('click', () => { if (recl.zona) return; (yo.rol === 'admin' && r.estado !== 'resuelto') ? alternarSel(r.id) : abrirReclamo(r.id); });
    return m;
  })).addTo(mapa);
  if (encuadrar && lista.length) mapa.fitBounds(L.latLngBounds(lista.map((r) => [r.c_lat, r.c_lng])).pad(0.15), { maxZoom: 16 });

  $('#r-titulo').textContent = `${lista.length} reclamos · ${recl.sel.size} seleccionados`;
  for (const id of ['#r-asignar', '#r-quitar']) { const b = $(id); if (b) b.disabled = !recl.sel.size; }
  const item = (r, n) => `
    <div class="recl ${recl.sel.has(r.id) ? 'sel' : ''}" data-id="${r.id}">
      ${yo.rol === 'admin' && r.estado !== 'resuelto' ? `<input type="checkbox" ${recl.sel.has(r.id) ? 'checked' : ''} aria-label="Seleccionar reclamo ${r.id}">` : ''}
      <div><b>${n ? `${n}. ` : ''}#${r.id} · ${esc(r.motivo)}</b>
        <div>${esc(r.tipo_contenedor)} ${esc(r.nro_inventario)} · ${esc(r.c_direccion)}</div>
        <div class="suave">${haceCuanto(r.ts)} · ${esc(r.nombre)}${r.operario ? ` · asignado a ${esc(r.operario)}` : ''}</div></div>
    </div>`;
  const cajaRuta = $('#r-ruta'); cajaRuta.textContent = '';
  // Con un operario elegido se muestra su recorrido óptimo para los reclamos programados
  if (recl.estado === 'programado' && recl.operario && lista.length > 1) {
    cajaRuta.textContent = 'Calculando recorrido…';
    $('#r-lista').innerHTML = lista.map((r) => item(r)).join('');
    const ruta = await calcularRuta(lista.map((r) => ({ lat: r.c_lat, lng: r.c_lng })));
    if (vista !== 'reclamos' || visibles().length !== lista.length) return;
    const enOrden = ruta.orden.map((i) => lista[i]);
    recl.capaRuta = dibujarRuta(mapa, enOrden.map((r) => ({ lat: r.c_lat, lng: r.c_lng, titulo: `#${r.id} · ${r.motivo}` })), ruta, (_, i) => abrirReclamo(enOrden[i].id));
    cajaRuta.textContent = `Recorrido óptimo: ${resumenRuta(ruta)}`;
    $('#r-lista').innerHTML = enOrden.map((r, i) => item(r, i + 1)).join('');
  } else {
    $('#r-lista').innerHTML = lista.map((r) => item(r)).join('') || '<p class="suave">No hay reclamos en este estado.</p>';
    if (recl.estado === 'programado' && !recl.operario && lista.length) cajaRuta.textContent = 'Elegí un operario para ver su recorrido óptimo.';
  }
}

async function abrirReclamo(id) {
  const r = await api('/api/reclamos/' + id);
  const puede = r.estado !== 'resuelto' && yo.rol === 'admin';
  ficha.hidden = false;
  ficha.innerHTML = `
    <button class="btn sec chico cerrar" aria-label="Cerrar">Cerrar</button>
    <h2>Reclamo #${r.id}</h2>
    <div>${chipReclamo(r.estado)}</div>
    <dl class="datos">
      <dt>Motivo</dt><dd><b>${esc(r.motivo)}</b></dd>
      <dt>Equipo</dt><dd><a href="#" data-ficha="${r.contenedor_id}">${esc(r.nro_inventario)}</a> · ${esc(r.tipo_contenedor)}</dd>
      <dt>Dirección</dt><dd>${esc([r.calle, r.altura].filter(Boolean).join(' '))}${r.barrio ? ', ' + esc(r.barrio) : ''}</dd>
      <dt>GPS del vecino</dt><dd>${r.lat != null ? `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}` : 'Sin ubicación'}</dd>
      <dt>Observaciones</dt><dd>${esc(r.observaciones) || '—'}</dd>
      <dt>Cargado por</dt><dd>${esc(r.nombre)}${r.email ? ` · ${esc(r.email)}` : ' · sin mail de contacto'}</dd>
      <dt>Fecha</dt><dd>${fecha(r.ts)}</dd>
      <dt>Operario</dt><dd>${r.operario ? `${esc(r.operario)} · programado ${fecha(r.programado_ts)}` : 'Sin asignar'}</dd>
    </dl>
    ${r.fotos.map((f) => `<a href="/fotos/${esc(f)}" target="_blank"><img class="foto-recl" src="/fotos/${esc(f)}" alt="Foto del reclamo"></a>`).join('')}
    ${r.estado === 'resuelto' ? `<h3>Resolución</h3><div class="linea">${esc(r.resolucion)}<div class="suave">${fecha(r.resuelto_ts)} · ${esc(r.resuelto_por)}</div>
      ${r.foto_resolucion ? `<img src="/fotos/${esc(r.foto_resolucion)}" alt="Foto de la resolución">` : ''}</div>` : ''}
    ${puede ? `<h3>Resolver</h3>
      <form id="resolver"><textarea name="resolucion" required placeholder="Qué se hizo para resolver el reclamo" style="width:100%;min-height:80px"></textarea>
      <p class="suave" style="font-size:13px;margin:6px 0">Al resolver se envía un mail ${r.email ? 'al vecino y ' : ''}a la empresa.</p>
      <button class="btn">Resolver y enviar mail</button><p class="error" id="res-err"></p></form>` : ''}
    <h3>Mails enviados</h3>
    ${r.mails.map((m) => `<div class="linea"><b>${esc(m.asunto)}</b><div class="suave">${fecha(m.ts)} · para ${esc(m.para)}</div>
      ${m.estado === 'enviado' ? '<span class="chip" style="--c:#1a9d5f">Enviado</span>' : `<span class="chip" style="--c:#b3261e">No enviado</span> <span class="error">${esc(m.error)}</span>`}</div>`).join('') || '<p class="suave">Sin mails.</p>'}`;
  $('.cerrar', ficha).onclick = () => { ficha.hidden = true; };
  const f = $('#resolver', ficha);
  if (f) f.onsubmit = async (e) => {
    e.preventDefault(); f.querySelector('button').disabled = true;
    try { await api(`/api/reclamos/${r.id}/resolver`, { body: { resolucion: new FormData(f).get('resolucion') } }); await abrirReclamo(r.id); if (vista === 'reclamos') verReclamos(); }
    catch (err) { $('#res-err', ficha).textContent = err.message; f.querySelector('button').disabled = false; }
  };
}

// ---------------- Ajustes ----------------
async function verAjustes() {
  const a = await api('/api/ajustes');
  if (vista !== 'ajustes') return;
  main.innerHTML = `
    <div class="pagina" style="max-width:760px">
      <div class="panel">
        <h3>Mail de la empresa</h3>
        <p class="suave" style="margin-top:0">A esta dirección llegan los reclamos nuevos y las resoluciones.</p>
        <form class="herramientas" id="f-ajustes">
          <input type="email" name="empresa_email" value="${esc(a.empresa_email)}" placeholder="reclamos@empresa.com" style="flex:1 1 260px">
          <button class="btn">Guardar</button>
          <button class="btn sec" type="button" id="probar">Enviar mail de prueba</button>
        </form>
        <p id="aj-msg" style="margin:0"></p>
      </div>
      <div class="panel" style="margin-top:14px">
        <h3>Cuenta que envía los mails</h3>
        ${a.smtp.configurado
          ? `<p><span class="chip" style="--c:#1a9d5f">Configurada</span> Envía <b>${esc(a.smtp.remitente)}</b> por ${esc(a.smtp.host)}.</p>`
          : `<p><span class="chip" style="--c:#b3261e">Sin configurar</span> Todavía no se pueden enviar mails.</p>`}
        <p class="suave" style="font-size:13px">La cuenta y su contraseña se cargan como variables del servicio (no en esta pantalla, por seguridad):
          <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code>. El README explica cómo hacerlo con una cuenta de Gmail.</p>
      </div>
    </div>`;
  const msg = (ok, t) => { const m = $('#aj-msg'); m.className = ok ? 'suave' : 'error'; m.textContent = t; };
  $('#f-ajustes').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/ajustes', { body: { empresa_email: new FormData(e.target).get('empresa_email') } }); msg(true, 'Guardado.'); }
    catch (err) { msg(false, err.message); }
  };
  $('#probar').onclick = async () => {
    msg(true, 'Enviando…');
    try {
      await api('/api/ajustes', { body: { empresa_email: $('[name=empresa_email]').value } });
      const r = await api('/api/ajustes/probar-mail', { method: 'POST' });
      msg(r.ok, r.ok ? 'Mail de prueba enviado. Revisá la casilla.' : `No se pudo enviar: ${r.error}`);
    } catch (err) { msg(false, err.message); }
  };
}

ir('mapa');

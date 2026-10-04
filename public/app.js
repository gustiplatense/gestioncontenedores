import { api, esc, $, ESTADOS, ALERTAS, GESTIONES, ROLES, haceCuanto, fecha, nro, chipEstado, requerirLogin, salir } from '/common.js';

const raiz = $('#raiz');
const yo = await requerirLogin(raiz);
const { tipos, barrios } = await api('/api/tipos');
const tipoPorId = Object.fromEntries(tipos.map((t) => [t.id, t]));
const puedeGestionar = yo.rol !== 'consulta';

const VISTAS = { mapa: 'Mapa', inventario: 'Inventario', gestiones: 'Gestiones', ...(yo.rol === 'admin' ? { usuarios: 'Usuarios' } : {}) };
let vista = 'mapa';
let filtro = { tipo: '', estado: '', barrio: '', alerta: '', q: '' };
let mapa = null, capa = null, pagina = 0;

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
  ({ mapa: verMapa, inventario: verInventario, gestiones: verGestiones, usuarios: verUsuarios })[v]();
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
async function verMapa() {
  const r = await api('/api/resumen');
  const kpi = (n, txt, color, f) => `<button class="kpi" style="--c:${color}" data-kpi='${JSON.stringify(f)}'><b>${nro(n)}</b><span>${txt}</span></button>`;
  const maxTipo = Math.max(...r.porTipo.map((t) => t.n), 1);
  main.innerHTML = `
    <div class="vista-mapa">
      <div class="kpis">
        ${kpi(r.total, 'Unidades en inventario', '#0f6b4a', {})}
        ${Object.entries(ESTADOS).map(([k, v]) => kpi(r.porEstado[k] || 0, v.nombre, v.color, { estado: k })).join('')}
        ${kpi(r.sinLectura, ALERTAS.sin_lectura.nombre, ALERTAS.sin_lectura.color, { alerta: 'sin_lectura' })}
        ${kpi(r.fueraDeUbicacion, ALERTAS.desvio.nombre, ALERTAS.desvio.color, { alerta: 'desvio' })}
      </div>
      <div class="mapa-fila">
        <div class="panel">
          <h3>Filtros</h3>
          <div class="filtros">${selectores()}<button class="btn sec chico" id="limpiar">Limpiar filtros</button></div>
          <p class="suave" id="cuenta" style="font-size:13px"></p>
          <h3>Unidades activas por tipo</h3>
          ${r.porTipo.map((t) => `<div class="barra"><span>${esc(t.nombre)}</span><b>${nro(t.n)}</b><i style="--p:${(t.n / maxTipo) * 100}%"></i></div>`).join('')}
          <p class="suave" style="font-size:12.5px">Lecturas recibidas en 24 h: <b>${nro(r.lecturas24h)}</b></p>
        </div>
        <div id="mapa"></div>
      </div>
    </div>`;
  mapa = L.map('mapa', { preferCanvas: true }).setView([-34.615, -58.44], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
  const ley = L.control({ position: 'bottomright' });
  ley.onAdd = () => {
    const d = L.DomUtil.create('div', 'leyenda');
    d.innerHTML = [...Object.values(ESTADOS), ...Object.values(ALERTAS)].map((e) => `<div><i style="background:${e.color}"></i>${e.nombre}</div>`).join('');
    return d;
  };
  ley.addTo(mapa);

  main.querySelector('.filtros').onchange = (e) => { filtro[e.target.dataset.f] = e.target.value; cargarPuntos(); };
  $('#limpiar').onclick = () => { filtro = { tipo: '', estado: '', barrio: '', alerta: '', q: '' }; verMapa(); };
  main.querySelector('.kpis').onclick = (e) => {
    const b = e.target.closest('.kpi'); if (!b) return;
    filtro = { ...filtro, estado: '', alerta: '', ...JSON.parse(b.dataset.kpi) };
    main.querySelectorAll('[data-f]').forEach((s) => { s.value = filtro[s.dataset.f]; });
    cargarPuntos();
  };
  cargarPuntos(true);
}

async function cargarPuntos(inicial) {
  const { q, ...f } = filtro;
  const puntos = await api('/api/contenedores/mapa?' + qs(f));
  if (!mapa) return;
  if (capa) mapa.removeLayer(capa);
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
  $('#cuenta').textContent = `${nro(puntos.length)} unidades en el mapa`;
  if (!inicial && puntos.length) mapa.fitBounds(capa.getBounds().pad(0.1), { maxZoom: 16 });
}

// ---------------- Inventario ----------------
function verInventario() {
  main.innerHTML = `
    <div class="pagina">
      <div class="herramientas">
        <input type="search" id="q" placeholder="Buscar por Nº de inventario, tag o dirección" value="${esc(filtro.q)}">
        ${selectores()}
      </div>
      <div class="tabla-caja"><table>
        <thead><tr><th>Nº inventario</th><th>Tag ID</th><th>Tipo</th><th>Estado</th><th>Dirección</th><th>Barrio</th><th>Última lectura</th></tr></thead>
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
    <h2>${esc(c.nro_inventario)}</h2>
    <div>${chipEstado(c.estado)}
      ${c.sin_lectura ? `<span class="chip" style="--c:${ALERTAS.sin_lectura.color}">${ALERTAS.sin_lectura.nombre}</span>` : ''}
      ${c.fuera_de_ubicacion ? `<span class="chip" style="--c:${ALERTAS.desvio.color}">A ${nro(Math.round(c.ult_desvio_m))} m de su ubicación</span>` : ''}
    </div>
    <dl class="datos">
      <dt>Tipo</dt><dd>${esc(c.tipo)}</dd>
      <dt>Tag ID</dt><dd class="mono">${esc(c.tag_id)}</dd>
      <dt>Ubicación</dt><dd>${esc(c.direccion)}${c.barrio ? ', ' + esc(c.barrio) : ''}</dd>
      <dt>Alta</dt><dd>${esc(c.fecha_alta)}</dd>
      <dt>Última lectura</dt><dd>${haceCuanto(c.ult_lectura_ts)}</dd>
    </dl>
    <div class="qr">
      <img src="/api/contenedores/${c.id}/qr.svg" alt="Código QR de ${esc(c.nro_inventario)}">
      <div><b>QR del contenedor</b><p class="suave" style="margin:4px 0 8px;font-size:13px">Escanealo con el celular para abrirlo en la app de campo.</p>
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

ir('mapa');

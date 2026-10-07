// App del vecino / empresa: carga de reclamos sobre un contenedor o cesto, sin login.
import { api, esc, $, codigoDe } from '/common.js';
import { estampar, reducirFoto } from '/fotos.js';

const raiz = $('#raiz');
const MAX_FOTOS = 3;
let lector = null;
const recordado = (() => { try { return JSON.parse(localStorage.getItem('hassa-vecino') || '{}'); } catch { return {}; } })();

function marco(cuerpo, volver) {
  raiz.innerHTML = `
    <div class="movil">
      <header class="claro">
        ${volver ? '<button class="volver" id="volver" aria-label="Volver" style="margin:0">←</button>' : ''}
        <img class="logo-img" src="/logo.png" alt="Hassa">
      </header>
      <div class="cuerpo">${cuerpo}</div>
    </div>`;
  if (volver) $('#volver').onclick = async () => { await pararLector(); volver(); };
  window.scrollTo(0, 0);
}
async function pararLector() {
  if (!lector) return;
  try { await lector.stop(); } catch { /* ya estaba detenido */ }
  lector = null;
}

function inicio(mensaje) {
  marco(`
    <div><h2 style="margin-bottom:6px">Reportá un problema</h2>
      <p class="suave" style="margin:0">¿Viste un contenedor o cesto roto o incompleto? Escaneá su código QR y contanos qué le pasa.</p></div>
    <button class="btn grande" id="escanear">Escanear el QR del contenedor</button>
    <form class="tarjeta" id="buscar">
      <label>O ingresá el número que figura en el contenedor
        <span class="fila"><input name="c" placeholder="Ej.: 516" inputmode="numeric" required><button class="btn">Continuar</button></span>
      </label>
      <p class="error" id="err">${esc(mensaje || '')}</p>
    </form>`);
  $('#escanear').onclick = escanear;
  $('#buscar').onsubmit = (e) => { e.preventDefault(); cargar(new FormData(e.target).get('c')); };
}

function escanear() {
  marco(`<div id="lector"></div><p class="suave" id="estado-lector">Apuntá la cámara al código QR del contenedor.</p>`, inicio);
  lector = new Html5Qrcode('lector');
  lector.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, async (texto) => {
    await pararLector();
    cargar(codigoDe(texto));
  }).catch(() => {
    $('#estado-lector').innerHTML = '<span class="error">No se pudo abrir la cámara. Revisá los permisos o ingresá el número a mano.</span>';
  });
}

async function cargar(ref) {
  try { formulario(await api('/api/publico/contenedor/' + encodeURIComponent(codigoDe(String(ref))))); }
  catch (e) { inicio(e.message); }
}

function formulario(c) {
  const fotos = [];            // fotos reducidas, todavía sin marca de agua
  let gps = null;
  marco(`
    <div class="tarjeta"><b style="font-size:17px">${esc(c.tipo)}</b><div class="suave">Equipo Nº ${esc(c.nro_inventario)}</div></div>
    <form class="gestion" id="f">
      <label>¿Qué problema tiene?
        <select name="motivo" required><option value="">Elegí un motivo</option>${c.motivos.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
      <div>
        <div class="fotos-vista" id="fotos"></div>
        <label class="foto-btn" id="agregar" style="display:block;margin-top:8px">Agregar foto (hasta ${MAX_FOTOS})
          <input type="file" accept="image/*" multiple id="foto"></label>
      </div>
      <div class="fila">
        <label style="flex:2">Calle<input name="calle" value="${esc(c.calle)}" required></label>
        <label style="flex:1">Altura<input name="altura" value="${esc(c.altura)}" inputmode="numeric"></label>
      </div>
      <label>Barrio<input name="barrio" value="${esc(c.barrio)}"></label>
      <div class="gps" id="gps">Obteniendo tu ubicación…</div>
      <label>Observaciones<textarea name="observaciones" placeholder="Contanos más (opcional)"></textarea></label>
      <label>Tu nombre o el de tu empresa<input name="nombre" value="${esc(recordado.nombre)}" required autocomplete="name"></label>
      <label>Tu mail (para avisarte cuando esté resuelto)<input type="email" name="email" value="${esc(recordado.email)}" required autocomplete="email"></label>
      <p class="error" id="err"></p>
      <button class="btn grande">Enviar reclamo</button>
    </form>`, inicio);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((p) => {
      gps = { lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy) };
      const g = $('#gps'); if (g) { g.className = 'gps ok'; g.textContent = `Ubicación registrada (±${gps.precision} m)`; }
    }, () => { const g = $('#gps'); if (g) g.textContent = 'Sin ubicación GPS. Podés enviar el reclamo igual.'; }, { enableHighAccuracy: true, timeout: 15000 });
  } else $('#gps').textContent = 'Este dispositivo no informa ubicación.';

  const pintarFotos = () => {
    $('#fotos').innerHTML = fotos.map((f, i) => `<div style="position:relative"><img src="${f.datos}" alt="Foto ${i + 1}">
      <button type="button" data-quitar="${i}" aria-label="Quitar foto ${i + 1}" style="position:absolute;top:4px;right:4px;border:0;border-radius:50%;width:26px;height:26px;background:#000a;color:#fff">×</button></div>`).join('');
    $('#agregar').style.display = fotos.length >= MAX_FOTOS ? 'none' : 'block';
  };
  $('#foto').onchange = async (e) => {
    for (const archivo of [...e.target.files].slice(0, MAX_FOTOS - fotos.length)) {
      try { fotos.push({ datos: await reducirFoto(archivo), ts: new Date() }); } catch { $('#err').textContent = 'No se pudo leer una de las fotos.'; }
    }
    e.target.value = ''; pintarFotos();
  };
  $('#fotos').onclick = (e) => { const b = e.target.closest('[data-quitar]'); if (b) { fotos.splice(Number(b.dataset.quitar), 1); pintarFotos(); } };

  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target)), err = $('#err');
    if (!fotos.length) { err.textContent = 'Agregá al menos una foto.'; return; }
    const btn = e.target.querySelector('button.grande'); btn.disabled = true; btn.textContent = 'Enviando…'; err.textContent = '';
    try {
      // Marca de agua con los datos finales del reclamo
      const marcadas = await Promise.all(fotos.map((f) => estampar(f.datos, [
        `${f.ts.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })} ${f.ts.toLocaleTimeString('es-AR', { hour12: false })}`,
        [[d.calle, d.altura].filter(Boolean).join(' '), d.barrio].filter(Boolean).join(', '),
        gps ? `GPS ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)} (±${gps.precision} m)` : 'Sin ubicación GPS',
        `Equipo ${c.nro_inventario} · ${c.tipo}`,
        `Reclamo de vecino · ${d.motivo}`,
      ].filter(Boolean))));
      const r = await api('/api/publico/reclamos', { body: { ...d, contenedor: c.nro_inventario, fotos: marcadas, lat: gps?.lat, lng: gps?.lng } });
      try { localStorage.setItem('hassa-vecino', JSON.stringify({ nombre: d.nombre, email: d.email })); } catch { /* sin almacenamiento */ }
      marco(`
        <div class="tarjeta ok-pantalla"><div class="tilde">✓</div>
          <h2>Recibimos tu reclamo</h2>
          <p class="suave">Número de reclamo: <b>#${r.id}</b><br>Te vamos a avisar a ${esc(d.email)} cuando esté resuelto.</p></div>
        <button class="btn grande" id="otro">Cargar otro reclamo</button>`);
      $('#otro').onclick = () => inicio();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Enviar reclamo'; }
  };
}

const inicial = new URLSearchParams(location.search).get('c');
if (inicial) { history.replaceState(null, '', '/vecino/'); cargar(inicial); } else inicio();

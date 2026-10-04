// Utilidades compartidas entre el backoffice y la app de campo
export const ESTADOS = {
  en_servicio: { nombre: 'En vía pública', color: '#1a9d5f' },
  en_deposito: { nombre: 'En depósito', color: '#5b6b7a' },
  reparacion: { nombre: 'En reparación', color: '#e08a00' },
  baja: { nombre: 'Baja', color: '#b3261e' },
};
export const ALERTAS = {
  sin_lectura: { nombre: 'Sin lectura +48 h', color: '#7b3fe4' },
  desvio: { nombre: 'Fuera de ubicación', color: '#d6336c' },
};
export const GESTIONES = {
  movimiento: 'Movimiento', recambio: 'Recambio', reparacion: 'Solicitud de reparación', baja: 'Baja',
};
export const ROLES = { admin: 'Administrador', operador: 'Operador', consulta: 'Consulta' };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, el = document) => el.querySelector(sel);

export async function api(url, opts = {}) {
  const r = await fetch(url, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || `Error ${r.status}`); e.status = r.status; throw e; }
  return data;
}

export function haceCuanto(iso) {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} días`;
}
export const fecha = (iso) => iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
export const nro = (n) => Number(n).toLocaleString('es-AR');
export const chipEstado = (e) => `<span class="chip" style="--c:${ESTADOS[e]?.color}">${esc(ESTADOS[e]?.nombre || e)}</span>`;

// Devuelve el usuario logueado, o muestra la pantalla de ingreso y no resuelve hasta recargar.
export async function requerirLogin(contenedor) {
  try { return await api('/api/me'); } catch (e) { if (e.status !== 401) throw e; }
  const cfg = await api('/api/config');
  contenedor.innerHTML = `
    <div class="login">
      <div class="login-card">
        <img class="logo-img grande" src="/logo.png" alt="Hassa"><div class="marca grande">Inventario de contenedores</div>
        <p class="suave">Ingresá con tu cuenta de Google. El acceso lo habilita un administrador.</p>
        <div id="g-btn"></div>
        <div id="demo-btns"></div>
        <p class="error" id="login-error"></p>
      </div>
    </div>`;
  const error = (m) => { $('#login-error', contenedor).textContent = m; };
  if (cfg.googleClientId) {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => {
      google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: async (resp) => {
          try { await api('/api/auth/google', { body: { credential: resp.credential } }); location.reload(); }
          catch (e) { error(e.message); }
        },
      });
      google.accounts.id.renderButton($('#g-btn', contenedor), { theme: 'filled_blue', size: 'large', text: 'signin_with', locale: 'es' });
    };
    document.head.appendChild(s);
  } else {
    $('#demo-btns', contenedor).innerHTML = `<p class="aviso">Modo demo: el login con Google se activa al configurar <code>GOOGLE_CLIENT_ID</code>.</p>` +
      cfg.usuariosDemo.map((u) => `<button class="btn ancho" data-email="${esc(u.email)}">Entrar como ${esc(ROLES[u.rol])}</button>`).join('');
    $('#demo-btns', contenedor).onclick = async (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      try { await api('/api/auth/demo', { body: { email: b.dataset.email } }); location.reload(); }
      catch (e) { error(e.message); }
    };
  }
  return new Promise(() => {});
}

export async function salir() { await api('/api/auth/salir', { method: 'POST' }); location.reload(); }

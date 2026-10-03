// Simula una aplicación de terceros que reporta lecturas georreferenciadas de tags.
// Uso: npm run simular            (URL=http://localhost:3000 API_KEY=demo-key CANTIDAD=300)
const URL_BASE = process.env.URL || 'http://localhost:3000';
const headers = { 'Content-Type': 'application/json', 'x-api-key': process.env.API_KEY || 'demo-key' };
const cantidad = Number(process.env.CANTIDAD || 300);

const tags = await (await fetch(`${URL_BASE}/api/v1/tags?limit=${cantidad}`, { headers })).json();
if (!Array.isArray(tags)) { console.error("Error:", tags); process.exit(1); }
const lecturas = tags.map((t) => ({
  tag_id: t.tag_id,
  lat: t.lat + (Math.random() - 0.5) * 0.0002,   // ~10 m de ruido de GPS
  lng: t.lng + (Math.random() - 0.5) * 0.0002,
  ts: new Date().toISOString(),
}));
const r = await fetch(`${URL_BASE}/api/v1/lecturas`, { method: 'POST', headers, body: JSON.stringify({ lecturas }) });
console.log(r.status, await r.json());

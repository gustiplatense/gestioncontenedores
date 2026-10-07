// Envío de mails por SMTP. Las credenciales van en variables de entorno (nunca en el código):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y opcionalmente MAIL_FROM.
// Con Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER=cuenta@gmail.com, SMTP_PASS=contraseña de aplicación.
import nodemailer from 'nodemailer';
import { db } from './db.js';

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
const puerto = Number(SMTP_PORT || 465);
const remitente = process.env.MAIL_FROM || SMTP_USER || '';

export const smtp = {
  configurado: Boolean(SMTP_HOST && remitente),
  host: SMTP_HOST || null,
  remitente: remitente || null,
};

const transporte = smtp.configurado
  ? nodemailer.createTransport({
      host: SMTP_HOST, port: puerto, secure: puerto === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    })
  : null;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Arma un mail simple a partir de un título y pares etiqueta/valor
export function cuerpoHtml(titulo, filas, pie = '') {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#17231e">
    <h2 style="color:#0f6b4a;margin:0 0 12px">${esc(titulo)}</h2>
    <table cellpadding="6" style="border-collapse:collapse">${filas.filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `<tr><td style="color:#62716b;vertical-align:top">${esc(k)}</td><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>
    ${pie}</div>`;
}

// Envía y deja registro del resultado en la tabla `mails`. Nunca lanza: devuelve { ok, error }.
export async function enviarMail({ para, asunto, html, adjuntos = [], responderA, reclamoId = null }) {
  const destinatarios = [].concat(para).filter(Boolean);
  const registrar = (estado, error) => db.prepare('INSERT INTO mails (reclamo_id,para,asunto,estado,error,ts) VALUES (?,?,?,?,?,?)')
    .run(reclamoId, destinatarios.join(', ') || '(sin destinatario)', asunto, estado, error || null, new Date().toISOString());
  let error = null;
  if (!destinatarios.length) error = 'No hay dirección de destino configurada';
  else if (!transporte) error = 'El servidor de correo (SMTP) no está configurado';
  else {
    try {
      await transporte.sendMail({
        from: `"Hassa Inventario" <${remitente}>`, to: destinatarios.join(', '), subject: asunto, html,
        replyTo: responderA || undefined, attachments: adjuntos,
      });
    } catch (e) { error = e.message; }
  }
  registrar(error ? 'error' : 'enviado', error);
  if (error) console.error(`Mail no enviado (${asunto}): ${error}`);
  return { ok: !error, error };
}

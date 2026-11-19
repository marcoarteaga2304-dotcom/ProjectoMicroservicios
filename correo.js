require('dotenv').config();
const nodemailer = require('nodemailer');

const APP_URL = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 587);
const user = process.env.SMTP_USER;
const remitente = process.env.SMTP_FROM || (user ? `GlowCosmetics <${user}>` : 'GlowCosmetics <no-reply@glowcosmetics.local>');

const transporte = host
  ? nodemailer.createTransport({
      host, port,
      secure: port === 465,                       // 465 = SSL directo; 587 y 2525 usan STARTTLS
      auth: user ? { user, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
    })
  : null;

const hayCorreo = () => Boolean(transporte);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Diseño común de todos los correos de la tienda
function plantilla(html) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#fafafa;font-family:Arial,Helvetica,sans-serif;color:#2c2c2c">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="text-align:center;padding:12px 0"><span style="font-family:Georgia,serif;font-size:26px;color:#d63384">GlowCosmetics</span></div>
    <div style="background:#fff;border:1px solid #eee;border-radius:10px;padding:24px;line-height:1.55">${html}</div>
    <p style="font-size:12px;color:#757575;text-align:center;margin-top:16px">Recibes este mensaje por una acción realizada en ${esc(APP_URL)}.<br>Consulta nuestro Aviso de Privacidad en el sitio.</p>
  </div></body></html>`;
}

async function enviarCorreo(to, subject, html, extra = {}) {
  if (!transporte) {
    console.log(`[correo no enviado: SMTP sin configurar] Para: ${to} | Asunto: ${subject}`);
    return false;
  }
  try {
    await transporte.sendMail({
      from: remitente, to, subject,
      html: plantilla(html),
      text: html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim(),
      ...extra
    });
    return true;
  } catch (e) {
    console.error('Error enviando correo:', e.message);
    return false;
  }
}

async function verificarCorreo() {
  if (!transporte) { console.log('✉️  Correo sin configurar (SMTP_HOST vacío): los mensajes solo se muestran en la consola.'); return false; }
  try {
    await transporte.verify();
    console.log(`✉️  Servidor de correo listo (${host}:${port})`);
    return true;
  } catch (e) {
    console.error(`✉️  No se pudo conectar al servidor de correo (${host}:${port}): ${e.message}`);
    return false;
  }
}

module.exports = { enviarCorreo, verificarCorreo, hayCorreo, remitente };
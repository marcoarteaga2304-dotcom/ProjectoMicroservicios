// Uso: node probar-paypal.js
// En Docker: docker compose exec web node probar-paypal.js
require('dotenv').config();
const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_SECRET;
const live = process.env.PAYPAL_MODE === 'live';
const base = live ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

(async () => {
  if (!id || !secret) { console.log('❌ Faltan PAYPAL_CLIENT_ID y/o PAYPAL_SECRET en tu .env'); process.exit(1); }
  console.log(`Modo: ${live ? 'LIVE (dinero real)' : 'sandbox (pruebas)'}`);
  const r = await fetch(base + '/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.log('❌ PayPal rechazó las credenciales:', d.error_description || d.error || r.status);
    console.log('   Revisa que el Client ID y el Secret sean de la misma app y del mismo modo (Sandbox/Live).');
    process.exit(1);
  }
  console.log('✅ Credenciales válidas.');
  const o = await fetch(base + '/v2/checkout/orders', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + d.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'MXN', value: '1.00' } }] })
  });
  const od = await o.json().catch(() => ({}));
  if (o.ok) console.log(`✅ PayPal acepta órdenes en pesos mexicanos (orden de prueba ${od.id}; no se cobra nada).`);
  else console.log('❌ No se pudo crear una orden en MXN:', (od.details && od.details[0] && od.details[0].description) || od.message || o.status);
})().catch(e => { console.error('❌ Error de conexión:', e.message); process.exit(1); });
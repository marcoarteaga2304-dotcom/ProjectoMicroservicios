require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-este-secreto-en-produccion';
const ENVIO_COSTO = Number(process.env.ENVIO_COSTO ?? 99);
const ENVIO_GRATIS_DESDE = Number(process.env.ENVIO_GRATIS_DESDE ?? 1500); // 0 = desactivado
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const CONTACTO_EMAIL = process.env.CONTACTO_EMAIL || 'contacto@glowcosmetics.local';
const CATEGORIAS = ['Rostro', 'Ojos', 'Labios'];
const ESTADOS = ['Pagado', 'Enviado', 'Entregado', 'Cancelado'];

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_SECRET = process.env.PAYPAL_SECRET || '';
const PAYPAL_BASE = process.env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

if (JWT_SECRET === 'cambia-este-secreto-en-produccion') console.warn('⚠️  Define JWT_SECRET en tu .env antes de publicar la tienda.');

// ---------- Seguridad ----------
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
if (process.env.FORZAR_HTTPS === '1') {
  app.use((req, res, next) => (req.secure ? next() : res.redirect(301, 'https://' + req.headers.host + req.originalUrl)));
}
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://*.paypal.com', 'https://*.paypalobjects.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://*.paypal.com', 'https://*.paypalobjects.com'],
      frameSrc: ["'self'", 'https://*.paypal.com'],
      upgradeInsecureRequests: null
    }
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginResourcePolicy: { policy: 'same-site' }
}));

const limitar = (minutos, limite, mensaje) => rateLimit({
  windowMs: minutos * 60 * 1000, limit: limite, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: mensaje }
});
const limiteLogin = limitar(15, 10, 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
const limiteRegistro = limitar(60, 20, 'Demasiados registros desde esta red. Intenta más tarde.');
const limiteCorreo = limitar(60, 5, 'Demasiadas solicitudes. Intenta de nuevo en una hora.');

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Base de datos ----------
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'glowcosmetics_db',
  waitForConnections: true,
  connectionLimit: 10
});
pool.query('SELECT 1')
  .then(() => console.log('Conectado exitosamente a la base de datos MySQL.'))
  .catch(err => console.error('Error al conectar a la base de datos MySQL:', err.message));

// ---------- Utilidades ----------
class ErrorNegocio extends Error {
  constructor(mensaje, status = 400) { super(mensaje); this.status = status; }
}
const leerJson = v => (typeof v === 'string' ? JSON.parse(v) : v);
const redondear = n => Math.round(n * 100) / 100;
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function auth(req, res, next) {
  const hd = req.headers.authorization || '';
  const t = hd.startsWith('Bearer ') ? hd.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'Debes iniciar sesión.' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Tu sesión expiró. Inicia sesión de nuevo.' }); }
}

// Verifica el rol en la base de datos (así un admin degradado pierde acceso de inmediato)
async function soloAdmin(req, res, next) {
  const [rows] = await pool.execute('SELECT rol FROM usuarios WHERE email = ?', [req.user.email]);
  if (!rows[0] || rows[0].rol !== 'admin') return res.status(403).json({ error: 'Acceso solo para administradores.' });
  next();
}

async function enTransaccion(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally { conn.release(); }
}

// ---------- Correo (Por el momento no tenemos el SMTP configurado, solo se escribe en la consola de VS)
const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    })
  : null;

async function enviarCorreo(to, subject, html, extra = {}) {
  if (!mailer) { console.log(`[correo simulado] Para: ${to} | Asunto: ${subject}`); return; }
  try {
    await mailer.sendMail({ from: process.env.SMTP_FROM || 'GlowCosmetics <no-reply@glowcosmetics.local>', to, subject, html, ...extra });
  } catch (e) { console.error('Error enviando correo:', e.message); }
}

// ---------- Validaciones ----------
function validarDireccion(d) {
  if (!d || typeof d !== 'object') throw new ErrorNegocio('Ingresa tu dirección de envío.');
  const campos = { nombre: 'nombre de quien recibe', telefono: 'teléfono', calle: 'calle y número', colonia: 'colonia', ciudad: 'ciudad', estado: 'estado', cp: 'código postal' };
  const o = {};
  for (const k of Object.keys(campos)) {
    const v = String(d[k] ?? '').trim();
    if (!v || v.length > 120) throw new ErrorNegocio(`Revisa el campo: ${campos[k]}.`);
    o[k] = v;
  }
  if (!/^\d{5}$/.test(o.cp)) throw new ErrorNegocio('El código postal debe tener 5 dígitos.');
  if (!/^[\d\s+()-]{8,15}$/.test(o.telefono)) throw new ErrorNegocio('Revisa el número de teléfono.');
  o.referencias = String(d.referencias ?? '').trim().slice(0, 200);
  return o;
}

function normalizarCarrito(carrito, { permitirVacio = false } = {}) {
  if (!Array.isArray(carrito) || (!permitirVacio && carrito.length === 0)) throw new ErrorNegocio('Tu bolsa está vacía.');
  const mapa = new Map();
  for (const it of carrito) {
    const id = Number(it.id), cant = Number(it.cantidad);
    if (!Number.isInteger(id) || !Number.isInteger(cant) || cant < 1 || cant > 99) throw new ErrorNegocio('Carrito inválido.');
    mapa.set(id, (mapa.get(id) || 0) + cant);
  }
  return [...mapa].map(([id, cantidad]) => ({ id, cantidad }));
}

function camposProducto(b, parcial) {
  const o = {};
  const tiene = k => !parcial || b[k] !== undefined;
  if (tiene('nombre')) {
    const v = String(b.nombre ?? '').trim();
    if (!v || v.length > 150) throw new ErrorNegocio('El nombre es obligatorio (máx. 150 caracteres).');
    o.nombre = v;
  }
  if (tiene('categoria')) {
    if (!CATEGORIAS.includes(b.categoria)) throw new ErrorNegocio('Categoría inválida.');
    o.categoria = b.categoria;
  }
  if (tiene('precio')) {
    const v = Number(b.precio);
    if (!(v > 0) || v > 1000000) throw new ErrorNegocio('El precio debe ser mayor a 0.');
    o.precio = redondear(v);
  }
  if (tiene('stock')) {
    const v = Number(b.stock);
    if (!Number.isInteger(v) || v < 0) throw new ErrorNegocio('El stock debe ser un entero mayor o igual a 0.');
    o.stock = v;
  }
  if (tiene('imagen')) {
    const v = String(b.imagen ?? '').trim();
    if (v.length > 255) throw new ErrorNegocio('La ruta de la imagen es demasiado larga.');
    o.imagen = v;
  }
  if (tiene('descripcion')) {
    const v = String(b.descripcion ?? '').trim();
    if (v.length > 1000) throw new ErrorNegocio('La descripción no puede superar 1000 caracteres.');
    o.descripcion = v || null;
  }
  if (tiene('color_hex')) {
    const v = String(b.color_hex ?? '').trim();
    if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) throw new ErrorNegocio('El color debe tener formato #RRGGBB.');
    o.color_hex = v || null;
  }
  if (b.activo !== undefined) o.activo = b.activo ? 1 : 0;
  return o;
}

// ---------- Cupones y cotización (el servidor es la única fuente de precios)
async function evaluarCupon(conn, codigo, subtotal) {
  if (!codigo) return { cupon: null, descuento: 0 };
  const [r] = await conn.execute('SELECT * FROM cupones WHERE codigo = ? AND activo = 1', [String(codigo).trim().toUpperCase()]);
  const c = r[0];
  if (!c) throw new ErrorNegocio('El cupón no es válido o ya no está activo.');
  if (subtotal < Number(c.compra_minima)) throw new ErrorNegocio(`Este cupón requiere una compra mínima de $${Number(c.compra_minima)} MXN.`);
  let d = c.tipo === 'porcentaje' ? subtotal * Number(c.valor) / 100 : Number(c.valor);
  d = Math.min(redondear(d), subtotal);
  return { cupon: c.codigo, descuento: d };
}

async function cotizar(conn, carrito, { reservar = false, cupon = null } = {}) {
  const items = [];
  let subtotal = 0;
  for (const { id, cantidad } of carrito) {
    const [rows] = await conn.execute(
      'SELECT id, nombre, precio, stock FROM productos WHERE id = ? AND activo = 1' + (reservar ? ' FOR UPDATE' : ''), [id]);
    const p = rows[0];
    if (!p) throw new ErrorNegocio('Un producto de tu bolsa ya no está disponible.');
    if (p.stock < cantidad) throw new ErrorNegocio(`Stock insuficiente para "${p.nombre}" (disponibles: ${p.stock}).`);
    if (reservar) await conn.execute('UPDATE productos SET stock = stock - ? WHERE id = ?', [cantidad, id]);
    const precio = Number(p.precio);
    subtotal += precio * cantidad;
    items.push({ id, nombre: p.nombre, precio, cantidad });
  }
  subtotal = redondear(subtotal);
  const { cupon: codigo, descuento } = await evaluarCupon(conn, cupon, subtotal);
  const base = redondear(subtotal - descuento);
  const envio = ENVIO_GRATIS_DESDE > 0 && base >= ENVIO_GRATIS_DESDE ? 0 : ENVIO_COSTO;
  return { items, subtotal, descuento, cupon: codigo, envio, total: redondear(base + envio) };
}

async function registrarPedido(conn, email, carrito, metodo, { direccion, cupon, paypalId = null }) {
  const c = await cotizar(conn, carrito, { reservar: true, cupon });
  const folio = (metodo === 'PayPal' ? 'PAYPAL-' : 'GLOW-') + Date.now();
  await conn.execute(
    `INSERT INTO pedidos (usuario_email, total, folio, metodo_pago, productos, paypal_order_id, estado, direccion, subtotal, descuento, envio, cupon)
     VALUES (?, ?, ?, ?, ?, ?, 'Pagado', ?, ?, ?, ?, ?)`,
    [email, c.total, folio, metodo, JSON.stringify(c.items), paypalId, JSON.stringify(direccion), c.subtotal, c.descuento, c.envio, c.cupon]);
  return { folio, ...c, direccion };
}

function htmlPedido(p) {
  const filas = p.items.map(i => `<li>${i.cantidad} × ${h(i.nombre)} — $${redondear(i.precio * i.cantidad)}</li>`).join('');
  const d = p.direccion;
  return `<h2>¡Gracias por tu compra en GlowCosmetics! 💄</h2>
    <p>Folio: <b>${h(p.folio)}</b></p><ul>${filas}</ul>
    <p>Subtotal: $${p.subtotal}${p.descuento ? ` · Descuento (${h(p.cupon)}): -$${p.descuento}` : ''} · Envío: $${p.envio}</p>
    <p><b>Total: $${p.total} MXN</b></p>
    <p>Enviaremos tu pedido a: ${h(d.calle)}, ${h(d.colonia)}, ${h(d.ciudad)}, ${h(d.estado)}, C.P. ${h(d.cp)}.</p>`;
}

async function despuesDeCompra(email, pedido) {
  await pool.execute('DELETE FROM carritos WHERE usuario_email = ?', [email]);
  enviarCorreo(email, `Confirmación de tu pedido ${pedido.folio}`, htmlPedido(pedido));
}

// ---------- Público ----------
app.get('/api/config', (req, res) => {
  res.json({ paypalClientId: PAYPAL_CLIENT_ID, envioCosto: ENVIO_COSTO, envioGratisDesde: ENVIO_GRATIS_DESDE, contacto: CONTACTO_EMAIL,
    negocio: { nombre: process.env.NEGOCIO_NOMBRE || 'GlowCosmetics', domicilio: process.env.NEGOCIO_DOMICILIO || 'Querétaro, México' } });
});

app.get('/api/productos', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.nombre, p.categoria, p.precio, p.stock, p.imagen, p.descripcion, p.color_hex,
            (SELECT ROUND(AVG(r.calificacion), 1) FROM resenas r WHERE r.producto_id = p.id) AS calificacion,
            (SELECT COUNT(*) FROM resenas r WHERE r.producto_id = p.id) AS num_resenas
     FROM productos p WHERE p.activo = 1 ORDER BY p.id`);
  res.json(rows.map(p => ({
    ...p, precio: Number(p.precio),
    calificacion: p.calificacion === null ? null : Number(p.calificacion),
    num_resenas: Number(p.num_resenas)
  })));
});

app.get('/api/productos/:id/resenas', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new ErrorNegocio('Producto inválido.');
  const [rows] = await pool.execute(
    `SELECT r.calificacion, r.comentario, r.fecha, u.nombre FROM resenas r
     LEFT JOIN usuarios u ON u.email = r.usuario_email WHERE r.producto_id = ? ORDER BY r.fecha DESC LIMIT 30`, [id]);
  res.json(rows.map(r => ({ ...r, nombre: String(r.nombre || 'Cliente').split(' ')[0] })));
});

app.post('/api/productos/:id/resenas', auth, async (req, res) => {
  const id = Number(req.params.id);
  const calificacion = Number(req.body.calificacion);
  const comentario = String(req.body.comentario || '').trim().slice(0, 500);
  if (!Number.isInteger(id) || !Number.isInteger(calificacion) || calificacion < 1 || calificacion > 5) {
    throw new ErrorNegocio('La calificación debe ser de 1 a 5 estrellas.');
  }
  const [peds] = await pool.execute("SELECT productos FROM pedidos WHERE usuario_email = ? AND estado <> 'Cancelado'", [req.user.email]);
  const compro = peds.some(p => (leerJson(p.productos) || []).some(it => Number(it.id) === id));
  if (!compro) throw new ErrorNegocio('Solo quienes compraron este producto pueden reseñarlo.', 403);
  await pool.execute(
    `INSERT INTO resenas (producto_id, usuario_email, calificacion, comentario) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE calificacion = VALUES(calificacion), comentario = VALUES(comentario), fecha = NOW()`,
    [id, req.user.email, calificacion, comentario || null]);
  res.json({ mensaje: '¡Gracias por tu reseña!' });
});

app.post('/api/contacto', limiteCorreo, async (req, res) => {
  const nombre = String(req.body.nombre || '').trim().slice(0, 100);
  const email = String(req.body.email || '').trim().slice(0, 100);
  const mensaje = String(req.body.mensaje || '').trim().slice(0, 2000);
  if (!nombre || !/^\S+@\S+\.\S+$/.test(email) || mensaje.length < 5) throw new ErrorNegocio('Completa tu nombre, un correo válido y tu mensaje.');
  await enviarCorreo(CONTACTO_EMAIL, `Mensaje de contacto de ${nombre}`, `<p><b>${h(nombre)}</b> (${h(email)}):</p><p>${h(mensaje).replace(/\n/g, '<br>')}</p>`, { replyTo: email });
  res.json({ mensaje: '¡Mensaje enviado! Te responderemos pronto.' });
});

// ---------- Autenticación ----------
app.post('/api/registro', limiteRegistro, async (req, res) => {
  const nombre = String(req.body.nombre || '').trim().slice(0, 100);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!nombre || !/^\S+@\S+\.\S+$/.test(email)) throw new ErrorNegocio('Revisa tu nombre y correo electrónico.');
  if (password.length < 6) throw new ErrorNegocio('La contraseña debe tener al menos 6 caracteres.');
  const hash = await bcrypt.hash(password, 10);
  try {
    await pool.execute('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)', [nombre, email, hash, 'comprador']);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new ErrorNegocio('El correo electrónico ya está registrado.');
    throw err;
  }
  res.json({ mensaje: 'Registro exitoso' });
});

app.post('/api/login', limiteLogin, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const [rows] = await pool.execute('SELECT * FROM usuarios WHERE email = ?', [email]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password))) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  const usuario = { nombre: u.nombre, email: u.email, rol: u.rol };
  res.json({ mensaje: 'Login exitoso', token: jwt.sign(usuario, JWT_SECRET, { expiresIn: '8h' }), usuario });
});

app.post('/api/recuperar', limiteCorreo, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const [rows] = await pool.execute('SELECT nombre FROM usuarios WHERE email = ?', [email]);
  if (rows[0]) {
    const tokenPlano = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(tokenPlano).digest('hex');
    await pool.execute('DELETE FROM recuperacion WHERE usuario_email = ?', [email]);
    await pool.execute('INSERT INTO recuperacion (usuario_email, token_hash, expira) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))', [email, hash]);
    const enlace = `${APP_URL}/?reset=${tokenPlano}`;
    if (!mailer) console.log('🔑 Enlace de recuperación (modo desarrollo):', enlace);
    enviarCorreo(email, 'Recupera tu contraseña de GlowCosmetics',
      `<p>Hola ${h(rows[0].nombre)}, recibimos una solicitud para restablecer tu contraseña.</p>
       <p><a href="${enlace}">Haz clic aquí para crear una nueva</a> (válido por 1 hora).</p>
       <p>Si no fuiste tú, ignora este mensaje.</p>`);
  }
  // Misma respuesta exista o no el correo (no revela qué cuentas están registradas)
  res.json({ mensaje: 'Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña.' });
});

app.post('/api/restablecer', limiteLogin, async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 6) throw new ErrorNegocio('La contraseña debe tener al menos 6 caracteres.');
  const hash = crypto.createHash('sha256').update(String(req.body.token || '')).digest('hex');
  const [rows] = await pool.execute('SELECT id, usuario_email FROM recuperacion WHERE token_hash = ? AND usado = 0 AND expira > NOW()', [hash]);
  if (!rows[0]) throw new ErrorNegocio('El enlace no es válido o ya expiró. Solicita uno nuevo.');
  await pool.execute('UPDATE usuarios SET password = ? WHERE email = ?', [await bcrypt.hash(password, 10), rows[0].usuario_email]);
  await pool.execute('UPDATE recuperacion SET usado = 1 WHERE id = ?', [rows[0].id]);
  res.json({ mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
});

// ---------- Perfil ----------
app.get('/api/perfil', auth, async (req, res) => {
  const [rows] = await pool.execute('SELECT nombre, email, rol, direccion FROM usuarios WHERE email = ?', [req.user.email]);
  if (!rows[0]) throw new ErrorNegocio('Usuario no encontrado.', 401);
  res.json({ ...rows[0], direccion: rows[0].direccion ? leerJson(rows[0].direccion) : null });
});

app.put('/api/perfil', auth, async (req, res) => {
  const nombre = String(req.body.nombre || '').trim().slice(0, 100);
  if (!nombre) throw new ErrorNegocio('El nombre no puede estar vacío.');
  const direccion = req.body.direccion ? validarDireccion(req.body.direccion) : null;
  await pool.execute('UPDATE usuarios SET nombre = ?, direccion = ? WHERE email = ?', [nombre, direccion ? JSON.stringify(direccion) : null, req.user.email]);
  res.json({ mensaje: 'Perfil actualizado', nombre });
});

app.put('/api/perfil/password', auth, async (req, res) => {
  const nueva = String(req.body.nueva || '');
  if (nueva.length < 6) throw new ErrorNegocio('La nueva contraseña debe tener al menos 6 caracteres.');
  const [rows] = await pool.execute('SELECT password FROM usuarios WHERE email = ?', [req.user.email]);
  if (!rows[0] || !(await bcrypt.compare(String(req.body.actual || ''), rows[0].password))) throw new ErrorNegocio('La contraseña actual es incorrecta.');
  await pool.execute('UPDATE usuarios SET password = ? WHERE email = ?', [await bcrypt.hash(nueva, 10), req.user.email]);
  res.json({ mensaje: 'Contraseña actualizada' });
});

// ---------- Bolsa guardada en el servidor ----------
app.get('/api/carrito', auth, async (req, res) => {
  const [rows] = await pool.execute('SELECT items FROM carritos WHERE usuario_email = ?', [req.user.email]);
  res.json({ items: rows[0] ? leerJson(rows[0].items) : [] });
});

app.put('/api/carrito', auth, async (req, res) => {
  const items = normalizarCarrito(req.body.items, { permitirVacio: true });
  if (items.length === 0) await pool.execute('DELETE FROM carritos WHERE usuario_email = ?', [req.user.email]);
  else await pool.execute('INSERT INTO carritos (usuario_email, items) VALUES (?, ?) ON DUPLICATE KEY UPDATE items = VALUES(items)', [req.user.email, JSON.stringify(items)]);
  res.json({ ok: true });
});

// ---------- Favoritos ----------
app.get('/api/favoritos', auth, async (req, res) => {
  const [rows] = await pool.execute('SELECT producto_id FROM favoritos WHERE usuario_email = ?', [req.user.email]);
  res.json(rows.map(r => r.producto_id));
});
app.put('/api/favoritos/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new ErrorNegocio('Producto inválido.');
  await pool.execute('INSERT IGNORE INTO favoritos (usuario_email, producto_id) VALUES (?, ?)', [req.user.email, id]);
  res.json({ ok: true });
});
app.delete('/api/favoritos/:id', auth, async (req, res) => {
  await pool.execute('DELETE FROM favoritos WHERE usuario_email = ? AND producto_id = ?', [req.user.email, Number(req.params.id)]);
  res.json({ ok: true });
});

// ---------- Cotización y compra ----------
app.post('/api/cotizar', auth, async (req, res) => {
  if (!Array.isArray(req.body.carrito) || req.body.carrito.length === 0) {
    return res.json({ items: [], subtotal: 0, descuento: 0, cupon: null, envio: 0, total: 0 });
  }
  res.json(await cotizar(pool, normalizarCarrito(req.body.carrito), { cupon: req.body.cupon }));
});

app.post('/api/checkout', auth, async (req, res) => {
  const carrito = normalizarCarrito(req.body.carrito);
  const direccion = validarDireccion(req.body.direccion);
  const pedido = await enTransaccion(conn => registrarPedido(conn, req.user.email, carrito, 'Normal', { direccion, cupon: req.body.cupon }));
  despuesDeCompra(req.user.email, pedido);
  res.json({ mensaje: '¡Compra realizada con éxito!', folio: pedido.folio, total: pedido.total });
});

app.get('/api/pedidos', auth, async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM pedidos WHERE usuario_email = ? ORDER BY fecha DESC', [req.user.email]);
  res.json(rows.map(p => ({ ...p, productos: p.productos ? leerJson(p.productos) : null, direccion: p.direccion ? leerJson(p.direccion) : null })));
});

// ---------- PayPal (Aun falta por configurar)
async function ppToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) throw new ErrorNegocio('PayPal no está configurado en el servidor.', 503);
  const r = await fetch(PAYPAL_BASE + '/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const d = await r.json();
  if (!r.ok) throw new ErrorNegocio('No se pudo autenticar con PayPal.', 502);
  return d.access_token;
}

app.post('/api/paypal/crear-orden', auth, async (req, res) => {
  const carrito = normalizarCarrito(req.body.carrito);
  const direccion = validarDireccion(req.body.direccion);
  const cot = await cotizar(pool, carrito, { cupon: req.body.cupon });
  const t = await ppToken();
  const r = await fetch(PAYPAL_BASE + '/v2/checkout/orders', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'MXN', value: cot.total.toFixed(2) }, description: 'Pedido GlowCosmetics' }] })
  });
  const d = await r.json();
  if (!r.ok) throw new ErrorNegocio('PayPal rechazó la creación de la orden.', 502);
  await pool.execute("DELETE FROM paypal_ordenes WHERE creado < DATE_SUB(NOW(), INTERVAL 1 DAY)");
  await pool.execute('INSERT INTO paypal_ordenes (order_id, usuario_email, carrito, direccion, cupon, total) VALUES (?, ?, ?, ?, ?, ?)',
    [d.id, req.user.email, JSON.stringify(carrito), JSON.stringify(direccion), cot.cupon, cot.total]);
  res.json({ orderID: d.id });
});

app.post('/api/paypal/capturar-orden', auth, async (req, res) => {
  const orderID = String(req.body.orderID || '');
  const [rows] = await pool.execute('SELECT * FROM paypal_ordenes WHERE order_id = ? AND usuario_email = ?', [orderID, req.user.email]);
  const orden = rows[0];
  if (!orden) throw new ErrorNegocio('Orden de PayPal no encontrada o expirada.');

  const pedido = await enTransaccion(async conn => {
    const p = await registrarPedido(conn, orden.usuario_email, leerJson(orden.carrito), 'PayPal',
      { direccion: leerJson(orden.direccion), cupon: orden.cupon, paypalId: orderID });
    if (Math.abs(p.total - Number(orden.total)) > 0.01) throw new ErrorNegocio('Los precios cambiaron. Revisa tu bolsa e intenta de nuevo.');
    const t = await ppToken();
    const cap = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }
    });
    const d = await cap.json();
    if (!cap.ok || d.status !== 'COMPLETED') throw new ErrorNegocio('PayPal no pudo completar el pago.', 502);
    return p; // si algo falla antes, se revierten el stock y el pedido
  });
  await pool.execute('DELETE FROM paypal_ordenes WHERE order_id = ?', [orderID]);
  despuesDeCompra(req.user.email, pedido);
  res.json({ mensaje: '¡Pago con PayPal procesado con éxito!', folio: pedido.folio, total: pedido.total });
});

// ---------- Administrador: productos ----------
const carpetaImg = path.join(__dirname, 'public', 'img');
fs.mkdirSync(carpetaImg, { recursive: true });
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: carpetaImg,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${EXT[file.mimetype]}`)
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(new ErrorNegocio('Solo se permiten imágenes JPG, PNG o WEBP.')))
}).single('imagen');

app.post('/api/admin/imagen', auth, soloAdmin, (req, res, next) => {
  upload(req, res, err => {
    if (err) return next(err.code === 'LIMIT_FILE_SIZE' ? new ErrorNegocio('La imagen supera los 3 MB.') : err);
    if (!req.file) return next(new ErrorNegocio('No se recibió ninguna imagen.'));
    res.json({ ruta: '/img/' + req.file.filename });
  });
});

app.get('/api/admin/productos', auth, soloAdmin, async (req, res) => {
  const [rows] = await pool.query('SELECT id, nombre, categoria, precio, stock, imagen, descripcion, color_hex, activo FROM productos ORDER BY id');
  res.json(rows.map(p => ({ ...p, precio: Number(p.precio) })));
});

app.post('/api/admin/productos', auth, soloAdmin, async (req, res) => {
  const o = camposProducto(req.body, false);
  o.activo = 1;
  const cols = Object.keys(o);
  const [r] = await pool.execute(`INSERT INTO productos (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map(c => o[c]));
  res.json({ mensaje: 'Producto agregado', id: r.insertId });
});

app.put('/api/admin/productos/:id', auth, soloAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const o = camposProducto(req.body, true);
  const cols = Object.keys(o);
  if (!Number.isInteger(id) || cols.length === 0) throw new ErrorNegocio('Datos inválidos.');
  const [r] = await pool.execute(`UPDATE productos SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`, [...cols.map(c => o[c]), id]);
  if (r.affectedRows === 0) throw new ErrorNegocio('Producto no encontrado.', 404);
  res.json({ mensaje: 'Producto actualizado' });
});

// ---------- Administrador: pedidos y resumen ----------
app.get('/api/admin/pedidos', auth, soloAdmin, async (req, res) => {
  const w = [], p = [];
  const { estado, desde, hasta, q } = req.query;
  if (ESTADOS.includes(estado)) { w.push('p.estado = ?'); p.push(estado); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(desde || '')) { w.push('p.fecha >= ?'); p.push(desde + ' 00:00:00'); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(hasta || '')) { w.push('p.fecha <= ?'); p.push(hasta + ' 23:59:59'); }
  if (q) { w.push('(p.folio LIKE ? OR p.usuario_email LIKE ?)'); p.push(`%${String(q)}%`, `%${String(q)}%`); }
  const [rows] = await pool.execute(
    `SELECT p.*, u.nombre AS cliente FROM pedidos p LEFT JOIN usuarios u ON u.email = p.usuario_email
     ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY p.fecha DESC LIMIT 200`, p);
  res.json(rows.map(r => ({ ...r, productos: r.productos ? leerJson(r.productos) : null, direccion: r.direccion ? leerJson(r.direccion) : null })));
});

app.put('/api/admin/pedidos/:id/estado', auth, soloAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { estado } = req.body;
  if (!Number.isInteger(id) || !ESTADOS.includes(estado)) throw new ErrorNegocio('Estado inválido.');
  const ped = await enTransaccion(async conn => {
    const [rows] = await conn.execute('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [id]);
    const p = rows[0];
    if (!p) throw new ErrorNegocio('Pedido no encontrado.', 404);
    if (p.estado === 'Cancelado') throw new ErrorNegocio('Un pedido cancelado ya no puede cambiar de estado.');
    if (estado === 'Cancelado') { // devuelve el stock
      for (const it of (p.productos ? leerJson(p.productos) : [])) {
        await conn.execute('UPDATE productos SET stock = stock + ? WHERE id = ?', [it.cantidad, it.id]);
      }
    }
    await conn.execute('UPDATE pedidos SET estado = ? WHERE id = ?', [estado, id]);
    return p;
  });
  enviarCorreo(ped.usuario_email, `Tu pedido ${ped.folio}: ${estado}`,
    `<p>El estado de tu pedido <b>${h(ped.folio)}</b> cambió a: <b>${h(estado)}</b>.</p>`);
  res.json({ mensaje: 'Estado actualizado' });
});

app.get('/api/admin/resumen', auth, soloAdmin, async (req, res) => {
  const [[tot]] = await pool.query("SELECT COUNT(*) AS pedidos, COALESCE(SUM(total), 0) AS ventas FROM pedidos WHERE estado <> 'Cancelado'");
  const [[mes]] = await pool.query("SELECT COUNT(*) AS pedidos, COALESCE(SUM(total), 0) AS ventas FROM pedidos WHERE estado <> 'Cancelado' AND fecha >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
  const [porEstado] = await pool.query('SELECT estado, COUNT(*) AS n FROM pedidos GROUP BY estado');
  const [bajoStock] = await pool.query('SELECT id, nombre, stock FROM productos WHERE activo = 1 AND stock <= 3 ORDER BY stock, id LIMIT 10');
  let top = [];
  try {
    [top] = await pool.query(
      `SELECT jt.nombre, SUM(jt.cantidad) AS unidades
       FROM pedidos p, JSON_TABLE(p.productos, '$[*]' COLUMNS (nombre VARCHAR(150) PATH '$.nombre', cantidad INT PATH '$.cantidad')) jt
       WHERE p.estado <> 'Cancelado' AND p.productos IS NOT NULL GROUP BY jt.nombre ORDER BY unidades DESC LIMIT 5`);
  } catch (e) { console.warn('No se pudo calcular el top de productos:', e.message); }
  const ventas = Number(tot.ventas), n = Number(tot.pedidos);
  res.json({
    ventasTotales: ventas, pedidos: n, ticketPromedio: n ? redondear(ventas / n) : 0,
    ventas30: Number(mes.ventas), pedidos30: Number(mes.pedidos),
    porEstado, bajoStock, top: top.map(t => ({ nombre: t.nombre, unidades: Number(t.unidades) }))
  });
});

// ---------- Administrador: cupones ----------
app.get('/api/admin/cupones', auth, soloAdmin, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM cupones ORDER BY id DESC');
  res.json(rows.map(c => ({ ...c, valor: Number(c.valor), compra_minima: Number(c.compra_minima) })));
});

app.post('/api/admin/cupones', auth, soloAdmin, async (req, res) => {
  const codigo = String(req.body.codigo || '').trim().toUpperCase();
  const { tipo } = req.body;
  const valor = Number(req.body.valor), minima = Number(req.body.compra_minima || 0);
  if (!/^[A-Z0-9_-]{3,30}$/.test(codigo)) throw new ErrorNegocio('El código debe tener 3-30 caracteres (letras, números, - o _).');
  if (!['porcentaje', 'fijo'].includes(tipo)) throw new ErrorNegocio('Tipo de cupón inválido.');
  if (!(valor > 0) || (tipo === 'porcentaje' && valor > 100)) throw new ErrorNegocio('Valor inválido para el cupón.');
  if (!(minima >= 0)) throw new ErrorNegocio('La compra mínima no es válida.');
  try {
    await pool.execute('INSERT INTO cupones (codigo, tipo, valor, compra_minima) VALUES (?, ?, ?, ?)', [codigo, tipo, valor, minima]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new ErrorNegocio('Ya existe un cupón con ese código.');
    throw e;
  }
  res.json({ mensaje: 'Cupón creado' });
});

app.put('/api/admin/cupones/:id', auth, soloAdmin, async (req, res) => {
  await pool.execute('UPDATE cupones SET activo = ? WHERE id = ?', [req.body.activo ? 1 : 0, Number(req.params.id)]);
  res.json({ mensaje: 'Cupón actualizado' });
});

// ---------- Errores ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.use((err, req, res, next) => {
  if (err instanceof ErrorNegocio) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Solicitud inválida.' });
  console.error(err);
  res.status(500).json({ error: 'Error en el servidor.' });
});

app.listen(PORT, () => console.log(`Tienda activa en http://localhost:${PORT}`));
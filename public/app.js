// ======================= ESTADO =======================
let productos = [];
let carrito = [];                 // [{ id, cantidad }] (los precios siempre los calcula el servidor)
let usuarioActual = null;         // { nombre, email, rol }
let token = null;
let favoritos = new Set();
let config = {};
let perfil = null;
let cuponCodigo = null;
let cotizacion = null;
let categoriaActual = 'Todos';
let paypalCargado = false;
let errorPayPalMostrado = false;
let resetToken = null;
let adminProductos = [];

const SECCIONES = ['sec-catalogo', 'sec-carrito', 'sec-auth', 'sec-historial', 'sec-perfil', 'sec-admin', 'sec-info'];
const ESTADOS = ['Pagado', 'Enviado', 'Entregado', 'Cancelado'];
const CAMPOS_DIR = [
  ['nombre', 'Nombre de quien recibe', true], ['telefono', 'Teléfono', false], ['calle', 'Calle y número', true],
  ['colonia', 'Colonia', false], ['ciudad', 'Ciudad', false], ['estado', 'Estado', false],
  ['cp', 'Código postal', false], ['referencias', 'Referencias (opcional)', true]
];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinero = n => Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
const estrellas = n => { const r = Math.round(n || 0); return '★'.repeat(r) + '☆'.repeat(5 - r); };
const fecha = f => new Date(f).toLocaleString('es-MX');

// ======================= INICIO =======================
document.addEventListener('DOMContentLoaded', async () => {
  aplicarTemaGuardado();
  pintarCamposDireccion('dir-campos', 'dir');
  pintarCamposDireccion('pf-dir-campos', 'pf');
  restaurarSesion();
  actualizarUIUsuario();
  actualizarContador();
  try { config = await (await fetch('/api/config')).json(); } catch {}
  pintarBanner();
  await cargarProductos();
  if (usuarioActual) await sincronizarUsuario();
  revisarEnlaceReset();
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarDetalle(); });

// ======================= TEMA =======================
function aplicarTemaGuardado() {
  let t = null;
  try { t = localStorage.getItem('glow_tema'); } catch {}
  setTema(t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
}
function setTema(t) {
  document.documentElement.dataset.tema = t;
  $('btn-tema').textContent = t === 'dark' ? '☀️' : '🌙';
  try { localStorage.setItem('glow_tema', t); } catch {}
}
function alternarTema() { setTema(document.documentElement.dataset.tema === 'dark' ? 'light' : 'dark'); }

function pintarBanner() {
  const g = Number(config.envioGratisDesde || 0);
  $('banner').textContent = g > 0 ? `✨ Envío gratis en compras desde $${dinero(g)} MXN ✨` : '✨ Descubre tu brillo con GlowCosmetics ✨';
}

// ======================= SESIÓN =======================
function guardarSesion() {
  try { sessionStorage.setItem('glow_sesion', JSON.stringify({ token, usuario: usuarioActual, carrito })); } catch {}
}
function restaurarSesion() {
  try {
    const s = JSON.parse(sessionStorage.getItem('glow_sesion'));
    if (s && s.token) { token = s.token; usuarioActual = s.usuario; carrito = s.carrito || []; }
  } catch {}
}

// ======================= UTILIDADES UI =======================
function toast(msg, tipo = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + tipo;
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('saliendo'); setTimeout(() => t.remove(), 350); }, 3200);
}

function confirmar(mensaje) {
  return new Promise(resolve => {
    $('modal-texto').textContent = mensaje;
    const m = $('modal');
    m.classList.remove('oculta');
    const fin = v => { m.classList.add('oculta'); resolve(v); };
    $('modal-si').onclick = () => fin(true);
    $('modal-no').onclick = () => fin(false);
  });
}

async function api(url, opciones = {}) {
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  const res = await fetch(url, { ...opciones, headers });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && token) cerrarSesion(true);
  if (!res.ok) throw new Error(data.error || 'Ocurrió un error inesperado.');
  return data;
}
const post = (url, cuerpo) => api(url, { method: 'POST', body: JSON.stringify(cuerpo) });
const put = (url, cuerpo) => api(url, { method: 'PUT', body: JSON.stringify(cuerpo) });

function toggleMenu() { $('header-derecha').classList.toggle('abierto'); }

// ======================= NAVEGACIÓN =======================
function mostrarSeccion(id) {
  if (['sec-carrito', 'sec-historial', 'sec-perfil'].includes(id) && !usuarioActual) {
    toast('✨ Inicia sesión o crea una cuenta para continuar.', 'info');
    id = 'sec-auth';
  }
  if (id === 'sec-admin' && (!usuarioActual || usuarioActual.rol !== 'admin')) {
    toast('Acceso restringido a administradores.', 'error');
    id = 'sec-catalogo';
  }
  SECCIONES.forEach(s => $(s).classList.add('oculta'));
  const el = $(id);
  el.classList.remove('oculta', 'fade-in');
  void el.offsetWidth;
  el.classList.add('fade-in');

  if (id === 'sec-carrito') { actualizarVistaCarrito(); precargarDireccion(); }
  if (id === 'sec-historial') cargarHistorialPedidos();
  if (id === 'sec-perfil') cargarPerfil();
  if (id === 'sec-admin') adminTab('resumen', document.querySelector('#admin-tabs span'));
  $('header-derecha').classList.remove('abierto');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleAuth(vista) {
  ['login', 'registro', 'recuperar', 'reset'].forEach(v => $('form-' + v).classList.toggle('oculta', v !== vista));
}

// ======================= CATÁLOGO =======================
async function cargarProductos() {
  $('grid-productos').innerHTML = '<div class="skeleton"></div>'.repeat(6);
  try {
    productos = await (await fetch('/api/productos')).json();
    aplicarFiltros();
  } catch (e) {
    $('grid-productos').innerHTML = '<p class="mensaje-vacio">No pudimos cargar los productos. Intenta de nuevo más tarde.</p>';
  }
}

function renderizarGrid(lista) {
  const cont = $('grid-productos');
  if (!lista.length) {
    cont.innerHTML = `<p class="mensaje-vacio">${categoriaActual === 'Favoritos' ? 'Aún no tienes favoritos. Toca el ❤ de un producto para guardarlo.' : 'No se encontraron productos 💄'}</p>`;
    return;
  }
  cont.innerHTML = lista.map((p, i) => {
    const clase = p.stock === 0 ? 'stock-no' : p.stock <= 3 ? 'stock-poco' : 'stock-ok';
    const texto = p.stock === 0 ? 'Agotado' : p.stock <= 3 ? `¡Últimas ${p.stock} piezas!` : `Disponibles: ${p.stock}`;
    return `
    <div class="tarjeta-producto" style="animation-delay:${Math.min(i, 12) * 45}ms">
      <button class="corazon ${favoritos.has(p.id) ? 'activo' : ''}" data-fav="${p.id}" onclick="toggleFavorito(event, ${p.id})" aria-label="Favorito">♥</button>
      <img src="${esc(encodeURI(p.imagen))}" alt="${esc(p.nombre)}" loading="lazy" onclick="abrirDetalle(${p.id})">
      <div class="info-producto">
        <span class="categoria-badge">${esc(p.categoria)}</span>
        <h3 onclick="abrirDetalle(${p.id})">${esc(p.nombre)}</h3>
        ${p.num_resenas ? `<p class="estrellas">${estrellas(p.calificacion)} <small>(${p.num_resenas})</small></p>` : ''}
        <p class="precio">$${dinero(p.precio)} MXN</p>
        <p class="${clase}">${texto}</p>
        <button class="btn-agregar" onclick="agregarAlCarrito(${p.id})" ${p.stock === 0 ? 'disabled' : ''}>${p.stock > 0 ? 'Añadir a la bolsa' : 'Agotado'}</button>
      </div>
    </div>`;
  }).join('');
}

function aplicarFiltros() {
  const texto = $('input-buscar').value.toLowerCase().trim();
  const min = parseFloat($('precio-min').value), max = parseFloat($('precio-max').value);
  let lista = productos.filter(p =>
    (categoriaActual === 'Todos' || (categoriaActual === 'Favoritos' ? favoritos.has(p.id) : p.categoria.toLowerCase() === categoriaActual.toLowerCase())) &&
    (!texto || p.nombre.toLowerCase().includes(texto) || p.categoria.toLowerCase().includes(texto)) &&
    (isNaN(min) || p.precio >= min) && (isNaN(max) || p.precio <= max));
  const orden = $('orden').value;
  if (orden === 'precio-asc') lista.sort((a, b) => a.precio - b.precio);
  else if (orden === 'precio-desc') lista.sort((a, b) => b.precio - a.precio);
  else if (orden === 'nombre') lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  else if (orden === 'novedades') lista.sort((a, b) => b.id - a.id);
  renderizarGrid(lista);
}

let tBusqueda;
function buscarProductos() { clearTimeout(tBusqueda); tBusqueda = setTimeout(aplicarFiltros, 150); }

function limpiarFiltros() {
  $('input-buscar').value = ''; $('precio-min').value = ''; $('precio-max').value = ''; $('orden').value = 'destacados';
  aplicarFiltros();
}

function filtrar(categoria, elemento) {
  if (categoria === 'Favoritos' && !usuarioActual) {
    toast('✨ Inicia sesión para ver tus favoritos.', 'info');
    return mostrarSeccion('sec-auth');
  }
  document.querySelectorAll('.filtros span').forEach(el => el.classList.remove('activo'));
  if (elemento) elemento.classList.add('activo');
  categoriaActual = categoria;
  mostrarSeccion('sec-catalogo');
  $('titulo-categoria').innerText = categoria === 'Todos' ? 'Catálogo Completo' : categoria === 'Favoritos' ? 'Tus Favoritos' : `Colección: ${categoria}`;
  aplicarFiltros();
}

async function toggleFavorito(ev, id) {
  ev.stopPropagation();
  if (!usuarioActual) { toast('✨ Inicia sesión para guardar favoritos.', 'info'); return mostrarSeccion('sec-auth'); }
  const era = favoritos.has(id);
  era ? favoritos.delete(id) : favoritos.add(id);
  document.querySelectorAll(`[data-fav="${id}"]`).forEach(b => b.classList.toggle('activo', !era));
  try {
    await api(`/api/favoritos/${id}`, { method: era ? 'DELETE' : 'PUT' });
    toast(era ? 'Quitado de favoritos' : '❤ Añadido a favoritos', 'info');
    if (categoriaActual === 'Favoritos') aplicarFiltros();
  } catch (e) {
    era ? favoritos.add(id) : favoritos.delete(id);
    aplicarFiltros();
    toast(e.message, 'error');
  }
}

// ======================= DETALLE Y RESEÑAS =======================
function abrirDetalle(id) {
  const p = productos.find(x => x.id === id);
  if (!p) return;
  const clase = p.stock === 0 ? 'stock-no' : p.stock <= 3 ? 'stock-poco' : 'stock-ok';
  const texto = p.stock === 0 ? 'Agotado' : p.stock <= 3 ? `¡Últimas ${p.stock} piezas!` : `Disponibles: ${p.stock}`;
  $('detalle-contenido').innerHTML = `
    <button class="cerrar" onclick="cerrarDetalle()" aria-label="Cerrar">×</button>
    <div class="detalle-grid">
      <img src="${esc(encodeURI(p.imagen))}" alt="${esc(p.nombre)}">
      <div class="detalle">
        <span class="categoria-badge">${esc(p.categoria)}</span>
        <h2>${esc(p.nombre)}</h2>
        ${p.num_resenas ? `<p class="estrellas">${estrellas(p.calificacion)} <small>(${p.num_resenas} reseñas)</small></p>` : ''}
        <p class="precio">$${dinero(p.precio)} MXN</p>
        ${p.color_hex ? `<div class="tono"><i style="background:${esc(p.color_hex)}"></i> Tono de referencia</div>` : ''}
        ${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ''}
        <p class="${clase}">${texto}</p>
        <button class="btn btn-rosa" onclick="agregarAlCarrito(${p.id})" ${p.stock === 0 ? 'disabled' : ''}>Añadir a la bolsa</button>
      </div>
    </div>
    <h3 class="subtitulo">Reseñas</h3>
    <div id="lista-resenas"><p class="nota">Cargando reseñas...</p></div>
    <div id="zona-resena"></div>`;
  $('modal-detalle').classList.remove('oculta');
  cargarResenas(id);
}
function cerrarDetalle() { $('modal-detalle').classList.add('oculta'); }

async function cargarResenas(id) {
  try {
    const rs = await (await fetch(`/api/productos/${id}/resenas`)).json();
    $('lista-resenas').innerHTML = rs.length
      ? rs.map(r => `<div class="resena"><span class="estrellas">${estrellas(r.calificacion)}</span> <strong>${esc(r.nombre)}</strong> <small class="nota">${new Date(r.fecha).toLocaleDateString('es-MX')}</small>${r.comentario ? `<p>${esc(r.comentario)}</p>` : ''}</div>`).join('')
      : '<p class="nota">Aún no hay reseñas. ¡Sé la primera persona en opinar!</p>';
  } catch { $('lista-resenas').innerHTML = '<p class="nota">No se pudieron cargar las reseñas.</p>'; }
  $('zona-resena').innerHTML = usuarioActual
    ? `<div class="form-resena">
         <select id="res-cal"><option value="5">★★★★★ Excelente</option><option value="4">★★★★ Muy bueno</option><option value="3">★★★ Bueno</option><option value="2">★★ Regular</option><option value="1">★ Malo</option></select>
         <textarea id="res-txt" rows="2" maxlength="500" placeholder="Cuéntanos tu experiencia (opcional)"></textarea>
         <button class="btn btn-oscuro" onclick="guardarResena(${id})">Publicar reseña</button>
         <p class="nota">Solo pueden opinar quienes compraron el producto.</p>
       </div>`
    : '<p class="nota">Inicia sesión para dejar una reseña.</p>';
}

async function guardarResena(id) {
  try {
    const d = await post(`/api/productos/${id}/resenas`, { calificacion: $('res-cal').value, comentario: $('res-txt').value });
    toast('⭐ ' + d.mensaje);
    await cargarProductos();
    abrirDetalle(id);
  } catch (e) { toast(e.message, 'error'); }
}

// ======================= BOLSA =======================
function agregarAlCarrito(id) {
  if (!usuarioActual) {
    toast('✨ Inicia sesión o regístrate para añadir productos a tu bolsa.', 'info');
    cerrarDetalle();
    return mostrarSeccion('sec-auth');
  }
  const p = productos.find(x => x.id === id);
  if (!p || p.stock < 1) return;
  const item = carrito.find(x => x.id === id);
  if (item) {
    if (item.cantidad >= p.stock) return toast(`Solo hay ${p.stock} disponibles de "${p.nombre}".`, 'warn');
    item.cantidad++;
  } else carrito.push({ id, cantidad: 1 });
  refrescarCarrito();
  toast(`💄 "${p.nombre}" se añadió a tu bolsa`);
}

function cambiarCantidad(id, delta) {
  const item = carrito.find(x => x.id === id);
  const p = productos.find(x => x.id === id);
  if (!item) return;
  const nueva = item.cantidad + delta;
  if (nueva < 1) return quitarDelCarrito(id);
  if (p && nueva > p.stock) return toast(`Solo hay ${p.stock} disponibles.`, 'warn');
  item.cantidad = nueva;
  refrescarCarrito();
}

function quitarDelCarrito(id) {
  carrito = carrito.filter(x => x.id !== id);
  refrescarCarrito();
  toast('Producto removido de tu bolsa', 'info');
}

let tGuardarCarrito;
function refrescarCarrito() {
  guardarSesion();
  actualizarContador();
  actualizarVistaCarrito();
  if (token) {
    clearTimeout(tGuardarCarrito);
    tGuardarCarrito = setTimeout(() => put('/api/carrito', { items: carrito }).catch(() => {}), 600);
  }
}

function actualizarContador() {
  const c = $('contador-carrito');
  c.textContent = carrito.reduce((a, i) => a + i.cantidad, 0);
  c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
}

function actualizarVistaCarrito() {
  const lineas = carrito.map(it => ({ it, p: productos.find(x => x.id === it.id) })).filter(l => l.p);
  $('lista-carrito').innerHTML = lineas.length ? lineas.map(({ it, p }) => `
    <div class="item-carrito">
      <img src="${esc(encodeURI(p.imagen))}" alt="">
      <div class="item-info"><h4>${esc(p.nombre)}</h4><p>$${dinero(p.precio)} MXN</p></div>
      <div class="cantidad">
        <button onclick="cambiarCantidad(${p.id}, -1)" aria-label="Menos">−</button>
        <span>${it.cantidad}</span>
        <button onclick="cambiarCantidad(${p.id}, 1)" aria-label="Más">+</button>
      </div>
      <button class="btn-quitar" onclick="quitarDelCarrito(${p.id})">Remover</button>
    </div>`).join('') : '<p class="vacio">Tu bolsa de compras está vacía 🛍️</p>';

  $('zona-checkout').classList.toggle('oculta', lineas.length === 0);
  const visible = !$('sec-carrito').classList.contains('oculta');
  if (lineas.length && visible) {
    const sub = lineas.reduce((a, { it, p }) => a + p.precio * it.cantidad, 0);
    pintarTotales(cotizacion || { subtotal: sub, descuento: 0, envio: 0, total: sub, cupon: null });
    cargarPayPal();
    pedirCotizacion();
  }
}

function pintarTotales(c) {
  $('subtotal').innerText = dinero(c.subtotal);
  $('descuento').innerText = dinero(c.descuento);
  $('fila-descuento').classList.toggle('oculta', !c.descuento);
  $('envio').innerText = dinero(c.envio);
  $('total-final').innerText = dinero(c.total);
  const g = Number(config.envioGratisDesde || 0);
  $('aviso-envio').textContent = c.envio === 0 && c.subtotal > 0 ? '¡Envío gratis!' : g > 0 ? `(gratis desde $${dinero(g)})` : '';
  const act = $('cupon-activo');
  if (c.cupon) {
    act.innerHTML = `🏷️ Cupón <strong>${esc(c.cupon)}</strong> aplicado (-$${dinero(c.descuento)}) · <a href="#" onclick="quitarCupon();return false">Quitar</a>`;
    act.classList.remove('oculta');
  } else act.classList.add('oculta');
}

let tCot;
function pedirCotizacion() {
  clearTimeout(tCot);
  tCot = setTimeout(async () => {
    if (!carrito.length || !token || $('sec-carrito').classList.contains('oculta')) return;
    try {
      cotizacion = await post('/api/cotizar', { carrito, cupon: cuponCodigo });
      pintarTotales(cotizacion);
    } catch (e) {
      toast(e.message, 'warn');
      if (cuponCodigo) quitarCupon();
    }
  }, 250);
}

function aplicarCupon() {
  const codigo = $('input-cupon').value.trim().toUpperCase();
  if (!codigo) return toast('Escribe un código de cupón.', 'warn');
  cuponCodigo = codigo;
  pedirCotizacion();
}

function quitarCupon() {
  cuponCodigo = null; cotizacion = null;
  $('input-cupon').value = '';
  pedirCotizacion();
}

function pagoExitoso(data) {
  carrito = []; cuponCodigo = null; cotizacion = null;
  $('input-cupon').value = '';
  refrescarCarrito();
  cargarProductos();
  toast(`🎉 ¡Pedido realizado! Folio: ${data.folio}`);
  mostrarSeccion('sec-historial');
}

// ======================= DIRECCIÓN =======================
function pintarCamposDireccion(contenedor, pref) {
  $(contenedor).innerHTML = CAMPOS_DIR.map(([k, et, completo]) => `
    <div class="${completo ? 'completo' : ''}"><label>${et}</label>
    <input type="${k === 'telefono' ? 'tel' : 'text'}" id="${pref}-${k}" maxlength="${k === 'cp' ? 5 : 120}"></div>`).join('');
}

function leerDireccion(pref) {
  const d = {};
  for (const [k, et] of CAMPOS_DIR) {
    d[k] = $(`${pref}-${k}`).value.trim();
    if (k !== 'referencias' && !d[k]) throw new Error(`Completa el campo: ${et}.`);
  }
  if (!/^\d{5}$/.test(d.cp)) throw new Error('El código postal debe tener 5 dígitos.');
  return d;
}

function llenarDireccion(pref, d) { for (const [k] of CAMPOS_DIR) $(`${pref}-${k}`).value = d?.[k] || ''; }

async function precargarDireccion() {
  if ($('dir-calle').value) return; // ya hay datos escritos
  try {
    if (!perfil) perfil = await api('/api/perfil');
    if (perfil.direccion) llenarDireccion('dir', perfil.direccion);
    else $('dir-nombre').value = perfil.nombre;
  } catch {}
}

async function guardarDireccionSiAplica() {
  if (!$('guardar-dir').checked) return;
  try {
    const dir = leerDireccion('dir');
    await put('/api/perfil', { nombre: usuarioActual.nombre, direccion: dir });
    if (perfil) perfil.direccion = dir;
  } catch {}
}

// ======================= PAGO =======================
async function procesarPagoNormal() {
  if (!usuarioActual || carrito.length === 0) return;
  let dir;
  try { dir = leerDireccion('dir'); } catch (e) { return toast(e.message, 'warn'); }
  if (!(await confirmar(`¿Confirmas tu pedido por $${dinero(cotizacion?.total)} MXN?`))) return;
  const btn = $('btn-pagar');
  btn.disabled = true; btn.textContent = 'Procesando...';
  try {
    const d = await post('/api/checkout', { carrito, direccion: dir, cupon: cuponCodigo });
    await guardarDireccionSiAplica();
    pagoExitoso(d);
  } catch (e) {
    toast(e.message, 'error');
    cargarProductos();
  } finally { btn.disabled = false; btn.textContent = 'Pagar Pedido'; }
}

function cargarPayPal() {
  if (paypalCargado) return;
  if (!config.paypalClientId) { $('paypal-aviso').classList.remove('oculta'); return; }
  paypalCargado = true;
  const s = document.createElement('script');
  s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.paypalClientId)}&currency=MXN`;
  s.onload = renderBotonesPayPal;
  s.onerror = () => { paypalCargado = false; toast('No se pudo cargar PayPal. Revisa tu conexión.', 'error'); };
  document.head.appendChild(s);
}

function renderBotonesPayPal() {
  paypal.Buttons({
    style: { layout: 'vertical', shape: 'pill', label: 'paypal' },
    createOrder: async () => {
      try {
        const dir = leerDireccion('dir');
        const d = await post('/api/paypal/crear-orden', { carrito, direccion: dir, cupon: cuponCodigo });
        return d.orderID;
      } catch (e) { errorPayPalMostrado = true; toast(e.message, 'warn'); throw e; }
    },
    onApprove: async data => {
      try {
        const d = await post('/api/paypal/capturar-orden', { orderID: data.orderID });
        await guardarDireccionSiAplica();
        pagoExitoso(d);
      } catch (e) { toast(e.message, 'error'); cargarProductos(); }
    },
    onCancel: () => toast('Cancelaste el pago con PayPal.', 'info'),
    onError: () => {
      if (errorPayPalMostrado) { errorPayPalMostrado = false; return; }
      toast('Ocurrió un error con PayPal. Intenta de nuevo.', 'error');
    }
  }).render('#paypal-contenedor');
}

// ======================= AUTENTICACIÓN =======================
async function hacerRegistro(e) {
  e.preventDefault();
  try {
    await post('/api/registro', { nombre: $('reg-nombre').value, email: $('reg-email').value, password: $('reg-pass').value });
    toast('🎀 ¡Cuenta creada con éxito! Ya puedes iniciar sesión.');
    $('form-registro').reset();
    toggleAuth('login');
  } catch (err) { toast(err.message, 'error'); }
}

async function hacerLogin(e) {
  e.preventDefault();
  try {
    const d = await post('/api/login', { email: $('login-email').value, password: $('login-pass').value });
    token = d.token; usuarioActual = d.usuario; perfil = null;
    guardarSesion();
    actualizarUIUsuario();
    $('form-login').reset();
    const h = new Date().getHours();
    const saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    toast(`✨ ${saludo}, ${usuarioActual.nombre.split(' ')[0]}. ¡Qué gusto verte en GlowCosmetics!`);
    await sincronizarUsuario();
    mostrarSeccion(usuarioActual.rol === 'admin' ? 'sec-admin' : 'sec-catalogo');
  } catch (err) { toast(err.message, 'error'); }
}

async function sincronizarUsuario() {
  try {
    const [c, f] = await Promise.all([api('/api/carrito'), api('/api/favoritos')]);
    if (c.items.length) carrito = c.items;
    favoritos = new Set(f);
  } catch {}
  carrito = carrito.filter(i => productos.some(p => p.id === i.id));
  guardarSesion();
  actualizarContador();
  aplicarFiltros();
}

function actualizarUIUsuario() {
  const info = $('info-usuario');
  if (usuarioActual) {
    info.innerText = `Hola, ${usuarioActual.nombre.split(' ')[0]}`;
    info.onclick = () => mostrarSeccion('sec-perfil');
  } else {
    info.innerText = 'Ingresar';
    info.onclick = () => mostrarSeccion('sec-auth');
  }
  $('nav-admin').classList.toggle('oculta', !(usuarioActual && usuarioActual.rol === 'admin'));
  $('nav-salir').classList.toggle('oculta', !usuarioActual);
}

async function logout() { if (await confirmar('¿Deseas cerrar sesión?')) cerrarSesion(false); }

function cerrarSesion(expirada) {
  usuarioActual = null; token = null; carrito = []; favoritos = new Set(); perfil = null; cuponCodigo = null; cotizacion = null;
  if (categoriaActual === 'Favoritos') { categoriaActual = 'Todos'; }
  try { sessionStorage.removeItem('glow_sesion'); } catch {}
  actualizarUIUsuario();
  actualizarContador();
  aplicarFiltros();
  mostrarSeccion('sec-catalogo');
  toast(expirada ? 'Tu sesión expiró. Inicia sesión de nuevo.' : '👋 Sesión cerrada. ¡Hasta pronto!', 'info');
}

async function solicitarRecuperacion(e) {
  e.preventDefault();
  try {
    const d = await post('/api/recuperar', { email: $('rec-email').value });
    toast('📧 ' + d.mensaje, 'info');
    toggleAuth('login');
  } catch (err) { toast(err.message, 'error'); }
}

function revisarEnlaceReset() {
  const t = new URLSearchParams(location.search).get('reset');
  if (!t) return;
  resetToken = t;
  history.replaceState(null, '', location.pathname);
  mostrarSeccion('sec-auth');
  toggleAuth('reset');
}

async function restablecerPassword(e) {
  e.preventDefault();
  try {
    const d = await post('/api/restablecer', { token: resetToken, password: $('reset-pass').value });
    toast('🔒 ' + d.mensaje);
    $('form-reset').reset();
    toggleAuth('login');
  } catch (err) { toast(err.message, 'error'); }
}

// ======================= PERFIL =======================
async function cargarPerfil() {
  try {
    perfil = await api('/api/perfil');
    $('pf-nombre').value = perfil.nombre;
    $('pf-email').textContent = perfil.email;
    llenarDireccion('pf', perfil.direccion);
  } catch (e) { toast(e.message, 'error'); }
}

async function guardarPerfil(e) {
  e.preventDefault();
  let dir = null;
  if (CAMPOS_DIR.some(([k]) => $('pf-' + k).value.trim())) {
    try { dir = leerDireccion('pf'); } catch (err) { return toast(err.message, 'warn'); }
  }
  try {
    const d = await put('/api/perfil', { nombre: $('pf-nombre').value, direccion: dir });
    usuarioActual.nombre = d.nombre;
    perfil = { ...perfil, nombre: d.nombre, direccion: dir };
    guardarSesion(); actualizarUIUsuario();
    toast('✅ Perfil actualizado');
  } catch (err) { toast(err.message, 'error'); }
}

async function cambiarPassword(e) {
  e.preventDefault();
  try {
    await put('/api/perfil/password', { actual: $('pw-actual').value, nueva: $('pw-nueva').value });
    toast('🔒 Contraseña actualizada');
    e.target.reset();
  } catch (err) { toast(err.message, 'error'); }
}

// ======================= HISTORIAL =======================
async function cargarHistorialPedidos() {
  const cont = $('lista-historial');
  cont.innerHTML = '<div class="skeleton" style="height:90px"></div>';
  try {
    const pedidos = await api('/api/pedidos');
    if (!pedidos.length) { cont.innerHTML = '<p class="vacio">Aún no tienes compras registradas ✨</p>'; return; }
    cont.innerHTML = pedidos.map((p, i) => {
      const d = p.direccion;
      return `
      <div class="pedido" style="animation-delay:${Math.min(i, 8) * 60}ms">
        <p><strong>Folio:</strong> ${esc(p.folio)} <span class="etiqueta-pago">${esc(p.metodo_pago || 'Normal')}</span> <span class="estado ${esc(p.estado)}">${esc(p.estado)}</span></p>
        <p><strong>Total:</strong> $${dinero(p.total)} MXN${p.descuento > 0 ? ` <small class="nota">(descuento ${esc(p.cupon || '')}: -$${dinero(p.descuento)})</small>` : ''}</p>
        <p><strong>Fecha:</strong> ${fecha(p.fecha)}</p>
        ${d ? `<p class="nota">📍 ${esc(d.calle)}, ${esc(d.colonia)}, ${esc(d.ciudad)}, ${esc(d.estado)} C.P. ${esc(d.cp)}</p>` : ''}
        ${Array.isArray(p.productos) ? `<ul>${p.productos.map(it => `<li>${it.cantidad} × ${esc(it.nombre)}</li>`).join('')}</ul>` : ''}
      </div>`;
    }).join('');
  } catch { cont.innerHTML = '<p class="vacio">No pudimos cargar tu historial.</p>'; }
}

// ======================= ADMINISTRADOR =======================
function adminTab(nombre, el) {
  document.querySelectorAll('#admin-tabs span').forEach(s => s.classList.remove('activo'));
  if (el) el.classList.add('activo');
  ['resumen', 'pedidos', 'productos', 'cupones'].forEach(t => $('adm-' + t).classList.toggle('oculta', t !== nombre));
  ({ resumen: cargarAdminResumen, pedidos: cargarAdminPedidos, productos: cargarAdminProductos, cupones: cargarAdminCupones })[nombre]();
}

async function cargarAdminResumen() {
  try {
    const r = await api('/api/admin/resumen');
    const tarjeta = (t, v) => `<div class="tarjeta-dato"><small>${t}</small><strong>${v}</strong></div>`;
    $('adm-resumen').innerHTML = `
      <div class="tarjetas-resumen">
        ${tarjeta('Ventas totales', '$' + dinero(r.ventasTotales))}
        ${tarjeta('Pedidos', r.pedidos)}
        ${tarjeta('Ticket promedio', '$' + dinero(r.ticketPromedio))}
        ${tarjeta('Últimos 30 días', '$' + dinero(r.ventas30) + ' · ' + r.pedidos30 + ' pedidos')}
      </div>
      <p class="nota" style="margin-bottom:14px">${r.porEstado.map(e => `${esc(e.estado)}: ${e.n}`).join(' · ') || 'Sin pedidos todavía'}. Las ventas no incluyen pedidos cancelados.</p>
      <div class="dos-col">
        <div class="resumen"><h3>🏆 Más vendidos</h3><ul>${r.top.length ? r.top.map(t => `<li>${esc(t.nombre)} — ${t.unidades} u.</li>`).join('') : '<li class="nota">Sin datos aún</li>'}</ul></div>
        <div class="resumen"><h3>⚠️ Poco stock</h3><ul>${r.bajoStock.length ? r.bajoStock.map(t => `<li>${esc(t.nombre)} — ${t.stock} u.</li>`).join('') : '<li class="nota">Todo en orden</li>'}</ul></div>
      </div>`;
  } catch (e) { toast(e.message, 'error'); }
}

let tAdminPed;
function debounceAdminPedidos() { clearTimeout(tAdminPed); tAdminPed = setTimeout(cargarAdminPedidos, 300); }

async function cargarAdminPedidos() {
  const q = new URLSearchParams({ estado: $('fp-estado').value, desde: $('fp-desde').value, hasta: $('fp-hasta').value, q: $('fp-q').value.trim() });
  try {
    const peds = await api('/api/admin/pedidos?' + q);
    $('adm-pedidos-body').innerHTML = peds.length ? peds.map(p => {
      const d = p.direccion;
      const cancelado = p.estado === 'Cancelado';
      return `<tr id="ped-${p.id}">
        <td><strong>${esc(p.folio)}</strong>
          <div class="mini">${esc(p.cliente || '')} · ${esc(p.usuario_email)}</div>
          ${Array.isArray(p.productos) ? `<div class="mini">${p.productos.map(i => `${i.cantidad}× ${esc(i.nombre)}`).join(', ')}</div>` : ''}
          ${d ? `<div class="mini">📍 ${esc(d.nombre)} · ${esc(d.telefono)} · ${esc(d.calle)}, ${esc(d.colonia)}, ${esc(d.ciudad)}, ${esc(d.estado)} C.P. ${esc(d.cp)}${d.referencias ? ' · ' + esc(d.referencias) : ''}</div>` : ''}</td>
        <td>${fecha(p.fecha)}</td>
        <td>$${dinero(p.total)}<div class="mini">${esc(p.metodo_pago || '')}${p.cupon ? ' · ' + esc(p.cupon) : ''}</div></td>
        <td><select id="est-${p.id}" ${cancelado ? 'disabled' : ''}>${ESTADOS.map(e => `<option ${e === p.estado ? 'selected' : ''}>${e}</option>`).join('')}</select></td>
        <td><button class="btn btn-rosa btn-peq" ${cancelado ? 'disabled' : ''} onclick="cambiarEstado(${p.id}, this)">Guardar</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="nota">No hay pedidos con esos filtros.</td></tr>';
  } catch (e) { toast(e.message, 'error'); }
}

async function cambiarEstado(id, btn) {
  const estado = $('est-' + id).value;
  if (estado === 'Cancelado' && !(await confirmar('Cancelar el pedido devuelve el stock y no se puede deshacer. Si se pagó con PayPal, el reembolso debes hacerlo manualmente en PayPal. ¿Continuar?'))) return;
  btn.disabled = true;
  try {
    await put(`/api/admin/pedidos/${id}/estado`, { estado });
    toast('✅ Estado actualizado');
    cargarAdminPedidos();
    cargarProductos();
  } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
}

async function cargarAdminProductos() {
  try {
    adminProductos = await api('/api/admin/productos');
    $('adm-prod-body').innerHTML = adminProductos.map(p => `
      <tr id="prow-${p.id}" class="${p.activo ? '' : 'inactivo'}">
        <td><img class="miniatura" src="${esc(encodeURI(p.imagen))}" alt="">${esc(p.nombre)}${p.activo ? '' : ' <span class="mini">(desactivado)</span>'}</td>
        <td>${esc(p.categoria)}</td>
        <td><input type="number" id="precio-${p.id}" value="${p.precio}" min="1" step="0.01"></td>
        <td><input type="number" id="stock-${p.id}" value="${p.stock}" min="0" step="1"></td>
        <td>
          <button class="btn btn-rosa btn-peq" onclick="guardarRapido(${p.id}, this)">Guardar</button>
          <button class="btn btn-claro btn-peq" onclick="editarProducto(${p.id})">Editar</button>
          <button class="btn btn-claro btn-peq" onclick="alternarActivo(${p.id})">${p.activo ? 'Desactivar' : 'Activar'}</button>
        </td>
      </tr>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}

async function guardarRapido(id, btn) {
  btn.disabled = true;
  try {
    await put('/api/admin/productos/' + id, { precio: $('precio-' + id).value, stock: $('stock-' + id).value });
    toast('✅ Producto actualizado');
    $('prow-' + id).classList.add('guardado');
    await cargarProductos();
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function alternarActivo(id) {
  const p = adminProductos.find(x => x.id === id);
  if (p.activo && !(await confirmar(`¿Desactivar "${p.nombre}"? Dejará de verse en la tienda (puedes activarlo después).`))) return;
  try {
    await put('/api/admin/productos/' + id, { activo: p.activo ? 0 : 1 });
    toast(p.activo ? 'Producto desactivado' : 'Producto activado', 'info');
    await Promise.all([cargarAdminProductos(), cargarProductos()]);
  } catch (e) { toast(e.message, 'error'); }
}

function editarProducto(id) {
  const p = adminProductos.find(x => x.id === id);
  $('prod-id').value = p.id; $('prod-nombre').value = p.nombre; $('prod-categoria').value = p.categoria;
  $('prod-precio').value = p.precio; $('prod-stock').value = p.stock; $('prod-imagen').value = p.imagen || '';
  $('prod-color').value = p.color_hex || ''; $('prod-desc').value = p.descripcion || '';
  $('form-prod-titulo').textContent = 'Editar producto: ' + p.nombre;
  $('prod-btn').textContent = 'Guardar cambios';
  $('prod-cancelar').classList.remove('oculta');
  $('form-prod').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelarEdicion() {
  $('form-prod').reset(); $('prod-id').value = '';
  $('form-prod-titulo').textContent = 'Agregar producto';
  $('prod-btn').textContent = 'Agregar';
  $('prod-cancelar').classList.add('oculta');
}

async function guardarFormProducto(e) {
  e.preventDefault();
  const id = $('prod-id').value;
  const cuerpo = {
    nombre: $('prod-nombre').value, categoria: $('prod-categoria').value, precio: $('prod-precio').value,
    stock: $('prod-stock').value, imagen: $('prod-imagen').value, color_hex: $('prod-color').value, descripcion: $('prod-desc').value
  };
  try {
    if (id) await put('/api/admin/productos/' + id, cuerpo); else await post('/api/admin/productos', cuerpo);
    toast(id ? '✅ Producto actualizado' : '🎉 Producto agregado al catálogo');
    cancelarEdicion();
    await Promise.all([cargarAdminProductos(), cargarProductos()]);
  } catch (err) { toast(err.message, 'error'); }
}

async function subirImagen() {
  const archivo = $('prod-archivo').files[0];
  if (!archivo) return;
  const fd = new FormData();
  fd.append('imagen', archivo);
  try {
    const res = await fetch('/api/admin/imagen', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'No se pudo subir la imagen.');
    $('prod-imagen').value = d.ruta;
    toast('📷 Imagen subida');
  } catch (e) { toast(e.message, 'error'); }
  $('prod-archivo').value = '';
}

async function cargarAdminCupones() {
  try {
    const cs = await api('/api/admin/cupones');
    $('adm-cup-body').innerHTML = cs.length ? cs.map(c => `
      <tr><td><strong>${esc(c.codigo)}</strong></td>
      <td>${c.tipo === 'porcentaje' ? c.valor + '%' : '$' + dinero(c.valor)}</td>
      <td>$${dinero(c.compra_minima)}</td>
      <td>${c.activo ? '🟢 Activo' : '⚪ Inactivo'}</td>
      <td><button class="btn btn-claro btn-peq" onclick="alternarCupon(${c.id}, ${c.activo ? 0 : 1})">${c.activo ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('')
      : '<tr><td colspan="5" class="nota">Aún no hay cupones.</td></tr>';
  } catch (e) { toast(e.message, 'error'); }
}

async function crearCupon(e) {
  e.preventDefault();
  try {
    await post('/api/admin/cupones', { codigo: $('cup-codigo').value, tipo: $('cup-tipo').value, valor: $('cup-valor').value, compra_minima: $('cup-min').value });
    toast('🏷️ Cupón creado');
    e.target.reset();
    cargarAdminCupones();
  } catch (err) { toast(err.message, 'error'); }
}

async function alternarCupon(id, activo) {
  try { await put('/api/admin/cupones/' + id, { activo }); cargarAdminCupones(); }
  catch (e) { toast(e.message, 'error'); }
}

// ======================= INFORMACIÓN =======================
const negocio = () => config.negocio || { nombre: 'GlowCosmetics', domicilio: 'Querétaro, México' };
const INFO = {
  privacidad: () => `<h2>Aviso de Privacidad</h2>
    <p><strong>${esc(negocio().nombre)}</strong>, con domicilio en ${esc(negocio().domicilio)}, es responsable del tratamiento de tus datos personales.</p>
    <h3>Datos que recabamos</h3><ul><li>Nombre y correo electrónico.</li><li>Dirección y teléfono de envío.</li><li>Historial de pedidos y reseñas.</li></ul>
    <h3>Para qué los usamos</h3><p>Crear tu cuenta, procesar y enviar tus pedidos, enviarte confirmaciones y atender tus solicitudes. Los pagos con PayPal los procesa PayPal; esta tienda no guarda datos de tarjetas.</p>
    <h3>Tus derechos</h3><p>Puedes solicitar el acceso, rectificación, cancelación u oposición al tratamiento de tus datos (derechos ARCO) escribiendo a ${esc(config.contacto || '')}.</p>`,
  terminos: () => `<h2>Términos y Condiciones</h2>
    <h3>Precios y pagos</h3><p>Los precios están en pesos mexicanos (MXN) e incluyen impuestos, salvo que se indique lo contrario. El envío se calcula al finalizar la compra.</p>
    <h3>Disponibilidad</h3><p>Los pedidos están sujetos a existencias. Si un producto se agota, te lo notificaremos.</p>
    <h3>Cambios y devoluciones</h3><p>Por higiene y seguridad, los productos de maquillaje abiertos o usados no admiten devolución. Si recibes un producto dañado o incorrecto, contáctanos dentro de los 7 días naturales posteriores a la entrega y lo reemplazaremos o reembolsaremos.</p>
    <h3>Contacto</h3><p>Para dudas escribe a ${esc(config.contacto || '')}.</p>`,
  faq: () => `<h2>Preguntas Frecuentes</h2>
    <h3>¿Cuánto cuesta el envío?</h3><p>$${dinero(config.envioCosto)} MXN${Number(config.envioGratisDesde) > 0 ? `, y es gratis en compras desde $${dinero(config.envioGratisDesde)} MXN` : ''}.</p>
    <h3>¿Cómo uso un cupón?</h3><p>En tu bolsa escribe el código en el campo "Cupón de descuento" y pulsa Aplicar.</p>
    <h3>¿Cómo sé el estado de mi pedido?</h3><p>En la sección "Mis Pedidos" verás si está Pagado, Enviado o Entregado, y te avisamos por correo cuando cambie.</p>
    <h3>¿Puedo pagar con PayPal?</h3><p>Sí, al finalizar tu compra encontrarás el botón de PayPal.</p>
    <h3>Olvidé mi contraseña</h3><p>En la pantalla de inicio de sesión elige "¿Olvidaste tu contraseña?" y te enviaremos un enlace.</p>`,
  contacto: () => `<h2>Contacto</h2>
    <p>Escríbenos a <strong>${esc(config.contacto || '')}</strong> o usa este formulario:</p>
    <form onsubmit="enviarContacto(event)">
      <input type="text" id="ct-nombre" placeholder="Tu nombre" required maxlength="100" value="${esc(usuarioActual?.nombre || '')}">
      <input type="email" id="ct-email" placeholder="Tu correo" required maxlength="100" value="${esc(usuarioActual?.email || '')}">
      <textarea id="ct-msg" rows="4" placeholder="Tu mensaje" required maxlength="2000"></textarea>
      <button class="btn btn-rosa" type="submit">Enviar mensaje</button>
    </form>`
};

function mostrarInfo(tema) {
  $('info-contenido').innerHTML = INFO[tema]();
  mostrarSeccion('sec-info');
}

async function enviarContacto(e) {
  e.preventDefault();
  try {
    const d = await post('/api/contacto', { nombre: $('ct-nombre').value, email: $('ct-email').value, mensaje: $('ct-msg').value });
    toast('📨 ' + d.mensaje);
    $('ct-msg').value = '';
  } catch (err) { toast(err.message, 'error'); }
}
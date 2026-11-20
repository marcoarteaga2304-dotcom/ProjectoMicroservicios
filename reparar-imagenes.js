// Empareja cada producto con el archivo real de public/img (ignora guiones, acentos, mayúsculas y extensión)
// y corrige la ruta guardada en la base de datos.
// Uso: docker compose exec web node reparar-imagenes.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const carpeta = path.join(__dirname, 'public', 'img');
const clave = texto => String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .split(/[^a-z0-9]+/).filter(t => t && t !== 'tono').join('');

(async () => {
  if (!fs.existsSync(carpeta)) { console.log('❌ No existe la carpeta public/img dentro del contenedor.'); process.exit(1); }
  const archivos = fs.readdirSync(carpeta).filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f));
  console.log(`Imágenes encontradas en public/img: ${archivos.length}`);
  if (!archivos.length) { console.log('❌ La carpeta está vacía dentro del contenedor (revisa que Docker tenga acceso a esa carpeta).'); process.exit(1); }

  const porClave = new Map(archivos.map(f => [clave(f.replace(/\.[^.]+$/, '')), f]));
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'glowcosmetics_db'
  });
  const [productos] = await pool.query('SELECT id, nombre, imagen FROM productos ORDER BY id');

  const usados = new Set(), sinArchivo = [];
  let correctas = 0, corregidas = 0;
  for (const p of productos) {
    const f = porClave.get(clave(p.nombre));
    if (!f) { sinArchivo.push(p.nombre); continue; }
    usados.add(f);
    const ruta = '/img/' + f;
    if (p.imagen === ruta) { correctas++; continue; }
    await pool.execute('UPDATE productos SET imagen = ? WHERE id = ?', [ruta, p.id]);
    corregidas++;
    console.log(`🔧 ${p.nombre}  ->  ${f}`);
  }
  console.log(`\n✅ Ya estaban bien: ${correctas}   🔧 Corregidas: ${corregidas}`);
  if (sinArchivo.length) console.log('❌ Sin archivo de imagen para:\n   - ' + sinArchivo.join('\n   - '));
  const sobrantes = archivos.filter(f => !usados.has(f));
  if (sobrantes.length) console.log('ℹ️  Archivos que no corresponden a ningún producto:\n   - ' + sobrantes.join('\n   - '));
  await pool.end();
})().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
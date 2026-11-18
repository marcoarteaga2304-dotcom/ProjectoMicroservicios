// Uso: node crear-admin.js correo@dominio.com "contraseña" "Nombre Completo"
// Crea el usuario administrador, o convierte en admin (y renueva contraseña) a uno existente.
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

(async () => {
  const [email, password, ...resto] = process.argv.slice(2);
  const nombre = resto.join(' ') || 'Administrador';
  if (!email || !password) {
    console.log('Uso: node crear-admin.js correo contraseña [nombre]');
    process.exit(1);
  }
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'glowcosmetics_db'
  });
  const hash = await bcrypt.hash(password, 10);
  await pool.execute(
    `INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, 'admin')
     ON DUPLICATE KEY UPDATE password = VALUES(password), rol = 'admin'`,
    [nombre, email.toLowerCase(), hash]);
  console.log(`Listo: ${email} ahora es administrador.`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

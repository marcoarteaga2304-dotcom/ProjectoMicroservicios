// Uso: npm run respaldo
require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'respaldos');
fs.mkdirSync(dir, { recursive: true });
const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const archivo = path.join(dir, `glowcosmetics-${sello}.sql`);

const args = ['-h', process.env.DB_HOST || 'localhost', '-u', process.env.DB_USER || 'root',
  '--single-transaction', '--routines', process.env.DB_NAME || 'glowcosmetics_db'];
const salida = fs.createWriteStream(archivo);
const p = spawn('mysqldump', args, { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' } });
p.stdout.pipe(salida);
p.stderr.on('data', d => process.stderr.write(d));
p.on('error', () => console.error('No se encontró mysqldump. Agrega la carpeta bin de MySQL al PATH.'));
p.on('close', code => console.log(code === 0 ? `Respaldo creado: ${archivo}` : 'El respaldo falló.'));
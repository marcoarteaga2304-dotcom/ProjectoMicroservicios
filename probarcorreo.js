// Uso: node probar-correo.js [correo-destino]
// En Docker: docker compose exec web node probar-correo.js correo@ejemplo.com
const { enviarCorreo, verificarCorreo, hayCorreo } = require('./correo');

(async () => {
  const destino = process.argv[2];
  if (!hayCorreo()) { console.log('❌ SMTP_HOST no está definido en tu .env'); process.exit(1); }
  if (!(await verificarCorreo())) process.exit(1);
  if (!destino) { console.log('Conexión correcta. Para enviar una prueba: node probar-correo.js correo@ejemplo.com'); return; }
  const ok = await enviarCorreo(destino, 'Prueba de correo - GlowCosmetics',
    '<h2>¡Funciona! ✉️</h2><p>Si lees este mensaje, el servidor SMTP de la tienda está bien configurado.</p>');
  console.log(ok ? `✅ Correo enviado a ${destino}` : '❌ No se pudo enviar (revisa el mensaje de error de arriba)');
  process.exit(ok ? 0 : 1);
})();
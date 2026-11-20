E · MD
# GlowCosmetics
 
Tienda en línea de maquillaje con catálogo, bolsa de compras, pago con PayPal, reseñas, favoritos, cupones y panel de administración.
 
## Arquitectura
 
| Componente | Tecnología | Responsabilidad |
|---|---|---|
| `web` | Node.js + Express | Sirve el sitio (`public/`) y la API REST: usuarios, productos, pedidos, pagos, panel de administración |
| `db` | MySQL 8.4 | Guarda usuarios, productos, pedidos, cupones, reseñas, etc. |
| PayPal | API externa | Único método de pago: cobros y reembolsos (Orders v2) |
| SMTP | Servicio de correo | Envía confirmaciones, avisos de pedido y recuperación de contraseña |
 
Comunicación: el navegador consulta a `web` por HTTP (puerto 3000); `web` se conecta a `db` por TCP (puerto 3306) dentro de la red de Docker, usando el nombre del servicio (`db`) como host; y `web` llama a la API de PayPal por HTTPS.
 
```
Navegador ──HTTP──► web (Express) ──TCP 3306──► db (MySQL)
                       └──HTTPS──► API de PayPal
```
 
## Estructura
 
```
├── server.js            API y servidor web
├── public/              Sitio (HTML, CSS, JS) e imágenes (public/img)
├── database/            Scripts SQL que Docker ejecuta al crear la base
├── correo.js            Envío de correos (SMTP)
├── crear-admin.js       Crea o promueve un usuario administrador
├── probar-paypal.js     Verifica las credenciales de PayPal
├── probar-correo.js     Verifica el servidor de correo
├── reparar-imagenes.js  Empareja las imágenes de public/img con los productos
├── respaldo.js          Copia de seguridad de la base (npm run respaldo)
├── Dockerfile           Imagen del servicio web
├── docker-compose.yml   Orquesta web + db
├── .env.example         Variables de entorno de ejemplo (valores ficticios)
└── .gitignore
```
 
## Requisitos
 
- [Git](https://git-scm.com/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (incluye Docker Compose)
- Opcional, para ejecutar sin Docker: Node.js 18 o superior y MySQL 8
## Descargar
 
```bash
git clone https://github.com/USUARIO/REPOSITORIO.git
cd REPOSITORIO
```
 
## Configurar
 
1. Copia el archivo de ejemplo y edítalo con tus valores reales:
```bash
# Windows (PowerShell)
copy .env.example .env
# Linux / macOS
cp .env.example .env
```
 
2. En `.env` define como mínimo:
   - `DB_PASSWORD`: contraseña de MySQL (obligatoria con Docker).
   - `JWT_SECRET`: cadena larga y aleatoria.
   - `PAYPAL_CLIENT_ID` y `PAYPAL_SECRET`: credenciales **Sandbox** de <https://developer.paypal.com> (sin ellas la tienda funciona, pero sin el botón de PayPal).
> El archivo `.env` contiene información confidencial y **nunca** debe subirse al repositorio (ya está en `.gitignore`).
 
## Ejecutar con Docker (recomendado)
 
```bash
docker compose up --build
```
 
La primera vez, MySQL crea las tablas con los scripts de `database/`. Cuando veas `Tienda activa en http://localhost:3000`, abre esa dirección en el navegador.
 
Crear el usuario administrador (en otra terminal):
 
```bash
docker compose exec web node crear-admin.js correo@ejemplo.com "ContraseñaSegura" "Nombre Admin"
```
 
Comandos útiles:
 
```bash
docker compose ps                 # estado de los servicios
docker compose logs -f web        # registros del servicio web
docker compose down               # detener (conserva los datos)
docker compose down -v            # detener y BORRAR la base de datos
docker compose --profile herramientas up -d   # phpMyAdmin en http://localhost:8081 (usuario root y tu DB_PASSWORD)
```
 
## Ejecutar sin Docker
 
1. Crea la base `glowcosmetics_db` en tu MySQL e importa en orden los archivos de `database/` (`01-esquema.sql`, `02-migracion.sql`, `03-migracion2.sql`).
2. En `.env` deja `DB_HOST=localhost` y tu usuario y contraseña de MySQL.
3. Instala y ejecuta:
```bash
npm install
npm start
```
 
## Dependencias principales
 
`express`, `mysql2`, `bcrypt`, `jsonwebtoken`, `helmet`, `express-rate-limit`, `multer`, `nodemailer`, `dotenv` (la lista completa está en `package.json`).
 
## Pagos con PayPal (único método de pago)
 
1. Entra a <https://developer.paypal.com>, activa **Sandbox** y abre *Apps & Credentials* → *Create App* (tipo Merchant), eligiendo una cuenta comercial Sandbox.
2. Copia el *Client ID* y el *Secret* a tu `.env` (`PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`) y deja `PAYPAL_MODE=sandbox`.
3. Para comprar en pruebas, usa la cuenta **Personal** de *Testing Tools → Sandbox Accounts*, no tu cuenta real.
4. Verifica la configuración:
```bash
docker compose exec web node probar-paypal.js
```
 
> Los cobros se hacen en pesos mexicanos (MXN). Si usas cuentas Sandbox, crea la cuenta comercial con país México para que acepte MXN sin conversión.
 
Si tu base ya existía antes de agregar los reembolsos, ejecuta una vez `database/04-migracion3.sql` (o recrea la base con `docker compose down -v`).
 
## Correo electrónico (SMTP)
 
Define en `.env` `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM` (ejemplos en `.env.example`). Prueba la conexión y envía un correo de prueba:
 
```bash
docker compose exec web node probar-correo.js tu-correo@ejemplo.com
```
 
Sin `SMTP_HOST`, la tienda funciona, pero los correos solo se muestran en la consola.
 
## Solución de problemas
 
- **El puerto 3000 está ocupado:** cambia `PORT` en `.env` (por ejemplo, 3001) y abre `http://localhost:3001`.
- **`DB_PASSWORD` no definida:** falta el archivo `.env` o esa variable.
- **Cambié la contraseña de la base y no funciona:** el volumen conserva la contraseña anterior; ejecuta `docker compose down -v` y vuelve a levantar.
- **Las imágenes de los productos no se ven:** ejecuta `docker compose exec web node reparar-imagenes.js`; empareja cada producto con su archivo de `public/img` y corrige la ruta en la base.
- **No llegan correos:** ejecuta `docker compose exec web node probar-correo.js` para ver el error. Sin `SMTP_HOST`, los correos solo se muestran en la consola (`docker compose logs web`), incluido el enlace de recuperación de contraseña.
- **El botón de PayPal no aparece o falla:** ejecuta `docker compose exec web node probar-paypal.js` y revisa que el Client ID y el Secret sean de la misma app Sandbox.
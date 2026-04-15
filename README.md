# Global App Backend

Backend inicial en Node.js con Express, MongoDB y autenticacion con JWT.

Dominio temporal del frontend:

- `https://teal-flamingo-532353.hostingersite.com`

## Scripts

- `npm run dev`: inicia el servidor con nodemon.
- `npm start`: inicia el servidor en modo normal.
- `npm run seed:admin`: crea o actualiza el usuario administrativo inicial.
- `npm run seed:client`: crea o actualiza un cliente inicial para entrar al portal.
- `npm run seed:posts`: crea o actualiza 3 publicaciones demo para el feed del cliente.

## Endpoints iniciales

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/client-requests`
- `GET /api/admin/users`
- `POST /api/admin/users/clients`
- `GET /api/admin/client-requests`
- `GET /api/admin/orders`
- `POST /api/admin/orders`
- `GET /api/admin/orders/:orderId`
- `PATCH /api/admin/orders/:orderId`
- `PATCH /api/admin/orders/:orderId/tracking-steps/:stepKey`
- `GET /api/admin/maintenance`
- `PATCH /api/admin/maintenance/:maintenanceId`
- `POST /api/admin/posts`
- `GET /api/admin/posts`

## Roles

- El cliente no selecciona rol en el frontend.
- El registro publico crea usuarios con rol `client` desde backend.
- El acceso administrativo se controla con rol `admin` y rutas protegidas.

## Seed administrativo

Ejecuta `npm run seed:admin` con la base conectada.

Valores por defecto del seed:

- `GLOBAL_ADMIN_NAME=Global Admin`
- `GLOBAL_ADMIN_EMAIL=admin@globalimports.com`
- `GLOBAL_ADMIN_PASSWORD=GlobalAdmin123!`

Puedes sobreescribirlos por entorno antes de ejecutar el comando.

## Seed cliente

Ejecuta `npm run seed:client` con la base conectada.

Valores por defecto del seed:

- `GLOBAL_CLIENT_NAME=Cliente Demo`
- `GLOBAL_CLIENT_EMAIL=cliente@globalimports.com`
- `GLOBAL_CLIENT_PASSWORD=ClienteGlobal123!`
- `GLOBAL_CLIENT_PHONE=+58 412-000-0000`

Puedes sobreescribirlos por entorno antes de ejecutar el comando.

## Variables de entorno

Usa el archivo `.env.example` como referencia.

Variables necesarias para Cloudinary si quieres subir archivos desde el portal admin:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_FOLDER` opcional, por defecto `global-app/posts`

Variables necesarias para correos transaccionales con Brevo:

- `BREVO_API_KEY`
- `PUBLIC_APP_URL` para construir enlaces del portal en correos de tracking y recuperación

## Tracking: push + correo

- Cuando un cliente autenticado consulta un tracking, su usuario queda asociado como suscriptor del pedido.
- Cada actualización de un estado de tracking envía push notification y correo al email registrado del cliente/suscriptor.
- El correo de tracking se envía vía Brevo con remitente `orders@globalimportsus.com`.

## Publicaciones admin -> feed cliente

- El admin publica en `POST /api/admin/posts`.
- Si sube imágenes o video, el backend los envía a Cloudinary.
- Mongo guarda las URLs seguras (`secure_url`) devueltas por Cloudinary.
- El portal del cliente consume esas publicaciones desde Mongo a través de `GET /api/client/posts`.

## Render

- Start Command actual compatible: `node server.js`
- Si prefieres usar scripts de npm, tambien funciona `npm start`
- Para el frontend temporal, usa `CORS_ORIGIN=https://teal-flamingo-532353.hostingersite.com`
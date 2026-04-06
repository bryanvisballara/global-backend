# Admin Blueprint

## Roles

- `admin`: opera pedidos, seguimiento, mantenimientos y publicaciones.
- `client`: consume seguimiento, mantenimientos y feed social.

## Modulos iniciales

### 1. Gestion de clientes

- El administrador puede crear clientes desde backend.
- El frontend publico no expone selector de rol.

### 2. Gestion de ordenes

- Cada orden representa un carro importado para un cliente.
- Datos base: marca, modelo, ano, VIN, tracking number, fecha de compra, media, notas.
- Cada orden tiene 7 pasos de seguimiento administrables desde backend.

### 3. Seguimiento de importacion

Pasos base:

1. Solicitud recibida
2. Compra confirmada
3. Logistica en origen
4. En transito
5. Proceso aduanal
6. Entrega local
7. Entrega completada

Cada paso acepta:

- estado (`pending`, `active`, `completed`)
- notas
- imagenes o videos por URL

### 4. Mantenimientos

- Al crear una orden, el backend agenda un mantenimiento a 6 meses desde `purchaseDate`.
- El backend ya deja persistido el vencimiento en la coleccion `maintenance`.
- La parte de push notifications queda preparada a nivel de datos, pero todavia falta el worker o servicio externo que dispare notificaciones reales.

### 5. Publicaciones

- El administrador puede crear publicaciones para el feed del cliente.
- Formatos iniciales soportados:
  - `carousel` con varias imagenes
  - `video` con un video principal

## Endpoints admin actuales

- `GET /api/admin/users`
- `POST /api/admin/users/clients`
- `GET /api/admin/orders`
- `POST /api/admin/orders`
- `GET /api/admin/orders/:orderId`
- `PATCH /api/admin/orders/:orderId`
- `PATCH /api/admin/orders/:orderId/tracking-steps/:stepKey`
- `GET /api/admin/maintenance`
- `PATCH /api/admin/maintenance/:maintenanceId`
- `GET /api/admin/posts`
- `POST /api/admin/posts`

## Seed de acceso administrativo

Comando:

`npm run seed:admin`

Credenciales por defecto:

- correo: `admin@globalimports.com`
- clave: `GlobalAdmin123!`

## Siguiente fase recomendada

1. Construir el panel administrativo web consumiendo estos endpoints.
2. Integrar upload real de imagenes y videos a S3, Cloudinary o similar.
3. Agregar un job scheduler para disparar push notifications de mantenimiento.
4. Crear el feed y detalle de tracking para el cliente.
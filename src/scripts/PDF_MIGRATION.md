# PDF Migration Script

Este script migra los PDFs antiguos que fueron subidos a Cloudinary a almacenamiento local, actualizando las URLs en la base de datos para servirse desde el nuevo endpoint seguro `/api/uploads/download/`.

## Por qué migrar

- Los PDFs en Cloudinary pueden tener problemas de compatibilidad con Safari/iPad
- Las URLs locales son más confiables y controlan mejor los headers HTTP
- Mejor rendimiento al no depender de Cloudinary para PDFs

## Uso

Ejecuta desde la raíz del proyecto backend:

```bash
node src/scripts/migratePdfsFromCloudinary.js
```

### Requisitos previos

- Backend debe estar con todas las dependencias instaladas (`npm install`)
- Archivo `.env` debe estar configurado con credenciales de MongoDB
- El servidor **NO debe estar ejecutándose** durante la migración (evita conflictos de acceso)

## Qué hace el script

1. Conecta a MongoDB
2. Busca todos los pedidos (LATAM y USA) que tengan PDFs desde Cloudinary
3. Para cada PDF:
   - Descarga desde Cloudinary
   - Lo guarda localmente en `/uploads/order-documents/`
   - Actualiza la URL en la BD a `/api/uploads/download/[nombre-local]`
   - Guarda la URL original de Cloudinary para referencia
4. También migra PDFs en eventos de tracking vinculados

## Salida esperada

```
🔄 Starting PDF migration from Cloudinary to local storage...

📦 Found 45 orders with potential Cloudinary PDFs

[1/45] Processing order: GI-12790100
  Migrating: https://res.cloudinary.com/.../pdf...
  ✓ Migrated to: /api/uploads/download/migrated-...
  ✓ Order documents migrated
  ✓ 3 tracking event(s) migrated

[2/45] Processing order: GI-12790101
  ...

✅ Migration complete!
   Orders modified: 45
   Tracking events modified: 127
   PDFs now served locally from /api/uploads/download/
```

## Notas

- El script procesa en lotes de 5 órdenes
- Los archivos locales se nombran con prefijo `migrated-` + timestamp + UUID
- Si algún PDF falla en descargar, se mantiene la URL original de Cloudinary
- Se puede ejecutar múltiples veces sin problemas (solo re-migra los que falten)
- Los PDFs originales en Cloudinary se mantienen (por si necesitas rollback)

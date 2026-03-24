# Global App Backend

Backend inicial en Node.js con Express, MongoDB y autenticacion con JWT.

## Scripts

- `npm run dev`: inicia el servidor con nodemon.
- `npm start`: inicia el servidor en modo normal.

## Endpoints iniciales

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

## Roles

- `client`: se crea automaticamente al registrarse.
- `admin`: se crea automaticamente al iniciar el servidor si `ADMIN_NAME`, `ADMIN_EMAIL` y `ADMIN_PASSWORD` existen en el entorno.

## Variables de entorno

Usa el archivo `.env.example` como referencia.
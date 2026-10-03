# Hassa · Inventario de contenedores (demo)

Demo funcional con tres partes en un solo servicio:

- **Backend / API** (`server/`): maestro de contenedores y cestos (tipo, Nº de inventario, tag ID), lecturas georreferenciadas, gestiones y usuarios.
- **Backoffice** (`/`): indicadores, mapa, inventario con búsqueda, ficha con QR, gestiones con foto y administración de usuarios.
- **App de campo** (`/campo/`): PWA para el celular con lectura de QR, foto, GPS y registro de movimiento, recambio, solicitud de reparación y baja.

Los 3.000 contenedores, sus ubicaciones y direcciones son **datos ficticios** generados al iniciar.

## Cómo correrla

Requiere Node.js 22.13 o superior.

```bash
npm install
npm start
```

Abrir http://localhost:3000. Sin configurar nada arranca en **modo demo**, con tres usuarios de prueba (administrador, operador, consulta).

- `npm run simular` simula una aplicación de terceros que reporta 300 lecturas.
- `npm run reset` borra la base y las fotos; se regeneran en el próximo inicio.

## Guion sugerido para la presentación

1. **Mapa**: total de unidades y estados. Tocar "Fuera de ubicación" o "Sin lectura +48 h" para ver las alertas que surgen de las lecturas de los tags.
2. **Inventario**: buscar un Nº de inventario y abrir la ficha. Mostrar el QR.
3. **Celular**: escanear ese QR desde la pantalla, sacar una foto y registrar una solicitud de reparación.
4. **Gestiones**: la solicitud aparece con foto, usuario y hora; "Marcar reparado" la cierra y el contenedor vuelve a la vía pública.
5. **Recambio**: escanear un contenedor en la calle y uno del depósito; se intercambian las ubicaciones.
6. **Usuarios**: habilitar o bloquear una cuenta de Google y cambiarle el rol.

## Usarla desde el celular

La cámara y el GPS del navegador solo funcionan sobre **HTTPS** (o en `localhost`). Opciones:

- Desplegar en Cloud Run (abajo), o
- Exponer la PC con un túnel HTTPS (cloudflared, ngrok o similar) apuntando al puerto 3000.

Sin HTTPS igual se puede mostrar la app de campo ingresando el Nº de inventario a mano.

## Activar el login con Google

1. En Google Cloud Console > APIs y servicios > Credenciales, crear un **ID de cliente OAuth** de tipo "Aplicación web".
2. En "Orígenes autorizados de JavaScript" agregar la URL donde corre la demo (por ejemplo `http://localhost:3000` y la URL pública).
3. Iniciar con las variables (ver `.env.example`):

```bash
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com ADMIN_EMAIL=tu.cuenta@gmail.com npm start
```

`ADMIN_EMAIL` es el primer administrador. El resto de las cuentas se habilita desde la pestaña **Usuarios**; una cuenta de Google que no esté en esa lista no puede entrar. Roles: administrador (todo), operador (registra gestiones), consulta (solo lectura).

## Desplegar en Cloud Run

```bash
gcloud run deploy hassa-demo --source . --region southamerica-east1 \
  --allow-unauthenticated --max-instances 1 \
  --set-env-vars GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com,ADMIN_EMAIL=tu.cuenta@gmail.com
```

En Cloud Run la base SQLite vive en el disco temporal del contenedor: los datos y las fotos **se reinician** cuando la instancia se recicla. Alcanza para una demo, no para uso real.

## API para aplicaciones de terceros

Se autentican con una clave por integrador en el encabezado `x-api-key` (en la demo: `demo-key`).

```bash
curl -X POST http://localhost:3000/api/v1/lecturas \
  -H 'x-api-key: demo-key' -H 'Content-Type: application/json' \
  -d '{"lecturas":[{"tag_id":"E280...","lat":-34.6037,"lng":-58.3816,"ts":"2026-10-03T12:00:00Z"}]}'
```

- Acepta lotes de hasta 5.000 lecturas. `ts` es opcional (por defecto, la hora de recepción).
- Es idempotente: reenviar la misma lectura (mismo tag, hora e integrador) no la duplica.
- Responde cuántas fueron aceptadas, duplicadas y rechazadas (tag desconocido o datos inválidos).
- Cada lectura actualiza la última posición del contenedor y su distancia a la ubicación asignada (alerta a más de 150 m).

## Qué cambia para el sistema definitivo

| Demo | Producción |
|---|---|
| SQLite embebido | PostgreSQL + PostGIS (Cloud SQL), tabla de lecturas particionada por mes |
| Fotos en disco local | Cloud Storage con URLs firmadas |
| Verificación propia del token de Google | Firebase Authentication / Identity Platform |
| Requiere conexión | Guardado de gestiones sin señal y sincronización posterior |
| Dirección cargada a mano en los movimientos | Geocodificación inversa (calle y barrio a partir del GPS) |
| 3.000 unidades de ejemplo | 150.000 unidades, 450.000 lecturas por día (unos 164 millones por año) |

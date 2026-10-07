# Hassa · Inventario de contenedores (demo)

Demo funcional en un solo servicio:

| Parte | Dirección | Quién la usa |
|---|---|---|
| Backoffice | `/` | Administración: mapa, inventario, gestiones, reclamos, usuarios y ajustes |
| App de campo | `/campo/` | Operarios: QR, foto, gestiones, relevamientos asignados y recorrido |
| App del vecino | `/vecino/` | Vecinos y empresas: carga de reclamos, sin login |
| API de lecturas | `/api/v1/lecturas` | Aplicaciones de terceros que reportan lecturas de tags |

## Datos

- **Reales:** los 7.046 equipos y puntos de recolección de `server/datos/inventario.json` (Comuna 1, generado desde el Excel de puntos de recolección). El código de inventario es el `ID_EQUIPO`.
- **Simulados:** tag ID, estados (depósito, reparación, baja), lecturas, gestiones y 30 reclamos de ejemplo (20 ya programados para "Operario Juan" y 10 pendientes sin asignar).

Como el inventario es información real, conviene que el repositorio de GitHub sea **privado**.

## Cómo correrla

Requiere Node.js 22.13 o superior.

```bash
npm install
npm start
```

Abrir http://localhost:3000. Sin configurar nada arranca en **modo demo**, con usuarios de prueba (administración, dos operarios, consulta).

- `npm run simular` simula una aplicación de terceros que reporta 300 lecturas.
- `npm run reset` borra la base y las fotos; se regeneran en el próximo inicio.

## Guion sugerido

1. **Mapa:** estados, alertas, puntos vacíos y mapa de calor de lecturas (panel "Capas").
2. **Vecino:** abrir `/vecino/` en el celular, escanear el QR de una ficha del backoffice (o ingresar un ID real, por ejemplo `516`), sacar fotos y enviar el reclamo.
3. **Reclamos:** el reclamo aparece en "Pendiente". Con "Seleccionar zona" se arrastra el mouse sobre el mapa, se elige un operario y "Asignar".
4. **Recorrido:** en "Programado", elegir un operario para ver su recorrido óptimo.
5. **App de campo:** entrar como ese operario, "Ver recorrido en el mapa", abrir una parada y resolverla con foto.
6. **Mails:** en la ficha de cada reclamo figura cada mail y si se envió.

## Código QR

El QR de cada ficha contiene `https://…/vecino/?c=ID_EQUIPO`: con la cámara del celular abre la app del vecino en ese equipo, y la app de campo lo lee desde su propio lector. Los lectores también aceptan un QR que contenga solo el número, o una URL que termine en el número o lo lleve en `?id=`.

## Envío de mails

Se envían por SMTP desde una cuenta de la empresa. La **dirección que recibe** los reclamos se carga en el backoffice, pestaña **Ajustes** (o con la variable `EMPRESA_EMAIL` como valor inicial). La **cuenta que envía** va en variables de entorno:

| Variable | Ejemplo con Gmail |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `avisos.hassa@gmail.com` |
| `SMTP_PASS` | contraseña de aplicación de 16 letras |
| `EMPRESA_EMAIL` | `reclamos@empresa.com` (opcional) |

Con Gmail: activar la verificación en dos pasos de la cuenta y crear una "contraseña de aplicación" en https://myaccount.google.com/apppasswords. En Cloud Run las variables se cargan en **Editar e implementar nueva revisión > Variables y secretos**.

Se envía un mail a la empresa por cada reclamo nuevo (con las fotos adjuntas y respuesta dirigida al vecino), una confirmación al vecino, y un aviso de resolución a ambos. Sin SMTP configurado los reclamos se guardan igual y cada mail queda registrado como "No enviado" con el motivo.

## Recorrido óptimo

Lo calcula el servicio público de rutas de OpenStreetMap (OSRM, `router.project-osrm.org`): ordena las paradas y devuelve el trazado por calles, partiendo de la posición GPS del operario. Es gratuito y sin garantía de disponibilidad; si no responde, el sistema ordena las paradas por distancia en línea recta y lo indica en pantalla. Para producción conviene un servidor OSRM propio.

## Usarla desde el celular

La cámara y el GPS del navegador solo funcionan sobre **HTTPS** (o en `localhost`): desplegar en Cloud Run o exponer la PC con un túnel HTTPS.

## Login con Google

1. En Google Cloud Console > APIs y servicios > Credenciales, crear un **ID de cliente OAuth** de tipo "Aplicación web".
2. En "Orígenes autorizados de JavaScript" agregar la URL del servicio.
3. Cargar las variables `GOOGLE_CLIENT_ID` y `ADMIN_EMAIL` (primer administrador).

El resto de las cuentas se habilita en la pestaña **Usuarios**. Roles: administrador (todo), operador (gestiones y relevamientos asignados), consulta (solo lectura). La app del vecino no pide login.

## Desplegar en Cloud Run

```bash
gcloud run deploy hassa-demo --source . --region europe-west1 \
  --allow-unauthenticated --max-instances 1
```

La base SQLite vive en el disco temporal del contenedor: los datos, las fotos y lo cargado en Ajustes **se reinician** con cada nueva revisión o reciclado de la instancia.

## API para aplicaciones de terceros

```bash
curl -X POST http://localhost:3000/api/v1/lecturas \
  -H 'x-api-key: demo-key' -H 'Content-Type: application/json' \
  -d '{"lecturas":[{"tag_id":"E280...","lat":-34.6037,"lng":-58.3816,"ts":"2026-10-03T12:00:00Z"}]}'
```

Acepta lotes de hasta 5.000 lecturas, es idempotente y responde cuántas fueron aceptadas, duplicadas y rechazadas.

## Qué cambia para el sistema definitivo

| Demo | Producción |
|---|---|
| SQLite embebido | PostgreSQL + PostGIS (Cloud SQL), lecturas particionadas por mes |
| Fotos en disco local | Cloud Storage con URLs firmadas |
| Verificación propia del token de Google | Firebase Authentication / Identity Platform |
| Requiere conexión | Guardado sin señal y sincronización posterior |
| OSRM público | Servidor de rutas propio |
| Límite de reclamos por IP en memoria | Captcha y límite persistente |
| 7.046 equipos (Comuna 1) | 150.000 equipos, 450.000 lecturas por día |

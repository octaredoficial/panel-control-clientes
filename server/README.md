# Backend del Panel de Control de Clientes

Servidor Node.js **sin dependencias de npm** que reemplaza a Firebase:

- **Firestore (datos + sync en vivo)** → SQLite embebido + API REST + WebSocket.
- **Firebase Auth (login)** → una sola **contraseña compartida** con sesión por cookie.

Está pensado para correr en Docker detrás de **Caddy** (TLS autofirmado) en un
servidor de 1 GB de RAM. Usa solo módulos integrados de Node 22:

- `node:sqlite` (`DatabaseSync`) como base de datos de un solo archivo.
- `node:http` para el servidor y el servido de estáticos.
- `node:crypto` para firmar sesiones (HMAC-SHA256) y para un **servidor WebSocket
  mínimo** propio (RFC 6455), evitando la dependencia `ws`.

> Requiere **Node ≥ 22.5** (por el módulo `node:sqlite`). El módulo es
> experimental en v22, por lo que al arrancar aparece un aviso
> `ExperimentalWarning: SQLite`; es inofensivo.

## Variables de entorno

| Variable         | Obligatoria | Por defecto        | Descripción |
| ---------------- | ----------- | ------------------ | ----------- |
| `APP_PASSWORD`   | **Sí**      | —                  | Contraseña única de acceso. |
| `SESSION_SECRET` | **Sí**      | —                  | Secreto largo y aleatorio para firmar los tokens de sesión (HMAC). Genera uno con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `DB_PATH`        | No          | `/data/pcc.sqlite` | Ruta del archivo SQLite. En Docker es un volumen montado en `/data`. |
| `PORT`           | No          | `8080`             | Puerto de escucha del backend. |
| `COOKIE_INSECURE`| No          | —                  | `=1` para **no** marcar la cookie como `Secure` (solo para pruebas por `http` sin proxy TLS). En producción, detrás de Caddy (HTTPS), déjalo sin definir. |

## Cómo ejecutarlo en local

```bash
cd server
APP_PASSWORD=miclave \
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
DB_PATH=./pcc.sqlite PORT=8080 COOKIE_INSECURE=1 \
node index.js
```

Luego abre `http://127.0.0.1:8080/` (sirve el frontend desde la raíz del repo).

## Pruebas

```bash
cd server
node --test
```

Cubren: login correcto/incorrecto, gating de autenticación en `/api/*`,
round-trip de datos por SQLite, cabeceras de seguridad en estáticos y la
difusión por WebSocket entre dos clientes.

## Contrato de la API

Todas las respuestas llevan las cabeceras `X-Content-Type-Options: nosniff` y
`Referrer-Policy: strict-origin-when-cross-origin` (las mismas que fijaba
`netlify.toml`).

### Autenticación

| Método | Ruta          | Cuerpo               | Respuesta |
| ------ | ------------- | -------------------- | --------- |
| POST   | `/api/login`  | `{ "password": "…" }`| `200 { ok:true }` + `Set-Cookie: pcc_session=…` (HttpOnly, SameSite=Strict, Secure, Max-Age 30 días) si la contraseña coincide; `401` si no. |
| POST   | `/api/logout` | —                    | `200 { ok:true }` + cookie de borrado. |

La contraseña se compara en **tiempo constante** (`crypto.timingSafeEqual` sobre
hashes SHA-256). La sesión es un **token firmado sin estado** (`payload.firma`,
HMAC-SHA256 con `SESSION_SECRET`, con caducidad), así que el backend no mantiene
un almacén de sesiones y sobrevive a reinicios.

### Datos (requieren sesión; devuelven `401` sin cookie válida)

| Método | Ruta               | Cuerpo                         | Acción |
| ------ | ------------------ | ------------------------------ | ------ |
| GET    | `/api/state`       | —                              | Snapshot completo `{ clientes:[], movimientos:[], config:{}\|null, theme:'claro'\|'oscuro' }`. Equivale a la carga inicial de Firestore. |
| PUT    | `/api/clientes`    | array de clientes              | Reemplaza toda la colección (dentro de una transacción) y difunde `{domain:'clientes', data:[...]}` por WS. |
| PUT    | `/api/movimientos` | array de movimientos           | Igual que clientes, difunde `{domain:'movimientos', data:[...]}`. |
| PUT    | `/api/config`      | objeto de configuración        | Guarda la config y difunde `{domain:'config', data:{...}}`. |
| PUT    | `/api/theme`       | `{ "valor": "claro"\|"oscuro" }`| Guarda el tema y difunde `{domain:'theme', data:'claro'\|'oscuro'}`. |

La semántica de "reemplazar la colección completa" imita el espejado de
colecciones de `firebase-sync.js`: el módulo de sync del cliente (FEAT-004)
enviará el array completo al parchear los setters de `PCC`.

### Sincronización en vivo (WebSocket)

- Endpoint: `GET /ws` con **upgrade** a WebSocket. El upgrade **exige la cookie
  de sesión** válida; si no, se responde `401` y se cierra.
- Al conectar, el servidor envía `{ domain:'state', data:<snapshot completo> }`
  para que un cliente que (re)conecta se resincronice.
- En cada escritura REST, el servidor **difunde** `{ domain, data }` a todos los
  clientes conectados (incluido el emisor; el cliente se protege con su flag
  `_aplicandoSnapshot`, así que el eco es inofensivo).

### Estáticos

Cualquier ruta que no empiece por `/api/` ni sea `/ws` sirve el frontend
(`index.html`, `app.js`, `red-mapa.js`, `styles.css`, el módulo de sync, etc.)
desde la raíz del repositorio, con protección contra *path traversal*.

## Estructura

```
server/
├── index.js        Punto de entrada (lee env y arranca a escuchar).
├── server.js       Fábrica del servidor HTTP + enrutado REST + upgrade WS.
├── db.js           Capa SQLite (node:sqlite): esquema y lectura/escritura.
├── auth.js         Contraseña única + tokens de sesión firmados (cookies).
├── ws.js           Servidor WebSocket mínimo (RFC 6455) sin dependencias.
├── server.test.js  Pruebas con node:test.
└── package.json
```

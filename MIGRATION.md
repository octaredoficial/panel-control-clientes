# MIGRATION.md — Migración a autohospedaje (Netlify + Firebase → servidor propio)

> Nota de arquitectura (ADR) de la migración del **Panel de Control de Clientes** (WISP)
> desde **Netlify** (hosting) + **Firebase** (Firestore + Auth) hacia un stack **100%
> autohospedado y Dockerizado** en el servidor Vultr del usuario, accesible **solo por IP
> pública** sobre **HTTPS autofirmado**.
>
> Este documento registra decisiones **ya tomadas por el usuario**. No se vuelven a debatir;
> se dejan por escrito para que las features siguientes (FEAT-002…FEAT-006) sean coherentes.
> **FEAT-001 no cambia ningún comportamiento de producción**: solo establece la línea base y
> fija estas decisiones.

---

## 1. Línea base del proyecto (estado actual)

- **App:** HTML + CSS + JavaScript puro (vanilla), **sin bundler** ni dependencias de build.
- **Núcleo lógico:** `app.js` expone un namespace global `window.PCC` (modelo, cálculos de
  negocio, recibos/folios, persistencia, siembra). El IIFE cae a `globalThis.PCC` cuando no hay
  `window`, por lo que el núcleo **es cargable bajo Node**.
- **Integración nube (único punto Firebase):** `firebase-sync.js` (seam a reemplazar).
- **Hosting/DB actuales:** Netlify (estático) + Firestore (datos) + Firebase Auth (login Google/anónimo).

### 1.1 Estado de las pruebas (baseline)

- **No existe un arnés de pruebas automatizado en el repositorio.** No hay `package.json`, ni
  carpeta `test/` o `tests/`, ni scripts de Node que ejerciten `window.PCC`. El `README.md`
  documenta **verificación manual en el navegador** ("como no hay navegador headless… se hace a
  mano"). La referencia a "~66 tests del núcleo" **no corresponde a archivos presentes** en este
  repo; se documenta aquí para evitar confusiones.
- **Smoke check de baseline (ejecutado en este entorno):**

  ```
  node -e "require('./app.js'); console.log('PCC keys:', Object.keys(globalThis.PCC).length)"
  # → PCC loaded OK, keys: 41   (exit 0)
  ```

  Es decir: `app.js` **parsea y carga limpio bajo Node v22** y expone el núcleo. Esto es lo
  máximo que puede verificarse de forma automática hoy, al no haber suite formal.
- **Plan para pruebas:** el backend nuevo debe venir con pruebas basadas en el runner integrado
  `node --test` (`node:test`), sin dependencias extra, dado el objetivo de 1 GB de RAM.

### 1.2 Toolchain del build box (verificado)

| Herramienta        | Comando                   | Resultado en este entorno |
| ------------------ | ------------------------- | ------------------------- |
| Node.js            | `node --version`          | `v22.23.3` (esperado v22.x) ✓ |
| Docker CLI         | `docker --version`        | `docker version 5.2.3` (en realidad **Podman** emulando `docker`: `/usr/local/bin/docker` → podman) |
| Compose (plugin)   | `docker compose version`  | **No disponible** aquí. `docker compose` requiere un proveedor externo (docker-compose/podman-compose) ausente, y además falla por un `conmon` roto en el build box. |

**Consecuencia operativa:** en este build box **no se puede** ni validar ni levantar compose.
- **Validación local:** se hará con `docker compose config` **en el servidor** (o donde haya un
  Docker/Compose funcional); aquí no es posible.
- **Ejecución real:** `docker compose up -d` se corre **en el servidor Vultr** (Ubuntu), que sí
  tiene Docker + Compose. Las features de contenedores entregarán los archivos (`Dockerfile`,
  `docker-compose.yml`, config de Caddy) para ejecutarse allí; **no se despliega desde el sandbox**.

---

## 2. Decisiones de arquitectura bloqueadas (ya decididas por el usuario)

### 2.1 Login: contraseña única compartida (sin Firebase Auth)
- Una sola **contraseña compartida** para entrar; se elimina el login con Google / anónimo de
  Firebase Auth.
- El backend valida la contraseña y entrega una **sesión** (cookie/token) que habilita el acceso
  a la app y a la conexión de sincronización.
- Reemplaza el overlay de login de `index.html` (`#btn-login-google` / `#btn-login-anonimo`) por
  un formulario de **una sola contraseña** (se implementa en una feature posterior, **no aquí**).

### 2.2 Sincronización en vivo: **WebSocket**
Justificación (breve):
- **Full-duplex:** el cliente **también envía escrituras** (altas/ediciones de clientes, pagos,
  config, tema), no solo recibe. WS cubre ambos sentidos sobre **una sola conexión**.
- **Deltas triviales y de bajo overhead:** empujar cambios por WS es más ligero que **polling**
  (sin peticiones repetidas) y encaja con el patrón actual de `firebase-sync.js` (snapshots/deltas).
- **SSE descartado:** Server-Sent Events es unidireccional (server→cliente); obligaría a un canal
  HTTP aparte para las escrituras. WS mantiene **una única conexión** bidireccional, más simple y
  eficiente para 1 vCPU / 1 GB de RAM.

### 2.3 Acceso solo por IP + HTTPS autofirmado vía **Caddy (`tls internal`)**
- Acceso **solo por IP pública** `64.177.92.121`, **sin dominio**.
- **Let's Encrypt es imposible sin dominio** (ACME requiere un nombre DNS verificable), así que se
  usa **HTTPS autofirmado**. Caddy lo resuelve en una línea con **`tls internal`** (CA interna que
  genera el certificado); el usuario **acepta la advertencia** del navegador. Caddy actúa como
  **reverse proxy** delante del backend Node (termina TLS y proxya HTTP/WS al backend).

### 2.4 Base de datos embebida: **SQLite** (archivo único)
- **SQLite** de **un solo archivo**, embebido en el servidor (no Firebase).
- Para **30–50 clientes** sobra: **cero mantenimiento**, sin servidor de DB aparte, respaldo =
  copiar un archivo. Encaja con el objetivo de **poca RAM**.
- Implementación preferida sin dependencias pesadas: `node:sqlite` integrado de Node 22 o
  `better-sqlite3` (a decidir en la feature de backend según disponibilidad offline).

### 2.5 Todo en **docker compose**
- Backend Node + Caddy (reverse proxy/TLS) orquestados con **un solo `docker-compose.yml`** en la
  raíz del repo. El volumen del archivo SQLite se persiste fuera del contenedor.

### 2.6 **No** interrumpir la VPN del MikroTik
- El Vultr ya corre una **VPN hacia el MikroTik** del usuario. La migración **no debe tocar ni
  interrumpir** esa VPN: el stack Docker debe convivir con ella (puertos/redes que **no colisionen**
  con la VPN; usar los puertos estándar 80/443 para Caddy y mantener el resto de la red del host
  intacto). Cualquier script de despliegue debe ser **aditivo** y reversible.

---

## 3. Mapeo del modelo de datos (origen → destino SQLite)

El objetivo es **preservar la capa de datos de `app.js` sin cambios**: la UI sigue leyendo del
**espejo síncrono en `localStorage`** y el módulo de sync (que **reemplaza** a `firebase-sync.js`)
replica el patrón actual: parchear los setters de `PCC` para empujar deltas al backend y, al recibir
cambios remotos, llamar a los **setters originales** + `window.PCC.UI.render()` (y `aplicarTema()`
para el tema), con guarda `_aplicandoSnapshot` para evitar bucles; sembrar solo si el store remoto
está vacío.

Claves de `localStorage` (fuente que lee la UI): `pcc.clientes`, `pcc.movimientos`, `pcc.config`,
`pcc.theme`.

| Entidad (hoy)                 | Destino en SQLite                 | Notas |
| ----------------------------- | --------------------------------- | ----- |
| Colección `clientes`          | tabla **`clientes`**              | un registro por cliente; `id` del cliente = PK |
| Colección `movimientos`       | tabla **`movimientos`**           | gastos/ingresos/ahorros y **pagos** (`esPago:true` + `folio` + `periodo` + `clienteId` + `prevUltimoPago` + `prevFechaProximoPago`) |
| Documento `config/app`        | **`config`** (clave `app`)        | objeto de configuración del negocio |
| Documento `config/theme`      | **`theme`** (o `config` `theme`)  | `'claro' \| 'oscuro'` |

### 3.1 Esquema de cliente actual (de `crearCliente` en `app.js`)
`id`, `nombre`, `celular`, `direccion`, `ip`, `tipoConexion` (`'AP'|'PtP'|'Modem'|''`), `apId`,
`megas`, `monto` (number), `fechaInstalacion` (ISO), `diaPago` (1–31),
`estatus` (`'Activo'|'Pausado'`), `fechaProximoPago` (ISO), `ultimoPago` (ISO|`''`), y los campos
ricos del CSV `ssid`, `passWifi`, `passModem`, `ipPrincipal`.

> El panel es **single-tenant**: ya **no** existen los campos `socio` (Carlos/Octavio) ni el
> `tipoPago` financiero (PTP/Directo). Todo el dinero es de Octavio y no hay reparto entre socios.

### 3.2 Esquema de movimiento
`id`, `tipo` (`gasto|ingreso|ahorro`), `concepto`, `monto`, `fecha` (ISO); y para pagos además
`esPago:true`, `folio`, `periodo` (`'YYYY-MM'`), `clienteId`, `prevUltimoPago`, `prevFechaProximoPago`.

### 3.3 Objeto de configuración
`diasAviso`, `moneda`, `nombreNegocio` (por defecto **"OCTARED"**), `telefonoContacto`,
`direccionNegocio`, `mensajePie`.

> Ya **no** hay claves de gastos fijos (`costoAntena`, `numAntenas`, `costoLuz`,
> `luzPeriodicidadMeses`, `luzMesAncla`): se eliminaron junto con el reparto entre socios.

### 3.4 Datos a migrar y campos más ricos del CSV (→ FEAT-005)
- La carga es **solo desde el CSV del usuario (~29 clientes), partiendo de cero**. La base de
  datos de **Firestore NO se migra**: sus colecciones reales de clientes, reportes y transacciones
  se **ignoran** a propósito (ver el runbook en 3.7).
- El **CSV trae campos más ricos** que el esquema previo de cliente: **SSID**, **Pass WiFi**,
  **Pass Modem** e **IP Principal** (además de Nombre, Teléfono, Dirección, Plan, Mensualidad,
  Próximo Pago, Estado, Tipo Internet, IP Cliente). Para **no perder ningún dato**, se requiere una
  **extensión del esquema de cliente** (nuevos campos `ssid`, `passWifi`, `passModem`, `ipPrincipal`)
  y de su ficha/formulario. **Esa extensión se hace en FEAT-005**, no en esta feature.
- Los valores "sucios" del CSV (por ejemplo una IP con texto extra como
  `192.168.6.87    STEREN:8888`) se cargan **literalmente, sin limpiar**; la limpieza se hace
  más tarde desde la propia app.

---

## 3.5 Despliegue (runbook)

El **runbook de despliegue paso a paso** en el servidor Vultr (instalar Docker +
Compose, clonar, crear `.env`, `docker compose up -d --build`, aceptar el
certificado autofirmado en `https://64.177.92.121`, respaldos, logs y la
verificación de que **no se interrumpe la VPN del MikroTik**) está en
[`DEPLOY.md`](./DEPLOY.md). La contenedorización (Dockerfile, Caddyfile,
`docker-compose.yml`, `.env.example`) se añade en **FEAT-003**.

El stack son dos servicios en `docker-compose.yml` (raíz del repo):

- **app** — backend Node 22 (`server/Dockerfile`, imagen `node:22-alpine`,
  usuario no-root). SQLite en el volumen `pcc-data` montado en `/data`. **No
  publica puertos**: solo lo alcanza Caddy por la red interna `pcc-net`.
- **proxy** — Caddy (`caddy:2-alpine`) con `tls internal` (HTTPS autofirmado,
  sin dominio ni Let's Encrypt). **Único** servicio que publica puertos (**80**
  y **443**); el `:80` redirige a `:443`. **Sin `network_mode: host`** para no
  colisionar con la VPN del MikroTik.

> El `.env` real (con `APP_PASSWORD` y `SESSION_SECRET`) está en `.gitignore`;
> usa `.env.example` como plantilla. Genera `SESSION_SECRET` con
> `openssl rand -hex 32`.

---

## 3.6 Cutover del frontend (FEAT-004) y prueba de humo

El corte de Firebase en el navegador ya está hecho:

- `index.html` **ya no carga** `firebase-sync.js`; en su lugar carga
  `backend-sync.js` como `<script type="module">`. `firebase-sync.js` **se
  eliminó** del repositorio (su lógica quedó superada).
- El overlay `#pcc-login` **ya no** tiene botones de Google/invitado: ahora es un
  formulario de **una sola contraseña** (`#form-login` con `#login-password` y el
  botón `#btn-login`), conservando `#login-error` para los mensajes.
- `backend-sync.js` replica la estrategia de `firebase-sync.js` contra el backend
  propio: login por `POST /api/login`, carga inicial con `GET /api/state`, espejo
  de escrituras locales parcheando los cuatro setters de `PCC`
  (`guardarClientes`/`guardarMovimientos`/`guardarConfig`/`setTheme`, con la guarda
  `_aplicandoSnapshot` para evitar bucles) y aplicación de cambios remotos vía
  **WebSocket `/ws`** llamando a los setters **originales** + `PCC.UI.render()` /
  `PCC.UI.aplicarTema()`. El logout llama `POST /api/logout`, cierra el WebSocket,
  restaura los setters originales y vuelve a mostrar el overlay.

### Prueba de humo (requiere el backend de FEAT-002 corriendo)

Arranca el backend sirviendo el frontend (ver `server/README.md`), p. ej.:

```bash
cd server
APP_PASSWORD=miclave \
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
DB_PATH=./pcc.sqlite PORT=8080 COOKIE_INSECURE=1 node index.js
```

Luego, en el navegador (dos pestañas contra el **mismo** backend):

1. **Login:** abre la app → aparece el overlay de contraseña. Con una contraseña
   **incorrecta** debe mostrarse `Contraseña incorrecta. Intenta de nuevo.` en
   `#login-error` y **no** abrir la app. Con la contraseña **correcta** el overlay
   se oculta y la app carga su estado.
2. **Sync en vivo:** crea/edita/pausa/elimina un cliente en la pestaña A y confirma
   que **aparece solo** en la pestaña B **sin recargar** (vía WebSocket).
3. **Pagos:** registra un pago y revisa que, tras recargar (`GET /api/state`),
   persisten `folio`, `periodo` y los campos `prevUltimoPago` /
   `prevFechaProximoPago`; prueba también **revertir** el pago.
4. **Mapa de red** (lee `PCC.cargarClientes` + `TOPOLOGIA`), **modo oscuro** (el
   tema se sincroniza entre pestañas), **exportar CSV** e **historial**: todo sigue
   funcionando porque la capa de datos de `app.js` no cambió; solo cambió el módulo
   de sync.
5. **Logout:** pulsa «Cerrar sesión» → se cierra la sesión, se cierra el WebSocket
   y reaparece el overlay de contraseña.

> En este sandbox se verificó por `curl` contra el backend: `backend-sync.js` se
> sirve con `Content-Type: text/javascript`, contraseña incorrecta → `401`,
> correcta → `200` + cookie `Set-Cookie`, `GET /api/state` sin cookie → `401` y con
> cookie → snapshot JSON, y un `PUT /api/clientes` seguido de `GET /api/state`
> conserva los campos ricos (p. ej. `ssid`). La verificación de las **dos pestañas**
> en vivo la hace el usuario en el navegador con el backend corriendo.

---

## 3.7 Migración de datos: runbook CSV-only desde cero

La carga de datos parte **de una sola fuente**: el **CSV del usuario** (~29
clientes), con campos más ricos que el formulario original. Se carga **desde cero**
en el nuevo SQLite.

> **Firestore NO se migra.** La base de datos real de Firestore (proyecto
> `panel-clientes-12a4a`) y sus colecciones de clientes, reportes y transacciones se
> **abandonan a propósito**: no se exportan, no se reconcilian y no se cargan. No
> hace falta `serviceAccount.json` ni `firebase-admin`, y el script
> `export-firestore.mjs` ya **no** existe.

Como el sandbox no recibe el CSV con datos reales, esta parte **produce las
herramientas** que **corre el usuario** y mantiene el esquema de cliente con los
campos ricos del CSV.

### 3.7.1 Extensión del esquema de cliente

`crearCliente` en `app.js` ahora acepta y rellena por defecto cuatro campos
**opcionales** (todos `''` por defecto, así los clientes antiguos y la siembra no
se ven afectados):

| Campo         | Origen CSV     | Uso |
| ------------- | -------------- | --- |
| `ssid`        | `SSID`         | Nombre de la red WiFi del cliente |
| `passWifi`    | `Pass WiFi`    | Contraseña del WiFi |
| `passModem`   | `Pass Modem`   | Contraseña del módem |
| `ipPrincipal` | `IP Principal` | IP del equipo principal (antena/AP), distinta de `ip` |

La **ficha del cliente** (`#form-cliente` en `index.html`) expone inputs para los
cuatro (`#cliente-ssid`, `#cliente-pass-wifi`, `#cliente-pass-modem`,
`#cliente-ip-principal`) y `app.js` los lee/escribe igual que el resto de campos.
**Ningún campo existente se renombró ni se eliminó.**

### 3.7.2 Columnas del CSV y su mapeo

Cabeceras EXACTAS esperadas en la primera fila del CSV (13 columnas):

```
Nombre, Telefono, Direccion, Plan, Mensualidad, Proximo Pago, Estado,
Tipo Internet, IP Cliente, IP Principal, SSID, Pass WiFi, Pass Modem
```

| Columna CSV     | Campo cliente      | Notas de mapeo |
| --------------- | ------------------ | -------------- |
| `Nombre`        | `nombre`           | |
| `Telefono`      | `celular`          | opcional |
| `Direccion`     | `direccion`        | |
| `Plan`          | `megas`            | texto tal cual (p. ej. "10 MB") |
| `Mensualidad`   | `monto` (number)   | se limpian `$`, comas y espacios |
| `Proximo Pago`  | `fechaProximoPago` | `dd/mm/aaaa`, `dd-mm-aaaa`, `aaaa-mm-dd` o `dd/mm/aa` → ISO |
| `Estado`        | `estatus`          | `pausad/suspend/inactiv/cortad/baja/moroso` → `Pausado`; resto → `Activo` |
| `Tipo Internet` | `tipoConexion`     | `ptp/enlace`→`PtP`; `modem/cable/directo/fibra`→`Modem`; `ap/ptmp/antena/inalámbr/wifi`→`AP`; desconocido→`''` |
| `IP Cliente`    | `ip`               | |
| `IP Principal`  | `ipPrincipal`      | campo nuevo |
| `SSID`          | `ssid`             | campo nuevo |
| `Pass WiFi`     | `passWifi`         | campo nuevo |
| `Pass Modem`    | `passModem`        | campo nuevo |

Las **13 columnas** se mapean; no se descarta ninguna. Campos del modelo sin
columna en el CSV (`apId`, `diaPago`, `fechaInstalacion`, `ultimoPago`) quedan con
sus valores por defecto; se pueden completar más tarde desde la ficha del cliente
en la app.

Los valores se cargan **literalmente** (solo se recorta el espacio exterior): si una
celda trae texto "sucio" (p. ej. una IP como `192.168.6.87    STEREN:8888`), se
guarda **tal cual** y la limpieza se hace después dentro de la app.

### 3.7.3 Qué se carga y qué se ignora

- Se cargan **solo los clientes del CSV** (`clientes-from-csv.json`), tal cual los
  produce `import-csv.mjs`, sin limpiar los valores sucios.
- `movimientos` arranca **vacío** (`[]`): no hay historial de pagos que migrar.
- `config` se carga con `nombreNegocio` **"OCTARED"** (y el resto de valores por
  defecto); `theme` arranca en **`claro`**.
- **Firestore se ignora por completo**: no hay export, ni reconciliación, ni cotejo
  por IP/nombre. Los `id` de cliente son los que genera el importador del CSV.

### 3.7.4 Orden de operaciones (lo que corre el usuario)

Correr desde el directorio del repo, en la máquina del usuario (no en el sandbox):

**Paso 1. Importar el CSV**: coloca el CSV del usuario en el repo (p. ej.
`clientes.csv`, con las 13 cabeceras de 3.7.2) y:

```bash
node scripts/import-csv.mjs clientes.csv     # escribe clientes-from-csv.json
```

**Paso 2. Cargar en el backend ya corriendo** (ver DEPLOY.md). Primero en seco
para revisar el resumen y el dataset final, sin tocar el backend:

```bash
node scripts/merge-and-seed.mjs \
  --csv clientes-from-csv.json \
  --out dataset-final.json \
  --dry-run
```

Si el resumen (número de clientes cargados) se ve bien, carga de verdad al backend:

```bash
node scripts/merge-and-seed.mjs \
  --csv clientes-from-csv.json \
  --base-url https://64.177.92.121 \
  --password "TU_APP_PASSWORD" \
  --insecure        # acepta el certificado autofirmado de Caddy por IP
```

`merge-and-seed.mjs` hace `POST /api/login` y luego `PUT /api/clientes`,
`PUT /api/movimientos`, `PUT /api/config` y `PUT /api/theme`
(reemplazo de colección completa, el mismo contrato que usa `backend-sync.js`).

> **Cuidado: la carga es desde cero y sobrescribe.** Cada `PUT` reemplaza la
> colección completa en el backend, no la fusiona. Volver a correr
> `merge-and-seed.mjs` contra un backend ya poblado **pisa** `clientes`,
> `movimientos`, `config` y `theme` con el dataset del CSV; en particular,
> `config` queda reducido a `nombreNegocio` **"OCTARED"** (más los valores por
> defecto), perdiendo cualquier configuración más rica que hubiera. Es el
> comportamiento buscado para una carga inicial desde cero, pero evita
> re-ejecutarlo sobre datos reales que quieras conservar.

### 3.7.5 Verificar los conteos tras la carga

1. En la terminal, el resumen de `merge-and-seed.mjs` imprime el número de
   **clientes** cargados; compáralo con lo esperado (~29 clientes).
2. Comprueba el estado del backend directamente:

   ```bash
   # login y guardar la cookie
   curl -k -i -X POST https://64.177.92.121/api/login \
     -H 'Content-Type: application/json' -d '{"password":"TU_APP_PASSWORD"}'
   # luego, con la cookie Set-Cookie devuelta:
   curl -k https://64.177.92.121/api/state -H 'Cookie: pcc_session=...'
   ```

   Verifica que `clientes`, `movimientos`, `config` y `theme` tengan los conteos
   esperados y que un cliente del CSV conserve `ssid`/`passWifi`/`passModem`/
   `ipPrincipal`.
3. Abre la app en el navegador, entra con la contraseña y abre la ficha de un
   cliente migrado: los campos SSID / Pass WiFi / Pass Modem / IP Principal deben
   aparecer poblados.

> **Datos reales fuera de git.** `clientes-from-csv.json`, `dataset-final.json` y
> cualquier CSV con datos de clientes **no se versionan** (ver `.gitignore`); son
> archivos de trabajo locales del usuario.

---

## 4. Alcance explícito de FEAT-001
- **Sí:** línea base de pruebas (documentada), verificación de toolchain, y este ADR.
- **No:** ningún cambio en `app.js`, `index.html`, `firebase-sync.js`, `styles.css` ni
  `red-mapa.js`. Sin cambios de comportamiento en producción.

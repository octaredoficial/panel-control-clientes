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
- **Núcleo lógico:** `app.js` expone un namespace global `window.PCC` (41 funciones: modelo,
  cálculos de negocio, reparto Carlos/Octavio, recibos/folios, persistencia, siembra). El IIFE
  cae a `globalThis.PCC` cuando no hay `window`, por lo que el núcleo **es cargable bajo Node**.
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
`megas`, `monto` (number), `fechaInstalacion` (ISO), `diaPago` (1–31), `tipoPago` (`'PTP'|'Directo'`),
`estatus` (`'Activo'|'Pausado'`), `socio` (`'Carlos'|'Octavio'`), `fechaProximoPago` (ISO),
`ultimoPago` (ISO|`''`).

### 3.2 Esquema de movimiento
`id`, `tipo` (`gasto|ingreso|ahorro`), `concepto`, `monto`, `fecha` (ISO); y para pagos además
`esPago:true`, `folio`, `periodo` (`'YYYY-MM'`), `clienteId`, `prevUltimoPago`, `prevFechaProximoPago`.

### 3.3 Objeto de configuración
`diasAviso`, `moneda`, `costoAntena`, `numAntenas`, `costoLuz`, `luzPeriodicidadMeses`,
`luzMesAncla`, `nombreNegocio`, `telefonoContacto`, `direccionNegocio`, `mensajePie`.

### 3.4 Datos a migrar y campos más ricos del CSV (→ FEAT-005)
- Se migran los **clientes existentes** desde el **CSV del usuario (~29 clientes)** reconciliados
  con lo que haya en **Firestore** (export que corre el **usuario**, ya que el sandbox no alcanza
  Firestore).
- El **CSV trae campos más ricos** que el esquema actual de cliente: **SSID**, **Pass WiFi**,
  **Pass Modem** e **IP Principal** (además de Nombre, Teléfono, Dirección, Plan, Mensualidad,
  Próximo Pago, Estado, Tipo Internet, IP Cliente). Para **no perder ningún dato**, se requiere una
  **extensión del esquema de cliente** (nuevos campos `ssid`, `passWifi`, `passModem`, `ipPrincipal`)
  y de su ficha/formulario. **Esa extensión se hace en FEAT-005**, no en esta feature.

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

## 4. Alcance explícito de FEAT-001
- **Sí:** línea base de pruebas (documentada), verificación de toolchain, y este ADR.
- **No:** ningún cambio en `app.js`, `index.html`, `firebase-sync.js`, `styles.css` ni
  `red-mapa.js`. Sin cambios de comportamiento en producción.

# Panel de Control de Clientes

Aplicación web para administrar los clientes y las finanzas de un negocio de venta de internet / megas (WISP). Está hecha con **HTML + CSS + JavaScript puro (vanilla)**: no necesita bundler ni frameworks en el navegador. Es **100% autohospedada**: corre en tu propio servidor con un **backend ligero en Node.js**, una base de datos **SQLite embebida** y un **proxy Caddy** que sirve **HTTPS autofirmado**. Guarda los datos en tu servidor y los **sincroniza en vivo entre tu móvil y tu PC**: abres la app en cualquier dispositivo y ves siempre la misma información.

La interfaz tiene una paleta **minimalista** (acento índigo suave) con **modo claro y modo oscuro**, y toda la aplicación está en **español**.

## Arquitectura

Todo corre en **tu servidor** (no hay dependencias de servicios externos como Firebase o Netlify). El stack se orquesta con **Docker Compose** y son dos contenedores:

- **Frontend (estático):** `index.html`, `app.js`, `red-mapa.js`, `styles.css` y el módulo de sincronización `backend-sync.js`. Es la misma app vanilla de siempre; toda la lógica de negocio vive en `app.js`.
- **`app` (backend):** servidor **Node.js 22** con dependencias cero, que embebe **SQLite** (archivo único en un volumen de Docker), expone una **API REST + WebSocket** para los cuatro dominios de datos (`clientes`, `movimientos`, `config`, `theme`), hace de **login con contraseña única** y **sirve los archivos estáticos** del frontend. Ver [`server/README.md`](./server/README.md) para el contrato de la API.
- **`proxy` (Caddy):** termina **HTTPS autofirmado** (`tls internal`, sin dominio) y hace de reverse proxy hacia `app`. Es el único que publica puertos (80 y 443); redirige `http://` a `https://`.

```
Navegador (móvil/PC)
      │  HTTPS autofirmado  +  WebSocket (wss://) para la sync en vivo
      ▼
  Caddy (proxy)  :80 → :443
      │  red interna de Docker
      ▼
  app (Node 22 + SQLite)  ──►  volumen pcc-data (pcc.sqlite)
```

Las decisiones de arquitectura (por qué WebSocket, SQLite, Caddy, contraseña única, etc.) están en [`MIGRATION.md`](./MIGRATION.md).

## Cómo abrirla

La app se sirve desde **tu propio servidor** y se abre **en cualquier dispositivo (móvil o PC)** con los mismos datos sincronizados.

- **En producción (tu servidor Vultr):** abre

  **https://64.177.92.121**

  El navegador avisará **una sola vez** de que el certificado es **autofirmado** (es lo esperado al no tener dominio): acepta la advertencia y continúa. Funciona igual en el navegador del móvil y en el de la PC (Chrome, Edge, Firefox, Safari…). El despliegue paso a paso está en [`DEPLOY.md`](./DEPLOY.md).

- **En local para desarrollo:** levanta el stack con Docker Compose desde la carpeta del proyecto:

  ```bash
  cp .env.example .env     # pon tu APP_PASSWORD y un SESSION_SECRET aleatorio
  docker compose up -d --build
  ```

  y abre `https://localhost` (acepta el certificado autofirmado). También puedes ejecutar solo el backend con Node para desarrollo rápido (ver [`server/README.md`](./server/README.md)).

> **Inicio de sesión con contraseña única:** al abrir la aplicación aparece una pantalla que pide **una sola contraseña** (la que configures en `APP_PASSWORD`). Ya **no** hay login con Google ni acceso anónimo. Una vez dentro, en la cabecera tienes el botón **Cerrar sesión**.

> La primera vez (si el servidor está vacío) se cargan automáticamente unos **datos de ejemplo** para que puedas probar todo de inmediato (ver [Siembra y migración inicial](#siembra-y-migración-inicial)).

## Login con contraseña única

El acceso se controla con **una sola contraseña compartida**, no con cuentas de usuario:

- La contraseña se define en la variable de entorno **`APP_PASSWORD`** del backend (en tu `.env`). Elige una fuerte.
- Al enviar la contraseña, el backend la compara en **tiempo constante** y, si es correcta, emite un **token de sesión firmado** (HMAC-SHA256 con `SESSION_SECRET`) en una **cookie HttpOnly**. Todas las rutas `/api/*` y el WebSocket exigen esa cookie.
- Si la contraseña es incorrecta, se muestra un mensaje en español en la pantalla de acceso y la app no se abre.
- **Cerrar sesión** borra la sesión, cierra el WebSocket y vuelve a mostrar la pantalla de contraseña.

Las variables de entorno del backend (`APP_PASSWORD`, `SESSION_SECRET`, `DB_PATH`, `PORT`) se documentan en [`.env.example`](./.env.example) y [`server/README.md`](./server/README.md).

## Sincronización en vivo (WebSocket)

El **servidor propio** es la fuente de verdad. El `localStorage` del navegador actúa como **espejo / caché local** para que la interfaz siga siendo **instantánea** (la pantalla lee de ese espejo de forma síncrona), mientras `backend-sync.js` mantiene el espejo al día con el servidor y propaga a este cada cambio que haces.

- **Mismos datos en todos lados:** cualquier cambio (alta/edición de cliente, pagos, gastos, configuración, tema) se guarda en el backend (SQLite) y se **emite por WebSocket** a los demás dispositivos que tengan la sesión abierta, que lo aplican **en vivo sin recargar**.
- **Datos compartidos:** todo el que entre con la contraseña ve y edita **los mismos** datos (es un panel de un solo negocio).
- **Estructura de datos en el servidor** (tablas SQLite, cada registro guardado como objeto JSON completo para no perder campos):
  - Tabla **`clientes`**: un registro por cliente (el `id` del cliente es la clave).
  - Tabla **`movimientos`**: un registro por movimiento (gastos, ingresos, ahorros y pagos; el `id` del movimiento es la clave).
  - Fila **`config`**: el objeto de configuración (días de aviso, moneda, datos del negocio, etc.).
  - Fila **`theme`**: el tema, con la forma `{ valor: 'claro' | 'oscuro' }`.
- **Degradación segura:** si el backend no responde, la app no se rompe; muestra un mensaje en español y el WebSocket reintenta reconectar.

### Siembra y migración inicial

La **primera vez** que entras y el **servidor está vacío** (sin clientes ni movimientos), la app **siembra una sola vez**:

- Si ese navegador ya tenía datos en `localStorage` de una versión anterior, **sube esos** datos al backend.
- Si no hay datos locales, usa el conjunto de arranque (`construirSeed`, los **18 clientes reales de OCTARED**; ver [Datos precargados](#datos-precargados-los-18-clientes-reales-de-octared)) más la configuración y el tema por defecto.

Si el servidor **ya tiene datos**, la app **no los duplica ni los sobrescribe**: el backend es la fuente de verdad y simplemente se refleja en cada dispositivo.

Para cargar tus clientes reales (solo desde el CSV, partiendo de cero) usa las herramientas de migración descritas en [`MIGRATION.md`](./MIGRATION.md) (scripts en [`scripts/`](./scripts)).

## Despliegue en el servidor

El despliegue en tu servidor Vultr (Ubuntu, IP `64.177.92.121`) está documentado paso a paso en [`DEPLOY.md`](./DEPLOY.md): instalar Docker + Compose, clonar el repo, crear `.env` con `APP_PASSWORD` y `SESSION_SECRET`, `docker compose up -d --build`, abrir `https://64.177.92.121` y aceptar el certificado autofirmado. Incluye además cómo **no interrumpir la VPN del MikroTik** (el stack no usa `network_mode: host` y solo publica 80/443), ver logs, reiniciar y respaldar la base de datos SQLite.

## Migración de datos

Para cargar tus clientes reales al nuevo backend hay herramientas en [`scripts/`](./scripts) y el runbook completo en [`MIGRATION.md`](./MIGRATION.md). La carga es **solo desde el CSV, partiendo de cero**: la base de datos de Firestore **no** se migra (sus colecciones de clientes, reportes y transacciones se **ignoran** a propósito).

- `scripts/import-csv.mjs`: convierte tu CSV de clientes (Nombre, Telefono, Direccion, Plan, Mensualidad, Proximo Pago, Estado, Tipo Internet, IP Cliente, IP Principal, SSID, Pass WiFi, Pass Modem) a objetos cliente en `clientes-from-csv.json`.
- `scripts/merge-and-seed.mjs`: carga esos clientes en el backend (movimientos vacíos, `config` con `nombreNegocio` **"OCTARED"** y tema claro), con `--dry-run` para revisar antes.

Los valores "sucios" del CSV (por ejemplo una IP con texto extra como `192.168.6.87    STEREN:8888`) se cargan **literalmente, tal cual**, y se limpian más tarde desde la propia app.

Los archivos con datos reales (`clientes-from-csv.json`, `*.csv`) están en `.gitignore` y **no se suben al repo**.

## Verificación manual en el navegador

Como no hay navegador headless en el entorno de pruebas, esta comprobación se hace a mano (con el stack levantado y la app servida por el backend):

1. Abre **https://64.177.92.121** (o `https://localhost` en local) y acepta el certificado autofirmado.
2. **Inicia sesión** con tu contraseña única (`APP_PASSWORD`). Verifica que la pantalla de acceso desaparece y aparece la app. Prueba también una **contraseña incorrecta** y confirma que muestra el error en español sin abrir la app.
3. **Sincronización en vivo:** en un dispositivo/navegador logueado, **da de alta o edita un cliente**; en otro dispositivo/navegador (también con sesión iniciada) comprueba que el cambio **aparece solo**, sin recargar.
4. **Pagar y revertir:** registra un **pago** de un cliente y luego pulsa **↩️ Revertir**; confirma que el Resumen se recalcula y que el cambio se refleja en el otro dispositivo.
5. **Persistencia desde el servidor:** **recarga** la página y confirma que los datos siguen ahí (vienen del backend, no solo del navegador).
6. **Modo oscuro:** alterna el tema con 🌙 / ☀️ y comprueba que se recuerda y se sincroniza.
7. **Consola del navegador:** debe quedar **sin errores**.
8. **Cerrar sesión:** pulsa **Cerrar sesión** y verifica que vuelve a aparecer la pantalla de contraseña.

> El botón **Avisar** (WhatsApp) **sigue funcionando igual** que antes: abre un enlace `https://wa.me/...` con el mensaje prellenado.

### Verificación manual del Historial de pagos y Recibos

Para esta funcionalidad (ver [Historial de pagos y Recibos](#historial-de-pagos-y-recibos)), comprueba a mano en el navegador:

1. **Inicia sesión** con tu contraseña única (`APP_PASSWORD`).
2. **Registrar un pago:** pulsa **✔️ Pagar** en un cliente, elige la **mensualidad que cubre** (periodo) y ajusta el **monto**, y **Confirma**. Debe abrirse el **recibo** con su **folio** `REC-AAAA-NNNN`.
3. **Imprimir / PDF:** pulsa **🖨️ Imprimir / PDF** y confirma que en la vista previa **solo aparece el recibo** (no todo el panel); elige **"Guardar como PDF"** como destino para obtener el archivo.
4. **WhatsApp:** pulsa **💬 Enviar por WhatsApp** y verifica que se abre `https://wa.me/...` con el **resumen prellenado** (folio, periodo, concepto y monto).
5. **Historial:** abre el **📜 Historial** del cliente y comprueba el **estado de cuenta** (total pagado, último pago, próximo vencimiento, al corriente/vencido) y la **lista de pagos**; usa **🧾 Ver recibo** en una fila para **reimprimir** un recibo anterior.
6. **Sincronización:** en **otro dispositivo** logueado, confirma que el pago recién registrado aparece **con su folio y periodo**, sin recargar.

## Funcionalidades

- **Resumen mensual** con navegación por meses (botones `‹` y `›`):
  - **Ingresos**: ingresos registrados del mes más los pagos de clientes cobrados ese mes.
  - **Egresos**: gastos registrados del mes.
  - **Ganancia Neta**: ingresos menos egresos.
  - **Por cobrar (hasta fin de mes)**: suma de los montos de clientes activos cuyo pago vence hasta el fin del mes seleccionado y aún no están pagados.
- **Estadísticas**: clientes activos y pausados, y un desplegable con estadísticas del mes (al corriente, vencidos, pagos cobrados y ahorro acumulado). *Pagos cobrados este mes* cuenta únicamente los cobros registrados con el botón **Pagar** de una tarjeta de cliente; un ingreso capturado a mano con **Nuevo Ingreso** suma a *Ingresos* pero no a este contador.
- **Pagos próximos o vencidos**: lista ordenada por urgencia (lo más vencido primero), con el total de vencidos en la cabecera y un aviso configurable de "N días antes".

> **Criterio de "vencido"**: un cliente se considera vencido solo si está **Activo** y su fecha de pago ya pasó. Un cliente **Pausado** nunca cuenta como vencido (no se le cobra mientras está en pausa), y este mismo criterio se aplica de forma coherente en el chip *Vencidos*, en la estadística de vencidos y en el panel de Pagos.
>
> El **estado de pago** de los clientes (vencido / próximo / pagado), las **estadísticas** y el panel de **Pagos** se calculan siempre **a la fecha de hoy**, aunque navegues a otros meses con `‹` / `›`. La navegación de mes solo afecta a las métricas del resumen (Ingresos, Egresos, Ganancia y Por cobrar) y al detalle de movimientos. Por eso los paneles de Estadísticas y Pagos muestran la etiqueta *"a la fecha de hoy"*.
- **Clientes activos y pausados**:
  - **Búsqueda** por nombre, teléfono, dirección o IP.
  - **Filtros** (chips) con conteos: Todos, Activos, Pausados, Vencidos.
  - **Orden**: por próximo pago (predeterminado), por nombre o por monto.
  - **Exportar a CSV**: descarga el archivo `clientes.csv`.
- **Acciones por cliente** (en cada tarjeta):
  - **Avisar**: abre WhatsApp con un mensaje prellenado (nombre, monto adeudado y fecha de vencimiento).
  - **Pagar**: registra el pago del mes, marca al cliente como pagado y recalcula su próxima fecha de pago.
  - **Revertir** (↩️): deshace el último pago registrado del cliente (por si pulsaste **Pagar** por error). Solo aparece cuando el cliente tiene algún pago que se pueda deshacer. Ver [Revertir / deshacer un pago](#revertir--deshacer-un-pago).
  - **Editar**: abre el formulario del cliente con sus datos cargados.
  - **Pausar / Reanudar**: alterna el estatus del cliente.
  - **Eliminar**: pide confirmación antes de borrar.
- **Nuevo Cliente**: formulario con validación en español (**nombre, monto y día de pago** son obligatorios; el **celular es opcional**, para poder registrar clientes sin número, como varios de los 18 reales, y asignarles IP/AP desde su ficha).
- **Movimientos**: registrar **Gastos**, **Ingresos** y **Ahorros**. El panel de detalle tiene pestañas que filtran por tipo, calculan el total del mes y muestran un estado vacío adecuado.
- **Modo oscuro**: el botón 🌙 / ☀️ alterna el tema y lo recuerda al recargar.
- **Configuración**: ajusta los **días de aviso** y la **moneda**, edita los **datos del negocio (recibo)** y permite **reiniciar los datos de ejemplo**.

## Revertir / deshacer un pago

¿Pulsaste **Pagar** en el cliente equivocado o por error? Puedes deshacerlo:

1. En la tarjeta del cliente aparece el botón **↩️ Revertir** (solo se muestra si ese cliente tiene un pago registrado que se pueda deshacer).
2. Al pulsarlo se pide **confirmación**. Si aceptas, el cliente **vuelve a quedar exactamente como estaba antes del pago**: se borra el movimiento del cobro y se restauran su *último pago* y su *fecha de próximo pago* previos.
3. Como el cobro se elimina de los movimientos, el **Resumen del mes** y las **Estadísticas** (incluido *Pagos cobrados este mes*) se recalculan solos.

**Cómo funciona por dentro:** al registrar un pago, la aplicación guarda dentro del propio movimiento el estado previo del cliente (`prevUltimoPago` y `prevFechaProximoPago`). Revertir simplemente borra ese movimiento y restaura esos valores tal cual, sin tener que recalcular nada, de modo que la reversión es exacta.

> **Limitación (pagos antiguos):** los pagos registrados con **versiones anteriores** de la app no guardan ese estado previo. Si reviertes uno de esos pagos antiguos, la app hace un *fallback seguro*: limpia el último pago y **recalcula** la fecha de próximo pago. En ese caso te avisa con un mensaje y conviene revisar la fecha por si no coincide con la que tenía exactamente antes. Los pagos hechos a partir de esta versión se revierten siempre con exactitud.

## Historial de pagos y Recibos

Cada pago que registras genera un **recibo** y queda guardado en el **historial del cliente**. Así puedes consultar su estado de cuenta, reimprimir recibos y compartirlos por WhatsApp, todo desde su tarjeta y sin salir de la app.

### El historial del cliente (botón 📜)

En la tarjeta de cada cliente aparece el botón **📜 Historial**. Al pulsarlo se abre una ventana con:

- Un **estado de cuenta** con cuatro datos: **Total pagado** (suma histórica de todos sus pagos cobrados), **Último pago**, **Próximo vencimiento** y **Estado actual** (**al corriente** o **vencido**, con el mismo criterio que el resto de la app: solo un cliente **Activo** y atrasado cuenta como vencido).
- La **lista de pagos** del cliente ordenada de más reciente a más antiguo. Cada fila muestra la **fecha** del pago, el **periodo** (mensualidad) que cubre, el **monto** y el **folio** del recibo.
- Botones por fila para **🧾 Ver recibo** (reimprime o reenvía ese recibo) y **↩️ Revertir** (solo en el último pago reversible del cliente, igual que en la tarjeta).

Si el cliente aún no tiene pagos, se muestra un aviso de historial vacío.

### Registrar un pago eligiendo periodo y monto

Al pulsar **✔️ Pagar** en una tarjeta ya no se cobra de golpe: se abre el modal **Registrar pago**, donde eliges:

- **Mensualidad que cubre** (el **periodo**): un desplegable con los meses alrededor del vencimiento. Por defecto se selecciona el **mes de la fecha de próximo pago** del cliente y, si no la tuviera, el **mes en curso**.
- **Monto cobrado**: viene relleno con el monto habitual del cliente, pero puedes ajustarlo (por ejemplo, un cobro parcial o con recargo).

Al **Confirmar pago**, la app registra el movimiento, avanza la fecha de próximo pago del cliente y abre **de inmediato el recibo**.

### El recibo y su folio

El recibo se arma automáticamente con los **datos del negocio** (ver más abajo), el **cliente**, el **periodo que cubre**, el **concepto**, el **monto** y un **folio**.

El **folio** tiene el formato **`REC-AAAA-NNNN`** (por ejemplo `REC-2026-0001`): el prefijo `REC`, el **año** del pago y un **consecutivo de 4 dígitos**. El consecutivo es **por año** y se calcula en el momento de registrar el pago como **(folio máximo existente de ese mismo año) + 1**; el primer recibo de cada año empieza en `0001`.

> **Limitación conocida del folio:** como el consecutivo se calcula en el dispositivo a partir de los pagos que ya conoce, existe una **colisión teórica** si **dos dispositivos registran un pago en el mismo instante** antes de sincronizarse (podrían asignar el mismo número). Para el volumen de este negocio es **aceptable**; si ocurriera, basta con corregir el folio del pago afectado. El envío totalmente desatendido con numeración centralizada quedaría para una fase con backend.

### Imprimir o guardar el recibo en PDF

El botón **🖨️ Imprimir / PDF** usa la **impresión del propio navegador** (`window.print`). Una hoja de estilos **`@media print`** oculta el resto de la aplicación y deja **solo el recibo** en la hoja, de modo que no se imprime el panel completo.

Para obtener un **PDF**, en el diálogo de impresión elige **"Guardar como PDF"** (o "Microsoft Print to PDF") como destino. **No se usan librerías externas**: todo es el navegador más CSS de impresión.

### Enviar el recibo por WhatsApp

El botón **💬 Enviar por WhatsApp** abre un enlace **`https://wa.me/<número>?text=<resumen>`** con el resumen del recibo **prellenado**: nombre del negocio, **folio**, cliente, **periodo**, concepto, **monto** y fecha, más el mensaje de pie. Reutiliza la misma **normalización de celular** del botón Avisar (a los números de **10 dígitos** se les antepone el código de México **52**).

> El envío **totalmente automático** (sin abrir WhatsApp, mediante la **WhatsApp Business API**) queda **fuera de esta fase**: requeriría un backend o Cloud Functions y se abordará más adelante.

### Datos del negocio (en Configuración)

Los textos que salen en el recibo se editan desde el modal de **Configuración ⚙️**, bajo **"Datos del negocio (recibo)"**. Son cuatro campos, con **valores genéricos por defecto** que puedes personalizar cuando quieras:

- **`nombreNegocio`**: nombre comercial que encabeza el recibo. Por defecto **"OCTARED"**.
- **`telefonoContacto`**: teléfono de contacto del negocio (texto libre). Vacío por defecto.
- **`direccionNegocio`**: domicilio o referencia del negocio. Vacío por defecto.
- **`mensajePie`**: línea de agradecimiento al pie del recibo. Por defecto **"Gracias por su preferencia."**.

Estos datos **viajan dentro de la configuración** (`config`) y se **sincronizan** con el servidor como el resto de la app, así que aparecen igual en todos tus dispositivos.

### Cómo se guarda en el servidor

Los campos nuevos (**`folio`** y **`periodo`**) viajan **dentro del propio objeto del movimiento** en la tabla **`movimientos`**, **sin cambios de esquema** ni tablas nuevas: un pago sigue siendo un movimiento con `esPago: true`.

Los **pagos antiguos** (registrados antes de esta fase, **sin folio ni periodo**) siguen funcionando: al verlos o reimprimir su recibo se aplica un **fallback** que muestra el folio como **"sin folio"** y deriva el periodo del **mes de la fecha del pago**.

## Datos precargados: los 18 clientes reales de OCTARED

Ya **no** se cargan clientes ficticios de demostración. El conjunto de datos ahora son **exactamente los 18 clientes reales de OCTARED**, tomados de la lista del negocio (que coincide con el diagrama de red). Son estos:

*Cresencia caraos casa P4*, *VECINA YOLANDA CASA 15*, *Hermelinda*, *MICAELA HERNANDEZ CASA 54*, *casa 44 LIZBETH*, *Daniel casa 44*, *Nieto*, *Lupita casa 26 alado de nieto*, *Gabriela*, *URIEL*, *Reyes vecino*, *TIENDA INDOMABLE*, *Mercedez RH*, *Berenice*, *Jessy casa 43*, *Obed*, *VECINO DE BRANDON* y *CASA 17 CARMEN LAVANDERIA*.

El panel es **de un solo negocio (single-tenant)**: todo el dinero es de **Octavio**, sin reparto entre socios. Reglas con las que se cargan:

- **Todos quedan en estado Activo.** Ninguno arranca pausado.
- **Instalación en $0** para todos (no se cobra instalación en este alta).
- **Monto, megas y día de pago** son los reales de cada cliente (por ejemplo, *Nieto* 20 MB $600, *Reyes vecino* 30 MB $600, *Mercedez RH* 10 MB $400). El día de pago se deriva de la fecha de instalación.
- **Estado de pago realista:** los marcados como "al corriente" o "en curso" quedan con un pago reciente y su próximo vencimiento a futuro; los que "deben" quedan como **Vencido** (vencimiento ya pasado y sin pago del ciclo).

Puedes editar, pausar, borrar o completar los datos de cada cliente (incluidos los [campos de red](#campos-de-red-en-la-ficha-del-cliente)); todo queda guardado en el servidor y sincronizado entre dispositivos.

## Cómo cargar los 18 reales si tu servidor ya tenía datos de ejemplo

**Importante:** la siembra automática de los 18 reales **solo ocurre si el servidor está vacío** (ver [Siembra y migración inicial](#siembra-y-migración-inicial)). Si ya habías abierto la app antes, **tu servidor ya tiene los datos de ejemplo anteriores**, así que los 18 reales **no aparecen solos**. Para cargarlos:

1. Abre **Configuración** (botón ⚙️ en la parte superior).
2. Pulsa **Reiniciar datos de ejemplo** y confirma.

Esta acción **sobrescribe en el servidor** todos los **clientes** y **movimientos** actuales con los **18 clientes reales** (deja la lista de movimientos vacía). El reinicio escribe a través de los mismos **setters** que la app usa para crear o editar, así que **se propaga al backend** y el cambio se refleja en todos los dispositivos con la sesión abierta.

> **Advertencia:** reiniciar **borra los datos previos** (los clientes y movimientos de ejemplo que hubiera) y los reemplaza por los 18 reales. Hazlo solo cuando quieras partir de ese conjunto limpio.

## Campos de red en la ficha del cliente

Para poder **identificar poco a poco** a cada cliente dentro de la red, la ficha del cliente (el formulario de **Nuevo / Editar cliente**) incluye estos campos de red:

- **IP:** es el **mismo campo IP** que ya existía; se reutiliza como la IP del cliente dentro de la red (por ejemplo `192.168.10.38`). Un cliente **con IP** se considera **identificado**; **sin IP** queda como **pendiente** en el mapa.
- **Tipo de conexión:** un desplegable con **AP** (cliente colgando de un AP PtMP), **PtP** (enlace punto a punto dedicado), **Modem** (modem de cable) y **"sin asignar"** (vacío, falta identificar).
- **AP / enlace:** un desplegable para elegir el **nodo padre** del cliente dentro de la topología: **AP_OCTARED_3**, **LiteAP AC-1 (CALOSWiFi)**, **LiteAP AC-2 (CARLOSWiFi)**, **PtP MERCEDES RH** o **PtP CASA 44**.

Estos tres datos **viajan dentro del propio objeto del cliente** (en la tabla **`clientes`**) y se **sincronizan con el servidor** como el resto de sus campos, **sin cambios de esquema** ni tablas nuevas. Los clientes antiguos que no tuvieran estos campos siguen funcionando: se tratan como "falta identificar" hasta que les asignes IP, tipo de conexión y AP.

> La ficha del cliente también incluye los **campos de red extendidos** de la migración —**SSID**, **Pass WiFi**, **Pass Modem** e **IP Principal**— para no perder ningún dato del CSV (ver [`MIGRATION.md`](./MIGRATION.md)).

## Mapa de red

La app incluye una vista **Mapa de red** que replica, de forma visual y **dinámica**, la estructura de la red de OCTARED. Se abre con el botón **🗺️ Red** del encabezado; es una vista **opcional (opt-in)**: al pulsarlo se alterna entre los paneles normales y el mapa, sin romper el resto de la app.

### Diseño: listas apiladas verticales

El mapa usa un diseño de **listas apiladas** (de arriba a abajo), no columnas sueltas. Cada AP o enlace es una **tarjeta ancha** con una **cabecera de color** (nombre + SSID + MHz + IP) y, **dentro de la misma tarjeta**, sus antenas o clientes como **filas**: cada fila muestra un **punto de estado** (verde = identificado, naranja = pendiente, azul = infraestructura), el **nombre a la izquierda** y la **IP alineada a la derecha** (por ejemplo `.111`, con la IP completa en el tooltip).

### Qué muestra (de arriba a abajo)

- **Leyenda** de colores (identificado, falta identificar, AP/infraestructura, etc.).
- **Core:** el router **MikroTik hEX S** (`192.168.10.1`), centrado arriba, en color **ámbar**.
- **APs Multipunto (PtMP) y sus antenas**, en **azul**. Cada AP lista **todas** sus antenas como filas (infraestructura y clientes juntos):
  - **AP OCTARED3** (`192.168.10.26`, SSID **OCTARED3**, 5105 MHz) con sus **6 antenas**: Lupita casa 26 `.111`, CASA 30 `.100`, LB-LINDA_S `.37`, NIETO `.38`, LiteBeam 5AC `.49`, Tienda Indomable `.129`.
  - **LiteAP AC-1** (`192.168.10.20`, SSID **CALOSWiFi**, 5230 MHz) con **3**: Jessy casa 43 `.40`, Reyes vecino `.34`, Octarednuevaultima `.72`.
  - **LiteAP AC-2** (`192.168.10.21`, SSID **CARLOSWiFi**, 5135 MHz) con **2**: Berenice `.31`, CASA 54 `.134`.
- **Enlaces Punto a Punto (PtP)**, en **teal**, cada punta con su cliente dedicado como fila:
  - **PtP MERCEDES RH** (punta `192.168.10.25`) -> Mercedez RH `.36`.
  - **PtP CASA 44** (punta `192.168.10.15`) -> casa 44 LIZBETH `.145`.
- **Clientes directos por cable (modem)** (`.19`, `.22`, `.24`, `.101`), que abren en `http://IP:8090`.
- **Pendientes / Falta identificar** (en **naranja**): nodos de infraestructura pendientes (`.61` TP-LINK, `.18`) y los clientes que aún no tienen IP.
- **En tu lista de cobro, SIN IP aún:** lista informativa con los nombres de los clientes sin IP.

### Conexiones: microondas (inalámbrico) vs cable

Las conexiones se dibujan **al final, por detrás de las tarjetas**, con un **SVG en línea** (sin librerías externas), para no estorbar la lectura:

- **Enlaces inalámbricos (simulan microondas):** Core -> cada AP, Core -> cada punta PtP y cada AP/punta -> sus antenas o cliente. Se dibujan con **línea punteada animada** (efecto de "ondas" en movimiento), **azul** para los AP y **teal** para los PtP.
- **Conexiones por cable:** Core -> cada **modem** directo, con **línea sólida continua** (simula el cable físico), en color verde/identificado.

Las líneas se **recalculan** al cambiar el tamaño de la ventana y cada vez que se redibuja el mapa (incluidos los datos que llegan del servidor por WebSocket). La animación de ondas se desactiva si el sistema pide **movimiento reducido** (`prefers-reduced-motion`).

### Antenas fijas de infraestructura + clientes reales (sin duplicar)

Cada AP/enlace trae en la **topología** una lista de **antenas fijas** (nombre + IP). Al dibujar, el mapa **fusiona** esas antenas fijas con los **clientes reales** clasificados bajo ese AP, **deduplicando por IP**: si una antena fija coincide con un cliente real (misma IP), la fila se marca como **identificada** y toma el nombre del cliente; si no, se muestra como fila de **infraestructura**. Así aparecen también los nodos que no son clientes de cobro (CASA 30, LB-LINDA_S, LiteBeam 5AC, Octarednuevaultima, CASA 54) sin repetir a los clientes reales.

### Es dinámico y se cruza con los clientes reales

El mapa **no es una imagen fija**: sus nodos de cliente se **derivan de los 18 clientes reales** cargados en la app. La clasificación es:

- Cliente **con IP** (y su AP/enlace asignado): aparece como nodo **identificado** (**verde**) colgando de su AP o enlace.
- Cliente **sin IP**: aparece en la zona de **pendientes** (**naranja**) como "falta identificar".

Como se nutre de los datos sincronizados, el mapa se **actualiza solo** cuando cambian los clientes (incluyendo los cambios que llegan desde el servidor en otro dispositivo). En el conjunto actual quedan **8 clientes identificados** (los que ya traen IP) y **10 pendientes**.

### Buscador y colores

- **Buscador:** el campo de búsqueda del mapa filtra por **nombre o IP**; resalta los nodos que coinciden y atenúa el resto. Al vaciarlo se restaura todo.
- **Semántica de colores:** **core = ámbar**, **AP = azul**, **PtP = teal**, **identificado = verde**, **pendiente = naranja**. La vista **respeta el modo oscuro** y es **responsive**: en **PC** las tarjetas de AP se muestran en **fila/grilla** y en **móvil** se **apilan a una columna**, con las filas internas legibles y la IP a la derecha sin romperse. Las líneas SVG se recalculan para ambos tamaños.

### Abrir un nodo

Cada nodo con IP **abre su dirección en una pestaña nueva**. Ten en cuenta que las IPs `192.168.10.x` son **direcciones privadas** de la red de OCTARED: **solo abren si estás dentro de esa red o conectado por VPN**. Los **modems de cable** se abren en **`http://IP:8090`** y el resto de equipos en **`https://IP`**.

> Los nodos de infraestructura del diagrama que **no** son clientes de cobro (como CASA 30, LB-LINDA_S, LiteBeam 5AC, Octarednuevaultima o CASA 54) **sí** se muestran ahora como una **fila fija** dentro de su AP (definidos en la topología). Los clientes de cobro siguen derivándose de la lista real del backend y se fusionan con esas antenas fijas por IP para no duplicarlos.

### Verificación manual del Mapa de red

Como no hay navegador headless en el entorno de pruebas, esta comprobación se hace a mano:

1. **Inicia sesión** con tu contraseña única (`APP_PASSWORD`).
2. **Carga los 18 reales:** abre **Configuración ⚙️** y pulsa **Reiniciar datos de ejemplo** (necesario si tu servidor ya tenía datos; ver [Cómo cargar los 18 reales](#cómo-cargar-los-18-reales-si-tu-servidor-ya-tenía-datos-de-ejemplo)).
3. **Abre la vista Red** con el botón **🗺️ Red** (pruébala en **PC** y en **móvil**) y comprueba: que **AP OCTARED3** lista sus **6 antenas**; qué clientes salen **identificados** (en verde) y cuáles **pendientes** (en naranja); y que las líneas **Core -> AP** son **punteadas** (microondas) mientras que **Core -> modem** son **sólidas** (cable).
4. **Busca por nombre o IP** en el buscador del mapa y verifica que el nodo coincidente se **resalta** y el resto se atenúa.
5. **Asigna una IP y un AP** a un cliente pendiente desde su ficha (Editar cliente -> IP, Tipo de conexión y AP/enlace) y guarda; al volver al mapa, ese cliente debe pasar de "falta identificar" a **identificado** bajo el AP indicado.
6. **Sincronización:** en **otro dispositivo** con la sesión abierta, confirma que ese cliente aparece también como identificado, sin recargar.

## Persistencia (servidor propio + espejo local)

La **fuente de verdad** es el **backend propio** (SQLite en tu servidor). El **`localStorage`** del navegador actúa como **espejo / caché local** para que la interfaz siga siendo **instantánea**: la pantalla lee de ese espejo de forma síncrona, mientras `backend-sync.js` mantiene el espejo al día con los datos remotos y propaga al servidor cada cambio que haces.

- En el servidor, los datos se guardan en las tablas **`clientes`** y **`movimientos`** y en las filas **`config`** y **`theme`** (ver [Sincronización en vivo (WebSocket)](#sincronización-en-vivo-websocket)).
- En el navegador, el espejo local vive bajo claves con prefijo `pcc.` (`pcc.clientes`, `pcc.movimientos`, `pcc.config`, `pcc.theme`). La configuración (`pcc.config`) incluye los **días de aviso**, la **moneda** y los **datos del negocio** del recibo (`nombreNegocio`, `telefonoContacto`, `direccionNegocio`, `mensajePie`), que se añaden con sus valores por defecto a cualquier configuración antigua que no los tuviera.

Esto implica que:

- Los datos **se comparten entre dispositivos y navegadores**: al iniciar sesión ves siempre la misma información y los cambios se sincronizan **en vivo** por WebSocket.
- Los datos **permanecen** aunque cierres y vuelvas a abrir la página, porque viven en el servidor (no dependen de un solo navegador).
- Si borras el almacenamiento local del sitio, no pierdes nada: al volver a iniciar sesión los datos se **vuelven a traer del servidor**.

## Nota sobre WhatsApp

El botón **Avisar** abre un enlace de WhatsApp (`https://wa.me/...`) con el mensaje prellenado. El número de celular se normaliza a solo dígitos y, si tiene 10 dígitos, se le antepone el código de país de México (**52**).

Esta acción abre el sitio de WhatsApp en una pestaña nueva (necesitas WhatsApp Web o la app disponible). La app en sí se sirve desde tu servidor; para que el enlace de WhatsApp abra en el navegador necesitas **conexión a internet** hacia WhatsApp.

## Qué se probó

- **Pruebas automatizadas del backend:** `node --test` dentro de `server/` cubre login (contraseña incorrecta → 401, correcta → cookie de sesión), que las rutas `/api/*` y el WebSocket exigen sesión, el ida y vuelta `PUT`→`GET` por SQLite (preservando campos ricos del cliente y de pago) y la difusión por WebSocket entre dos clientes.
- **Pruebas automatizadas de la migración:** `node --test` dentro de `scripts/` cubre el parseo de CSV (comillas y comas embebidas), el parseo de fechas, los mapeos de Estado y Tipo Internet, el mapeo de las 13 columnas del CSV (incluyendo SSID / Pass WiFi / Pass Modem / IP Principal) y la **carga literal** de los valores "sucios" del CSV (por ejemplo una IP con texto extra se preserva tal cual).
- **Smoke del núcleo frontend:** `node -e "require('./app.js')"` carga el núcleo vía `globalThis.PCC` (41 claves) sin errores; `node --check app.js` y `node --check red-mapa.js` pasan sin errores de sintaxis. `red-mapa.js` **se autoprotege cuando no hay `document`** (la lógica de DOM no se ejecuta fuera del navegador, solo se expone su función pura de clasificación).
- Carga del núcleo con un `localStorage` simulado: se siembran **18 clientes reales**; `formatoMoneda(500)` devuelve `$500.00` y `formatoFechaLarga("2026-09-29")` devuelve `29 de septiembre de 2026`.
- **Dataset de los 18 reales:** el SEED tiene **exactamente 18 clientes**, **todos Activos**; los clientes sin dato de red arrancan con **campos de red vacíos** (sin IP, tipo de conexión ni AP).
- **Mapeos concretos de red:** se verifica que los clientes con IP quedan bajo su AP/enlace correcto (por ejemplo *Nieto* `.38`, *Lupita casa 26* `.111` y *TIENDA INDOMABLE* `.129` en AP_OCTARED_3; *Reyes vecino* `.34` y *Jessy casa 43* `.40` en LiteAP AC-1; *Berenice* `.31` en LiteAP AC-2; *Mercedez RH* `.36` en PtP MERCEDES RH; *casa 44 LIZBETH* `.145` en PtP CASA 44).
- **Clasificación del mapa** (`window.PCC_RED.clasificarClientes`): sobre el SEED de 18 produce **8 identificados** (los que traen IP, repartidos bajo su AP/enlace) y **10 pendientes**; un cliente con IP y `apId` conocido cae como identificado, y uno sin IP o con `apId` desconocido cae en pendientes.
- **Fusión de antenas fijas y clientes** (`window.PCC_RED.fusionarAntenas`): AP OCTARED3 lista sus **6 antenas fijas** de la topología; sin clientes reales todas son filas de infraestructura; con un cliente real cuya IP coincide con una antena (`.111`) la fila pasa a **identificada** y toma el nombre del cliente **sin duplicar**, y un cliente con IP nueva se agrega como fila extra identificada.
- Clasificación de estados correcta sobre los datos de ejemplo (vencidos, próximos y pagados).
- Coherencia del criterio de "vencido": un cliente **Pausado** y atrasado **no** cuenta como vencido en ningún conteo, mientras que uno **Activo** y atrasado sí.
- Flujo de **Pagar**: tras registrar el pago, la fecha de próximo pago avanza al siguiente ciclo (mes siguiente respetando el día de pago).
- `crearCliente` normaliza y autocalcula la fecha de próximo pago para un cliente nuevo.
- **Revertir pago** (`construirMovimientoPago` / `revertirPago`): al pagar, el movimiento guarda el estado previo del cliente (`prevUltimoPago` y `prevFechaProximoPago`); al revertir, se elimina el movimiento del cobro y se restauran **exactamente** esos valores. Para un pago antiguo **sin** esos datos se verifica el *fallback*: limpia el último pago y recalcula la fecha de próximo pago. Un `id` inexistente o un movimiento que no es un pago no modifican nada.
- **Folio consecutivo por año** (`generarFolio`): calcula `REC-AAAA-NNNN` tomando el máximo consecutivo del **mismo año** y sumando 1 (el primero del año empieza en `0001`); ignora folios de otros años y pagos sin folio.
- **Periodo por defecto** (`periodoPorDefecto`): devuelve el `YYYY-MM` del **próximo pago** del cliente y, si no lo tiene, el **mes de referencia**; `construirMovimientoPago` respeta el periodo y el monto indicados y, cuando recibe la lista de movimientos, asigna un folio consecutivo (p. ej. `REC-2026-0008`), dando prioridad a un folio explícito.
- **Formato de periodo** (`formatoPeriodo`): convierte `YYYY-MM` a texto en español (p. ej. *febrero 2026*) y devuelve `''` ante entradas vacías o inválidas.
- **Datos del recibo** (`datosRecibo`): arma el recibo con el nombre del negocio por defecto y el monto formateado; para **pagos viejos sin folio/periodo** aplica el *fallback* (folio **"sin folio"** y periodo derivado de la **fecha del pago**).
- **Texto de WhatsApp del recibo** (`textoWhatsAppRecibo`): el resumen incluye el **folio**, el **monto formateado** y el **nombre del negocio**.
- **Migración de los datos del negocio**: una `pcc.config` antigua migra añadiendo `nombreNegocio` (**"OCTARED"**), `telefonoContacto`, `direccionNegocio` y `mensajePie` (**"Gracias por su preferencia."**) con sus valores por defecto.
- La capa de interfaz se inicializa y ejecuta el render completo sin lanzar errores (verificado con un DOM simulado).
- Revisión funcional recomendada en el navegador: crear / editar / pausar / eliminar clientes, buscar, filtrar por cada chip, ordenar, exportar CSV, cambiar de mes, abrir cada modal, registrar gastos / ingresos / ahorros, **pagar un cliente y luego pulsar ↩️ Revertir para confirmar que vuelve a su estado anterior** (y que el Resumen se recalcula), **registrar un pago eligiendo periodo y monto, ver / imprimir el recibo y abrir el 📜 Historial** (ver [Verificación manual del Historial de pagos y Recibos](#verificación-manual-del-historial-de-pagos-y-recibos)), alternar el modo oscuro y recargar para confirmar la persistencia; la consola debe quedar sin errores.

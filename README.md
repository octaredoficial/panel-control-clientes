# Panel de Control de Clientes

Aplicación web para administrar los clientes y las finanzas de un negocio de venta de internet / megas. Está hecha con **HTML + CSS + JavaScript puro (vanilla)**: no necesita bundler, ni instalación de dependencias, ni frameworks. Ahora usa **Firebase (Cloud Firestore + Authentication)** para guardar los datos **en la nube** y **sincronizarlos entre tu móvil y tu PC**: puedes abrirla en cualquier dispositivo y ver siempre la misma información.

La interfaz tiene una paleta **minimalista** (acento índigo suave) con **modo claro y modo oscuro**, y toda la aplicación está en **español**.

## Cómo abrirla

La app está pensada para abrirse **en cualquier dispositivo (móvil o PC)** con los mismos datos sincronizados. Para ello se publica como sitio estático en **Netlify** y guarda los datos en **Firebase**.

- **En línea (recomendado):** abre el sitio desplegado en Netlify:

  **https://ornate-melba-f303fc.netlify.app**

  Funciona igual en el navegador del móvil y en el de la PC (Chrome, Edge, Firefox, Safari…).

- **En local para desarrollo:** sírvela con un **servidor http** sencillo y ábrela en `http://localhost`. Por ejemplo, desde la carpeta del proyecto:

  ```
  python3 -m http.server 8080
  ```

  y luego abre `http://localhost:8080`.

> **Importante: ya NO funciona con doble clic (`file://`).** Como ahora carga los SDK de Firebase mediante **módulos ES** desde el CDN de gstatic, el navegador los bloquea bajo el protocolo `file://` (por CORS y por las reglas de los módulos). Debes abrirla por **http/https** (Netlify o un servidor local) y **tener conexión a internet**.

> **Inicio de sesión:** al abrir la aplicación aparece una pantalla que pide **iniciar sesión**. Puedes entrar con **Google** o como **invitado** (acceso anónimo). Una vez dentro, en la cabecera tienes el botón **Cerrar sesión**.

> La primera vez (si la nube está vacía) se cargan automáticamente unos **datos de ejemplo** para que puedas probar todo de inmediato (ver [Siembra y migración inicial](#siembra-y-migración-inicial)).

## Sincronización en la nube con Firebase

La aplicación guarda y sincroniza los datos con **Cloud Firestore** del proyecto Firebase `panel-clientes-12a4a`, y controla el acceso con **Firebase Authentication**.

- **Mismos datos en todos lados:** cualquier cambio (alta/edición de cliente, pagos, gastos, configuración, tema) se escribe en Firestore y aparece **en vivo** en los demás dispositivos que tengan la sesión abierta.
- **Datos COMPARTIDOS entre todos los autenticados:** por ahora, todo el que inicie sesión (con Google o como invitado) ve y edita **los mismos** datos. Esto es **intencional y temporal** para arrancar y probar; **todavía no** se restringe por correo. Más adelante se puede endurecer (ver `firestore.rules`).
- **Estructura de datos en Firestore** (compartida, no por usuario):
  - Colección **`clientes`**: un documento por cliente (el `id` del cliente es el id del documento).
  - Colección **`movimientos`**: un documento por movimiento (gastos, ingresos, ahorros y pagos; el `id` del movimiento es el id del documento).
  - Documento **`config/app`**: el objeto de configuración (días de aviso, moneda, gastos fijos, etc.).
  - Documento **`config/theme`**: el tema, con la forma `{ valor: 'claro' | 'oscuro' }`.
- **SDK:** se usa el SDK modular de Firebase **v10.12.5** cargado por el CDN de gstatic (`firebase-app`, `firebase-auth`, `firebase-firestore`) desde `firebase-sync.js`.
- **Degradación segura:** si el SDK no carga o falla el inicio de sesión, la app no se rompe; muestra un mensaje en español en la pantalla de inicio de sesión.

### Siembra y migración inicial

La **primera vez** que alguien entra y **Firestore está vacío** (sin clientes ni movimientos), la app **siembra la nube una sola vez**:

- Si ese navegador ya tenía datos en `localStorage` de la versión anterior (solo local), **sube esos** datos a Firestore.
- Si no hay datos locales, usa los **datos de ejemplo** (`construirSeed`, los ~24 clientes de demostración) más la configuración y el tema por defecto.

Si Firestore **ya tiene datos**, la app **no los duplica ni los sobrescribe**: la nube es la fuente de verdad y simplemente se refleja en cada dispositivo.

## Pasos en Firebase (consola)

Estos pasos se hacen una sola vez en la [consola de Firebase](https://console.firebase.google.com/) sobre el proyecto `panel-clientes-12a4a`:

1. **Authentication → Sign-in method:** habilitar **Google** y **Anónimo** (ya hechos). Son los dos métodos que usa la pantalla de inicio de sesión.
2. **Authentication → Settings → Authorized domains:** añadir los dominios desde los que se abrirá la app para que el inicio de sesión funcione:
   - `ornate-melba-f303fc.netlify.app` (el sitio en Netlify)
   - `localhost` (para pruebas locales con un servidor http)
3. **Firestore Database:** crear la base de datos si aún no existe. Luego, en la pestaña **Rules**, pegar el contenido del archivo **`firestore.rules`** de este repositorio y pulsar **Publicar**. Esas reglas permiten leer y escribir solo a usuarios autenticados.

> **Sobre las claves:** las claves Web que aparecen en `firebaseConfig` (dentro de `firebase-sync.js`) son **públicas por diseño**; no son secretas. La seguridad real la dan las **reglas de Firestore** más **Authentication**, no el ocultar esas claves.

## Pasos en Netlify

El sitio se publica como estático, **sin build**, tal como define `netlify.toml`:

1. En [Netlify](https://app.netlify.com/) conectar el repositorio de GitHub **`octaredoficial/panel-control-clientes`** (o, como alternativa rápida, **arrastrar la carpeta** del proyecto a Netlify).
2. Configuración de despliegue:
   - **Build command:** vacío (ninguno).
   - **Publish directory:** `.` (la raíz del repositorio), tal como indica `netlify.toml`.
3. Tras el despliegue, el sitio queda disponible en **https://ornate-melba-f303fc.netlify.app**.
4. **Recordatorio:** ese dominio (`ornate-melba-f303fc.netlify.app`) debe estar en **Authorized domains** de Firebase (paso anterior) para que el inicio de sesión funcione.

## Verificación manual en el navegador

Como no hay navegador headless en el entorno de pruebas, esta comprobación se hace a mano:

1. Abre el sitio de Netlify (**https://ornate-melba-f303fc.netlify.app**) o sírvelo en local con un servidor http y usa `http://localhost`.
2. **Inicia sesión con Google** y, en otra prueba, entra también **como invitado** (anónimo). Verifica que la pantalla de inicio de sesión desaparece y aparece la app.
3. **Sincronización en vivo:** en un dispositivo/navegador logueado, **da de alta o edita un cliente**; en otro dispositivo/navegador (también con sesión iniciada) comprueba que el cambio **aparece solo**, sin recargar.
4. **Pagar y revertir:** registra un **pago** de un cliente y luego pulsa **↩️ Revertir**; confirma que el Resumen y el Reparto se recalculan y que el cambio se refleja en el otro dispositivo.
5. **Persistencia desde la nube:** **recarga** la página y confirma que los datos siguen ahí (vienen de Firestore, no solo del navegador).
6. **Modo oscuro:** alterna el tema con 🌙 / ☀️ y comprueba que se recuerda y se sincroniza.
7. **Consola del navegador:** debe quedar **sin errores**.
8. **Cerrar sesión:** pulsa **Cerrar sesión** y verifica que vuelve a aparecer la pantalla de inicio de sesión.

> El botón **Avisar** (WhatsApp) **sigue funcionando igual** que antes: abre un enlace `https://wa.me/...` con el mensaje prellenado.

## Funcionalidades

- **Resumen mensual** con navegación por meses (botones `‹` y `›`):
  - **Ingresos**: ingresos registrados del mes más los pagos de clientes cobrados ese mes.
  - **Egresos**: gastos registrados del mes.
  - **Ganancia Neta**: ingresos menos egresos.
  - **Por cobrar (hasta fin de mes)**: suma de los montos de clientes activos cuyo pago vence hasta el fin del mes seleccionado y aún no están pagados.
- **Reparto de fin de mes** (panel justo debajo del Resumen): calcula cómo se divide la ganancia del mes entre los dos socios, **Carlos** y **Octavio**. Comparte la navegación de mes del Resumen (usa el mes seleccionado con `‹` / `›`) y se recalcula al cambiar de mes o al registrar un pago o un gasto. Ver [Reparto de fin de mes entre socios](#reparto-de-fin-de-mes-entre-socios).
- **Estadísticas**: clientes activos y pausados, y un desplegable con estadísticas del mes (al corriente, vencidos, pagos cobrados, PTP, Directo y ahorro acumulado). *Pagos cobrados este mes* cuenta únicamente los cobros registrados con el botón **Pagar** de una tarjeta de cliente; un ingreso capturado a mano con **Nuevo Ingreso** suma a *Ingresos* pero no a este contador.
- **Pagos próximos o vencidos**: lista ordenada por urgencia (lo más vencido primero), con el total de vencidos en la cabecera y un aviso configurable de "N días antes".

> **Criterio de "vencido"**: un cliente se considera vencido solo si está **Activo** y su fecha de pago ya pasó. Un cliente **Pausado** nunca cuenta como vencido (no se le cobra mientras está en pausa), y este mismo criterio se aplica de forma coherente en el chip *Vencidos*, en la estadística de vencidos y en el panel de Pagos.
>
> El **estado de pago** de los clientes (vencido / próximo / pagado), las **estadísticas** y el panel de **Pagos** se calculan siempre **a la fecha de hoy**, aunque navegues a otros meses con `‹` / `›`. La navegación de mes solo afecta a las métricas del resumen (Ingresos, Egresos, Ganancia y Por cobrar) y al detalle de movimientos. Por eso los paneles de Estadísticas y Pagos muestran la etiqueta *"a la fecha de hoy"*.
- **Clientes activos y pausados**:
  - **Búsqueda** por nombre, teléfono, dirección o IP.
  - **Filtros** (chips) con conteos: Todos, Activos, Pausados, Vencidos, PTP, Directo.
  - **Orden**: por próximo pago (predeterminado), por nombre o por monto.
  - **Exportar a CSV**: descarga el archivo `clientes.csv`.
- **Acciones por cliente** (en cada tarjeta):
  - **Avisar**: abre WhatsApp con un mensaje prellenado (nombre, monto adeudado y fecha de vencimiento).
  - **Pagar**: registra el pago del mes, marca al cliente como pagado y recalcula su próxima fecha de pago.
  - **Revertir** (↩️): deshace el último pago registrado del cliente (por si pulsaste **Pagar** por error). Solo aparece cuando el cliente tiene algún pago que se pueda deshacer. Ver [Revertir / deshacer un pago](#revertir--deshacer-un-pago).
  - **Editar**: abre el formulario del cliente con sus datos cargados.
  - **Pausar / Reanudar**: alterna el estatus del cliente.
  - **Eliminar**: pide confirmación antes de borrar.
- **Nuevo Cliente**: formulario con validación en español (nombre, celular, monto y día de pago son obligatorios). Incluye el campo **Pagado a** (ver [el campo "socio"](#el-campo-socio-pagado-a)).
- **Movimientos**: registrar **Gastos**, **Ingresos** y **Ahorros**. El panel de detalle tiene pestañas que filtran por tipo, calculan el total del mes y muestran un estado vacío adecuado.
- **Modo oscuro**: el botón 🌙 / ☀️ alterna el tema y lo recuerda al recargar.
- **Configuración**: ajusta los **días de aviso**, la **moneda** y los **gastos fijos del negocio** (ver [Gastos fijos configurables](#gastos-fijos-configurables)), y permite **reiniciar los datos de ejemplo**.

## Revertir / deshacer un pago

¿Pulsaste **Pagar** en el cliente equivocado o por error? Puedes deshacerlo:

1. En la tarjeta del cliente aparece el botón **↩️ Revertir** (solo se muestra si ese cliente tiene un pago registrado que se pueda deshacer).
2. Al pulsarlo se pide **confirmación**. Si aceptas, el cliente **vuelve a quedar exactamente como estaba antes del pago**: se borra el movimiento del cobro y se restauran su *último pago* y su *fecha de próximo pago* previos.
3. Como el cobro se elimina de los movimientos, el **Resumen del mes**, las **Estadísticas** (incluido *Pagos cobrados este mes*) y el **Reparto de fin de mes** se recalculan solos.

**Cómo funciona por dentro:** al registrar un pago, la aplicación guarda dentro del propio movimiento el estado previo del cliente (`prevUltimoPago` y `prevFechaProximoPago`). Revertir simplemente borra ese movimiento y restaura esos valores tal cual, sin tener que recalcular nada, de modo que la reversión es exacta.

> **Limitación (pagos antiguos):** los pagos registrados con **versiones anteriores** de la app no guardan ese estado previo. Si reviertes uno de esos pagos antiguos, la app hace un *fallback seguro*: limpia el último pago y **recalcula** la fecha de próximo pago. En ese caso te avisa con un mensaje y conviene revisar la fecha por si no coincide con la que tenía exactamente antes. Los pagos hechos a partir de esta versión se revierten siempre con exactitud.

## Reparto de fin de mes entre socios

El negocio es de dos socios, **Carlos** y **Octavio**, que reparten la ganancia al cierre de cada mes. El panel **Reparto de fin de mes** aplica la fórmula que acordaron.

### El campo "socio" (Pagado a)

Cada cliente tiene un campo **"Pagado a"** (socio) que indica a quién le paga directamente: **Carlos** (valor por defecto) u **Octavio**. En la práctica casi todos los clientes pagan a Carlos; solo hay un cliente que le paga directamente a Octavio y esa mensualidad es 100% suya.

- Al crear un cliente nuevo, el campo arranca en **Carlos**.
- Los clientes antiguos guardados antes de esta versión (datos "v1" sin el campo) **migran automáticamente a "Carlos"** al cargarse. Cualquier valor inválido también cae en "Carlos".
- La tarjeta de cada cliente muestra de forma discreta **"Paga a: Carlos"** o **"Paga a: Octavio"**.

### Gastos fijos configurables

Los gastos fijos del negocio se descuentan del total **antes** de repartir, es decir, los **absorben los dos socios al 50/50**. Son configurables desde el modal de **Configuración**, bajo *Gastos fijos del negocio*:

- **Starlink**: `Número de antenas × Costo por antena`. Por defecto **2 antenas × $1,305 = $2,610 fijo todos los meses**.
- **Luz**: **$300** que se paga **cada dos meses** (periodicidad configurable), empezando en el **mes ancla** (por defecto **noviembre de 2025**).

**Patrón exacto de la luz** (con los valores por defecto): la luz aplica cuando el número de meses transcurridos desde el mes ancla es múltiplo de la periodicidad. Con ancla `2025-11` y periodicidad `2`:

| Mes | ¿Paga luz? |
| --- | --- |
| noviembre 2025 | **Sí** ($300) |
| diciembre 2025 | No ($0) |
| enero 2026 | **Sí** ($300) |
| febrero 2026 | No ($0) |
| marzo 2026 | **Sí** ($300) |
| … | … |

Es decir: noviembre, enero, marzo, mayo, julio y septiembre pagan luz; los meses intermedios no.

### Fórmula del reparto

Para el mes seleccionado, el reparto se calcula paso a paso:

```
Ingresos del mes (pagos cobrados)
  − Starlink (antenas)
  − Luz (solo los meses que aplica)
  − Pagos directos a Octavio
  = Ganancia a repartir
  ÷ 2  → mitad para cada socio

Total Carlos  = su mitad
Total Octavio = su mitad + sus pagos directos
```

- **Carlos** recibe su mitad de la ganancia a repartir.
- **Octavio** recibe su mitad **más** los pagos directos de los clientes marcados como suyos (ese dinero se aparta del reparto 50/50 y va completo a Octavio).

> **Importante — qué cuenta como "Ingresos del mes" en el reparto:** se basa en los **pagos cobrados de clientes**, es decir, los movimientos registrados con el botón **Pagar** de una tarjeta (`esPago = true`) cuya fecha cae en el mes seleccionado. Esto es coherente con la métrica *Pagos cobrados este mes* de las Estadísticas. Un **ingreso capturado a mano** con **Nuevo Ingreso** suma a la métrica *Ingresos* del Resumen, pero **no** entra en el reparto. Además, un pago solo se atribuye a Octavio si el movimiento quedó asociado a un cliente marcado "Octavio"; el botón **Pagar** guarda esa asociación automáticamente.

## Datos de ejemplo precargados

La primera vez se cargan **24 clientes de ejemplo** basados en una tabla de referencia (nombres como *Cresencia*, *VECINA YOLANDA*, *Hermelinda*, *MICAELA HERNANDEZ*, *Lupita casa 26*, *Reyes vecino*, *TIENDA INDOMABLE*, etc.), con mezcla de tipos de pago **PTP** y **Directo**, al menos un cliente **Pausado** y varios en estado **Vencido**, además de algunos **pagados** y **próximos**. El monto predeterminado es de **$500.00**. Las direcciones e IP son genéricas de ejemplo.

Estos datos sirven solo para demostrar la aplicación. Puedes editarlos, borrarlos o agregar los tuyos; todo queda guardado en tu navegador.

## Cómo reiniciar los datos

Si quieres volver al conjunto de datos de ejemplo original:

1. Abre **Configuración** (botón ⚙️ en la parte superior).
2. Pulsa **Reiniciar datos de ejemplo** y confirma.

Esto reemplaza todos los clientes y movimientos actuales por los datos de ejemplo.

## Persistencia (Firestore + espejo local)

Ahora la **fuente de verdad** es **Cloud Firestore** (en la nube). El **`localStorage`** del navegador actúa como **espejo / caché local** para que la interfaz siga siendo **instantánea**: la pantalla lee de ese espejo de forma síncrona, mientras `firebase-sync.js` mantiene el espejo al día con los datos remotos y propaga a la nube cada cambio que haces.

- En la nube, los datos se guardan en las colecciones **`clientes`** y **`movimientos`** y en los documentos **`config/app`** y **`config/theme`** (ver [Sincronización en la nube con Firebase](#sincronización-en-la-nube-con-firebase)).
- En el navegador, el espejo local vive bajo claves con prefijo `pcc.` (`pcc.clientes`, `pcc.movimientos`, `pcc.config`, `pcc.theme`). La configuración (`pcc.config`) incluye los gastos fijos del negocio (`costoAntena`, `numAntenas`, `costoLuz`, `luzPeriodicidadMeses`, `luzMesAncla`), que se añaden con sus valores por defecto a cualquier configuración antigua que no los tuviera.

Esto implica que:

- Los datos **se comparten entre dispositivos y navegadores**: al iniciar sesión ves siempre la misma información y los cambios se sincronizan **en vivo**.
- Los datos **permanecen** aunque cierres y vuelvas a abrir la página, porque viven en la nube (no dependen de un solo navegador).
- Si borras el almacenamiento local del sitio, no pierdes nada: al volver a iniciar sesión los datos se **vuelven a traer desde Firestore**.

## Nota sobre WhatsApp

El botón **Avisar** abre un enlace de WhatsApp (`https://wa.me/...`) con el mensaje prellenado. El número de celular se normaliza a solo dígitos y, si tiene 10 dígitos, se le antepone el código de país de México (**52**).

Esta acción abre el sitio de WhatsApp en una pestaña nueva (necesitas WhatsApp Web o la app disponible). Como ahora la aplicación sincroniza en la nube con Firebase, **requiere conexión a internet** para funcionar en general.

## Qué se probó

- `node --check app.js` pasa sin errores de sintaxis.
- Carga del núcleo con un `localStorage` simulado: se siembran **24 clientes** de ejemplo; `formatoMoneda(500)` devuelve `$500.00` y `formatoFechaLarga("2026-09-29")` devuelve `29 de septiembre de 2026`.
- Clasificación de estados correcta sobre los datos de ejemplo (vencidos, próximos y pagados).
- Coherencia del criterio de "vencido": un cliente **Pausado** y atrasado **no** cuenta como vencido en ningún conteo, mientras que uno **Activo** y atrasado sí (verificado en el arnés de pruebas).
- Flujo de **Pagar**: tras registrar el pago, la fecha de próximo pago avanza al siguiente ciclo (mes siguiente respetando el día de pago).
- `crearCliente` normaliza y autocalcula la fecha de próximo pago para un cliente nuevo.
- **Campo socio**: `crearCliente` asigna **Carlos** por defecto, respeta **Octavio** cuando se indica y normaliza cualquier valor inválido a Carlos; el conjunto de datos de ejemplo tiene **exactamente un** cliente marcado "Octavio" (monto $500) y el resto en Carlos.
- **Migración de configuración**: una `pcc.config` antigua `{diasAviso, moneda}` migra añadiendo los gastos fijos con sus defaults (`costoAntena: 1305`, `numAntenas: 2`, `costoLuz: 300`, `luzPeriodicidadMeses: 2`, `luzMesAncla: "2025-11"`).
- **Patrón de la luz** (`luzAplicaEnMes`): aplica en noviembre 2025 y enero 2026, y no aplica en diciembre 2025 ni febrero 2026.
- **Gastos fijos del mes** (`gastosFijosDelMes`): total **$2,910** en noviembre (Starlink $2,610 + luz $300) y **$2,610** en diciembre (sin luz).
- **Reparto** (`calcularReparto`): sobre un escenario con pagos de clientes de ambos socios, se verifica que *Ingresos del mes* cuenta solo los pagos `esPago` del mes (ignora los ingresos manuales y los pagos de otros meses), que `gananciaRepartir = ingresos − gastos fijos − pagos de Octavio`, que la mitad de cada socio es correcta y que *Total Carlos* es su mitad mientras que *Total Octavio* es su mitad más sus pagos directos; un pago sin cliente asociado no se atribuye a Octavio.
- **Revertir pago** (`construirMovimientoPago` / `revertirPago`): al pagar, el movimiento guarda el estado previo del cliente (`prevUltimoPago` y `prevFechaProximoPago`); al revertir, se elimina el movimiento del cobro y se restauran **exactamente** esos valores. Para un pago antiguo **sin** esos datos se verifica el *fallback*: limpia el último pago y recalcula la fecha de próximo pago. Un `id` inexistente o un movimiento que no es un pago no modifican nada.
- La capa de interfaz se inicializa y ejecuta el render completo sin lanzar errores (verificado con un DOM simulado).
- Revisión funcional recomendada en el navegador: crear / editar / pausar / eliminar clientes, buscar, filtrar por cada chip, ordenar, exportar CSV, cambiar de mes, abrir cada modal, registrar gastos / ingresos / ahorros, **pagar un cliente y luego pulsar ↩️ Revertir para confirmar que vuelve a su estado anterior** (y que el Resumen y el Reparto se recalculan), alternar el modo oscuro y recargar para confirmar la persistencia; la consola debe quedar sin errores.

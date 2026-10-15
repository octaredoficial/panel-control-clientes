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
- Si no hay datos locales, usa el conjunto de arranque (`construirSeed`, los **18 clientes reales de OCTARED**; ver [Datos precargados](#datos-precargados-los-18-clientes-reales-de-octared)) más la configuración y el tema por defecto.

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

### Verificación manual del Historial de pagos y Recibos

Para esta funcionalidad (ver [Historial de pagos y Recibos](#historial-de-pagos-y-recibos)), comprueba a mano en el navegador:

1. **Inicia sesión** (con Google o como invitado).
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
- **Nuevo Cliente**: formulario con validación en español (**nombre, monto y día de pago** son obligatorios; el **celular es opcional**, para poder registrar clientes sin número, como varios de los 18 reales, y asignarles IP/AP desde su ficha). Incluye el campo **Pagado a** (ver [el campo "socio"](#el-campo-socio-pagado-a)).
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

## Historial de pagos y Recibos

Cada pago que registras genera un **recibo** y queda guardado en el **historial del cliente**. Así puedes consultar su estado de cuenta, reimprimir recibos y compartirlos por WhatsApp, todo desde su tarjeta y sin salir de la app.

### El historial del cliente (botón 📜)

En la tarjeta de cada cliente aparece el botón **📜 Historial**. Al pulsarlo se abre una ventana con:

- Un **estado de cuenta** con cuatro datos: **Total pagado** (suma histórica de todos sus pagos cobrados), **Último pago**, **Próximo vencimiento** y **Estado actual** (**al corriente** o **vencido**, con el mismo criterio que el resto de la app: solo un cliente **Activo** y atrasado cuenta como vencido).
- La **lista de pagos** del cliente ordenada de más reciente a más antiguo. Cada fila muestra la **fecha** del pago, el **periodo** (mensualidad) que cubre, el **monto**, el **socio** al que pagó y el **folio** del recibo.
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

- **`nombreNegocio`**: nombre comercial que encabeza el recibo. Por defecto **"Mi WISP"**.
- **`telefonoContacto`**: teléfono de contacto del negocio (texto libre). Vacío por defecto.
- **`direccionNegocio`**: domicilio o referencia del negocio. Vacío por defecto.
- **`mensajePie`**: línea de agradecimiento al pie del recibo. Por defecto **"Gracias por su preferencia."**.

Estos datos **viajan dentro de la configuración** (`config/app`) y se **sincronizan** en la nube como el resto de la app, así que aparecen igual en todos tus dispositivos.

### Cómo se guarda en Firebase

Los campos nuevos (**`folio`** y **`periodo`**) viajan **dentro del propio objeto del movimiento** en la colección **`movimientos`**, **sin cambios de esquema** ni colecciones nuevas: un pago sigue siendo un movimiento con `esPago: true`.

Los **pagos antiguos** (registrados antes de esta fase, **sin folio ni periodo**) siguen funcionando: al verlos o reimprimir su recibo se aplica un **fallback** que muestra el folio como **"sin folio"** y deriva el periodo del **mes de la fecha del pago**.

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

## Datos precargados: los 18 clientes reales de OCTARED

Ya **no** se cargan clientes ficticios de demostración. El conjunto de datos ahora son **exactamente los 18 clientes reales de OCTARED**, tomados de la lista del negocio (que coincide con el diagrama de red). Son estos:

*Cresencia caraos casa P4*, *VECINA YOLANDA CASA 15*, *Hermelinda*, *MICAELA HERNANDEZ CASA 54*, *casa 44 LIZBETH*, *Daniel casa 44*, *Nieto*, *Lupita casa 26 alado de nieto*, *Gabriela*, *URIEL*, *Reyes vecino*, *TIENDA INDOMABLE*, *Mercedez RH*, *Berenice*, *Jessy casa 43*, *Obed*, *VECINO DE BRANDON* y *CASA 17 CARMEN LAVANDERIA*.

Reglas con las que se cargan:

- **Todos quedan en estado Activo.** Ninguno arranca pausado.
- **El único que paga directamente a Octavio es `casa 44 LIZBETH`** (socio **Octavio**); el resto paga a **Carlos**. Esto es lo que usa el [Reparto de fin de mes](#reparto-de-fin-de-mes-entre-socios).
- **Instalación en $0** para todos (no se cobra instalación en este alta).
- **Monto, megas y día de pago** son los reales de cada cliente (por ejemplo, *Nieto* 20 MB $600, *Reyes vecino* 30 MB $600, *Mercedez RH* 10 MB $400). El día de pago se deriva de la fecha de instalación.
- **Estado de pago realista:** los marcados como "al corriente" o "en curso" quedan con un pago reciente y su próximo vencimiento a futuro; los que "deben" quedan como **Vencido** (vencimiento ya pasado y sin pago del ciclo).

> **Decisión sobre `tipoPago` (financiero PTP/Directo):** como la lista real no trae este dato, los 18 clientes se cargan con `tipoPago = "Directo"` por defecto. Este campo es solo una **etiqueta financiera informativa** (y alimenta los chips y estadísticas de PTP/Directo); **no altera el reparto entre socios**, que depende únicamente del campo **socio** (Carlos / Octavio). Puedes cambiar el `tipoPago` de cada cliente cuando quieras desde su ficha sin que eso afecte las cuentas del reparto.

Puedes editar, pausar, borrar o completar los datos de cada cliente (incluidos los [campos de red](#campos-de-red-en-la-ficha-del-cliente)); todo queda guardado en la nube y sincronizado entre dispositivos.

## Cómo cargar los 18 reales si tu nube ya tenía datos de ejemplo

**Importante:** la siembra automática de los 18 reales **solo ocurre si Firestore está vacío** (ver [Siembra y migración inicial](#siembra-y-migración-inicial)). Si ya habías abierto la app antes, **tu nube ya tiene los datos de ejemplo anteriores**, así que los 18 reales **no aparecen solos**. Para cargarlos:

1. Abre **Configuración** (botón ⚙️ en la parte superior).
2. Pulsa **Reiniciar datos de ejemplo** y confirma.

Esta acción **sobrescribe en la nube** todos los **clientes** y **movimientos** actuales con los **18 clientes reales** (deja la lista de movimientos vacía). El reinicio escribe a través de los mismos **setters** que la app usa para crear o editar, así que **se propaga a Firestore** y el cambio se refleja en todos los dispositivos con la sesión abierta.

> **Advertencia:** reiniciar **borra los datos previos** (los clientes y movimientos de ejemplo que hubiera) y los reemplaza por los 18 reales. Hazlo solo cuando quieras partir de ese conjunto limpio.

## Campos de red en la ficha del cliente

Para poder **identificar poco a poco** a cada cliente dentro de la red, la ficha del cliente (el formulario de **Nuevo / Editar cliente**) incluye estos campos de red:

- **IP:** es el **mismo campo IP** que ya existía; se reutiliza como la IP del cliente dentro de la red (por ejemplo `192.168.10.38`). Un cliente **con IP** se considera **identificado**; **sin IP** queda como **pendiente** en el mapa.
- **Tipo de conexión:** un desplegable con **AP** (cliente colgando de un AP PtMP), **PtP** (enlace punto a punto dedicado), **Modem** (modem de cable) y **"sin asignar"** (vacío, falta identificar).
- **AP / enlace:** un desplegable para elegir el **nodo padre** del cliente dentro de la topología: **AP_OCTARED_3**, **LiteAP AC-1 (CALOSWiFi)**, **LiteAP AC-2 (CARLOSWiFi)**, **PtP MERCEDES RH** o **PtP CASA 44**.

Estos tres datos **viajan dentro del propio objeto del cliente** (en la colección **`clientes`**) y se **sincronizan a Firestore** como el resto de sus campos, **sin cambios de esquema** ni colecciones nuevas. Los clientes antiguos que no tuvieran estos campos siguen funcionando: se tratan como "falta identificar" hasta que les asignes IP, tipo de conexión y AP.

## Mapa de red

La app incluye una vista **Mapa de red** que replica, de forma visual y **dinámica**, la estructura de la red de OCTARED. Se abre con el botón **🗺️ Red** del encabezado; es una vista **opcional (opt-in)**: al pulsarlo se alterna entre los paneles normales y el mapa, sin romper el resto de la app.

### Qué muestra

- **Core:** el router **MikroTik hEX S** (`192.168.10.1`), arriba del todo, en color **ámbar**.
- **Los 3 APs PtMP**, en **azul**, cada uno con sus clientes colgando:
  - **AP_OCTARED_3** (`192.168.10.26`, SSID **OCTARED3**).
  - **LiteAP AC-1** (`192.168.10.20`, SSID **CALOSWiFi**).
  - **LiteAP AC-2** (`192.168.10.21`, SSID **CARLOSWiFi**).
- **Los 2 enlaces PtP** (punto a punto), en **teal**, como punta -> cliente dedicado:
  - **PtP MERCEDES RH** (punta `192.168.10.25`).
  - **PtP CASA 44** (punta `192.168.10.15`).
- **Modems de cable** directos (`.19`, `.22`, `.24`, `.101`).
- **Zona "Falta identificar / sin IP"** (en **naranja**) con los clientes que aún no tienen IP más los nodos pendientes por reconocer (`.61` TP-LINK y `.18`).

Los conectores entre nodos (core -> AP, core -> punta PtP y padre -> cliente) se dibujan con **SVG en línea** (curvas), sin librerías externas, y se **recalculan al cambiar el tamaño** de la ventana.

### Es dinámico y se cruza con los clientes reales

El mapa **no es una imagen fija**: sus nodos de cliente se **derivan de los 18 clientes reales** cargados en la app. La clasificación es:

- Cliente **con IP** (y su AP/enlace asignado): aparece como nodo **identificado** (**verde**) colgando de su AP o enlace.
- Cliente **sin IP**: aparece en la zona de **pendientes** (**naranja**) como "falta identificar".

Como se nutre de los datos sincronizados, el mapa se **actualiza solo** cuando cambian los clientes (incluyendo los cambios que llegan desde Firebase en otro dispositivo). En el conjunto actual quedan **8 clientes identificados** (los que ya traen IP) y **10 pendientes**.

### Buscador y colores

- **Buscador:** el campo de búsqueda del mapa filtra por **nombre o IP**; resalta los nodos que coinciden y atenúa el resto. Al vaciarlo se restaura todo.
- **Semántica de colores:** **core = ámbar**, **AP = azul**, **PtP = teal**, **identificado = verde**, **pendiente = naranja**. La vista **respeta el modo oscuro** y es responsive (en pantallas estrechas el lienzo se puede desplazar en horizontal sin romper el diseño).

### Abrir un nodo

Cada nodo con IP **abre su dirección en una pestaña nueva**. Ten en cuenta que las IPs `192.168.10.x` son **direcciones privadas** de la red de OCTARED: **solo abren si estás dentro de esa red o conectado por VPN**. Los **modems de cable** se abren en **`http://IP:8090`** y el resto de equipos en **`https://IP`**.

> Los nodos de infraestructura del diagrama que **no** son clientes de cobro (como CASA 30, LB-LINDA_S, LiteBeam 5AC, Octarednuevaultima o CASA 54) **no** se dibujan en el mapa, porque este deriva sus nodos de cliente de la lista de los 18. Podrán representarse más adelante si se agregan como clientes o como infraestructura de la topología.

### Verificación manual del Mapa de red

Como no hay navegador headless en el entorno de pruebas, esta comprobación se hace a mano:

1. **Inicia sesión** (con Google o como invitado).
2. **Carga los 18 reales:** abre **Configuración ⚙️** y pulsa **Reiniciar datos de ejemplo** (necesario si tu nube ya tenía datos; ver [Cómo cargar los 18 reales](#cómo-cargar-los-18-reales-si-tu-nube-ya-tenía-datos-de-ejemplo)).
3. **Abre la vista Red** con el botón **🗺️ Red** y comprueba qué clientes salen **identificados** (bajo su AP/enlace, en verde) y cuáles están **pendientes** (en naranja).
4. **Busca por nombre o IP** en el buscador del mapa y verifica que el nodo coincidente se **resalta** y el resto se atenúa.
5. **Asigna una IP y un AP** a un cliente pendiente desde su ficha (Editar cliente -> IP, Tipo de conexión y AP/enlace) y guarda; al volver al mapa, ese cliente debe pasar de "falta identificar" a **identificado** bajo el AP indicado.
6. **Sincronización:** en **otro dispositivo** con la sesión abierta, confirma que ese cliente aparece también como identificado, sin recargar.

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

- El arnés de pruebas completa **132 comprobaciones con 0 fallos** (antes eran 96; las nuevas cubren los 18 clientes reales, los campos de red y la clasificación del mapa).
- `node --check app.js` y `node --check red-mapa.js` pasan sin errores de sintaxis. `red-mapa.js` **se autoprotege cuando no hay `document`** (la lógica de DOM no se ejecuta en el arnés, solo se expone su función pura de clasificación).
- Carga del núcleo con un `localStorage` simulado: se siembran **18 clientes reales**; `formatoMoneda(500)` devuelve `$500.00` y `formatoFechaLarga("2026-09-29")` devuelve `29 de septiembre de 2026`.
- **Dataset de los 18 reales:** el SEED tiene **exactamente 18 clientes**, **todos Activos**, con **exactamente un** socio **Octavio** que es **`casa 44 LIZBETH`** (el resto, Carlos); los clientes sin dato de red arrancan con **campos de red vacíos** (sin IP, tipo de conexión ni AP) y `tipoPago` por defecto en **"Directo"**.
- **Mapeos concretos de red:** se verifica que los clientes con IP quedan bajo su AP/enlace correcto (por ejemplo *Nieto* `.38`, *Lupita casa 26* `.111` y *TIENDA INDOMABLE* `.129` en AP_OCTARED_3; *Reyes vecino* `.34` y *Jessy casa 43* `.40` en LiteAP AC-1; *Berenice* `.31` en LiteAP AC-2; *Mercedez RH* `.36` en PtP MERCEDES RH; *casa 44 LIZBETH* `.145` en PtP CASA 44).
- **Clasificación del mapa** (`window.PCC_RED.clasificarClientes`): sobre el SEED de 18 produce **8 identificados** (los que traen IP, repartidos bajo su AP/enlace) y **10 pendientes**; un cliente con IP y `apId` conocido cae como identificado, y uno sin IP o con `apId` desconocido cae en pendientes.
- Clasificación de estados correcta sobre los datos de ejemplo (vencidos, próximos y pagados).
- Coherencia del criterio de "vencido": un cliente **Pausado** y atrasado **no** cuenta como vencido en ningún conteo, mientras que uno **Activo** y atrasado sí (verificado en el arnés de pruebas).
- Flujo de **Pagar**: tras registrar el pago, la fecha de próximo pago avanza al siguiente ciclo (mes siguiente respetando el día de pago).
- `crearCliente` normaliza y autocalcula la fecha de próximo pago para un cliente nuevo.
- **Campo socio**: `crearCliente` asigna **Carlos** por defecto, respeta **Octavio** cuando se indica y normaliza cualquier valor inválido a Carlos; el conjunto de los 18 reales tiene **exactamente un** cliente marcado "Octavio" (**`casa 44 LIZBETH`**) y el resto en Carlos.
- **Migración de configuración**: una `pcc.config` antigua `{diasAviso, moneda}` migra añadiendo los gastos fijos con sus defaults (`costoAntena: 1305`, `numAntenas: 2`, `costoLuz: 300`, `luzPeriodicidadMeses: 2`, `luzMesAncla: "2025-11"`).
- **Patrón de la luz** (`luzAplicaEnMes`): aplica en noviembre 2025 y enero 2026, y no aplica en diciembre 2025 ni febrero 2026.
- **Gastos fijos del mes** (`gastosFijosDelMes`): total **$2,910** en noviembre (Starlink $2,610 + luz $300) y **$2,610** en diciembre (sin luz).
- **Reparto** (`calcularReparto`): sobre un escenario con pagos de clientes de ambos socios, se verifica que *Ingresos del mes* cuenta solo los pagos `esPago` del mes (ignora los ingresos manuales y los pagos de otros meses), que `gananciaRepartir = ingresos − gastos fijos − pagos de Octavio`, que la mitad de cada socio es correcta y que *Total Carlos* es su mitad mientras que *Total Octavio* es su mitad más sus pagos directos; un pago sin cliente asociado no se atribuye a Octavio.
- **Revertir pago** (`construirMovimientoPago` / `revertirPago`): al pagar, el movimiento guarda el estado previo del cliente (`prevUltimoPago` y `prevFechaProximoPago`); al revertir, se elimina el movimiento del cobro y se restauran **exactamente** esos valores. Para un pago antiguo **sin** esos datos se verifica el *fallback*: limpia el último pago y recalcula la fecha de próximo pago. Un `id` inexistente o un movimiento que no es un pago no modifican nada.
- **Folio consecutivo por año** (`generarFolio`): calcula `REC-AAAA-NNNN` tomando el máximo consecutivo del **mismo año** y sumando 1 (el primero del año empieza en `0001`); ignora folios de otros años y pagos sin folio.
- **Periodo por defecto** (`periodoPorDefecto`): devuelve el `YYYY-MM` del **próximo pago** del cliente y, si no lo tiene, el **mes de referencia**; `construirMovimientoPago` respeta el periodo y el monto indicados y, cuando recibe la lista de movimientos, asigna un folio consecutivo (p. ej. `REC-2026-0008`), dando prioridad a un folio explícito.
- **Formato de periodo** (`formatoPeriodo`): convierte `YYYY-MM` a texto en español (p. ej. *febrero 2026*) y devuelve `''` ante entradas vacías o inválidas.
- **Datos del recibo** (`datosRecibo`): arma el recibo con el nombre del negocio por defecto y el monto formateado; para **pagos viejos sin folio/periodo** aplica el *fallback* (folio **"sin folio"** y periodo derivado de la **fecha del pago**).
- **Texto de WhatsApp del recibo** (`textoWhatsAppRecibo`): el resumen incluye el **folio**, el **monto formateado** y el **nombre del negocio**.
- **Migración de los datos del negocio**: una `pcc.config` antigua migra añadiendo `nombreNegocio` (**"Mi WISP"**), `telefonoContacto`, `direccionNegocio` y `mensajePie` (**"Gracias por su preferencia."**) con sus valores por defecto.
- La capa de interfaz se inicializa y ejecuta el render completo sin lanzar errores (verificado con un DOM simulado).
- Revisión funcional recomendada en el navegador: crear / editar / pausar / eliminar clientes, buscar, filtrar por cada chip, ordenar, exportar CSV, cambiar de mes, abrir cada modal, registrar gastos / ingresos / ahorros, **pagar un cliente y luego pulsar ↩️ Revertir para confirmar que vuelve a su estado anterior** (y que el Resumen y el Reparto se recalculan), **registrar un pago eligiendo periodo y monto, ver / imprimir el recibo y abrir el 📜 Historial** (ver [Verificación manual del Historial de pagos y Recibos](#verificación-manual-del-historial-de-pagos-y-recibos)), alternar el modo oscuro y recargar para confirmar la persistencia; la consola debe quedar sin errores.

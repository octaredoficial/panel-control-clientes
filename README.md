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

## Reparto del mes: previsto y cobrado

La app muestra **dos** vistas del reparto entre socios (Carlos y Octavio). Ambas usan la **misma fórmula**; lo único que cambia es el punto de partida:

### Reparto previsto del mes (visible desde el inicio)

Es el panel **que se ve a simple vista** y el que Octavio le muestra a su socio: **cuánto le toca a cada uno sobre la facturación total del mes**, es decir, **lo que entra si TODOS los clientes activos pagan su cuota**, aunque todavía no se haya cobrado (porque *"aunque el socio no cobre, me tiene que dar mi parte"*). Va etiquetado como **"previsto · si todos pagan este mes"** para no confundirlo con el reparto real.

La fórmula (idéntica a la del reparto real, pero sobre la **facturación** en vez de lo cobrado):

```
Facturación total del mes   (suma de cuotas de clientes ACTIVOS; hoy = $9,400)
  − Gastos fijos            (Starlink = numAntenas × costoAntena, p.ej. 2×1305 = 2610 + Luz si aplica el mes)
  = Ganancia prevista a repartir   (los pagos directos de Octavio NO se restan aquí)
  ÷ 2 = Mitad por socio
Total Carlos (previsto)  = su mitad
Total Octavio (previsto) = su mitad − sus pagos directos  (una sola vez, ya los cobra directo)
```

Los **pagos directos a Octavio** (suma de cuotas de los clientes Activos con socio 'Octavio'; hoy = $500) **NO** bajan la ganancia común: se descuentan **una sola vez, al final, solo del total de Octavio**.

Ejemplo con los datos actuales en un mes **sin luz**: `9400 − 2610 = 6790`; mitad `3395`; **Carlos 3395** y **Octavio 2895** (`3395 − 500`). Comprobación estilo Excel: `3395 + 2895 = 6290`, más los `500` que Octavio ya cobró directo = `6790`, que cuadra con la ganancia. En un mes **con luz** (la luz es bimestral), los gastos suben a `2910`, la ganancia baja a `6490`, mitad `3245`; **Carlos 3245** y **Octavio 2745**.

Notas importantes:

- La **facturación** y los **pagos directos de Octavio** se calculan con el **padrón ACTUAL** de clientes activos (las cuotas son fijas, no dependen del mes). Los clientes **Pausados no cuentan** (no se les cobra).
- Lo único que depende del **mes seleccionado** con la navegación **‹ ›** son los **gastos fijos**, porque la **luz es bimestral**. El subtítulo del panel (`#previsto-mes`) cambia con la navegación de mes.
- La lógica vive en la función pura `PCC.calcularRepartoPrevisto(fecha, clientes, cfg)`, que **reutiliza** `facturacionTotalMensual` y `gastosFijosDelMes` **sin cambiar la fórmula** del reparto.

### Reparto de fin de mes (cobrado, colapsado por defecto)

El panel **"Reparto de fin de mes" ("según pagos cobrados")** ahora está **plegado por defecto** (un acordeón nativo `<details>`: solo se ve su título y se despliega al tocarlo). Es **informativo / de control interno**: se basa en los **pagos ya cobrados** (botón **Pagar** de las tarjetas) con fecha en el mes seleccionado, no en la facturación. Sus valores (`#reparto-ingresos`, `#reparto-mes`, totales, etc.) **se siguen calculando y actualizando** aunque el acordeón esté cerrado; solo quedan ocultos a la vista hasta que se abre.

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

### Pulido final estilo iOS (fuente del sistema, large title y animaciones)

Como toque final la interfaz usa detalles al estilo de iOS, todos con CSS y **sin recursos remotos** (cero Google Fonts, cero CDNs de tipografía):

- **Fuente del sistema de Apple:** el texto usa la pila de fuentes del sistema (`-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif`). En iPhone/Mac se ve con **San Francisco**; en otras plataformas cae a la fuente de sistema correspondiente. No se descarga ninguna fuente.
- **Large title en el encabezado:** el título *Panel de Control de Clientes* se muestra como un **large title** grande, de peso fuerte y *tracking* ajustado, más prominente aún en móvil. **Decisión de diseño:** el large title es **estático** (no se encoge al hacer scroll). El efecto dinámico exigiría JavaScript que no se puede validar sin navegador en el entorno de pruebas (el render no es verificable aquí), así que se priorizó una jerarquía limpia y robusta que siempre degrada bien. Queda documentado también en un comentario de `styles.css`.
- **Transiciones y feedback táctil:** botones, chips, tarjetas y la barra inferior tienen transiciones suaves y discretas (≈180 ms) y un leve **`press`** al pulsar (`transform: scale(0.98)` en `:active`).
- **Reducir movimiento:** si el usuario activa *reducir movimiento* en su sistema, un bloque `@media (prefers-reduced-motion: reduce)` **anula** animaciones y transiciones y neutraliza el `press`, para una experiencia estática y accesible.

Verificación a mano: el texto se ve con la fuente del sistema, el título del encabezado destaca, al pulsar un botón hay un leve encogido, y con *reducir movimiento* activado nada se anima. El bloque de impresión del recibo (`@media print`) **no cambia**.

### Pulido visual estilo iOS (resumen de todos los cambios)

Como fase de **pulido visual**, la interfaz se afinó para sentirse como una app de iPhone, **todo con CSS/HTML y JS mínimo** (cero recursos remotos, cero frameworks). Estos son los cambios y las decisiones de diseño:

- **Header limpio en móvil:** en el teléfono el encabezado ya **no amontona** la maraña de botones. Las acciones del header se **ocultan en móvil** y se mueven a la **barra de navegación inferior** (`#nav-*`) y a la **hoja "Más"** (bottom sheet). Así arriba queda solo el título y una vista despejada. **Decisión desktop vs móvil:** en **escritorio se conservan** las acciones en el header (hay espacio de sobra), mientras que en **móvil se ocultan** y se accede a ellas por la barra inferior y la hoja "Más". Importante: los botones del header **siguen en el DOM con sus `id` y listeners** aunque estén ocultos en móvil, porque la barra inferior los reutiliza (hace `click()` sobre ellos); no se eliminaron, solo se ocultan visualmente.
- **Iconos SVG de línea en vez de emojis:** las acciones que antes se mostraban con **emojis** ahora usan **iconos SVG de línea** (trazo fino, `fill="none"` + `stroke="currentColor"`, así heredan el color del tema y se ven bien en **claro y oscuro**). Esto aplica a las acciones de tarjeta y del header: **Pagar** (antes ✔️), **Avisar** (antes 💬), **Historial** (antes 📜), **Red** (antes 🗺️), **Historial de meses** (antes 📊), **Configuración** (antes ⚙️), **tema claro/oscuro** (antes 🌙/☀️), etc. Cada icono conserva su **`aria-label`/`title`** para no perder accesibilidad, y el botón de tema **sigue alternando** su icono según el modo.
- **Tarjetas sutiles:** las tarjetas de cliente se suavizaron al estilo iOS (bordes y sombras más discretos, más aire interno, jerarquía tipográfica clara) sin cambiar la información que muestran.
- **Menú "•••" en las tarjetas:** las acciones secundarias de cada tarjeta (por ejemplo **editar / pausar / eliminar**) se agrupan detrás de un menú de **tres puntos (•••)** para no saturar la tarjeta; las acciones principales (Pagar, Avisar, Historial) siguen visibles.
- **Large title + animaciones + fuente del sistema:** el encabezado usa un **large title** prominente, hay **transiciones suaves** y un leve **`press`** al tocar (`scale(0.98)` en `:active`), y el texto usa la **fuente del sistema** de Apple (San Francisco en iPhone/Mac). Todo respeta **`prefers-reduced-motion`** (ver [Pulido final estilo iOS](#pulido-final-estilo-ios-fuente-del-sistema-large-title-y-animaciones)).

> **Donde este README describe acciones con emojis** (por ejemplo **✔️ Pagar**, **💬 Avisar**, **📜 Historial**, **🗺️ Red**, **📊 Historial**, **⚙️ Configuración** o **🌙/☀️** del tema), ten en cuenta que en la interfaz actual esos emojis se muestran como **iconos SVG de línea**. Los emojis se conservan en el texto solo como **referencia visual rápida** de a qué acción corresponde cada icono.

### Refinamientos visuales iOS (segunda ronda)

Una segunda ronda de **pulido puramente visual** (sin tocar la lógica, conservando claro/oscuro y todas las variables CSS) afinó estos detalles:

- **Acento lateral sutil en las tarjetas:** la barra lateral de color que marcaba el estado (roja para vencidos, etc.) era **gruesa** y competía con el borde de la tarjeta ("doble borde", se veía muy "web"). Ahora es un **borde izquierdo más delgado y atenuado** (con `color-mix` sobre la superficie) más una **tinta de fondo apenas perceptible** del color de estado. Se mantiene la semántica (**rojo = vencido, ámbar = próximo, verde = pagado, neutro = al corriente**) pero en versión suave y en **ambos temas**.
- **Badge de estado más pequeño y discreto:** la pastilla de estado de la tarjeta (**"Vencido hace N días"**, **"Vence…"**, **"Pagado (mes)"**) se **achicó** (menos fuente, padding y peso) para que el **nombre del cliente** sea el protagonista. Conserva los colores semánticos pero más sobrios (fondo tenue + texto del color).
- **Jerarquía en el reparto:** en **"Reparto de fin de mes"** las filas intermedias (Ingresos del mes, − Starlink, − Luz) quedan **más tenues/secundarias** (los montos de resta en rojo atenuado), y **"Ganancia a repartir"**, **"Mitad por socio"** y sobre todo **"Total Carlos" / "Total Octavio"** **dominan** (mayor tamaño/peso). El descuento de los **pagos directos a Octavio** se muestra junto a su total (no como una fila que baje la ganancia común). **No cambian los valores ni el cálculo**, solo el peso/tamaño/color.
- **Mes como subtítulo:** en **Resumen** y **Reparto**, el mes ya **no va entre paréntesis** en la misma línea (**"Reparto de fin de mes ( Octubre de 2026 )"**); ahora el **título principal** va en una línea y el **mes queda como subtítulo** debajo, más limpio y sin cortes raros en móvil. El mes lo sigue inyectando el JS por sus `id` (`#resumen-mes`, `#reparto-mes`) y la **navegación de meses ‹ ›** no cambia.
- **Separadores tenues:** las líneas **punteadas** entre filas (en el reparto, estadísticas del mes y el pie "Asignar cliente" del mapa) se cambiaron por **líneas sólidas muy tenues** (borde con `color-mix` a baja opacidad). El **recibo** conserva a propósito sus líneas punteadas (estética de **ticket**) y su `@media print` **no cambia**.
- **Más aire entre tarjetas:** se aumentó un poco el **espacio entre tarjetas** de cliente/pagos para que **respiren**, estilo iOS.

### Nota sobre el badge "Powered by Netlify"

En el plan gratuito, **Netlify inyecta un badge flotante "Powered by Netlify"** en una esquina del sitio desplegado. Ese badge **NO está en el código de este repositorio** (no hay ningún elemento nuestro que lo pinte), así que:

- Se **intenta ocultar por CSS** con reglas **defensivas y específicas** en `styles.css` (reforzadas en esta ronda): apuntan a los **id/clase típicos** del badge (`#netlify-badge`, `.netlify-badge`, y variantes `[id*="netlify" i]` / `[class*="netlify" i]`), a los **anchors/iframes fijos** que enlazan a `netlify.com`/`netlify.app` (incluyendo `aria-label`/`title`/`name` con "netlify"), y al **contenedor fijo** (`div[style*="position: fixed"]`) que envuelve ese enlace (vía `:has()`). Se usaron selectores específicos **a propósito**, para **no ocultar contenido propio** (nada de un `* { display:none }` amplio).
- **Límite realista:** si Netlify inyecta el badge **dentro de un `iframe` de otro origen**, el CSS de este sitio **no puede ocultar su interior**; solo podría ocultarse el `iframe` entero **si es identificable por un atributo** (title/name/src con "netlify"). Si no lo es, **no hay forma por CSS**.
- **Si el badge persiste** pese a esas reglas (porque Netlify puede cambiar su marcado o servirlo desde otro origen), se quita desde la **configuración de Netlify** o **cambiando de plan**, ya que **no vive en el repositorio** y no podemos garantizar ocultarlo solo con CSS.
- `netlify.toml` **no se tocó**: la publicación del sitio sigue igual (sitio estático, sin build, publicando la raíz).

### Verificación manual del pulido visual (para Octavio, en el iPhone)

Como no hay navegador en el entorno de pruebas, esto se comprueba **a mano en el iPhone** (abre el sitio de Netlify, **https://ornate-melba-f303fc.netlify.app**, e inicia sesión):

1. **Header limpio:** arriba debe verse **despejado**, sin la **maraña de botones** de antes; solo el título y una vista limpia.
2. **Navegación por la barra inferior:** usa la **barra inferior** (Inicio / Red / Historial / Acciones) y abre la **hoja "Más"**; confirma que desde ahí llegas a Nuevo Cliente, Nuevo Ahorro, Nuevo Gasto, Configuración, el **cambio de tema** y **Cerrar sesión**.
3. **Tarjetas sutiles:** revisa que las tarjetas de cliente se ven **suaves y ordenadas** (bordes/sombras discretos, buena legibilidad).
4. **Iconos de línea en vez de emojis:** confirma que las acciones (**Pagar, Avisar, Historial, Red, Configuración, tema…**) se muestran con **iconos de línea**, no con emojis.
5. **Menú "•••" en una tarjeta:** toca el menú de **tres puntos** de una tarjeta y verifica que aparecen las acciones secundarias (editar / pausar / eliminar).
6. **Animaciones al tocar:** al pulsar un botón o una tarjeta debe notarse un leve **`press`** (encogido suave); con *reducir movimiento* activado, nada se anima.
7. **Claro/oscuro:** alterna el **tema** y confirma que iconos, tarjetas, barra inferior y hojas respetan el color en ambos modos.
8. **Acento lateral sutil (sin doble borde):** en las tarjetas de cliente, la marca de estado debe verse como un **acento delgado y suave** (no una barra gruesa) y **no** debe competir con el borde de la tarjeta.
9. **Badge de estado pequeño y nombre protagonista:** la pastilla **"Vencido hace N días" / "Pagado (mes)"** debe verse **chica y discreta**, y el **nombre del cliente** debe resaltar como lo más importante de la tarjeta.
10. **Reparto con totales dominantes:** en **"Reparto de fin de mes"**, **Total Carlos / Total Octavio** (y **Ganancia a repartir / Mitad por socio**) deben **dominar**, y las filas de **Starlink / Luz** verse **más tenues**. El descuento de **pagos directos a Octavio** debe aparecer junto a su total, no como una fila que baje la ganancia.
11. **Mes como subtítulo:** en **Resumen** y **Reparto**, el **mes** debe aparecer como **subtítulo** debajo del título (no entre paréntesis en la misma línea), y la navegación de meses **‹ ›** debe seguir cambiando ese subtítulo.
12. **Separadores tenues:** las líneas entre filas del reparto/estadísticas deben verse como **líneas sólidas muy suaves** (ya no punteadas). El **recibo** sí conserva su punteado de ticket.
13. **Más aire entre tarjetas:** las tarjetas deben tener **un poco más de separación** entre sí.
14. **Badge de Netlify:** comprueba si el **badge "Powered by Netlify"** **desapareció**. Si **sigue apareciendo**, quítalo desde la **configuración de Netlify** o **cambiando de plan** (no está en el código del repo; ver [Nota sobre el badge "Powered by Netlify"](#nota-sobre-el-badge-powered-by-netlify)).

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
  - **Facturación total del mes**: suma de la **cuota mensual** (campo *monto*) de **todos los clientes Activos**. Es la facturación **objetivo** del mes, es decir, lo que entraría **si todos los clientes activos pagaran** su cuota. Es una cifra **puramente informativa**: no cambia según el mes que navegues (la cuota es fija) y **no afecta al Reparto ni a la Ganancia**. Los clientes **Pausados no cuentan** (no se les cobra) y un cliente con cuota $0 (por ejemplo, uno "en curso") simplemente no suma.

> **¿Por qué parece que "falta dinero"?** No se pierde dinero. La **Facturación total del mes** es el *objetivo* (lo que podrías cobrar) y los **Ingresos** son lo *real* ya cobrado. Al principio del mes, *Ingresos* es bajo porque casi nadie ha pagado todavía; conforme pulsas **Pagar** en cada cliente, *Ingresos* sube. La **diferencia** entre la facturación y lo cobrado es, precisamente, lo que **falta por cobrar** (y la métrica *Por cobrar* te lo muestra). Cuando todos paguen, *Ingresos* se acerca a la facturación total.
- **Reparto de fin de mes** (panel justo debajo del Resumen): calcula cómo se divide la ganancia del mes entre los dos socios, **Carlos** y **Octavio**. Comparte la navegación de mes del Resumen (usa el mes seleccionado con `‹` / `›`) y se recalcula al cambiar de mes o al registrar un pago o un gasto. Ver [Reparto de fin de mes entre socios](#reparto-de-fin-de-mes-entre-socios).
- **Historial de meses** (vista opt-in con el botón **📊 Historial** del encabezado): una **tabla por mes** y una **gráfica de barras** (SVG puro) de lo **Cobrado** cada mes. Se arma **automáticamente** desde los pagos registrados y permite **capturar a mano** los totales de meses viejos. Ver [Historial de meses](#historial-de-meses).
- **Estadísticas**: clientes activos y pausados, y un desplegable con estadísticas del mes (al corriente = pagaron este mes, vencidos = faltan este mes, pagos cobrados, PTP, Directo y ahorro acumulado). *Pagos cobrados este mes* cuenta únicamente los cobros registrados con el botón **Pagar** de una tarjeta de cliente; un ingreso capturado a mano con **Nuevo Ingreso** suma a *Ingresos* pero no a este contador.
- **Faltan por pagar este mes**: lista los clientes **Activos** que aún no han registrado un pago del **mes en curso**, ordenados por urgencia (lo más atrasado primero), con el total de los que faltan en la cabecera y un aviso configurable de "N días antes".

> ### Cobranza por **mes calendario** (regla principal)
>
> El cobro es **mensual por mes natural**. Un cliente está **atrasado / vencido** cuando está **Activo** y **no ha registrado un pago del mes en curso**, sin importar su fecha de vencimiento individual. Es decir: *atrasado = no pagó el mes de hoy*.
>
> - **Ya no** se usa la fecha de vencimiento rodante por cliente para decidir el estado de cobranza (antes un cliente con "próximo pago" a futuro aparecía como *Pagado* aunque no hubiera pagado el mes; eso ya no ocurre).
> - Un cliente **Pausado** nunca cuenta como atrasado (no se le cobra mientras está en pausa).
> - Este mismo criterio se aplica de forma **coherente** en: la estadística *Clientes al corriente* (los que **sí** pagaron el mes) y *Clientes vencidos* (los que **faltan**), el **chip _Vencidos_** (que ahora significa "faltan por pagar este mes"), el panel **Faltan por pagar este mes** y el **badge** de cada tarjeta.
> - El badge de la tarjeta **muestra los días** del cliente que **falta por pagar** el mes, contados contra **su propio día de pago** (su `fechaProximoPago` del mes en curso): **"Vencido hace _N_ días"** (rojo) si su día ya pasó, **"Vence hoy" / "Vence mañana" / "Vence en _N_ días"** (ámbar) si está dentro de los *días de aviso*, y **"Faltan _N_ días"** (neutro) si su día aún no llega. Quien **ya pagó** el mes muestra **"Pagado (_mes_)"** (verde) y los **Pausados** muestran **"Pausado"**. Importante: el detalle de días es **solo presentación**; que el cliente *falte por pagar* se sigue decidiendo por **mes calendario** (`estaAtrasado`), no por su día de vencimiento. Por eso un cliente puede estar *por pagar este mes* y mostrar a la vez **"Faltan 6 días"** (su día aún no llega) o **"Vencido hace 3 días"** (su día ya pasó).
>
> **Separación visual "Faltan por pagar / Ya pagaron":** en *Clientes activos y pausados* (filtros *Todos* y *Activos*) la lista se parte en bloques con encabezado: primero **⚠️ Faltan por pagar (_mes_)** (arriba, acento rojo), luego **✅ Ya pagaron (_mes_)** (verde) y al final **⏸️ Pausados**. Al pulsar **Pagar** en un cliente y re-renderizar, este salta del bloque *faltan* al bloque *ya pagaron*.
>
> **Orden por urgencia del bloque "Faltan por pagar":** tanto el panel **Faltan por pagar este mes** como el grupo **⚠️ Faltan por pagar** de la lista de clientes se ordenan de **más vencido a menos** (por días restantes ascendente: los más atrasados arriba del todo, luego los que vencen pronto y al final los que aún les faltan días). Con el orden por defecto *por próximo pago* este criterio ya aplica a toda la lista; además, el bloque de atrasados **siempre** se muestra por urgencia aunque elijas ordenar *por nombre* o *por monto*. En el núcleo este orden vive en el helper puro `compararUrgencia(a, b, fechaRef)` y el texto de días en `textoDiasCobranza(dias, diasAviso)`.
>
> **Reinicio mensual automático (natural):** como la regla mira el **periodo del mes en curso**, al cambiar de mes natural **todos** vuelven a aparecer como *faltan por pagar* **sin tocar datos ni programar nada**: simplemente, ningún pago tiene el periodo del mes nuevo. No hay cron ni proceso manual; la ausencia del pago del nuevo mes los marca atrasados por sí sola.
>
> El estado de cobranza se calcula siempre **a la fecha de hoy**, aunque navegues a otros meses con `‹` / `›`. La navegación de mes solo afecta a las métricas del resumen (Ingresos, Egresos, Ganancia y Por cobrar), al detalle de movimientos y al reparto. Por eso los paneles de Estadísticas y de Pagos muestran la etiqueta *"a la fecha de hoy"*.
>
> En el núcleo (`window.PCC`) esta regla vive en dos funciones puras y testeables: `pagoDelMes(cliente, movimientos, fechaRef)` (true si hay un pago `esPago` del cliente con `periodo` del mes de `fechaRef`, o cuya `fecha` cae en ese mes para pagos viejos sin `periodo`) y `estaAtrasado(cliente, movimientos, fechaRef)` (Activo y sin pago del mes).
- **Clientes activos y pausados**:
  - **Búsqueda** por nombre, teléfono, dirección o IP.
  - **Filtros** (chips) con conteos: Todos, Activos, Pausados, Vencidos (= faltan por pagar este mes), PTP, Directo.
  - **Orden**: por próximo pago (predeterminado), por nombre o por monto.
  - **Exportar a CSV**: descarga el archivo `clientes.csv`.
- **Acciones por cliente** (en cada tarjeta):
  - **Avisar**: abre WhatsApp con un mensaje prellenado (nombre, mes en curso y monto); si el cliente aún no pagó el mes, añade una nota de que no está registrado el pago.
  - **Pagar**: registra el pago del **mes en curso** (por defecto), con lo que el cliente pasa a *ya pagó este mes* y salta al bloque *Ya pagaron*; además recalcula su próxima fecha de pago al mes siguiente. El mes siguiente volverá a aparecer como por cobrar automáticamente.
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

- Un **estado de cuenta** con cuatro datos: **Total pagado** (suma histórica de todos sus pagos cobrados), **Último pago**, **Próximo vencimiento** y **Estado actual** (**Pagado (_mes_)**, **Debe _mes_** o **Pausado**, con el mismo criterio de cobranza por mes calendario que el resto de la app: un cliente Activo que no pagó el mes en curso está atrasado).
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
  = Ganancia a repartir   (los pagos directos de Octavio NO se restan aquí)
  ÷ 2  → mitad para cada socio

Total Carlos  = su mitad
Total Octavio = su mitad − sus pagos directos  (una sola vez, ya los cobra directo)
```

- **Carlos** recibe su mitad de la ganancia a repartir.
- **Octavio** recibe su mitad **menos** los pagos directos de los clientes marcados como suyos. El motivo: ese dinero **Octavio ya lo cobró directo** de esos clientes, así que se le descuenta de su parte del reparto para no pagárselo dos veces. **Este descuento se aplica UNA sola vez, solo al total de Octavio**: los pagos directos **NO** se restan de la *Ganancia a repartir* (esa es solo *ingresos − gastos fijos*), por lo que la mitad de Carlos no se ve afectada. En la interfaz, el monto que se descuenta a Octavio se muestra junto a su total (*"su mitad menos $500 que ya cobró directo"*), no como una línea que baje la ganancia común.

> **Importante — qué cuenta como "Ingresos del mes" en el reparto:** se basa en los **pagos cobrados de clientes**, es decir, los movimientos registrados con el botón **Pagar** de una tarjeta (`esPago = true`) cuya fecha cae en el mes seleccionado. Esto es coherente con la métrica *Pagos cobrados este mes* de las Estadísticas. Un **ingreso capturado a mano** con **Nuevo Ingreso** suma a la métrica *Ingresos* del Resumen, pero **no** entra en el reparto. Además, un pago solo se atribuye a Octavio si el movimiento quedó asociado a un cliente marcado "Octavio"; el botón **Pagar** guarda esa asociación automáticamente.

## Historial de meses

La app incluye una vista **Historial de meses** que resume **mes a mes** cómo le fue al negocio. Se abre con el botón **📊 Historial** del encabezado; es una vista **opcional (opt-in)**, igual que el [Mapa de red](#mapa-de-red): al pulsarla se alternan los paneles normales por el historial, sin romper el resto de la app (y si estaba abierta la vista Red, se cierra para que nunca queden las dos a la vez).

### Qué muestra

- **Tabla por mes**, una fila por mes, con estas columnas:
  - **Mes**: el periodo en español (por ejemplo *Octubre 2026*).
  - **Cobrado**: lo que realmente se cobró ese mes (pagos registrados).
  - **Facturado**: la facturación **objetivo** del mes (suma de las cuotas de los clientes activos; hoy ~**$9,400**).
  - **% de cobranza**: `Cobrado ÷ Facturado` en porcentaje (muestra `—` cuando no hay facturado).
  - **Gastos**: los gastos fijos del mes (Starlink + luz cuando aplica).
  - **Ganancia a repartir**: lo que queda para dividir entre los socios tras los gastos.
  - **Total Carlos** y **Total Octavio**: cuánto le tocó a cada socio ese mes.
  - **Pagaron / No pagaron**: cuántos clientes pagaron el mes y cuántos faltaron.
- **Gráfica de barras** de lo **Cobrado** por mes, dibujada con **SVG en línea** (sin librerías externas), en orden cronológico ascendente (de izquierda a derecha). Cada barra tiene una altura proporcional al máximo del periodo, muestra el monto encima y el mes abreviado debajo, y respeta el **modo claro/oscuro** mediante variables CSS. En **móvil** el contenedor permite **scroll horizontal** para no deformar las barras.

### Cómo se arma (automático desde los pagos)

El historial se construye **solo** a partir de los **pagos registrados** (movimientos con `esPago`):

- Cada pago se asigna a su mes por la **fecha** del movimiento (`YYYY-MM` de `fecha`). Es **el mismo criterio** que usa el Reparto para sumar lo cobrado, así que un **pago tardío** (registrado con fecha de un mes pero periodo de otro) cuenta en el **mes de su fecha**, igual que en el panel Reparto, y no "pisa" ninguna captura manual del mes de su periodo.
- **Cobrado** usa exactamente la **misma lógica que el Reparto** (`calcularReparto`), de modo que las cifras **cuadran** con el panel [Reparto de fin de mes](#reparto-de-fin-de-mes-entre-socios). La decisión de si un mes es "real" o "manual" se toma con **ese mismo mes de la fecha**, para que la elección de fuente y el monto Cobrado siempre hablen del mismo mes.
- **Gastos** y el reparto **Carlos / Octavio** salen de las **mismas funciones del núcleo** (`gastosFijosDelMes`, `luzAplicaEnMes` y `calcularReparto`), **sin cambiar** la fórmula del reparto ya corregida. El historial solo **lee** y presenta esos cálculos; no inventa fórmulas nuevas.

> Como se nutre de los datos sincronizados, el historial se **actualiza solo** cuando registras un pago o un gasto (la vista se redibuja al re-renderizar), y los cambios que llegan desde Firebase en otro dispositivo también se reflejan.

### Capturar meses históricos a mano

Para los meses **anteriores** a usar la app (por ejemplo los totales de agosto o septiembre que tenías en tu Excel), hay un botón **➕ Agregar mes histórico** que abre un modal donde capturas:

- **Mes** (obligatorio) y **Cobrado** (obligatorio).
- Opcionalmente: **Gastos**, **Total Carlos**, **Total Octavio** y una **nota**. Lo que no captures se deriva de la lógica del núcleo (por ejemplo, los gastos del mes).

> **Reparto de un mes capturado a mano:** si dejas vacíos **Total Carlos** y **Total Octavio**, la ganancia de ese mes se divide **50/50** entre los dos socios. Esto es **a propósito**: la fórmula asimétrica de Octavio (su mitad **menos** lo que cobró directo de sus clientes) necesita el **detalle de pagos por cliente** de ese mes, y una captura manual de un mes viejo (p. ej. sacada del Excel) no lo trae. Sin ese desglose, 50/50 es el único reparto defendible; si conoces los totales exactos, **escríbelos a mano** en esos dos campos y la app los respeta. Esto solo afecta a los meses capturados a mano: los meses con pagos reales siempre usan la fórmula asimétrica de `calcularReparto`.

Estas capturas se guardan en **`config.historialManual`** y, como **viajan dentro de la configuración**, se **sincronizan en la nube** (Firestore) igual que el resto de la app, así que aparecen en todos tus dispositivos. Cada mes capturado a mano se marca en la tabla con una etiqueta **"capturado manualmente"** y trae un botón **🗑️ eliminar** para borrarlo cuando quieras (la barra correspondiente en la gráfica también se distingue).

### Precedencia: lo real gana sobre lo manual

Cuando un mes tiene **pagos reales**, se usan **siempre** los datos reales. Si un mes **no tiene pagos** pero sí un **registro manual**, se usa el manual y se marca como **"capturado manualmente"**. Dicho de otra forma: **lo real tiene prioridad sobre lo manual**, de modo que en cuanto empieces a registrar pagos de un mes, ese mes deja de mostrar la captura a mano y pasa a reflejar lo realmente cobrado.

### Limitaciones y decisiones de diseño

- **Rango mostrado:** por defecto los **últimos 12 meses** (contando hacia atrás desde el mes actual), **más** cualquier captura manual anterior a ese rango, para no perder meses viejos que hayas registrado a mano.
- **Facturado y Pagaron / No pagaron de meses pasados** se calculan con el **padrón ACTUAL** de clientes activos (las mismas `facturacionTotalMensual` y `pagoDelMes` recorren la lista de clientes de hoy). Por eso son una **referencia aproximada**, no una **foto histórica** del padrón que tenías ese mes.
- **Meses sin pagos salen en $0 (es correcto y esperado).** Recién reiniciado el SEED (los **18 clientes reales** y la lista de movimientos **vacía**; ver [Datos precargados](#datos-precargados-los-18-clientes-reales-de-octared)), el historial muestra el **mes actual en $0** porque todavía no hay pagos registrados. No es un error: la tabla y la gráfica se irán llenando conforme pulses **Pagar** en cada cliente.

### Verificación manual del Historial de meses

Como no hay navegador headless en el entorno de pruebas, esta comprobación se hace a mano:

1. **Inicia sesión** (con Google o como invitado).
2. **Abre la vista** con el botón **📊 Historial** del encabezado y comprueba que aparecen la **tabla por mes** y la **gráfica de barras** (en el SEED recién reiniciado, el mes actual sale en **$0**, que es lo esperado).
3. **Registra un pago** con **✔️ Pagar** en un cliente y confirma que, al volver al historial, el **mes actual sube** (tanto en la fila de la tabla como en su barra de la gráfica).
4. **Captura un mes histórico:** pulsa **➕ Agregar mes histórico**, llena **mes** y **cobrado** (y los opcionales si quieres) y guarda; verifica que aparece en la **tabla** y en la **gráfica** marcado como **"capturado manualmente"**. Luego **elimínalo** con **🗑️ eliminar** y confirma que desaparece.
5. **Precedencia:** registra un pago en el mismo mes que capturaste a mano y confirma que ese mes pasa a mostrar los **datos reales** (ya sin la marca de manual).
6. Comprueba la vista en **PC** y en **móvil** (en móvil, que la gráfica tenga **scroll horizontal**) y en **modo claro y oscuro**.

## Datos precargados: los 18 clientes reales de OCTARED

Ya **no** se cargan clientes ficticios de demostración. El conjunto de datos ahora son **exactamente los 18 clientes reales de OCTARED**, tomados de la lista del negocio (que coincide con el diagrama de red). Son estos:

*VECINA YOLANDA CASA 15*, *Hermelinda*, *MICAELA HERNANDEZ CASA 54*, *casa 44 LIZBETH*, *Daniel casa 44*, *Nieto*, *Lupita casa 26 alado de nieto*, *Gabriela*, *URIEL*, *Reyes vecino*, *TIENDA INDOMABLE*, *Mercedez RH*, *Berenice*, *Jessy casa 43*, *Obed*, *VECINO DE BRANDON*, *CASA 17 CARMEN LAVANDERIA* y *PERRUCHA*.

Reglas con las que se cargan:

- **Todos quedan en estado Activo.** Ninguno arranca pausado.
- **El único que paga directamente a Octavio es `casa 44 LIZBETH`** (socio **Octavio**); el resto paga a **Carlos**. Esto es lo que usa el [Reparto de fin de mes](#reparto-de-fin-de-mes-entre-socios).
- **Instalación en $0** para todos (no se cobra instalación en este alta).
- **Monto, megas y día de pago** son los reales de cada cliente (por ejemplo, *Nieto* 20 MB $600, *Reyes vecino* 30 MB $600, *Mercedez RH* 10 MB $400). El **día de pago** de cada cliente es el valor real de su columna **"DÍAS POR PAGAR"** del Excel del negocio (**no** el día de la fecha de instalación). Por ejemplo, *casa 44 LIZBETH* se instaló el **12**/11/2025 pero **paga los 15** de cada mes, así que su día de pago es **15**. El día de pago es **configurable** desde la ficha del cliente (**Día de pago (1-31)**) y es el que usa la app para calcular el vencimiento del mes (*"Vence: 15 de ..."*) y los días que faltan o lleva vencido.
- **Todos quedan ATRASADOS del mes en curso al reiniciar.** Bajo la [cobranza por mes calendario](#cobranza-por-mes-calendario-regla-principal), al sembrar o reiniciar los datos la lista de movimientos queda **vacía**, así que **ningún cliente tiene un pago del mes actual** y los 18 aparecen en **⚠️ Faltan por pagar (_mes_)**. El dashboard muestra **18 por cobrar / 0 pagados este mes**. La marca histórica PAGADO/DEBE del dataset ya **no** crea un pago del mes en curso: el usuario va marcando manualmente con **Pagar** quién ya pagó. Como consecuencia, ningún cliente del SEED trae `ultimoPago`. Al cambiar de mes natural, todos vuelven a faltar por pagar automáticamente.
- **Facturación total (objetivo):** la suma de las cuotas mensuales de los 18 clientes activos es **$9,400**.

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
- **Clientes directos por cable (modem)**: **cada modem es un cliente distinto** (no infraestructura compartida). Esta sección lista, con **nombre + IP**, a tus clientes cuyo **Tipo de conexión** es **Modem** y ya tienen IP (abren en `http://IP:8090`), más los **"huecos por ligar"**: las IPs de modem conocidas (`.19`, `.22`, `.24`, `.101`) que **aún no tienen un cliente asignado**. Cada hueco trae un botón para ligarle uno de tus clientes pendientes (ver [Asignar/ligar clientes desde el mapa](#asignarligar-clientes-desde-el-mapa)). En cuanto un cliente queda como Modem con esa IP, su hueco desaparece y el cliente aparece con su nombre.
- **Pendientes / Falta identificar** (en **naranja**): nodos de infraestructura pendientes (`.61` TP-LINK, `.18`) y los clientes que aún no tienen IP.
- **En tu lista de cobro, SIN IP aún:** lista informativa con los nombres de los clientes sin IP.

### Conexiones: microondas (inalámbrico) vs cable

Las conexiones se dibujan **al final, por detrás de las tarjetas**, con un **SVG en línea** (sin librerías externas), para no estorbar la lectura:

- **Enlaces inalámbricos (simulan microondas):** Core -> cada AP, Core -> cada punta PtP y cada AP/punta -> sus antenas o cliente. Se dibujan con **línea punteada animada** (efecto de "ondas" en movimiento), **azul** para los AP y **teal** para los PtP.
- **Conexiones por cable:** Core -> cada **modem** directo, con **línea sólida continua** (simula el cable físico), en color verde/identificado.

Las líneas se **recalculan** al cambiar el tamaño de la ventana y cada vez que se redibuja el mapa (incluidos los datos que llegan de Firebase). La animación de ondas se desactiva si el sistema pide **movimiento reducido** (`prefers-reduced-motion`).

### Antenas fijas de infraestructura + clientes reales (sin duplicar)

Cada AP/enlace trae en la **topología** una lista de **antenas fijas** (nombre + IP). Al dibujar, el mapa **fusiona** esas antenas fijas con los **clientes reales** clasificados bajo ese AP, **deduplicando por IP**: si una antena fija coincide con un cliente real (misma IP), la fila se marca como **identificada** y toma el nombre del cliente; si no, se muestra como fila de **infraestructura**. Así aparecen también los nodos que no son clientes de cobro (CASA 30, LB-LINDA_S, LiteBeam 5AC, Octarednuevaultima, CASA 54) sin repetir a los clientes reales.

### Es dinámico y se cruza con los clientes reales

El mapa **no es una imagen fija**: sus nodos de cliente se **derivan de los 18 clientes reales** cargados en la app. La clasificación es:

- Cliente con **Tipo de conexión "Modem"** e **IP**: aparece en la sección **Clientes directos por cable (modem)** con su **nombre + IP**. Los modems son **directos al router**, así que **no necesitan AP/enlace** (su campo *AP / enlace* puede quedar vacío). Este es el caso de **PERRUCHA** (`192.168.10.13`): en cuanto se marca como Modem con su IP, **sube a la sección de modems** en lugar de quedarse abajo en "falta identificar".
- Cliente **con IP** y su **AP o enlace PtP** asignado: aparece como nodo **identificado** (**verde**) colgando de ese AP o enlace.
- Cliente **sin IP** (o con IP pero **sin AP/enlace reconocible** cuando no es modem): aparece en la zona de **pendientes** (**naranja**) como "falta identificar".

Como se nutre de los datos sincronizados, el mapa se **actualiza solo** cuando cambian los clientes (incluyendo los cambios que llegan desde Firebase en otro dispositivo). En el conjunto inicial de los 18 reales quedan **8 clientes identificados** (los que ya traen IP y AP/enlace) y **10 pendientes** (ninguno es modem todavía, hasta que empieces a ligarlos).

### Asignar/ligar clientes desde el mapa

No hace falta entrar a la ficha de cada cliente para ubicarlo en la red: el propio mapa trae un botón **➕ Asignar cliente** en **cada AP**, **cada enlace PtP** y en la **sección de modems** (tanto en su cabecera como en cada hueco "por ligar").

Al pulsarlo se abre un **selector** con la **lista de tus clientes pendientes** (los que aún faltan por identificar). Eliges uno, **capturas su IP** (si ligaste un hueco de modem conocido, la IP viene **precargada**) y pulsas **Asignar**. La app entonces:

1. Le pone al cliente esa **IP**, el **Tipo de conexión** según dónde lo ligues (**AP**, **PtP** o **Modem**) y el **AP/enlace** correspondiente (vacío para los modems, que son directos al router).
2. **Guarda** el cambio con la misma capa de persistencia del resto de la app (`PCC.guardarClientes`), por lo que se **sincroniza a Firestore** y llega a tus otros dispositivos.
3. **Redibuja el mapa**: el cliente **salta** de "falta identificar" a su sección (bajo su AP/enlace, o a la lista de modems).

La IP se valida mínimamente (debe ser una **IPv4** con formato correcto, p. ej. `192.168.10.13`); si la dejas vacía o mal escrita, el selector te lo avisa y no guarda nada. Si cancelas, no se cambia nada. Como atajo adicional, **Alt+clic** sobre un nodo de cliente sigue abriendo su **ficha completa**.

### Buscador y colores

- **Buscador:** el campo de búsqueda del mapa filtra por **nombre o IP**; resalta los nodos que coinciden y atenúa el resto. Al vaciarlo se restaura todo.
- **Semántica de colores:** **core = ámbar**, **AP = azul**, **PtP = teal**, **identificado = verde**, **pendiente = naranja**. La vista **respeta el modo oscuro** y es **responsive**: en **PC** las tarjetas de AP se muestran en **fila/grilla** y en **móvil** se **apilan a una columna**, con las filas internas legibles y la IP a la derecha sin romperse. Las líneas SVG se recalculan para ambos tamaños.

### Abrir un nodo

Cada nodo con IP **abre su dirección en una pestaña nueva**. Ten en cuenta que las IPs `192.168.10.x` son **direcciones privadas** de la red de OCTARED: **solo abren si estás dentro de esa red o conectado por VPN**. Los **modems de cable** se abren en **`http://IP:8090`** y el resto de equipos en **`https://IP`**.

> Los nodos de infraestructura del diagrama que **no** son clientes de cobro (como CASA 30, LB-LINDA_S, LiteBeam 5AC, Octarednuevaultima o CASA 54) **sí** se muestran ahora como una **fila fija** dentro de su AP (definidos en la topología). Los clientes de cobro siguen derivándose de la lista real de Firebase y se fusionan con esas antenas fijas por IP para no duplicarlos.

### Verificación manual del Mapa de red

Como no hay navegador headless en el entorno de pruebas, esta comprobación se hace a mano:

1. **Inicia sesión** (con Google o como invitado).
2. **Carga los 18 reales:** abre **Configuración ⚙️** y pulsa **Reiniciar datos de ejemplo** (necesario si tu nube ya tenía datos; ver [Cómo cargar los 18 reales](#cómo-cargar-los-18-reales-si-tu-nube-ya-tenía-datos-de-ejemplo)).
3. **Abre la vista Red** con el botón **🗺️ Red** (pruébala en **PC** y en **móvil**) y comprueba: que **AP OCTARED3** lista sus **6 antenas**; qué clientes salen **identificados** (en verde) y cuáles **pendientes** (en naranja); y que las líneas **Core -> AP** son **punteadas** (microondas) mientras que **Core -> modem** son **sólidas** (cable).
4. **Busca por nombre o IP** en el buscador del mapa y verifica que el nodo coincidente se **resalta** y el resto se atenúa.
5. **Asigna una IP y un AP** a un cliente pendiente desde su ficha (Editar cliente -> IP, Tipo de conexión y AP/enlace) y guarda; al volver al mapa, ese cliente debe pasar de "falta identificar" a **identificado** bajo el AP indicado.
6. **Bug de modems (PERRUCHA):** edita un cliente, ponle **Tipo de conexión "Modem"** y una **IP** (por ejemplo `192.168.10.13`) y guarda. Al volver al mapa debe **subir a la sección "Clientes directos por cable (modem)"** con su nombre, **no** quedarse abajo en "falta identificar".
7. **Asignar desde el mapa:** pulsa **➕ Asignar cliente** en un **AP** (o en un **hueco de modem**), elige un cliente pendiente del selector, escribe su IP y pulsa **Asignar**. El cliente debe **ligarse** y aparecer de inmediato en esa sección (sin abrir la ficha). Prueba también que una IP vacía o inválida **no** guarda y avisa.
8. **Sincronización:** en **otro dispositivo** con la sesión abierta, confirma que ese cliente aparece también como identificado / como modem, sin recargar.

## Persistencia (Firestore + espejo local)

Ahora la **fuente de verdad** es **Cloud Firestore** (en la nube). El **`localStorage`** del navegador actúa como **espejo / caché local** para que la interfaz siga siendo **instantánea**: la pantalla lee de ese espejo de forma síncrona, mientras `firebase-sync.js` mantiene el espejo al día con los datos remotos y propaga a la nube cada cambio que haces.

- En la nube, los datos se guardan en las colecciones **`clientes`** y **`movimientos`** y en los documentos **`config/app`** y **`config/theme`** (ver [Sincronización en la nube con Firebase](#sincronización-en-la-nube-con-firebase)).
- En el navegador, el espejo local vive bajo claves con prefijo `pcc.` (`pcc.clientes`, `pcc.movimientos`, `pcc.config`, `pcc.theme`). La configuración (`pcc.config`) incluye los gastos fijos del negocio (`costoAntena`, `numAntenas`, `costoLuz`, `luzPeriodicidadMeses`, `luzMesAncla`), que se añaden con sus valores por defecto a cualquier configuración antigua que no los tuviera.

Esto implica que:

- Los datos **se comparten entre dispositivos y navegadores**: al iniciar sesión ves siempre la misma información y los cambios se sincronizan **en vivo**.
- Los datos **permanecen** aunque cierres y vuelvas a abrir la página, porque viven en la nube (no dependen de un solo navegador).
- Si borras el almacenamiento local del sitio, no pierdes nada: al volver a iniciar sesión los datos se **vuelven a traer desde Firestore**.

## Experiencia móvil (diseño "tipo app")

La aplicación se usa **principalmente en el celular** (y a veces en PC), así que la interfaz está pensada **primero para móvil** y se siente como una app nativa, sin dejar de verse bien en pantalla grande. Todo conserva el **diseño minimalista**, el **modo claro/oscuro** y **toda la funcionalidad** de siempre: solo cambia la capa visual y de navegación, no la lógica del negocio.

Qué cambia en el teléfono:

- **Barra de navegación inferior** fija (tipo app), con los accesos al alcance del pulgar:
  - **Inicio:** vuelve al panel principal (Resumen, Pagos, Clientes, etc.).
  - **Red:** abre el **Mapa de red** (equivale al botón de Red del escritorio).
  - **Historial:** abre el **Historial de meses**.
  - **Acciones (➕ / menú):** abre una **hoja de acciones** con Nuevo Cliente, Nuevo Ahorro, Nuevo Gasto y Configuración. El cambio de tema (claro/oscuro) y Cerrar sesión siguen disponibles.
  - La barra respeta el **área segura** del iPhone (gestos de la parte inferior) y el contenido deja espacio para que no la tape.
- **Tarjetas de cliente táctiles:** nombre, monto y estado grandes y legibles; botones de **Avisar**, **Pagar**, **Revertir** e **Historial** a lo ancho para tocarlos fácil, y los íconos de **editar / pausar / eliminar** con área de toque cómoda (mínimo 44 px).
- **Resumen, estadísticas y reparto apilados** en una sola columna, con números grandes (Ingresos, Egresos, Ganancia, Por cobrar, Facturación, Reparto) fáciles de leer de un vistazo.
- **Modales tipo hoja (bottom sheet):** los formularios (Nuevo Cliente, Nuevo Gasto, Configuración, Historial de pagos y el Recibo) suben desde abajo, ocupan todo el ancho, se redondean solo por arriba y hacen **scroll interno**. El botón de **cerrar (✕)** es grande, y los campos usan una fuente de **16 px** para que **iOS no haga zoom** al enfocar y para que el **teclado no tape** los campos (el contenido se puede desplazar). La impresión del **recibo** no se ve afectada: al imprimir sigue saliendo **solo el recibo**.
- **Historial de meses usable en pantalla chica:** la tabla hace **scroll horizontal suave** y la **columna Mes queda fija** a la izquierda para no perder la referencia al deslizar; la **gráfica SVG** escala, permite scroll horizontal y respeta claro/oscuro.
- **Mapa de red en una columna:** las tarjetas se apilan con scroll vertical cómodo, el **buscador ocupa todo el ancho**, los nodos y el botón **Asignar cliente** son tocables y la leyenda se lee bien; los conectores SVG se redibujan al rotar o cambiar de tamaño sin romper el diseño.
- **Instalable (PWA ligera):** se incluye un `manifest.json` **100% local** (nombre, color de tema, `display: standalone` e icono SVG local `icono.svg`), así que en Android/Chrome se puede **"Agregar a la pantalla de inicio"** y abrir a pantalla completa, y en iPhone con **"Añadir a pantalla de inicio"** desde Safari.

### Sobre la PWA: qué se incluyó y qué no (y por qué)

- **Sí** se añadió un **manifest** e **iconos locales** (SVG) y las etiquetas `theme-color` / `apple-mobile-web-app-*` en `index.html`. Son recursos **locales**, sin CDNs ni dependencias nuevas, y **no interfieren** con nada.
- **No** se añadió un **service worker**. La app carga los **SDK de Firebase como módulos ES desde gstatic en tiempo de ejecución**; un service worker que cachee o intercepte peticiones podría **interferir con Firebase/Netlify** y **no se puede probar en este entorno** (sin navegador ni acceso a la red de Firebase). Por eso se dejó fuera para **no añadir riesgo**: la app seguirá siendo instalable y "tipo app" igual. Si en el futuro se quiere soporte offline, habría que agregar un service worker que **excluya explícitamente** las peticiones a `gstatic`/Firebase y probarlo en un dispositivo real.

### Verificación manual de la experiencia móvil

Como en el entorno de pruebas **no hay navegador ni pantalla**, esto se comprueba a mano en tus dispositivos reales. Abre el sitio de Netlify (**https://ornate-melba-f303fc.netlify.app**) en **iPhone y/o Android** y también en **PC**, inicia sesión y revisa:

1. **Barra inferior:** navega con **Inicio / Red / Historial** y con el botón de **Acciones**; confirma que cada uno abre lo esperado y que la pestaña activa se resalta.
2. **Cobrar desde una tarjeta:** pulsa **✔️ Pagar** en un cliente, elige periodo y monto, confirma y revisa el recibo; luego pulsa **↩️ Revertir** y confirma que el Resumen y el Reparto se recalculan.
3. **Secciones:** abre **Red** y **Historial** y vuelve a **Inicio**; comprueba que el scroll es suave y que nada queda tapado por la barra inferior.
4. **Modales y teclado:** abre **Nuevo Cliente** y **Configuración**; confirma que suben como hoja, que el botón de cerrar es cómodo y que, al escribir en un campo, **el teclado no lo tapa** (se puede desplazar) y **no hace zoom** al enfocar.
5. **Tablas y mapa:** en **Historial de meses** desliza la tabla en horizontal y verifica que la **columna Mes queda fija**; en el **Mapa de red** confirma una sola columna, buscador a ancho completo y botones **Asignar cliente** fáciles de tocar.
6. **Girar el teléfono:** cambia entre **vertical y horizontal** y comprueba que todo se reacomoda sin romperse.
7. **Claro/oscuro:** alterna el tema con 🌙 / ☀️ y verifica que toda la interfaz móvil (tarjetas, hojas, tabla, gráfica y mapa) respeta el color.
8. **Instalar (opcional):** en Android/Chrome usa **"Agregar a la pantalla de inicio"**; en iPhone/Safari usa **"Añadir a pantalla de inicio"** y abre el icono para verla a pantalla completa.

## Nota sobre WhatsApp

El botón **Avisar** abre un enlace de WhatsApp (`https://wa.me/...`) con el mensaje prellenado. El número de celular se normaliza a solo dígitos y, si tiene 10 dígitos, se le antepone el código de país de México (**52**).

Esta acción abre el sitio de WhatsApp en una pestaña nueva (necesitas WhatsApp Web o la app disponible). Como ahora la aplicación sincroniza en la nube con Firebase, **requiere conexión a internet** para funcionar en general.

## Qué se probó

- El arnés de pruebas completa **141 comprobaciones con 0 fallos** (las nuevas cubren los 18 clientes reales, los campos de red, la clasificación del mapa y la fusión de antenas fijas con clientes reales).
- `node --check app.js` y `node --check red-mapa.js` pasan sin errores de sintaxis. `red-mapa.js` **se autoprotege cuando no hay `document`** (la lógica de DOM no se ejecuta en el arnés, solo se expone su función pura de clasificación).
- Carga del núcleo con un `localStorage` simulado: se siembran **18 clientes reales**; `formatoMoneda(500)` devuelve `$500.00` y `formatoFechaLarga("2026-09-29")` devuelve `29 de septiembre de 2026`.
- **Dataset de los 18 reales:** el SEED tiene **exactamente 18 clientes**, **todos Activos**, con **exactamente un** socio **Octavio** que es **`casa 44 LIZBETH`** (el resto, Carlos); los clientes sin dato de red arrancan con **campos de red vacíos** (sin IP, tipo de conexión ni AP) y `tipoPago` por defecto en **"Directo"**.
- **Mapeos concretos de red:** se verifica que los clientes con IP quedan bajo su AP/enlace correcto (por ejemplo *Nieto* `.38`, *Lupita casa 26* `.111` y *TIENDA INDOMABLE* `.129` en AP_OCTARED_3; *Reyes vecino* `.34` y *Jessy casa 43* `.40` en LiteAP AC-1; *Berenice* `.31` en LiteAP AC-2; *Mercedez RH* `.36` en PtP MERCEDES RH; *casa 44 LIZBETH* `.145` en PtP CASA 44).
- **Clasificación del mapa** (`window.PCC_RED.clasificarClientes`): sobre el SEED de 18 produce **8 identificados** (los que traen IP, repartidos bajo su AP/enlace) y **10 pendientes**; un cliente con IP y `apId` conocido cae como identificado, y uno sin IP o con `apId` desconocido cae en pendientes.
- **Fusión de antenas fijas y clientes** (`window.PCC_RED.fusionarAntenas`): AP OCTARED3 lista sus **6 antenas fijas** de la topología; sin clientes reales todas son filas de infraestructura; con un cliente real cuya IP coincide con una antena (`.111`) la fila pasa a **identificada** y toma el nombre del cliente **sin duplicar**, y un cliente con IP nueva se agrega como fila extra identificada.
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

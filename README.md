# Panel de Control de Clientes

Aplicación web para administrar los clientes y las finanzas de un negocio de venta de internet / megas. Está hecha con **HTML + CSS + JavaScript puro (vanilla)**: no necesita servidor, ni instalación, ni conexión a internet para funcionar. Todos los datos se guardan localmente en el navegador.

La interfaz tiene una paleta **minimalista** (acento índigo suave) con **modo claro y modo oscuro**, y toda la aplicación está en **español**.

## Cómo abrirla

1. Descarga o copia la carpeta del proyecto (debe contener `index.html`, `styles.css` y `app.js` juntos).
2. Haz **doble clic en `index.html`**. Se abrirá en tu navegador (Chrome, Edge, Firefox, Safari…).

No hace falta nada más: no requiere Node, ni npm, ni un servidor web. Funciona con el protocolo `file://`.

> La primera vez que la abres se cargan automáticamente unos **datos de ejemplo** para que puedas probar todo de inmediato.

## Funcionalidades

- **Resumen mensual** con navegación por meses (botones `‹` y `›`):
  - **Ingresos**: ingresos registrados del mes más los pagos de clientes cobrados ese mes.
  - **Egresos**: gastos registrados del mes.
  - **Ganancia Neta**: ingresos menos egresos.
  - **Por cobrar (hasta fin de mes)**: suma de los montos de clientes activos cuyo pago vence hasta el fin del mes seleccionado y aún no están pagados.
- **Estadísticas**: clientes activos y pausados, y un desplegable con estadísticas del mes (al corriente, vencidos, pagos cobrados, PTP, Directo y ahorro acumulado).
- **Pagos próximos o vencidos**: lista ordenada por urgencia (lo más vencido primero), con el total de vencidos en la cabecera y un aviso configurable de "N días antes".
- **Clientes activos y pausados**:
  - **Búsqueda** por nombre, teléfono, dirección o IP.
  - **Filtros** (chips) con conteos: Todos, Activos, Pausados, Vencidos, PTP, Directo.
  - **Orden**: por próximo pago (predeterminado), por nombre o por monto.
  - **Exportar a CSV**: descarga el archivo `clientes.csv`.
- **Acciones por cliente** (en cada tarjeta):
  - **Avisar**: abre WhatsApp con un mensaje prellenado (nombre, monto adeudado y fecha de vencimiento).
  - **Pagar**: registra el pago del mes, marca al cliente como pagado y recalcula su próxima fecha de pago.
  - **Editar**: abre el formulario del cliente con sus datos cargados.
  - **Pausar / Reanudar**: alterna el estatus del cliente.
  - **Eliminar**: pide confirmación antes de borrar.
- **Nuevo Cliente**: formulario con validación en español (nombre, celular, monto y día de pago son obligatorios).
- **Movimientos**: registrar **Gastos**, **Ingresos** y **Ahorros**. El panel de detalle tiene pestañas que filtran por tipo, calculan el total del mes y muestran un estado vacío adecuado.
- **Modo oscuro**: el botón 🌙 / ☀️ alterna el tema y lo recuerda al recargar.
- **Configuración**: ajusta los **días de aviso** y la **moneda**, y permite **reiniciar los datos de ejemplo**.

## Datos de ejemplo precargados

La primera vez se cargan **24 clientes de ejemplo** basados en una tabla de referencia (nombres como *Cresencia*, *VECINA YOLANDA*, *Hermelinda*, *MICAELA HERNANDEZ*, *Lupita casa 26*, *Reyes vecino*, *TIENDA INDOMABLE*, etc.), con mezcla de tipos de pago **PTP** y **Directo**, al menos un cliente **Pausado** y varios en estado **Vencido**, además de algunos **pagados** y **próximos**. El monto predeterminado es de **$500.00**. Las direcciones e IP son genéricas de ejemplo.

Estos datos sirven solo para demostrar la aplicación. Puedes editarlos, borrarlos o agregar los tuyos; todo queda guardado en tu navegador.

## Cómo reiniciar los datos

Si quieres volver al conjunto de datos de ejemplo original:

1. Abre **Configuración** (botón ⚙️ en la parte superior).
2. Pulsa **Reiniciar datos de ejemplo** y confirma.

Esto reemplaza todos los clientes y movimientos actuales por los datos de ejemplo.

## Persistencia (localStorage)

Toda la información se guarda en el **almacenamiento local del navegador** (`localStorage`), bajo claves con prefijo `pcc.` (`pcc.clientes`, `pcc.movimientos`, `pcc.config`, `pcc.theme`).

Esto implica que:

- Los datos **permanecen** aunque cierres y vuelvas a abrir la página en el mismo navegador y computadora.
- Los datos **no se comparten** entre navegadores, dispositivos ni usuarios distintos.
- Si borras los datos de navegación / el almacenamiento del sitio, se perderá la información (y al volver a abrir se cargarán de nuevo los datos de ejemplo).

## Nota sobre WhatsApp

El botón **Avisar** abre un enlace de WhatsApp (`https://wa.me/...`) con el mensaje prellenado. El número de celular se normaliza a solo dígitos y, si tiene 10 dígitos, se le antepone el código de país de México (**52**).

Esta acción **sí requiere conexión a internet del usuario final** (y tener WhatsApp Web o la app disponible), ya que abre el sitio de WhatsApp en una pestaña nueva. El resto de la aplicación funciona sin internet.

## Qué se probó

- `node --check app.js` pasa sin errores de sintaxis.
- Carga del núcleo con un `localStorage` simulado: se siembran **24 clientes** de ejemplo; `formatoMoneda(500)` devuelve `$500.00` y `formatoFechaLarga("2026-09-29")` devuelve `29 de septiembre de 2026`.
- Clasificación de estados correcta sobre los datos de ejemplo (vencidos, próximos y pagados).
- Flujo de **Pagar**: tras registrar el pago, la fecha de próximo pago avanza al siguiente ciclo (mes siguiente respetando el día de pago).
- `crearCliente` normaliza y autocalcula la fecha de próximo pago para un cliente nuevo.
- La capa de interfaz se inicializa y ejecuta el render completo sin lanzar errores (verificado con un DOM simulado).
- Revisión funcional recomendada en el navegador: crear / editar / pausar / eliminar clientes, buscar, filtrar por cada chip, ordenar, exportar CSV, cambiar de mes, abrir cada modal, registrar gastos / ingresos / ahorros, alternar el modo oscuro y recargar para confirmar la persistencia; la consola debe quedar sin errores.

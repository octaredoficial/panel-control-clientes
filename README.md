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
  - **Editar**: abre el formulario del cliente con sus datos cargados.
  - **Pausar / Reanudar**: alterna el estatus del cliente.
  - **Eliminar**: pide confirmación antes de borrar.
- **Nuevo Cliente**: formulario con validación en español (nombre, celular, monto y día de pago son obligatorios). Incluye el campo **Pagado a** (ver [el campo "socio"](#el-campo-socio-pagado-a)).
- **Movimientos**: registrar **Gastos**, **Ingresos** y **Ahorros**. El panel de detalle tiene pestañas que filtran por tipo, calculan el total del mes y muestran un estado vacío adecuado.
- **Modo oscuro**: el botón 🌙 / ☀️ alterna el tema y lo recuerda al recargar.
- **Configuración**: ajusta los **días de aviso**, la **moneda** y los **gastos fijos del negocio** (ver [Gastos fijos configurables](#gastos-fijos-configurables)), y permite **reiniciar los datos de ejemplo**.

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

## Persistencia (localStorage)

Toda la información se guarda en el **almacenamiento local del navegador** (`localStorage`), bajo claves con prefijo `pcc.` (`pcc.clientes`, `pcc.movimientos`, `pcc.config`, `pcc.theme`). La configuración (`pcc.config`) incluye los gastos fijos del negocio (`costoAntena`, `numAntenas`, `costoLuz`, `luzPeriodicidadMeses`, `luzMesAncla`), que se añaden con sus valores por defecto a cualquier configuración antigua que no los tuviera.

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
- Coherencia del criterio de "vencido": un cliente **Pausado** y atrasado **no** cuenta como vencido en ningún conteo, mientras que uno **Activo** y atrasado sí (verificado en el arnés de pruebas).
- Flujo de **Pagar**: tras registrar el pago, la fecha de próximo pago avanza al siguiente ciclo (mes siguiente respetando el día de pago).
- `crearCliente` normaliza y autocalcula la fecha de próximo pago para un cliente nuevo.
- **Campo socio**: `crearCliente` asigna **Carlos** por defecto, respeta **Octavio** cuando se indica y normaliza cualquier valor inválido a Carlos; el conjunto de datos de ejemplo tiene **exactamente un** cliente marcado "Octavio" (monto $500) y el resto en Carlos.
- **Migración de configuración**: una `pcc.config` antigua `{diasAviso, moneda}` migra añadiendo los gastos fijos con sus defaults (`costoAntena: 1305`, `numAntenas: 2`, `costoLuz: 300`, `luzPeriodicidadMeses: 2`, `luzMesAncla: "2025-11"`).
- **Patrón de la luz** (`luzAplicaEnMes`): aplica en noviembre 2025 y enero 2026, y no aplica en diciembre 2025 ni febrero 2026.
- **Gastos fijos del mes** (`gastosFijosDelMes`): total **$2,910** en noviembre (Starlink $2,610 + luz $300) y **$2,610** en diciembre (sin luz).
- **Reparto** (`calcularReparto`): sobre un escenario con pagos de clientes de ambos socios, se verifica que *Ingresos del mes* cuenta solo los pagos `esPago` del mes (ignora los ingresos manuales y los pagos de otros meses), que `gananciaRepartir = ingresos − gastos fijos − pagos de Octavio`, que la mitad de cada socio es correcta y que *Total Carlos* es su mitad mientras que *Total Octavio* es su mitad más sus pagos directos; un pago sin cliente asociado no se atribuye a Octavio.
- La capa de interfaz se inicializa y ejecuta el render completo sin lanzar errores (verificado con un DOM simulado).
- Revisión funcional recomendada en el navegador: crear / editar / pausar / eliminar clientes, buscar, filtrar por cada chip, ordenar, exportar CSV, cambiar de mes, abrir cada modal, registrar gastos / ingresos / ahorros, alternar el modo oscuro y recargar para confirmar la persistencia; la consola debe quedar sin errores.

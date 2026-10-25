/* ============================================================
   historial.js  (Vista "Historial de meses" - WISP OCTARED)
   ------------------------------------------------------------
   Vista OPT-IN (como el "Mapa de red") que resume cada mes:
     - TABLA por mes con columnas en espanol: Mes, Cobrado, Facturado,
       % de cobranza, Gastos, Ganancia a repartir, Total Carlos,
       Total Octavio y Pagaron/No pagaron. Las filas capturadas
       manualmente se marcan con una badge y traen boton para eliminar.
     - GRAFICA DE BARRAS en SVG inline (sin librerias) de lo Cobrado por
       mes, en orden cronologico ascendente, con colores por variables
       CSS de tema (claro/oscuro) y responsive (scroll-x en movil).
     - Modal "Agregar mes historico" (#modal-mes-historico) para capturar
       meses viejos a mano; se persisten en config.historialManual via
       PCC.guardarMesManual + PCC.guardarConfig (firebase-sync.js lo
       propaga a Firestore como el resto de la config).

   Toda la LOGICA DE DATOS vive en el nucleo window.PCC (FEAT-001):
     PCC.construirHistorial, PCC.resumenMensual, PCC.leerHistorialManual,
     PCC.guardarMesManual, PCC.eliminarMesManual, PCC.cargarClientes,
     PCC.cargarMovimientos, PCC.cargarConfig, PCC.guardarConfig,
     PCC.formatoMoneda, PCC.formatoPeriodo, PCC.mesDe, PCC.aFecha.
   Se lee de forma PEREZOSA dentro de las funciones (obtenerPCC()).

   DISENO para el arnes (sin DOM), igual que red-mapa.js:
     - Un helper PURO (escalaBarras) se expone en window.PCC_HISTORIAL
       SIN tocar el DOM, aunque no exista 'document'.
     - TODO lo que toca el DOM queda tras el guard de 'document'.
   ============================================================ */
(function () {
  "use strict";

  /* ----------------------------------------------------------
     1. Logica PURA (sin DOM) - testeable por el arnes
     ---------------------------------------------------------- */

  // Nombres de mes abreviados en espanol, indexados por mes (1..12).
  var MESES_ABREV = [
    "", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"
  ];

  /**
   * mesAbrev('YYYY-MM') -> 'Oct 26'. Tolera entradas invalidas devolviendo
   * la cadena original (o ''). No toca el DOM.
   * @param {string} mes
   * @returns {string}
   */
  function mesAbrev(mes) {
    if (typeof mes !== "string") {
      return "";
    }
    var m = /^(\d{4})-(\d{2})$/.exec(mes.trim());
    if (!m) {
      return mes;
    }
    var idx = parseInt(m[2], 10);
    var nombre = MESES_ABREV[idx] || m[2];
    return nombre + " " + m[1].slice(2);
  }

  /**
   * escalaBarras(valores): dada una lista de montos (Cobrado por mes),
   * devuelve para cada uno la ALTURA relativa en porcentaje (0..100) sobre
   * el maximo. Si todos son 0 (o no hay datos) devuelve 0 para todos
   * (barras planas). Puro, sin DOM: testeable por el arnes.
   * @param {Array<number>} valores
   * @returns {Array<number>} alturas en porcentaje 0..100
   */
  function escalaBarras(valores) {
    valores = Array.isArray(valores) ? valores : [];
    var max = 0;
    var i;
    for (i = 0; i < valores.length; i++) {
      var v = Number(valores[i]) || 0;
      if (v > max) {
        max = v;
      }
    }
    var out = [];
    for (i = 0; i < valores.length; i++) {
      var val = Number(valores[i]) || 0;
      out.push(max > 0 ? (val / max) * 100 : 0);
    }
    return out;
  }

  // Exponer la logica pura SIN requerir document (para el arnes).
  if (typeof window !== "undefined") {
    window.PCC_HISTORIAL = window.PCC_HISTORIAL || {};
    window.PCC_HISTORIAL.escalaBarras = escalaBarras;
    window.PCC_HISTORIAL.mesAbrev = mesAbrev;
  } else if (typeof globalThis !== "undefined") {
    globalThis.PCC_HISTORIAL = globalThis.PCC_HISTORIAL || {};
    globalThis.PCC_HISTORIAL.escalaBarras = escalaBarras;
    globalThis.PCC_HISTORIAL.mesAbrev = mesAbrev;
  }

  /* ----------------------------------------------------------
     2. A partir de aqui todo toca el DOM: autoprotegerse.
     ---------------------------------------------------------- */
  if (typeof window === "undefined" || typeof document === "undefined") {
    return; // Entorno sin DOM (node --check / arnes): no ejecutar UI.
  }

  var SVG_NS = "http://www.w3.org/2000/svg";
  var MESES_HISTORIAL = 12;

  /* ----------------------------------------------------------
     Helpers de DOM
     ---------------------------------------------------------- */
  function $(sel, ctx) {
    return (ctx || document).querySelector(sel);
  }

  function crearEl(tag, clase, texto) {
    var el = document.createElement(tag);
    if (clase) {
      el.className = clase;
    }
    if (texto != null) {
      el.textContent = texto;
    }
    return el;
  }

  function obtenerPCC() {
    return window.PCC || null;
  }

  function dinero(PCC, n) {
    return PCC && typeof PCC.formatoMoneda === "function"
      ? PCC.formatoMoneda(n)
      : "$" + (Number(n) || 0);
  }

  // 'octubre 2026' -> 'Octubre 2026' (capitaliza la primera letra).
  function periodoLargo(PCC, mes) {
    var txt =
      PCC && typeof PCC.formatoPeriodo === "function"
        ? PCC.formatoPeriodo(mes)
        : mes;
    if (!txt) {
      return mes;
    }
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }

  /* ----------------------------------------------------------
     Datos: obtener la lista de meses del historial
     ---------------------------------------------------------- */
  function obtenerHistorial() {
    var PCC = obtenerPCC();
    if (!PCC || typeof PCC.construirHistorial !== "function") {
      return null;
    }
    var clientes = PCC.cargarClientes ? PCC.cargarClientes() : [];
    var movimientos = PCC.cargarMovimientos ? PCC.cargarMovimientos() : [];
    var cfg = PCC.cargarConfig ? PCC.cargarConfig() : {};
    return PCC.construirHistorial(MESES_HISTORIAL, clientes, movimientos, cfg);
  }

  /* ----------------------------------------------------------
     TABLA por mes dentro de #historial-tabla
     ---------------------------------------------------------- */
  function dibujarTabla(filas) {
    var cont = $("#historial-tabla");
    if (!cont) {
      return;
    }
    var PCC = obtenerPCC();
    cont.innerHTML = "";

    if (!filas || !filas.length) {
      cont.appendChild(
        crearEl("p", "historial-vacio", "Aún no hay meses para mostrar.")
      );
      return;
    }

    var tabla = crearEl("table", "historial-tabla");
    var thead = crearEl("thead");
    var trh = crearEl("tr");
    var columnas = [
      "Mes",
      "Cobrado",
      "Facturado",
      "% de cobranza",
      "Gastos",
      "Ganancia a repartir",
      "Total Carlos",
      "Total Octavio",
      "Pagaron / No pagaron"
    ];
    columnas.forEach(function (c) {
      trh.appendChild(crearEl("th", null, c));
    });
    thead.appendChild(trh);
    tabla.appendChild(thead);

    var tbody = crearEl("tbody");
    filas.forEach(function (f) {
      var esManual = f.fuente === "manual";
      var tr = crearEl("tr", esManual ? "historial-fila--manual" : null);

      // Mes (+ badge si es manual)
      var tdMes = crearEl("td", "historial-celda-mes");
      tdMes.appendChild(crearEl("span", null, periodoLargo(PCC, f.mes)));
      if (esManual) {
        var badge = crearEl("span", "badge badge--aviso historial-badge-manual", "capturado manualmente");
        tdMes.appendChild(badge);
      }
      tr.appendChild(tdMes);

      // Cobrado
      tr.appendChild(crearEl("td", "historial-num", dinero(PCC, f.cobrado)));
      // Facturado
      tr.appendChild(crearEl("td", "historial-num", dinero(PCC, f.facturado)));
      // % de cobranza
      var pct =
        f.facturado > 0 ? Math.round((f.porcentajeCobranza || 0) * 100) + "%" : "—";
      tr.appendChild(crearEl("td", "historial-num", pct));
      // Gastos
      tr.appendChild(crearEl("td", "historial-num", dinero(PCC, f.gastosFijos)));
      // Ganancia a repartir
      tr.appendChild(crearEl("td", "historial-num", dinero(PCC, f.gananciaRepartir)));
      // Total Carlos
      tr.appendChild(crearEl("td", "historial-num", dinero(PCC, f.totalCarlos)));
      // Total Octavio
      tr.appendChild(crearEl("td", "historial-num", dinero(PCC, f.totalOctavio)));
      // Pagaron / No pagaron
      var pagaron =
        f.pagaron == null && f.noPagaron == null
          ? "—"
          : (f.pagaron == null ? 0 : f.pagaron) +
            " / " +
            (f.noPagaron == null ? 0 : f.noPagaron);
      var tdPagos = crearEl("td", "historial-num", pagaron);
      tr.appendChild(tdPagos);

      // Celda de accion: eliminar (solo en filas manuales).
      var tdAccion = crearEl("td", "historial-accion");
      if (esManual) {
        var btnDel = crearEl("button", "historial-eliminar");
        btnDel.innerHTML =
          '<span class="historial-icono" aria-hidden="true">' +
          (window.PCC_ICONOS ? window.PCC_ICONOS.svg("eliminar") : "") +
          "</span><span>eliminar</span>";
        btnDel.type = "button";
        btnDel.setAttribute("data-mes", f.mes);
        btnDel.title = "Eliminar este mes capturado manualmente";
        btnDel.addEventListener("click", function () {
          eliminarMesManual(f.mes);
        });
        tdAccion.appendChild(btnDel);
      }
      tr.appendChild(tdAccion);

      tbody.appendChild(tr);
    });
    tabla.appendChild(tbody);
    cont.appendChild(tabla);
  }

  /* ----------------------------------------------------------
     GRAFICA DE BARRAS (SVG inline, sin librerias) en #historial-grafica
     ------------------------------------------------------------
     Una barra por mes (orden cronologico ascendente de izq a der),
     altura proporcional al Cobrado del mes (escala al maximo). Colores
     por variables CSS de tema mediante clases (.historial-barra, etc.).
     Responsive: ancho minimo por barra + scroll-x del contenedor.
     ---------------------------------------------------------- */
  function dibujarGrafica(filas) {
    var cont = $("#historial-grafica");
    if (!cont) {
      return;
    }
    var PCC = obtenerPCC();
    cont.innerHTML = "";

    if (!filas || !filas.length) {
      cont.appendChild(
        crearEl("p", "historial-vacio", "Sin datos para graficar todavía.")
      );
      return;
    }

    // Orden cronologico ascendente (construirHistorial devuelve descendente).
    var cron = filas.slice().sort(function (a, b) {
      if (a.mes < b.mes) {
        return -1;
      }
      if (a.mes > b.mes) {
        return 1;
      }
      return 0;
    });

    var valores = cron.map(function (f) {
      return Number(f.cobrado) || 0;
    });
    var alturas = escalaBarras(valores);

    // Geometria del SVG (viewBox fijo; el CSS escala el ancho / permite
    // scroll en movil mediante min-width por barra).
    var anchoBarra = 46;
    var huecoBarra = 18;
    var margenX = 12;
    var altoGrafica = 180;
    var altoRotulo = 34; // espacio inferior para el rotulo del mes
    var altoMonto = 16; // espacio superior para el monto
    var n = cron.length;
    var ancho = margenX * 2 + n * anchoBarra + (n - 1) * huecoBarra;
    var alto = altoGrafica + altoRotulo + altoMonto;
    var baseY = altoMonto + altoGrafica;

    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "historial-svg");
    svg.setAttribute("viewBox", "0 0 " + ancho + " " + alto);
    svg.setAttribute("width", String(ancho));
    svg.setAttribute("height", String(alto));
    svg.setAttribute("role", "list");
    // Ancho minimo para que en movil haya scroll-x en vez de barras finas.
    svg.style.minWidth = ancho + "px";

    // Linea base.
    var baseLinea = document.createElementNS(SVG_NS, "line");
    baseLinea.setAttribute("x1", String(margenX));
    baseLinea.setAttribute("y1", String(baseY));
    baseLinea.setAttribute("x2", String(ancho - margenX));
    baseLinea.setAttribute("y2", String(baseY));
    baseLinea.setAttribute("class", "historial-eje");
    svg.appendChild(baseLinea);

    cron.forEach(function (f, i) {
      var x = margenX + i * (anchoBarra + huecoBarra);
      var hBarra = Math.max(2, Math.round((alturas[i] / 100) * altoGrafica));
      var y = baseY - hBarra;

      var g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("class", "historial-barra-g");
      g.setAttribute("role", "listitem");

      var rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(anchoBarra));
      rect.setAttribute("height", String(hBarra));
      rect.setAttribute("rx", "4");
      rect.setAttribute(
        "class",
        "historial-barra" + (f.fuente === "manual" ? " historial-barra--manual" : "")
      );

      // title accesible con mes + monto (tooltip nativo).
      var title = document.createElementNS(SVG_NS, "title");
      title.textContent = periodoLargo(PCC, f.mes) + ": " + dinero(PCC, f.cobrado);
      rect.appendChild(title);
      g.appendChild(rect);

      // Monto encima de la barra (abreviado por el formateador de moneda).
      var monto = document.createElementNS(SVG_NS, "text");
      monto.setAttribute("x", String(x + anchoBarra / 2));
      monto.setAttribute("y", String(Math.max(altoMonto - 2, y - 4)));
      monto.setAttribute("text-anchor", "middle");
      monto.setAttribute("class", "historial-barra-monto");
      monto.textContent = dinero(PCC, f.cobrado);
      g.appendChild(monto);

      // Rotulo del mes debajo.
      var rotulo = document.createElementNS(SVG_NS, "text");
      rotulo.setAttribute("x", String(x + anchoBarra / 2));
      rotulo.setAttribute("y", String(baseY + 20));
      rotulo.setAttribute("text-anchor", "middle");
      rotulo.setAttribute("class", "historial-barra-rotulo");
      rotulo.textContent = mesAbrev(f.mes);
      g.appendChild(rotulo);

      svg.appendChild(g);
    });

    cont.appendChild(svg);
  }

  /* ----------------------------------------------------------
     Redibujar la vista completa (tabla + grafica)
     ---------------------------------------------------------- */
  function dibujarHistorial() {
    var filas = obtenerHistorial();
    if (filas === null) {
      return; // PCC aun no disponible.
    }
    dibujarGrafica(filas);
    dibujarTabla(filas);
  }

  /* ----------------------------------------------------------
     Modal "Agregar mes historico": capturar meses manuales
     ---------------------------------------------------------- */
  function numeroOpcional(valor) {
    if (valor == null || String(valor).trim() === "") {
      return undefined;
    }
    var n = Number(valor);
    return isFinite(n) ? n : undefined;
  }

  function abrirModalMesHistorico() {
    var modal = $("#modal-mes-historico");
    var form = $("#form-mes-historico");
    if (form) {
      form.reset();
    }
    if (modal) {
      modal.hidden = false;
    }
  }

  function cerrarModalMesHistorico() {
    var modal = $("#modal-mes-historico");
    if (modal) {
      modal.hidden = true;
    }
  }

  function guardarMesHistorico(ev) {
    if (ev && typeof ev.preventDefault === "function") {
      ev.preventDefault();
    }
    var PCC = obtenerPCC();
    if (!PCC || typeof PCC.guardarMesManual !== "function") {
      return;
    }

    var mes = ($("#mes-historico-mes") || {}).value || "";
    mes = String(mes).trim();
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      window.alert("Elige un mes válido.");
      return;
    }
    var cobrado = numeroOpcional(($("#mes-historico-cobrado") || {}).value);
    if (cobrado == null) {
      window.alert("Captura el monto cobrado del mes.");
      return;
    }

    var entrada = { mes: mes, cobrado: cobrado };
    var gastos = numeroOpcional(($("#mes-historico-gastos") || {}).value);
    if (gastos !== undefined) {
      entrada.gastos = gastos;
    }
    var carlos = numeroOpcional(($("#mes-historico-carlos") || {}).value);
    if (carlos !== undefined) {
      entrada.totalCarlos = carlos;
    }
    var octavio = numeroOpcional(($("#mes-historico-octavio") || {}).value);
    if (octavio !== undefined) {
      entrada.totalOctavio = octavio;
    }
    var nota = (($("#mes-historico-nota") || {}).value || "").trim();
    if (nota) {
      entrada.nota = nota;
    }

    var cfg = PCC.cargarConfig ? PCC.cargarConfig() : {};
    var nuevoCfg = PCC.guardarMesManual(cfg, entrada);
    if (PCC.guardarConfig) {
      PCC.guardarConfig(nuevoCfg);
    }

    cerrarModalMesHistorico();
    dibujarHistorial();
  }

  function eliminarMesManual(mes) {
    var PCC = obtenerPCC();
    if (!PCC || typeof PCC.eliminarMesManual !== "function") {
      return;
    }
    if (!window.confirm("¿Eliminar el mes capturado manualmente " + mes + "?")) {
      return;
    }
    var cfg = PCC.cargarConfig ? PCC.cargarConfig() : {};
    var nuevoCfg = PCC.eliminarMesManual(cfg, mes);
    if (PCC.guardarConfig) {
      PCC.guardarConfig(nuevoCfg);
    }
    dibujarHistorial();
  }

  /* ----------------------------------------------------------
     Alternar visibilidad de la vista Historial (opt-in)
     ------------------------------------------------------------
     panelesPrincipales excluye AMBAS vistas opt-in (vista-red y
     vista-historial) para que al mostrar una no aparezca la otra como
     panel suelto. Al abrir Historial se cierra la vista Red si estuviera
     abierta, y viceversa (red-mapa.js hace lo simetrico).
     ---------------------------------------------------------- */
  function panelesPrincipales() {
    var cont = $(".contenido");
    if (!cont) {
      return [];
    }
    return Array.prototype.slice.call(cont.querySelectorAll(":scope > .panel"))
      .filter(function (p) {
        return p.id !== "vista-red" && p.id !== "vista-historial";
      });
  }

  function vistaHistorialVisible() {
    var vista = $("#vista-historial");
    return !!(vista && !vista.hidden);
  }

  // Cerrar la vista Red (la otra opt-in) si estuviera abierta y resetear su
  // boton, para que nunca queden las dos visibles a la vez.
  function cerrarVistaRed() {
    var vista = $("#vista-red");
    if (vista && !vista.hidden) {
      vista.hidden = true;
    }
    var btn = $("#btn-red");
    if (btn) {
      btn.classList.remove("btn--primario");
      btn.classList.add("btn--secundario");
      btn.setAttribute("aria-pressed", "false");
    }
  }

  function alternarVistaHistorial() {
    var vista = $("#vista-historial");
    if (!vista) {
      return;
    }
    var mostrar = vista.hidden;
    if (mostrar) {
      cerrarVistaRed();
    }
    vista.hidden = !mostrar;
    panelesPrincipales().forEach(function (p) {
      p.hidden = mostrar;
    });

    var btn = $("#btn-historial");
    if (btn) {
      btn.classList.toggle("btn--primario", mostrar);
      btn.classList.toggle("btn--secundario", !mostrar);
      btn.setAttribute("aria-pressed", mostrar ? "true" : "false");
    }

    if (mostrar) {
      dibujarHistorial();
    }
  }

  /* ----------------------------------------------------------
     Refresco dinamico: envolver window.PCC.UI.render de forma aditiva
     ---------------------------------------------------------- */
  var _renderEnvuelto = false;
  function envolverRender() {
    var PCC = obtenerPCC();
    if (!PCC || !PCC.UI || typeof PCC.UI.render !== "function" || _renderEnvuelto) {
      return _renderEnvuelto;
    }
    var original = PCC.UI.render;
    PCC.UI.render = function () {
      var r = original.apply(this, arguments);
      if (vistaHistorialVisible()) {
        dibujarHistorial();
      }
      return r;
    };
    if (window.PCC_HISTORIAL) {
      window.PCC_HISTORIAL.render = dibujarHistorial;
    }
    _renderEnvuelto = true;
    return true;
  }

  /* ----------------------------------------------------------
     Arranque
     ---------------------------------------------------------- */
  function iniciar() {
    var btn = $("#btn-historial");
    if (btn) {
      btn.addEventListener("click", alternarVistaHistorial);
      btn.setAttribute("aria-pressed", "false");
    }

    var btnMes = $("#btn-mes-historico");
    if (btnMes) {
      btnMes.addEventListener("click", abrirModalMesHistorico);
    }

    var form = $("#form-mes-historico");
    if (form) {
      form.addEventListener("submit", guardarMesHistorico);
    }

    if (!envolverRender()) {
      var intentos = 0;
      var temporizador = setInterval(function () {
        intentos++;
        if (envolverRender() || intentos > 40) {
          clearInterval(temporizador);
        }
      }, 50);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();

/* ============================================================
   red-mapa.js  (Vista "Mapa de red" - WISP OCTARED)
   ------------------------------------------------------------
   Replica el diagrama de la red como LISTAS APILADAS verticales:
     - Leyenda (identificado / falta identificar / AP-infraestructura).
     - Nodo CORE (MikroTik hEX S) centrado arriba.
     - "APs Multipunto (PtMP) y sus antenas": cada AP es una tarjeta
       ancha con cabecera azul (nombre + SSID + MHz + IP) y, debajo,
       dentro de la MISMA tarjeta, sus antenas como FILAS (punto de
       estado + nombre a la izquierda + IP a la derecha).
     - "Enlaces Punto a Punto (PtP)": tarjetas con cabecera teal y su
       cliente dedicado como fila.
     - "Clientes directos por cable (modem)": filas que abren http://IP:8090.
     - "Pendientes / Falta identificar": nodos de infraestructura
       pendientes (.61 TP-LINK, .18) y clientes sin IP (naranja).
     - "En tu lista de cobro, SIN IP aun": lista informativa de nombres.

   CONEXIONES (se dibujan AL FINAL, detras de las tarjetas, en el SVG):
     - INALAMBRICAS (simulan microondas): Core->cada AP, Core->cada punta
       PtP y padre->sus antenas/clientes. Linea PUNTEADA con animacion de
       "ondas" (stroke-dashoffset), azul para AP, teal para PtP.
     - CABLE: Core->cada modem con linea SOLIDA continua (color neutro).

   La INFRAESTRUCTURA viene de window.PCC.TOPOLOGIA; cada AP/punta trae
   su lista de antenas FIJAS (nombre + ip). Los CLIENTES de cobro vienen
   de window.PCC.cargarClientes(): con ip + apId conocido se clasifican
   bajo su padre y se FUSIONAN por IP con las antenas fijas (sin duplicar).

   DISENO para el arnes (sin DOM):
     - La logica PURA (clasificarClientes y fusionarAntenas) se define y se
       expone en window.PCC_RED SIN tocar el DOM, aunque no exista
       'document'. Todo lo que toca el DOM queda tras el guard.
   Lee window.PCC de forma PEREZOSA (dentro de funciones).
   ============================================================ */
(function () {
  "use strict";

  /* ----------------------------------------------------------
     1. Logica PURA (sin DOM) - testeable por el arnes
     ---------------------------------------------------------- */

  function _ip(v) {
    return (v == null ? "" : String(v)).trim();
  }

  /**
   * clasificarClientes: cruza la lista de clientes con la topologia y
   * devuelve, por cada AP/enlace, sus clientes "identificados" (con IP y
   * apId que apunta a ese padre) y una lista global de "pendientes"
   * (clientes sin IP o sin apId reconocible). No toca el DOM.
   *
   * @param {Array<Object>} clientes
   * @param {Object} topologia  window.PCC.TOPOLOGIA
   * @returns {{ padres: Array, identificados: Array, pendientes: Array, porApId: Object }}
   */
  function clasificarClientes(clientes, topologia) {
    clientes = Array.isArray(clientes) ? clientes : [];
    topologia = topologia || {};

    var aps = Array.isArray(topologia.aps) ? topologia.aps : [];
    var puntas = Array.isArray(topologia.puntas) ? topologia.puntas : [];

    var padres = aps.concat(puntas).map(function (p) {
      return {
        id: p.id,
        nombre: p.nombre,
        ip: p.ip,
        tipo: p.tipo, // 'AP' | 'PtP'
        clientes: []
      };
    });

    var porApId = {};
    padres.forEach(function (p) {
      porApId[p.id] = p;
    });

    var identificados = [];
    var pendientes = [];

    clientes.forEach(function (c) {
      if (!c) {
        return;
      }
      var ip = _ip(c.ip);
      var apId = _ip(c.apId);
      if (ip && apId && porApId[apId]) {
        porApId[apId].clientes.push(c);
        identificados.push(c);
      } else {
        pendientes.push(c);
      }
    });

    return {
      padres: padres,
      identificados: identificados,
      pendientes: pendientes,
      porApId: porApId
    };
  }

  /**
   * fusionarAntenas: combina las antenas FIJAS de un padre (infraestructura
   * declarada en la topologia) con los CLIENTES reales clasificados bajo
   * ese padre, DEDUPLICANDO por IP. Devuelve una lista ordenada de filas
   * listas para pintar, sin tocar el DOM.
   *
   * Cada fila: { nombre, ip, estado: 'identificado'|'infra', cliente|null }.
   *   - Si una antena fija coincide por IP con un cliente real, la fila es
   *     'identificado' y lleva el cliente (prioriza el nombre del cliente).
   *   - Antena fija sin cliente real => 'infra' (fila de pura infraestructura).
   *   - Cliente real cuyo IP no esta en las antenas fijas => se agrega al
   *     final como 'identificado'.
   *
   * @param {Object} padre     objeto de topologia (aps[]|puntas[]) con .antenas
   * @param {Array<Object>} clientes  clientes ya clasificados bajo ese padre
   * @returns {Array<Object>} filas
   */
  function fusionarAntenas(padre, clientes) {
    padre = padre || {};
    clientes = Array.isArray(clientes) ? clientes : [];

    var antenas = Array.isArray(padre.antenas) ? padre.antenas : [];
    var porIp = {};
    clientes.forEach(function (c) {
      var ip = _ip(c && c.ip);
      if (ip) {
        porIp[ip] = c;
      }
    });

    var filas = [];
    var usados = {};

    antenas.forEach(function (a) {
      var ip = _ip(a.ip);
      var cliente = ip ? porIp[ip] : null;
      if (cliente) {
        usados[ip] = true;
        filas.push({
          nombre: cliente.nombre || a.nombre || "",
          ip: ip,
          estado: "identificado",
          cliente: cliente
        });
      } else {
        filas.push({
          nombre: a.nombre || "",
          ip: ip,
          estado: "infra",
          cliente: null
        });
      }
    });

    // Clientes reales bajo el padre que no coinciden con ninguna antena fija.
    clientes.forEach(function (c) {
      var ip = _ip(c && c.ip);
      if (ip && usados[ip]) {
        return;
      }
      filas.push({
        nombre: (c && c.nombre) || "",
        ip: ip,
        estado: "identificado",
        cliente: c
      });
    });

    return filas;
  }

  // Exponer la logica pura SIN requerir document (para el arnes).
  if (typeof window !== "undefined") {
    window.PCC_RED = window.PCC_RED || {};
    window.PCC_RED.clasificarClientes = clasificarClientes;
    window.PCC_RED.fusionarAntenas = fusionarAntenas;
  } else if (typeof globalThis !== "undefined") {
    globalThis.PCC_RED = globalThis.PCC_RED || {};
    globalThis.PCC_RED.clasificarClientes = clasificarClientes;
    globalThis.PCC_RED.fusionarAntenas = fusionarAntenas;
  }

  /* ----------------------------------------------------------
     2. A partir de aqui todo toca el DOM: autoprotegerse.
     ---------------------------------------------------------- */
  if (typeof window === "undefined" || typeof document === "undefined") {
    return; // Entorno sin DOM (node --check / arnes): no ejecutar UI.
  }

  var MODEM_PUERTO = ":8090";
  var SVG_NS = "http://www.w3.org/2000/svg";

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

  function urlDeNodo(ip, esModem) {
    if (!ip) {
      return "";
    }
    return esModem ? "http://" + ip + MODEM_PUERTO : "https://" + ip;
  }

  function abrirIp(ip, esModem) {
    var url = urlDeNodo(ip, esModem);
    if (url) {
      window.open(url, "_blank", "noopener");
    }
  }

  function abrirFichaCliente(cliente) {
    var PCC = obtenerPCC();
    if (PCC && PCC.UI && typeof PCC.UI.abrirModalCliente === "function") {
      PCC.UI.abrirModalCliente(cliente);
      return;
    }
    if (window.console && console.info) {
      console.info("Mapa de red: ficha no disponible para", cliente && cliente.nombre);
    }
  }

  // Conectores a dibujar en el SVG. Cada entrada:
  //   { desde: El, hasta: El, tipo: 'ap'|'ptp'|'cable' }
  var _conectores = [];

  /* ----------------------------------------------------------
     Fila dentro de una tarjeta: punto de estado + nombre + IP a la derecha
     ------------------------------------------------------------
     estado: 'identificado' | 'infra' | 'pendiente' | 'modem'
     ---------------------------------------------------------- */
  function construirFila(opts) {
    var fila = crearEl("button", "red-fila-item red-fila-item--" + opts.estado);
    fila.type = "button";
    if (opts.ip) {
      fila.setAttribute("data-ip", opts.ip);
    }
    if (opts.nombre) {
      fila.setAttribute("data-nombre", opts.nombre);
    }

    fila.appendChild(crearEl("span", "red-fila-item__estado"));
    fila.appendChild(crearEl("span", "red-fila-item__nombre", opts.nombre || "—"));

    var ipTxt = opts.ip ? abreviarIp(opts.ip) : "sin IP";
    var ipEl = crearEl("span", "red-fila-item__ip" + (opts.ip ? "" : " red-fila-item__ip--vacia"), ipTxt);
    if (opts.ip) {
      ipEl.title = opts.ip;
    }
    fila.appendChild(ipEl);

    fila.addEventListener("click", function (ev) {
      ev.preventDefault();
      if (opts.cliente && (ev.altKey || !opts.ip)) {
        abrirFichaCliente(opts.cliente);
        return;
      }
      if (opts.ip) {
        abrirIp(opts.ip, opts.estado === "modem");
      } else if (opts.cliente) {
        abrirFichaCliente(opts.cliente);
      }
    });

    if (opts.cliente) {
      fila.title = "Clic: abrir IP · Alt+clic: abrir ficha del cliente";
    } else if (opts.ip) {
      fila.title = "Abrir " + urlDeNodo(opts.ip, opts.estado === "modem");
    }

    return fila;
  }

  // Muestra ".111" como la referencia del usuario, con la IP completa en title.
  function abreviarIp(ip) {
    var partes = String(ip).split(".");
    return partes.length === 4 ? "." + partes[3] : ip;
  }

  /* ----------------------------------------------------------
     Render del mapa completo dentro de #red-lienzo
     ---------------------------------------------------------- */
  function dibujarMapa() {
    var lienzo = $("#red-lienzo");
    if (!lienzo) {
      return;
    }
    var PCC = obtenerPCC();
    if (!PCC || typeof PCC.cargarClientes !== "function" || !PCC.TOPOLOGIA) {
      return;
    }

    var topologia = PCC.TOPOLOGIA;
    var clientes = PCC.cargarClientes();
    var clasif = clasificarClientes(clientes, topologia);

    lienzo.innerHTML = "";
    _conectores = [];

    // SVG inline para los conectores (detras de las tarjetas).
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "red-conectores");
    svg.setAttribute("id", "red-svg");
    lienzo.appendChild(svg);

    // Capa de contenido (encima del SVG).
    var capa = crearEl("div", "red-capa");
    lienzo.appendChild(capa);

    /* --- CORE centrado arriba --- */
    var core = topologia.core || {};
    var seccionCore = crearEl("div", "red-seccion red-seccion--core");
    var tarjetaCore = crearEl("div", "red-core");
    tarjetaCore.setAttribute("data-nombre", core.nombre || "Core");
    if (core.ip) {
      tarjetaCore.setAttribute("data-ip", core.ip);
    }
    tarjetaCore.appendChild(crearEl("span", "red-core__icono", "📡"));
    var coreTxt = crearEl("div", "red-core__texto");
    coreTxt.appendChild(crearEl("span", "red-core__titulo", core.nombre || "Core"));
    coreTxt.appendChild(crearEl("span", "red-core__sub", "RouterOS · red 192.168.10.0/24"));
    if (core.ip) {
      coreTxt.appendChild(crearEl("span", "red-core__ip", core.ip));
    }
    tarjetaCore.appendChild(coreTxt);
    seccionCore.appendChild(tarjetaCore);
    capa.appendChild(seccionCore);

    /* --- APs PtMP y sus antenas --- */
    var apsPadres = (clasif.padres || []).filter(function (p) {
      return p.tipo === "AP";
    });
    if (apsPadres.length) {
      capa.appendChild(tituloSeccion("APs Multipunto (PtMP) y sus antenas"));
      var gridAps = crearEl("div", "red-grid-tarjetas");
      apsPadres.forEach(function (padre) {
        var meta = padreTopologia(topologia, padre.id);
        var tarjeta = construirTarjetaPadre({
          variante: "ap",
          nombre: padre.nombre,
          ip: padre.ip,
          sub: metaCabecera(meta),
          filas: fusionarAntenas(meta, padre.clientes)
        });
        gridAps.appendChild(tarjeta.el);
        _conectores.push({ desde: tarjetaCore, hasta: tarjeta.cabeceraAncla, tipo: "ap" });
        tarjeta.anclasFila.forEach(function (ancla) {
          _conectores.push({ desde: tarjeta.cabeceraAncla, hasta: ancla, tipo: "ap" });
        });
      });
      capa.appendChild(gridAps);
    }

    /* --- Enlaces PtP --- */
    var ptpPadres = (clasif.padres || []).filter(function (p) {
      return p.tipo === "PtP";
    });
    if (ptpPadres.length) {
      capa.appendChild(tituloSeccion("Enlaces Punto a Punto (PtP)"));
      var gridPtp = crearEl("div", "red-grid-tarjetas");
      ptpPadres.forEach(function (padre) {
        var meta = padreTopologia(topologia, padre.id);
        var tarjeta = construirTarjetaPadre({
          variante: "ptp",
          nombre: padre.nombre,
          ip: padre.ip,
          sub: "Enlace dedicado",
          filas: fusionarAntenas(meta, padre.clientes)
        });
        gridPtp.appendChild(tarjeta.el);
        _conectores.push({ desde: tarjetaCore, hasta: tarjeta.cabeceraAncla, tipo: "ptp" });
        tarjeta.anclasFila.forEach(function (ancla) {
          _conectores.push({ desde: tarjeta.cabeceraAncla, hasta: ancla, tipo: "ptp" });
        });
      });
      capa.appendChild(gridPtp);
    }

    /* --- Modems de cable --- */
    var modems = Array.isArray(topologia.modems) ? topologia.modems : [];
    if (modems.length) {
      capa.appendChild(tituloSeccion("Clientes directos por cable (modem)"));
      var tarjetaModem = crearEl("div", "red-tarjeta red-tarjeta--modem");
      var cabModem = crearEl("div", "red-tarjeta__cabecera red-tarjeta__cabecera--modem");
      cabModem.appendChild(crearEl("span", "red-tarjeta__nombre", "Modems por cable"));
      cabModem.appendChild(crearEl("span", "red-tarjeta__ip", "http://IP:8090"));
      tarjetaModem.appendChild(cabModem);
      var cuerpoModem = crearEl("div", "red-tarjeta__cuerpo");
      modems.forEach(function (ip) {
        var fila = construirFila({ estado: "modem", nombre: "Modem", ip: ip });
        cuerpoModem.appendChild(fila);
        _conectores.push({ desde: tarjetaCore, hasta: fila, tipo: "cable" });
      });
      tarjetaModem.appendChild(cuerpoModem);
      capa.appendChild(tarjetaModem);
    }

    /* --- Pendientes / Falta identificar --- */
    var pendInfra = Array.isArray(topologia.pendientes) ? topologia.pendientes : [];
    capa.appendChild(tituloSeccion("Pendientes totales / Falta identificar"));
    var tarjetaPend = crearEl("div", "red-tarjeta red-tarjeta--pendiente");
    var cabPend = crearEl("div", "red-tarjeta__cabecera red-tarjeta__cabecera--pendiente");
    cabPend.appendChild(crearEl("span", "red-tarjeta__nombre", "Falta identificar"));
    tarjetaPend.appendChild(cabPend);
    var cuerpoPend = crearEl("div", "red-tarjeta__cuerpo");

    pendInfra.forEach(function (ip) {
      var etiqueta = ip.indexOf(".61") !== -1 ? "TP-LINK" : "Pendiente";
      cuerpoPend.appendChild(construirFila({ estado: "pendiente", nombre: etiqueta, ip: ip }));
    });
    clasif.pendientes.forEach(function (c) {
      var ip = (c.ip || "").trim();
      cuerpoPend.appendChild(construirFila({
        estado: "pendiente",
        nombre: c.nombre || "Cliente",
        ip: ip || null,
        cliente: c
      }));
    });
    if (!pendInfra.length && !clasif.pendientes.length) {
      cuerpoPend.appendChild(crearEl("p", "red-vacio", "Todo identificado 🎉"));
    }
    tarjetaPend.appendChild(cuerpoPend);
    capa.appendChild(tarjetaPend);

    /* --- Lista informativa: clientes sin IP --- */
    var sinIp = clasif.pendientes.filter(function (c) {
      return !((c.ip || "").trim());
    });
    if (sinIp.length) {
      capa.appendChild(tituloSeccion("En tu lista de cobro, SIN IP aún"));
      var listaSinIp = crearEl("ul", "red-lista-sinip");
      sinIp.forEach(function (c) {
        listaSinIp.appendChild(crearEl("li", "red-lista-sinip__item", c.nombre || "Cliente"));
      });
      capa.appendChild(listaSinIp);
    }

    // Dibujar los conectores una vez el layout esta en el DOM.
    redibujarConectores();
    aplicarFiltroBusqueda();
  }

  function tituloSeccion(texto) {
    var h = crearEl("h3", "red-titulo-seccion", texto);
    return h;
  }

  function metaCabecera(meta) {
    if (!meta) {
      return "";
    }
    var partes = [];
    if (meta.ssid) {
      partes.push("SSID " + meta.ssid);
    }
    if (meta.frecuencia) {
      partes.push(meta.frecuencia);
    }
    return partes.join(" · ");
  }

  /**
   * construirTarjetaPadre: tarjeta ancha con cabecera de color y filas dentro.
   * Devuelve { el, cabeceraAncla, anclasFila } para los conectores.
   */
  function construirTarjetaPadre(opts) {
    var tarjeta = crearEl("div", "red-tarjeta red-tarjeta--" + opts.variante);

    var cab = crearEl("div", "red-tarjeta__cabecera red-tarjeta__cabecera--" + opts.variante);
    cab.setAttribute("data-nombre", opts.nombre || "");
    if (opts.ip) {
      cab.setAttribute("data-ip", opts.ip);
    }
    var cabTxt = crearEl("div", "red-tarjeta__cabtexto");
    cabTxt.appendChild(crearEl("span", "red-tarjeta__nombre", opts.nombre || ""));
    if (opts.sub) {
      cabTxt.appendChild(crearEl("span", "red-tarjeta__sub", opts.sub));
    }
    cab.appendChild(cabTxt);
    if (opts.ip) {
      cab.appendChild(crearEl("span", "red-tarjeta__ip", opts.ip));
    }
    tarjeta.appendChild(cab);

    var cuerpo = crearEl("div", "red-tarjeta__cuerpo");
    var anclasFila = [];
    (opts.filas || []).forEach(function (f) {
      var fila = construirFila({
        estado: f.estado === "identificado" ? "identificado" : "infra",
        nombre: f.nombre,
        ip: f.ip || null,
        cliente: f.cliente || null
      });
      cuerpo.appendChild(fila);
      anclasFila.push(fila);
    });
    if (!(opts.filas || []).length) {
      cuerpo.appendChild(crearEl("p", "red-vacio", "Sin antenas"));
    }
    tarjeta.appendChild(cuerpo);

    return { el: tarjeta, cabeceraAncla: cab, anclasFila: anclasFila };
  }

  function padreTopologia(topologia, id) {
    var listas = [topologia.aps || [], topologia.puntas || []];
    for (var i = 0; i < listas.length; i++) {
      for (var j = 0; j < listas[i].length; j++) {
        if (listas[i][j].id === id) {
          return listas[i][j];
        }
      }
    }
    return null;
  }

  /* ----------------------------------------------------------
     Conectores SVG: inalambricos (punteados, microondas) y cable (solido)
     ---------------------------------------------------------- */
  function redibujarConectores() {
    var svg = $("#red-svg");
    var lienzo = $("#red-lienzo");
    if (!svg || !lienzo) {
      return;
    }
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }

    var base = lienzo.getBoundingClientRect();
    var w = lienzo.scrollWidth;
    var h = lienzo.scrollHeight;
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);

    _conectores.forEach(function (par) {
      if (!par.desde || !par.hasta) {
        return;
      }
      var rp = par.desde.getBoundingClientRect();
      var rh = par.hasta.getBoundingClientRect();

      // Sale del borde inferior del padre, entra por el borde superior del hijo.
      var x1 = rp.left - base.left + lienzo.scrollLeft + rp.width / 2;
      var y1 = rp.bottom - base.top + lienzo.scrollTop;
      var x2 = rh.left - base.left + lienzo.scrollLeft + rh.width / 2;
      var y2 = rh.top - base.top + lienzo.scrollTop;

      // Si el hijo esta por encima o al lado (grilla), ajustar puntos para
      // que la curva no se vea invertida: usar centros verticales.
      if (y2 <= y1) {
        y1 = rp.top - base.top + lienzo.scrollTop + rp.height / 2;
        y2 = rh.top - base.top + lienzo.scrollTop + rh.height / 2;
      }

      var dy = Math.max(18, Math.abs(y2 - y1) / 2);
      var d = "M " + x1 + " " + y1 +
        " C " + x1 + " " + (y1 + dy) +
        " " + x2 + " " + (y2 - dy) +
        " " + x2 + " " + y2;

      var path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "red-conector red-conector--" + par.tipo);
      svg.appendChild(path);
    });
  }

  /* ----------------------------------------------------------
     Buscador: resaltar coincidencias y atenuar el resto
     ---------------------------------------------------------- */
  function aplicarFiltroBusqueda() {
    var input = $("#red-busqueda");
    var lienzo = $("#red-lienzo");
    if (!input || !lienzo) {
      return;
    }
    var termino = (input.value || "").trim().toLowerCase();
    // Objetivos: filas y cabeceras/tarjetas con data-nombre/data-ip.
    var nodos = lienzo.querySelectorAll(
      ".red-fila-item, .red-tarjeta__cabecera, .red-core"
    );

    var i;
    if (!termino) {
      for (i = 0; i < nodos.length; i++) {
        nodos[i].classList.remove("red-match", "red-dim");
      }
      return;
    }

    for (i = 0; i < nodos.length; i++) {
      var nodo = nodos[i];
      var nombre = (nodo.getAttribute("data-nombre") || nodo.textContent || "").toLowerCase();
      var ip = (nodo.getAttribute("data-ip") || "").toLowerCase();
      var coincide = nombre.indexOf(termino) !== -1 || ip.indexOf(termino) !== -1;
      nodo.classList.toggle("red-match", coincide);
      nodo.classList.toggle("red-dim", !coincide);
    }
  }

  /* ----------------------------------------------------------
     Alternar visibilidad de la vista Red (opt-in)
     ---------------------------------------------------------- */
  function panelesPrincipales() {
    var cont = $(".contenido");
    if (!cont) {
      return [];
    }
    return Array.prototype.slice.call(cont.querySelectorAll(":scope > .panel"))
      .filter(function (p) {
        return p.id !== "vista-red";
      });
  }

  function vistaRedVisible() {
    var vista = $("#vista-red");
    return !!(vista && !vista.hidden);
  }

  function alternarVistaRed() {
    var vista = $("#vista-red");
    if (!vista) {
      return;
    }
    var mostrar = vista.hidden;
    vista.hidden = !mostrar;
    panelesPrincipales().forEach(function (p) {
      p.hidden = mostrar;
    });

    var btn = $("#btn-red");
    if (btn) {
      btn.classList.toggle("btn--primario", mostrar);
      btn.classList.toggle("btn--secundario", !mostrar);
      btn.setAttribute("aria-pressed", mostrar ? "true" : "false");
    }

    if (mostrar) {
      dibujarMapa();
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
      if (vistaRedVisible()) {
        dibujarMapa();
      }
      return r;
    };
    if (window.PCC_RED) {
      window.PCC_RED.render = dibujarMapa;
    }
    _renderEnvuelto = true;
    return true;
  }

  /* ----------------------------------------------------------
     Arranque
     ---------------------------------------------------------- */
  var _reResize = null;
  function iniciar() {
    var btn = $("#btn-red");
    if (btn) {
      btn.addEventListener("click", alternarVistaRed);
      btn.setAttribute("aria-pressed", "false");
    }

    var input = $("#red-busqueda");
    if (input) {
      input.addEventListener("input", aplicarFiltroBusqueda);
    }

    window.addEventListener("resize", function () {
      if (!vistaRedVisible()) {
        return;
      }
      // Reflow puede cambiar la grilla (desktop <-> movil): redibujar.
      if (_reResize) {
        clearTimeout(_reResize);
      }
      _reResize = setTimeout(redibujarConectores, 80);
    });

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

/* ============================================================
   red-mapa.js  (FEAT-003 / TAREA B)
   ------------------------------------------------------------
   Vista "Mapa de red" integrada en la app (Opcion A). Replica la
   estructura del diagrama de la red WISP OCTARED:
     - Core MikroTik hEX S (ambar) arriba.
     - Fila de 3 APs PtMP (azul) con sus clientes identificados (verde)
       colgando.
     - 2 enlaces PtP (teal) punta -> cliente dedicado.
     - Modems de cable (abren http://IP:8090).
     - Zona "Falta identificar / sin IP" (naranja) con los clientes sin
       IP mas los nodos pendientes (.61 TP-LINK, .18).

   La INFRAESTRUCTURA (core, APs, puntas, modems, pendientes) viene de
   window.PCC.TOPOLOGIA (expuesta por el nucleo en FEAT-002). Los CLIENTES
   se derivan de window.PCC.cargarClientes(): con IP + apId conocido ->
   nodo identificado bajo su AP/enlace; sin IP o sin apId -> pendientes.

   DISENO IMPORTANTE (para el arnes de pruebas sin DOM):
     - La logica PURA de clasificacion (clasificarClientes) se define y se
       expone en window.PCC_RED SIN tocar el DOM, aunque no exista
       'document'. Asi el arnes la puede probar.
     - Todo el codigo que toca el DOM queda despues de un guard
       'if (typeof document === "undefined") return;'.

   Lee window.PCC de forma PEREZOSA (dentro de funciones / tras
   DOMContentLoaded), nunca en tiempo de carga del modulo.
   ============================================================ */
(function () {
  "use strict";

  /* ----------------------------------------------------------
     1. Logica PURA (sin DOM) - testeable por el arnes
     ---------------------------------------------------------- */

  /**
   * clasificarClientes: cruza la lista de clientes con la topologia de red
   * y devuelve, por cada AP/enlace, sus clientes "identificados" (con IP y
   * apId que apunta a ese padre) y una lista global de "pendientes"
   * (clientes sin IP o sin apId reconocible).
   *
   * No toca el DOM. Es la pieza central del mapa y la unica que prueba el
   * arnes.
   *
   * @param {Array<Object>} clientes  lista de clientes (window.PCC.cargarClientes())
   * @param {Object} topologia        window.PCC.TOPOLOGIA
   * @returns {{ padres: Array, identificados: Array, pendientes: Array, porApId: Object }}
   */
  function clasificarClientes(clientes, topologia) {
    clientes = Array.isArray(clientes) ? clientes : [];
    topologia = topologia || {};

    var aps = Array.isArray(topologia.aps) ? topologia.aps : [];
    var puntas = Array.isArray(topologia.puntas) ? topologia.puntas : [];

    // Lista ordenada de padres validos (APs primero, luego puntas PtP).
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
      var ip = (c.ip || "").trim();
      var apId = (c.apId || "").trim();
      // Identificado: tiene IP y un apId que corresponde a un padre conocido.
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

  // Exponer la logica pura SIN requerir document (para el arnes y para
  // reutilizarla desde el render del DOM mas abajo).
  if (typeof window !== "undefined") {
    window.PCC_RED = window.PCC_RED || {};
    window.PCC_RED.clasificarClientes = clasificarClientes;
  } else if (typeof globalThis !== "undefined") {
    globalThis.PCC_RED = globalThis.PCC_RED || {};
    globalThis.PCC_RED.clasificarClientes = clasificarClientes;
  }

  /* ----------------------------------------------------------
     2. A partir de aqui todo toca el DOM: autoprotegerse.
     ---------------------------------------------------------- */
  if (typeof window === "undefined" || typeof document === "undefined") {
    return; // Entorno sin DOM (node --check / arnes): no ejecutar nada de UI.
  }

  var MODEM_PUERTO = ":8090";

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

  // Ultimo elemento de la ultima pieza que coincide por nombre: no necesario.
  // Guardamos referencias de nodos y conectores para redibujo en resize.
  var _conectores = []; // [{ padreEl, hijoEl }]

  /* ----------------------------------------------------------
     URL de un nodo segun su tipo
     ---------------------------------------------------------- */
  function urlDeNodo(ip, esModem) {
    if (!ip) {
      return "";
    }
    return esModem ? "http://" + ip + MODEM_PUERTO : "https://" + ip;
  }

  function abrirIp(ip, esModem) {
    var url = urlDeNodo(ip, esModem);
    if (!url) {
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  /* ----------------------------------------------------------
     Construccion de un nodo visual
     ------------------------------------------------------------
     variante: 'core' | 'ap' | 'ptp' | 'identificado' | 'pendiente' | 'modem'
     ---------------------------------------------------------- */
  function construirNodo(opts) {
    var nodo = crearEl("button", "red-nodo red-nodo--" + opts.variante);
    nodo.type = "button";
    if (opts.ip) {
      nodo.setAttribute("data-ip", opts.ip);
    }
    if (opts.nombre) {
      nodo.setAttribute("data-nombre", opts.nombre);
    }

    var titulo = crearEl("span", "red-nodo__titulo", opts.titulo || "");
    nodo.appendChild(titulo);

    if (opts.sub) {
      nodo.appendChild(crearEl("span", "red-nodo__sub", opts.sub));
    }
    if (opts.ip) {
      nodo.appendChild(crearEl("span", "red-nodo__ip", opts.ip));
    } else if (opts.ipVacia) {
      nodo.appendChild(crearEl("span", "red-nodo__ip red-nodo__ip--vacia", "sin IP"));
    }

    // Interaccion: abrir IP en pestana nueva (si tiene). Si es un cliente,
    // ofrecer tambien abrir su ficha (click con alt / o cuando no hay IP).
    nodo.addEventListener("click", function (ev) {
      ev.preventDefault();
      if (opts.cliente && (ev.altKey || !opts.ip)) {
        abrirFichaCliente(opts.cliente);
        return;
      }
      if (opts.ip) {
        abrirIp(opts.ip, opts.variante === "modem");
      } else if (opts.cliente) {
        abrirFichaCliente(opts.cliente);
      }
    });

    if (opts.cliente) {
      nodo.title = "Clic: abrir IP · Alt+clic: abrir ficha del cliente";
    } else if (opts.ip) {
      nodo.title = opts.variante === "modem"
        ? "Abrir " + urlDeNodo(opts.ip, true)
        : "Abrir " + urlDeNodo(opts.ip, false);
    }

    return nodo;
  }

  /**
   * abrirFichaCliente: reutiliza el modal de cliente de la app (si existe el
   * hook) para editar/identificar al cliente desde el mapa.
   */
  function abrirFichaCliente(cliente) {
    var PCC = obtenerPCC();
    if (PCC && PCC.UI && typeof PCC.UI.abrirModalCliente === "function") {
      PCC.UI.abrirModalCliente(cliente);
      return;
    }
    // Si no hay hook disponible, al menos avisar por consola (no romper).
    if (window.console && console.info) {
      console.info("Mapa de red: ficha de cliente no disponible para", cliente && cliente.nombre);
    }
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

    // Reiniciar el lienzo.
    lienzo.innerHTML = "";
    _conectores = [];

    // SVG inline para los conectores (debe quedar DETRAS de los nodos).
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "red-conectores");
    svg.setAttribute("id", "red-svg");
    lienzo.appendChild(svg);

    // Contenedor de nodos (encima del SVG).
    var capa = crearEl("div", "red-capa");
    lienzo.appendChild(capa);

    // --- Fila 1: Core ---
    var filaCore = crearEl("div", "red-fila red-fila--core");
    var core = topologia.core || {};
    var nodoCore = construirNodo({
      variante: "core",
      titulo: core.nombre || "Core",
      sub: "RouterOS · red " + "192.168.10.0/24",
      ip: core.ip
    });
    filaCore.appendChild(nodoCore);
    capa.appendChild(filaCore);

    // --- Fila 2: APs PtMP con sus clientes colgando ---
    var filaAps = crearEl("div", "red-fila red-fila--aps");
    (clasif.padres || []).forEach(function (padre) {
      if (padre.tipo !== "AP") {
        return;
      }
      var columna = crearEl("div", "red-columna");
      var meta = padreTopologia(topologia, padre.id);
      var nodoAp = construirNodo({
        variante: "ap",
        titulo: padre.nombre,
        sub: meta && meta.ssid ? "SSID " + meta.ssid : "",
        ip: padre.ip
      });
      columna.appendChild(nodoAp);
      _conectores.push({ padreEl: nodoCore, hijoEl: nodoAp });

      var hijos = crearEl("div", "red-hijos");
      padre.clientes.forEach(function (c) {
        var nodoCli = construirNodo({
          variante: "identificado",
          titulo: c.nombre || "Cliente",
          ip: c.ip,
          cliente: c
        });
        hijos.appendChild(nodoCli);
        _conectores.push({ padreEl: nodoAp, hijoEl: nodoCli });
      });
      if (!padre.clientes.length) {
        hijos.appendChild(crearEl("p", "red-vacio", "Sin clientes identificados"));
      }
      columna.appendChild(hijos);
      filaAps.appendChild(columna);
    });
    capa.appendChild(filaAps);

    // --- Fila 3: Enlaces PtP (punta -> cliente dedicado) ---
    var filaPtp = crearEl("div", "red-fila red-fila--ptp");
    (clasif.padres || []).forEach(function (padre) {
      if (padre.tipo !== "PtP") {
        return;
      }
      var columna = crearEl("div", "red-columna");
      var nodoPunta = construirNodo({
        variante: "ptp",
        titulo: padre.nombre,
        sub: "Enlace dedicado",
        ip: padre.ip
      });
      columna.appendChild(nodoPunta);
      _conectores.push({ padreEl: nodoCore, hijoEl: nodoPunta });

      var hijos = crearEl("div", "red-hijos");
      padre.clientes.forEach(function (c) {
        var nodoCli = construirNodo({
          variante: "identificado",
          titulo: c.nombre || "Cliente",
          ip: c.ip,
          cliente: c
        });
        hijos.appendChild(nodoCli);
        _conectores.push({ padreEl: nodoPunta, hijoEl: nodoCli });
      });
      if (!padre.clientes.length) {
        hijos.appendChild(crearEl("p", "red-vacio", "Sin cliente asignado"));
      }
      columna.appendChild(hijos);
      filaPtp.appendChild(columna);
    });
    capa.appendChild(filaPtp);

    // --- Fila 4: Modems de cable (acceso http://IP:8090) ---
    var modems = Array.isArray(topologia.modems) ? topologia.modems : [];
    if (modems.length) {
      var bloqueModems = crearEl("div", "red-bloque red-bloque--modems");
      bloqueModems.appendChild(crearEl("h3", "red-bloque__titulo", "Modems de cable (http://IP:8090)"));
      var gridModems = crearEl("div", "red-grid");
      modems.forEach(function (ip) {
        var nodoModem = construirNodo({
          variante: "modem",
          titulo: "Modem",
          ip: ip
        });
        gridModems.appendChild(nodoModem);
      });
      bloqueModems.appendChild(gridModems);
      capa.appendChild(bloqueModems);
    }

    // --- Fila 5: Falta identificar / sin IP (naranja) ---
    var bloquePend = crearEl("div", "red-bloque red-bloque--pendientes");
    bloquePend.appendChild(crearEl("h3", "red-bloque__titulo", "Falta identificar / sin IP"));
    var gridPend = crearEl("div", "red-grid");

    clasif.pendientes.forEach(function (c) {
      var nodoCli = construirNodo({
        variante: "pendiente",
        titulo: c.nombre || "Cliente",
        ipVacia: !((c.ip || "").trim()),
        ip: (c.ip || "").trim() || null,
        cliente: c
      });
      gridPend.appendChild(nodoCli);
    });

    // Nodos pendientes de infraestructura (sin cliente): .61 TP-LINK, .18
    var pendInfra = Array.isArray(topologia.pendientes) ? topologia.pendientes : [];
    pendInfra.forEach(function (ip) {
      var etiqueta = ip.indexOf(".61") !== -1 ? "TP-LINK" : "Pendiente";
      var nodoInfra = construirNodo({
        variante: "pendiente",
        titulo: etiqueta,
        ip: ip
      });
      gridPend.appendChild(nodoInfra);
    });

    if (!clasif.pendientes.length && !pendInfra.length) {
      gridPend.appendChild(crearEl("p", "red-vacio", "Todo identificado 🎉"));
    }
    bloquePend.appendChild(gridPend);
    capa.appendChild(bloquePend);

    // Dibujar los conectores una vez que el layout esta en el DOM.
    redibujarConectores();

    // Reaplicar el filtro de busqueda vigente (si hay texto).
    aplicarFiltroBusqueda();
  }

  /**
   * padreTopologia: localiza el objeto de topologia (AP o punta) por id para
   * leer metadatos como ssid/frecuencia.
   */
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
     Conectores SVG curvos (bezier) padre -> hijo
     ---------------------------------------------------------- */
  function redibujarConectores() {
    var svg = $("#red-svg");
    var lienzo = $("#red-lienzo");
    if (!svg || !lienzo) {
      return;
    }
    // Limpiar paths previos.
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }

    var base = lienzo.getBoundingClientRect();
    // Ajustar el tamano del SVG al contenido real del lienzo.
    svg.setAttribute("width", String(lienzo.scrollWidth));
    svg.setAttribute("height", String(lienzo.scrollHeight));
    svg.setAttribute("viewBox", "0 0 " + lienzo.scrollWidth + " " + lienzo.scrollHeight);

    var svgNS = "http://www.w3.org/2000/svg";

    _conectores.forEach(function (par) {
      if (!par.padreEl || !par.hijoEl) {
        return;
      }
      var rp = par.padreEl.getBoundingClientRect();
      var rh = par.hijoEl.getBoundingClientRect();

      // Coordenadas relativas al lienzo (teniendo en cuenta el scroll interno).
      var x1 = rp.left - base.left + lienzo.scrollLeft + rp.width / 2;
      var y1 = rp.bottom - base.top + lienzo.scrollTop;
      var x2 = rh.left - base.left + lienzo.scrollLeft + rh.width / 2;
      var y2 = rh.top - base.top + lienzo.scrollTop;

      var dy = Math.max(20, (y2 - y1) / 2);
      var d = "M " + x1 + " " + y1 +
        " C " + x1 + " " + (y1 + dy) +
        " " + x2 + " " + (y2 - dy) +
        " " + x2 + " " + y2;

      var path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "red-conector");
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
    var nodos = lienzo.querySelectorAll(".red-nodo");

    if (!termino) {
      for (var i = 0; i < nodos.length; i++) {
        nodos[i].classList.remove("red-nodo--match", "red-nodo--dim");
      }
      return;
    }

    for (var k = 0; k < nodos.length; k++) {
      var nodo = nodos[k];
      var nombre = (nodo.getAttribute("data-nombre") || nodo.textContent || "").toLowerCase();
      var ip = (nodo.getAttribute("data-ip") || "").toLowerCase();
      var coincide = nombre.indexOf(termino) !== -1 || ip.indexOf(termino) !== -1;
      nodo.classList.toggle("red-nodo--match", coincide);
      nodo.classList.toggle("red-nodo--dim", !coincide);
    }
  }

  /* ----------------------------------------------------------
     Alternar visibilidad de la vista Red (opt-in)
     ---------------------------------------------------------- */
  function panelesPrincipales() {
    // Secciones de la vista normal: todas las .panel dentro de .contenido
    // excepto la propia vista de red.
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
    var mostrar = vista.hidden; // si estaba oculta, la mostramos.
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
     ------------------------------------------------------------
     Asi, cuando la app re-renderiza (incluido firebase-sync.js al llegar
     snapshots remotos), si la vista Red esta visible, el mapa se redibuja.
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
    // Exponer tambien un render del mapa para quien lo necesite.
    if (window.PCC_RED) {
      window.PCC_RED.render = dibujarMapa;
    }
    _renderEnvuelto = true;
    return true;
  }

  /* ----------------------------------------------------------
     Arranque
     ---------------------------------------------------------- */
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
      if (vistaRedVisible()) {
        redibujarConectores();
      }
    });

    // Envolver el render de la UI en cuanto este disponible. app.js asigna
    // window.PCC.UI dentro de iniciar() (tras DOMContentLoaded); reintentar
    // brevemente por si el orden de ejecucion no lo tiene listo aun.
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

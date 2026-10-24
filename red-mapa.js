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
     - "Clientes directos por cable (modem)": CADA MODEM ES UN CLIENTE. Lista
       los clientes con tipoConexion 'Modem' e IP (nombre + IP, abren
       http://IP:8090) mas los "huecos por ligar" (IPs de modem conocidas en
       topologia.modems que aun no tienen cliente) con su boton de asignar.
     - "Pendientes / Falta identificar": nodos de infraestructura
       pendientes (.61 TP-LINK, .18) y clientes sin IP (naranja).

   ASIGNAR/LIGAR DESDE EL MAPA:
     - Cada AP, cada enlace PtP y la seccion de modems traen un boton
       "➕ Asignar cliente" que abre un mini-modal (patron .modal) con un
       <select> de los clientes pendientes (clientesSinAsignar) y un input de
       IP. Al confirmar se setea ip/tipoConexion/apId en el cliente elegido, se
       guarda con PCC.guardarClientes (firebase-sync lo propaga a Firestore) y
       se vuelve a dibujar el mapa, por lo que el cliente salta de pendientes
       a su seccion sin abrir la ficha.
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
     - La logica PURA (clasificarClientes, fusionarAntenas, clientesSinAsignar
       e ipValida) se define y se expone en window.PCC_RED SIN tocar el DOM,
       aunque no exista 'document'. Todo lo que toca el DOM queda tras el guard.
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
   * apId que apunta a ese padre), una lista de clientes-MODEM (tipoConexion
   * 'Modem' con IP, directos al router, sin depender de apId) y una lista
   * global de "pendientes" (clientes sin IP o sin forma de ubicarlos). No
   * toca el DOM.
   *
   * Reglas de clasificacion (en orden):
   *   1. tipoConexion === 'Modem' con IP no vacia -> MODEM (los modems son
   *      clientes directos por cable al router; NO cuelgan de un AP, por lo
   *      que NO requieren apId). Este es el arreglo del bug (p.ej. Perrucha
   *      .13 marcada como Modem con IP se queda abajo en "falta identificar").
   *   2. IP no vacia + apId que apunta a un AP/enlace conocido -> IDENTIFICADO
   *      bajo ese padre (AP o PtP), como hasta ahora.
   *   3. Cualquier otro caso -> PENDIENTE (sin IP, o con IP pero sin apId
   *      reconocible: no sabemos de que AP cuelga).
   *
   * @param {Array<Object>} clientes
   * @param {Object} topologia  window.PCC.TOPOLOGIA
   * @returns {{ padres: Array, identificados: Array, modems: Array, pendientes: Array, porApId: Object }}
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
    var modems = [];
    var pendientes = [];

    clientes.forEach(function (c) {
      if (!c) {
        return;
      }
      var ip = _ip(c.ip);
      var apId = _ip(c.apId);
      var tipo = _ip(c.tipoConexion);

      // 1) Cliente-modem con IP: va a la seccion de modems (directo al router).
      if (tipo === "Modem" && ip) {
        modems.push(c);
        return;
      }
      // 2) Cliente con IP + apId reconocido: bajo su AP/enlace.
      if (ip && apId && porApId[apId]) {
        porApId[apId].clientes.push(c);
        identificados.push(c);
        return;
      }
      // 3) Resto: falta identificar.
      pendientes.push(c);
    });

    return {
      padres: padres,
      identificados: identificados,
      modems: modems,
      pendientes: pendientes,
      porApId: porApId
    };
  }

  /**
   * clientesSinAsignar: filtra la lista de clientes dejando solo los que aun
   * NO estan ubicados en la red y, por tanto, se pueden "ligar" desde el mapa.
   * Un cliente esta sin asignar si clasificarClientes lo manda a "pendientes"
   * (sin IP, o con IP pero sin forma de ubicarlo). Logica pura (sin DOM),
   * reutilizada por el selector de "Asignar cliente".
   *
   * @param {Array<Object>} clientes
   * @param {Object} topologia  window.PCC.TOPOLOGIA
   * @returns {Array<Object>} clientes pendientes de ligar (ordenados por nombre)
   */
  function clientesSinAsignar(clientes, topologia) {
    var clasif = clasificarClientes(clientes, topologia);
    return clasif.pendientes.slice().sort(function (a, b) {
      var na = ((a && a.nombre) || "").toLowerCase();
      var nb = ((b && b.nombre) || "").toLowerCase();
      return na < nb ? -1 : na > nb ? 1 : 0;
    });
  }

  /**
   * ipValida: validacion minima de IPv4 (cuatro octetos 0-255). Sirve para el
   * formulario de "Asignar cliente" sin depender del DOM. Una cadena vacia es
   * INVALIDA (se exige IP para ligar). Logica pura.
   *
   * @param {string} ip
   * @returns {boolean}
   */
  function ipValida(ip) {
    var s = _ip(ip);
    if (!s) {
      return false;
    }
    var partes = s.split(".");
    if (partes.length !== 4) {
      return false;
    }
    for (var i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(partes[i])) {
        return false;
      }
      var n = Number(partes[i]);
      if (n < 0 || n > 255) {
        return false;
      }
    }
    return true;
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
    window.PCC_RED.clientesSinAsignar = clientesSinAsignar;
    window.PCC_RED.ipValida = ipValida;
  } else if (typeof globalThis !== "undefined") {
    globalThis.PCC_RED = globalThis.PCC_RED || {};
    globalThis.PCC_RED.clasificarClientes = clasificarClientes;
    globalThis.PCC_RED.fusionarAntenas = fusionarAntenas;
    globalThis.PCC_RED.clientesSinAsignar = clientesSinAsignar;
    globalThis.PCC_RED.ipValida = ipValida;
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

  /* ----------------------------------------------------------
     Asignar/ligar un cliente pendiente desde el mapa
     ------------------------------------------------------------
     Un pequeno modal propio del mapa: un <select> con los clientes que
     faltan por identificar (clientesSinAsignar), un input de IP (con la IP
     sugerida precargada cuando se liga un "hueco" de modem conocido) y un
     boton Asignar. Al confirmar se setean ip/tipoConexion/apId en el cliente
     elegido, se persiste via PCC.guardarClientes (firebase-sync lo propaga a
     la nube) y se vuelve a dibujar el mapa.
     ---------------------------------------------------------- */

  // Etiqueta legible del destino segun tipo de conexion.
  function etiquetaDestino(tipo, nombrePadre) {
    if (tipo === "Modem") {
      return "modem directo por cable";
    }
    if (tipo === "PtP") {
      return "enlace PtP " + (nombrePadre || "");
    }
    return "AP " + (nombrePadre || "");
  }

  // Abre el modal de asignacion para un destino concreto.
  //   destino = { tipo:'AP'|'PtP'|'Modem', apId:string, nombre:string, ipSugerida?:string }
  function abrirAsignarCliente(destino) {
    var PCC = obtenerPCC();
    if (!PCC || typeof PCC.cargarClientes !== "function") {
      return;
    }
    destino = destino || {};
    var pendientes = (window.PCC_RED && typeof window.PCC_RED.clientesSinAsignar === "function")
      ? window.PCC_RED.clientesSinAsignar(PCC.cargarClientes(), PCC.TOPOLOGIA)
      : [];

    var modal = construirModalAsignar(destino, pendientes);
    document.body.appendChild(modal);
    // Enfocar el primer control util.
    var sel = modal.querySelector(".red-asignar__select");
    if (sel) {
      sel.focus();
    }
  }

  function cerrarModalAsignar() {
    var m = $("#red-modal-asignar");
    if (m && m.parentNode) {
      m.parentNode.removeChild(m);
    }
  }

  function construirModalAsignar(destino, pendientes) {
    var modal = crearEl("div", "modal red-modal-asignar");
    modal.id = "red-modal-asignar";

    var overlay = crearEl("div", "modal__overlay");
    overlay.addEventListener("click", cerrarModalAsignar);
    modal.appendChild(overlay);

    var dialogo = crearEl("div", "modal__dialogo");
    dialogo.setAttribute("role", "dialog");
    dialogo.setAttribute("aria-modal", "true");
    dialogo.setAttribute("aria-label", "Asignar cliente");

    var cab = crearEl("div", "modal__cabecera");
    cab.appendChild(crearEl("h2", "modal__titulo", "Asignar cliente"));
    var cerrar = crearEl("button", "btn btn--icono", "✕");
    cerrar.type = "button";
    cerrar.setAttribute("aria-label", "Cerrar");
    cerrar.addEventListener("click", cerrarModalAsignar);
    cab.appendChild(cerrar);
    dialogo.appendChild(cab);

    var cuerpo = crearEl("div", "modal__cuerpo");
    cuerpo.appendChild(crearEl(
      "p",
      "campo-ayuda",
      "Elige un cliente que falta por identificar y captura su IP para ligarlo a: " +
        etiquetaDestino(destino.tipo, destino.nombre) + "."
    ));

    if (!pendientes.length) {
      cuerpo.appendChild(crearEl(
        "p",
        "red-vacio",
        "No hay clientes pendientes por ligar. Todos tus clientes ya tienen IP asignada 🎉"
      ));
      var accionesVacio = crearEl("div", "modal__acciones");
      var cancelarV = crearEl("button", "btn btn--secundario", "Cerrar");
      cancelarV.type = "button";
      cancelarV.addEventListener("click", cerrarModalAsignar);
      accionesVacio.appendChild(cancelarV);
      cuerpo.appendChild(accionesVacio);
      dialogo.appendChild(cuerpo);
      modal.appendChild(dialogo);
      return modal;
    }

    // Selector de cliente.
    var grpCliente = crearEl("div", "campo-grupo");
    grpCliente.appendChild(crearEl("label", "campo-label", "Cliente pendiente"));
    var select = crearEl("select", "campo campo--select red-asignar__select");
    pendientes.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c.id;
      var sufijo = (c.ip && String(c.ip).trim()) ? " · IP " + c.ip : "";
      opt.textContent = (c.nombre || "Cliente") + sufijo;
      select.appendChild(opt);
    });
    grpCliente.appendChild(select);
    cuerpo.appendChild(grpCliente);

    // Input de IP (precargado con la IP sugerida del hueco, si la hay).
    var grpIp = crearEl("div", "campo-grupo");
    grpIp.appendChild(crearEl("label", "campo-label", "IP del cliente"));
    var inputIp = crearEl("input", "campo red-asignar__ip");
    inputIp.type = "text";
    inputIp.placeholder = "192.168.10.x";
    if (destino.ipSugerida) {
      inputIp.value = destino.ipSugerida;
    } else {
      // Precargar la IP ya capturada en el cliente seleccionado, si la trae.
      var primero = pendientes[0];
      if (primero && primero.ip) {
        inputIp.value = primero.ip;
      }
    }
    grpIp.appendChild(inputIp);
    var ayudaIp = crearEl("div", "campo-ayuda red-asignar__error");
    ayudaIp.hidden = true;
    grpIp.appendChild(ayudaIp);
    cuerpo.appendChild(grpIp);

    // Al cambiar de cliente, sugerir su IP previa (si no venia un hueco fijo).
    select.addEventListener("change", function () {
      if (destino.ipSugerida) {
        return;
      }
      var elegido = pendientes.filter(function (c) {
        return String(c.id) === String(select.value);
      })[0];
      inputIp.value = (elegido && elegido.ip) ? elegido.ip : "";
    });

    var acciones = crearEl("div", "modal__acciones");
    var cancelar = crearEl("button", "btn btn--secundario", "Cancelar");
    cancelar.type = "button";
    cancelar.addEventListener("click", cerrarModalAsignar);
    var confirmar = crearEl("button", "btn btn--primario", "Asignar");
    confirmar.type = "button";
    confirmar.addEventListener("click", function () {
      var ip = (inputIp.value || "").trim();
      var validador = (window.PCC_RED && typeof window.PCC_RED.ipValida === "function")
        ? window.PCC_RED.ipValida
        : function (v) { return !!(v && String(v).trim()); };
      if (!validador(ip)) {
        ayudaIp.hidden = false;
        ayudaIp.textContent = "Escribe una IP válida (ej. 192.168.10.13).";
        inputIp.focus();
        return;
      }
      var ok = ligarCliente(select.value, ip, destino);
      if (ok) {
        cerrarModalAsignar();
      }
    });
    acciones.appendChild(cancelar);
    acciones.appendChild(confirmar);
    cuerpo.appendChild(acciones);

    dialogo.appendChild(cuerpo);
    modal.appendChild(dialogo);
    return modal;
  }

  /**
   * ligarCliente: aplica la asignacion al cliente elegido y persiste.
   * Setea ip + tipoConexion + apId (apId vacio para modem) y guarda via los
   * SETTERS de PCC (PCC.guardarClientes), que firebase-sync parchea para
   * espejar a Firestore. Redibuja el mapa al terminar.
   *
   * @param {string} clienteId
   * @param {string} ip
   * @param {Object} destino { tipo, apId }
   * @returns {boolean} true si se guardo
   */
  function ligarCliente(clienteId, ip, destino) {
    var PCC = obtenerPCC();
    if (!PCC || typeof PCC.cargarClientes !== "function" || typeof PCC.guardarClientes !== "function") {
      return false;
    }
    var lista = PCC.cargarClientes();
    var encontrado = false;
    var nuevaLista = lista.map(function (c) {
      if (!c || String(c.id) !== String(clienteId)) {
        return c;
      }
      encontrado = true;
      var copia = {};
      for (var k in c) {
        if (Object.prototype.hasOwnProperty.call(c, k)) {
          copia[k] = c[k];
        }
      }
      copia.ip = String(ip).trim();
      copia.tipoConexion = destino.tipo || "";
      // Los modems son directos al router: no cuelgan de un AP -> apId vacio.
      copia.apId = destino.tipo === "Modem" ? "" : (destino.apId || "");
      return copia;
    });
    if (!encontrado) {
      return false;
    }
    PCC.guardarClientes(nuevaLista);
    // Re-render: si existe el render envuelto de la UI lo usa; si no, redibuja
    // directamente el mapa. guardarClientes de firebase-sync ya propago a la nube.
    if (PCC.UI && typeof PCC.UI.render === "function") {
      PCC.UI.render();
    } else {
      dibujarMapa();
    }
    return true;
  }

  // Boton "➕ Asignar cliente" reutilizable para cabeceras de seccion/tarjeta.
  function botonAsignar(destino) {
    var btn = crearEl("button", "red-asignar-btn", "➕ Asignar cliente");
    btn.type = "button";
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      abrirAsignarCliente(destino);
    });
    return btn;
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
          filas: fusionarAntenas(meta, padre.clientes),
          destino: { tipo: "AP", apId: padre.id, nombre: padre.nombre }
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
          filas: fusionarAntenas(meta, padre.clientes),
          destino: { tipo: "PtP", apId: padre.id, nombre: padre.nombre }
        });
        gridPtp.appendChild(tarjeta.el);
        _conectores.push({ desde: tarjetaCore, hasta: tarjeta.cabeceraAncla, tipo: "ptp" });
        tarjeta.anclasFila.forEach(function (ancla) {
          _conectores.push({ desde: tarjeta.cabeceraAncla, hasta: ancla, tipo: "ptp" });
        });
      });
      capa.appendChild(gridPtp);
    }

    /* --- Modems de cable (CADA MODEM = UN CLIENTE) ---
       Los modems son clientes directos por cable al router (no infraestructura
       compartida). Se listan los CLIENTES con tipoConexion 'Modem' e IP
       (nombre + IP). Las IPs de topologia.modems se tratan como "huecos"
       de modems conocidos AUN SIN CLIENTE ligado: se muestran como filas
       "por ligar" (con su IP sugerida) y NO se duplican si ya hay un cliente
       con esa IP. */
    var modemsFijos = Array.isArray(topologia.modems) ? topologia.modems : [];
    var clientesModem = Array.isArray(clasif.modems) ? clasif.modems : [];
    capa.appendChild(tituloSeccion("Clientes directos por cable (modem)"));
    var tarjetaModem = crearEl("div", "red-tarjeta red-tarjeta--modem");
    var cabModem = crearEl("div", "red-tarjeta__cabecera red-tarjeta__cabecera--modem");
    var cabModemTxt = crearEl("div", "red-tarjeta__cabtexto");
    cabModemTxt.appendChild(crearEl("span", "red-tarjeta__nombre", "Modems por cable"));
    cabModemTxt.appendChild(crearEl("span", "red-tarjeta__sub", "cada modem es un cliente · http://IP:8090"));
    cabModem.appendChild(cabModemTxt);
    cabModem.appendChild(botonAsignar({ tipo: "Modem", apId: "", nombre: "" }));
    tarjetaModem.appendChild(cabModem);
    var cuerpoModem = crearEl("div", "red-tarjeta__cuerpo");

    // IPs de los clientes-modem ya ligados (para no duplicar los huecos fijos).
    var ipsConCliente = {};
    clientesModem.forEach(function (c) {
      var ip = (c.ip || "").trim();
      if (ip) {
        ipsConCliente[ip] = true;
      }
      var filaCli = construirFila({
        estado: "modem",
        nombre: c.nombre || "Cliente",
        ip: ip || null,
        cliente: c
      });
      cuerpoModem.appendChild(filaCli);
      _conectores.push({ desde: tarjetaCore, hasta: filaCli, tipo: "cable" });
    });

    // Huecos: IPs de modem conocidas sin cliente ligado todavia -> "por ligar".
    modemsFijos.forEach(function (ip) {
      if (ipsConCliente[ip]) {
        return; // ya hay un cliente real con esa IP.
      }
      var filaHueco = crearEl("div", "red-fila-item red-fila-item--modem red-fila-item--hueco");
      filaHueco.appendChild(crearEl("span", "red-fila-item__estado"));
      filaHueco.appendChild(crearEl("span", "red-fila-item__nombre", "Por ligar"));
      filaHueco.appendChild(crearEl("span", "red-fila-item__ip", abreviarIp(ip)));
      var btnHueco = botonAsignar({ tipo: "Modem", apId: "", nombre: "", ipSugerida: ip });
      btnHueco.classList.add("red-asignar-btn--mini");
      filaHueco.appendChild(btnHueco);
      cuerpoModem.appendChild(filaHueco);
      _conectores.push({ desde: tarjetaCore, hasta: filaHueco, tipo: "cable" });
    });

    if (!clientesModem.length && !modemsFijos.length) {
      cuerpoModem.appendChild(crearEl("p", "red-vacio", "Sin modems por ahora"));
    }
    tarjetaModem.appendChild(cuerpoModem);
    capa.appendChild(tarjetaModem);

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
    // Control para ligar un cliente pendiente a este AP/enlace desde el mapa.
    if (opts.destino) {
      var pie = crearEl("div", "red-tarjeta__pie");
      pie.appendChild(botonAsignar(opts.destino));
      cuerpo.appendChild(pie);
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
        // Excluir AMBAS vistas opt-in: asi al alternar el Mapa de red no se
        // muestra la vista Historial como panel suelto (y viceversa).
        return p.id !== "vista-red" && p.id !== "vista-historial";
      });
  }

  function vistaRedVisible() {
    var vista = $("#vista-red");
    return !!(vista && !vista.hidden);
  }

  // Al abrir el Mapa de red, cerrar la otra vista opt-in (Historial) si
  // estuviera visible y resetear su boton, para que nunca queden las dos.
  function cerrarVistaHistorial() {
    var vista = $("#vista-historial");
    if (vista && !vista.hidden) {
      vista.hidden = true;
    }
    var btn = $("#btn-historial");
    if (btn) {
      btn.classList.remove("btn--primario");
      btn.classList.add("btn--secundario");
      btn.setAttribute("aria-pressed", "false");
    }
  }

  function alternarVistaRed() {
    var vista = $("#vista-red");
    if (!vista) {
      return;
    }
    var mostrar = vista.hidden;
    if (mostrar) {
      cerrarVistaHistorial();
    }
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

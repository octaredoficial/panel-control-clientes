/* ============================================================
   nav-movil.js  (Barra de navegacion inferior "tipo app" - WISP OCTARED)
   ------------------------------------------------------------
   FEAT-002. Experiencia "tipo app" en movil: una barra inferior fija
   (bottom tab bar) con Inicio / Red / Historial / Mas, y una hoja de
   acciones (action sheet) para las acciones secundarias.

   PRINCIPIO CLAVE: este script NO reimplementa NADA de la logica de
   negocio ni la de alternado de vistas. Cada control de la barra y de la
   hoja dispara el click del boton HOMOLOGO del header, que ya tiene su
   handler enganchado por app.js / red-mapa.js / historial.js:
     - #nav-red       -> click en #btn-red        (red-mapa.js)
     - #nav-historial -> click en #btn-historial  (historial.js)
     - #nav-inicio    -> cierra la vista opt-in abierta y sube al inicio
     - #nav-mas       -> abre/cierra la hoja de acciones
     - #hoja-*        -> click en #btn-* del header (y cierra la hoja)

   Igual que red-mapa.js / historial.js:
     - IIFE con "use strict".
     - Se AUTOPROTEGE si no hay document (node --check / arnes).
     - Se engancha en DOMContentLoaded o de inmediato segun readyState.
     - Envuelve window.PCC.UI.render de forma ADITIVA para resincronizar el
       estado activo de la barra tras cada render, sin alterar el original.
   ============================================================ */
(function () {
  "use strict";

  /* ----------------------------------------------------------
     Autoproteccion: sin DOM no hay nada que cablear.
     ---------------------------------------------------------- */
  if (typeof window === "undefined" || typeof document === "undefined") {
    return; // Entorno sin DOM (node --check / arnes): no ejecutar UI.
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  // Dispara el click del boton con ese id si existe (no rompe si falta).
  function clickId(id) {
    var el = document.getElementById(id);
    if (el) {
      el.click();
    }
  }

  function obtenerPCC() {
    return window.PCC || null;
  }

  /* ----------------------------------------------------------
     Hoja de acciones (action sheet)
     ---------------------------------------------------------- */
  function hoja() {
    return document.getElementById("hoja-acciones");
  }

  function hojaAbierta() {
    var h = hoja();
    return !!(h && !h.hidden);
  }

  function marcarMas(abierta) {
    var btn = document.getElementById("nav-mas");
    if (btn) {
      btn.setAttribute("aria-expanded", abierta ? "true" : "false");
      btn.classList.toggle("nav-inferior__item--activo", abierta);
    }
  }

  function abrirHoja() {
    var h = hoja();
    if (!h) {
      return;
    }
    h.hidden = false;
    marcarMas(true);
  }

  function cerrarHoja() {
    var h = hoja();
    if (!h) {
      return;
    }
    h.hidden = true;
    marcarMas(false);
  }

  function alternarHoja() {
    if (hojaAbierta()) {
      cerrarHoja();
    } else {
      abrirHoja();
    }
  }

  // Ejecuta la accion homologa del header y cierra la hoja despues.
  function accionHoja(idHeader) {
    clickId(idHeader);
    cerrarHoja();
  }

  /* ----------------------------------------------------------
     Estado de las vistas opt-in (leido del DOM, sin duplicar logica)
     ---------------------------------------------------------- */
  function vistaRedVisible() {
    var v = document.getElementById("vista-red");
    return !!(v && !v.hidden);
  }

  function vistaHistorialVisible() {
    var v = document.getElementById("vista-historial");
    return !!(v && !v.hidden);
  }

  // Inicio: si hay una vista opt-in abierta, alternarla de vuelta usando su
  // propio boton del header (reutiliza el handler); luego subir al inicio.
  function irInicio() {
    if (vistaRedVisible()) {
      clickId("btn-red");
    } else if (vistaHistorialVisible()) {
      clickId("btn-historial");
    }
    if (typeof window.scrollTo === "function") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    sincronizarActivo();
  }

  /* ----------------------------------------------------------
     Estado activo de la barra: refleja la vista actual.
     - Red / Historial activos cuando su vista esta visible.
     - Inicio activo cuando no hay ninguna vista opt-in abierta.
     ---------------------------------------------------------- */
  function marcarActivo(id, activo) {
    var el = document.getElementById(id);
    if (!el) {
      return;
    }
    el.classList.toggle("nav-inferior__item--activo", !!activo);
    if (id === "nav-red" || id === "nav-historial") {
      el.setAttribute("aria-pressed", activo ? "true" : "false");
    }
  }

  function sincronizarActivo() {
    var red = vistaRedVisible();
    var hist = vistaHistorialVisible();
    marcarActivo("nav-red", red);
    marcarActivo("nav-historial", hist);
    marcarActivo("nav-inicio", !red && !hist);
  }

  /* ----------------------------------------------------------
     Refresco dinamico: envolver window.PCC.UI.render de forma ADITIVA
     (mismo patron que red-mapa.js / historial.js) para resincronizar el
     estado activo tras cada render, sin alterar el render original.
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
      sincronizarActivo();
      return r;
    };
    _renderEnvuelto = true;
    return true;
  }

  /* ----------------------------------------------------------
     Arranque: cablear la barra y la hoja.
     ---------------------------------------------------------- */
  function iniciar() {
    // Barra inferior: Red / Historial reutilizan los botones del header.
    var navRed = $("#nav-red");
    if (navRed) {
      navRed.addEventListener("click", function () {
        clickId("btn-red");
        sincronizarActivo();
      });
    }

    var navHistorial = $("#nav-historial");
    if (navHistorial) {
      navHistorial.addEventListener("click", function () {
        clickId("btn-historial");
        sincronizarActivo();
      });
    }

    var navInicio = $("#nav-inicio");
    if (navInicio) {
      navInicio.addEventListener("click", irInicio);
    }

    var navMas = $("#nav-mas");
    if (navMas) {
      navMas.addEventListener("click", alternarHoja);
    }

    // Hoja de acciones: cada boton dispara el click del homologo del header.
    var mapaHoja = {
      "hoja-nuevo-cliente": "btn-nuevo-cliente",
      "hoja-nuevo-gasto": "btn-nuevo-gasto",
      "hoja-nuevo-ahorro": "btn-nuevo-ahorro",
      "hoja-config": "btn-config",
      "hoja-tema": "btn-tema",
      "hoja-logout": "btn-logout"
    };
    Object.keys(mapaHoja).forEach(function (idHoja) {
      var btn = document.getElementById(idHoja);
      if (btn) {
        btn.addEventListener("click", function () {
          accionHoja(mapaHoja[idHoja]);
        });
      }
    });

    // Cerrar la hoja: boton "Cerrar", overlay y tecla Escape.
    var btnCerrar = $("#hoja-cerrar");
    if (btnCerrar) {
      btnCerrar.addEventListener("click", cerrarHoja);
    }
    var overlay = document.querySelector("#hoja-acciones [data-cerrar-hoja]");
    if (overlay) {
      overlay.addEventListener("click", cerrarHoja);
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && hojaAbierta()) {
        cerrarHoja();
      }
    });

    // Resincronizar el estado activo tras cada render del nucleo.
    if (!envolverRender()) {
      var intentos = 0;
      var temporizador = setInterval(function () {
        intentos++;
        if (envolverRender() || intentos > 40) {
          clearInterval(temporizador);
        }
      }, 50);
    }

    sincronizarActivo();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();

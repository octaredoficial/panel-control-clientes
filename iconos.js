/* ============================================================
   iconos.js  (Sistema de iconos SVG de linea estilo iOS - FEAT-002)
   ------------------------------------------------------------
   Punto 4 del pulido "tipo app": reemplazar TODOS los emojis de la
   interfaz por iconos SVG de LINEA (estilo iOS / SF Symbols): trazo
   fino y uniforme, fill="none", stroke="currentColor" y viewBox
   "0 0 24 24", de modo que HEREDAN el color del tema (claro/oscuro
   via [data-theme="oscuro"]) sin tocar nada mas.

   UN SOLO SET DE PATHS (sin duplicar):
     - Los <path> viven una sola vez en el SPRITE inline de <symbol>
       que esta al inicio del <body> en index.html (ids "icono-*").
     - El markup estatico los referencia con:
         <svg class="icono" aria-hidden="true"><use href="#icono-x"></use></svg>
     - El JS que GENERA markup (app.js, red-mapa.js, historial.js) usa
       este helper, que devuelve exactamente el mismo <svg><use></svg>
       apuntando al mismo id. Asi no se repiten los paths.

   SIN librerias ni CDNs: todo es SVG inline propio.

   Se autoprotege como el resto de IIFE del proyecto: no toca 'document'
   (solo construye strings), por lo que pasa 'node --check' y el arnes.
   Expone window.PCC_ICONOS.
   ============================================================ */
(function () {
  "use strict";

  // Nombres validos (deben coincidir con los <symbol id="icono-*"> del
  // sprite en index.html). Se listan aqui para documentar el catalogo y
  // poder validar en desarrollo; la fuente de los PATHS es el sprite.
  var NOMBRES = {
    config: 1,        // engrane (Configuracion)
    ahorro: 1,        // alcancia (Nuevo Ahorro)
    gasto: 1,         // menos en circulo (Nuevo Gasto)
    cliente: 1,       // persona + mas (Nuevo Cliente)
    mas: 1,           // mas (agregar generico)
    red: 1,           // mapa / nodos (Red)
    historial: 1,     // grafica de barras (Historial)
    sol: 1,           // tema claro
    luna: 1,          // tema oscuro
    tema: 1,          // medio sol/medio luna (cambiar tema)
    logout: 1,        // salir (Cerrar sesion)
    inicio: 1,        // casa (Inicio)
    csv: 1,           // documento (Exportar CSV)
    reiniciar: 1,     // reciclar (Reiniciar datos)
    avisar: 1,        // chat (WhatsApp / Avisar)
    pagar: 1,         // check (Pagar)
    revertir: 1,      // flecha de regreso (Revertir)
    recibos: 1,       // lista / documento (Historial de pagos)
    editar: 1,        // lapiz (Editar)
    pausar: 1,        // pausa
    reanudar: 1,      // play
    eliminar: 1,      // bote de basura (Eliminar)
    cerrar: 1,        // x (Cerrar modal)
    alerta: 1,        // triangulo de alerta (Faltan por pagar)
    check_circulo: 1, // check en circulo (Ya pagaron)
    recibo: 1,        // ticket (Ver recibo)
    imprimir: 1,      // impresora (Imprimir / PDF)
    login_google: 1,  // llave (Entrar con Google)
    login_invitado: 1,// persona (Entrar como invitado)
    core: 1,          // antena / torre (Core de red)
    celebracion: 1    // estrella/destello (estados vacios "todo listo")
  };

  /**
   * svg(nombre, claseExtra): devuelve el markup de un icono SVG de linea
   * que referencia (via <use>) el <symbol> del sprite inline. Hereda color
   * con currentColor. aria-hidden por ser decorativo (el texto/label va
   * aparte en el boton).
   *
   * @param {string} nombre  clave del catalogo (p.ej. "pausar")
   * @param {string} [claseExtra]  clase CSS adicional para el <svg>
   * @returns {string} '<svg class="icono ..." aria-hidden="true">...<use.../></svg>'
   */
  function svg(nombre, claseExtra) {
    var clase = "icono" + (claseExtra ? " " + claseExtra : "");
    var id = "icono-" + String(nombre || "").replace(/_/g, "-");
    // fill="none" + stroke="currentColor" explicitos para que el icono
    // herede el color del tema aunque la clase .icono de styles.css no
    // estuviera cargada (robustez); viewBox 0 0 24 24 unificado.
    return (
      '<svg class="' + clase + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">' +
      '<use href="#' + id + '"></use>' +
      "</svg>"
    );
  }

  var API = {
    NOMBRES: NOMBRES,
    svg: svg
  };

  // Exponer en window si existe (navegador); si no (node --check / arnes),
  // no hace nada y el modulo sigue siendo "cargable" sin romperse.
  if (typeof window !== "undefined") {
    window.PCC_ICONOS = API;
  }
})();

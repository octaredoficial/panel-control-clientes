/* ============================================================
   Panel de Control de Clientes - Sincronizacion con el backend propio (FEAT-004)
   ------------------------------------------------------------
   Modulo ES (cargado SOLO en el navegador con <script type="module">)
   que reemplaza a firebase-sync.js. Sustituye:
     - Firebase Auth (login Google/anonimo) -> una sola CONTRASENA compartida
       contra POST /api/login del backend propio.
     - Cloud Firestore (datos + sync en vivo) -> API REST (GET /api/state,
       PUT /api/clientes|movimientos|config|theme) + WebSocket /ws del
       backend autohospedado (Node + SQLite detras de Caddy, HTTPS autofirmado).

   ESTRATEGIA (identica a la de firebase-sync.js): "cache local sincrono +
   sync en segundo plano".
   - localStorage sigue siendo el ESPEJO sincrono que la UI lee via
     PCC.cargarX(). NO se vuelve asincrona la capa de datos.
   - Al llegar un snapshot/mensaje remoto, escribimos ese espejo local con
     los setters ORIGINALES del nucleo (PCC.guardarClientes /
     guardarMovimientos / guardarConfig / setTheme) y luego llamamos a
     window.PCC.UI.render() (y aplicarTema() si cambio el tema) para refrescar.
   - Las escrituras locales (acciones del usuario) se propagan al backend
     envolviendo (parcheando) esos mismos setters de PCC: se conserva su
     comportamiento original (espejo local sincrono) y, ademas, se espeja el
     estado al backend con un PUT de la coleccion completa (misma semantica de
     "reemplazar coleccion" que espejarColeccion de firebase-sync.js).
   - Para evitar bucles de escritura usamos un flag (_aplicandoSnapshot)
     mientras aplicamos datos remotos, de modo que no se reenvien al backend.

   API DEL BACKEND (misma-origen; el servidor de FEAT-002 sirve los estaticos):
     POST /api/login    { password }      -> 200 + cookie de sesion | 401
     POST /api/logout                     -> 200 (borra la cookie)
     GET  /api/state                      -> { clientes, movimientos, config, theme }
     PUT  /api/clientes      [array]      -> difunde {domain:'clientes', data:[...]}
     PUT  /api/movimientos   [array]      -> difunde {domain:'movimientos', data:[...]}
     PUT  /api/config        {objeto}     -> difunde {domain:'config', data:{...}}
     PUT  /api/theme         { valor }    -> difunde {domain:'theme', data:'claro'|'oscuro'}
     GET  /ws  (upgrade)                  -> al conectar envia {domain:'state', data:<snapshot>}
                                             y en cada escritura {domain, data}

   La cookie de sesion es HttpOnly; el navegador la envia sola con
   credentials:'include' en fetch y en el upgrade del WebSocket (misma origen).

   DEGRADACION SEGURA: toda la red va en try/catch. Si el backend no responde,
   la app NO lanza excepciones no capturadas y muestra un mensaje en espanol en
   el overlay de login.
   ============================================================ */

(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  /* --------------------------------------------------------
     Referencias al DOM del overlay de login (contrasena unica).
     -------------------------------------------------------- */
  var $login = document.getElementById("pcc-login");
  var $form = document.getElementById("form-login");
  var $password = document.getElementById("login-password");
  var $btnLogin = document.getElementById("btn-login");
  var $error = document.getElementById("login-error");
  var $btnLogout = document.getElementById("btn-logout");

  function mostrarError(mensaje) {
    if ($error) {
      $error.textContent = mensaje || "";
      $error.hidden = !mensaje;
    }
  }

  function mostrarOverlay() {
    if ($login) {
      $login.hidden = false;
    }
    if ($btnLogout) {
      $btnLogout.hidden = true;
    }
  }

  function ocultarOverlay() {
    if ($login) {
      $login.hidden = true;
    }
    if ($btnLogout) {
      $btnLogout.hidden = false;
    }
    mostrarError("");
  }

  function habilitarFormulario(habilitado) {
    if ($btnLogin) {
      $btnLogin.disabled = !habilitado;
    }
    if ($password) {
      $password.disabled = !habilitado;
    }
  }

  var PCC = window.PCC;
  if (!PCC) {
    mostrarError(
      "No se pudo cargar el nucleo de la aplicacion. Recarga la pagina."
    );
    return;
  }

  /* --------------------------------------------------------
     Estado interno de sincronizacion.
     -------------------------------------------------------- */
  // Flag: true mientras aplicamos datos remotos, para que los setters
  // parcheados NO reenvien esos datos al backend (evita bucles).
  var _aplicandoSnapshot = false;
  // Guardamos las funciones originales de PCC para preservar su semantica.
  var _orig = {
    guardarClientes: PCC.guardarClientes,
    guardarMovimientos: PCC.guardarMovimientos,
    guardarConfig: PCC.guardarConfig,
    setTheme: PCC.setTheme
  };
  var _setersParcheados = false;
  var _ws = null;
  // true tras un logout explicito del usuario, para no reintentar el WS.
  var _cerradoPorUsuario = false;
  var _reintentoWS = null;

  function refrescarUI() {
    try {
      if (
        window.PCC &&
        window.PCC.UI &&
        typeof window.PCC.UI.render === "function"
      ) {
        window.PCC.UI.render();
      }
    } catch (e) {
      // Un fallo de render no debe romper la sincronizacion.
    }
  }

  function refrescarTema() {
    try {
      if (
        window.PCC &&
        window.PCC.UI &&
        typeof window.PCC.UI.aplicarTema === "function"
      ) {
        window.PCC.UI.aplicarTema();
      }
    } catch (e) {}
  }

  /* --------------------------------------------------------
     Helpers HTTP (misma-origen; la cookie de sesion viaja sola).
     -------------------------------------------------------- */
  function apiFetch(ruta, opciones) {
    opciones = opciones || {};
    opciones.credentials = "include";
    opciones.headers = opciones.headers || {};
    return fetch(ruta, opciones);
  }

  function putJSON(ruta, cuerpo) {
    return apiFetch(ruta, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo)
    });
  }

  /* --------------------------------------------------------
     ESCRITURA: espejar el estado local al backend.
     Semantica "reemplazar coleccion completa" (como PUT del backend):
     el array/objeto completo se envia en cada guardado, igual que
     espejarColeccion hacia Firestore.
     -------------------------------------------------------- */
  function espejarClientes(arr) {
    putJSON("/api/clientes", Array.isArray(arr) ? arr : []).catch(function (e) {
      console.warn("[backend-sync] No se pudo espejar los clientes:", e);
    });
  }

  function espejarMovimientos(arr) {
    putJSON("/api/movimientos", Array.isArray(arr) ? arr : []).catch(
      function (e) {
        console.warn("[backend-sync] No se pudo espejar los movimientos:", e);
      }
    );
  }

  function espejarConfig(cfg) {
    putJSON("/api/config", cfg || {}).catch(function (e) {
      console.warn("[backend-sync] No se pudo espejar la configuracion:", e);
    });
  }

  function espejarTema(valor) {
    putJSON("/api/theme", {
      valor: valor === "oscuro" ? "oscuro" : "claro"
    }).catch(function (e) {
      console.warn("[backend-sync] No se pudo espejar el tema:", e);
    });
  }

  // Parchea los setters de PCC para que, ademas de su comportamiento
  // original (espejo local sincrono), espejen al backend. Solo ocurre en el
  // navegador tras login. NO cambia las firmas publicas de PCC: la UI sigue
  // sin esperar a la red.
  function parchearSeters() {
    if (_setersParcheados) {
      return;
    }
    _setersParcheados = true;

    PCC.guardarClientes = function (arr) {
      var r = _orig.guardarClientes.call(PCC, arr);
      if (!_aplicandoSnapshot) {
        espejarClientes(arr);
      }
      return r;
    };
    PCC.guardarMovimientos = function (arr) {
      var r = _orig.guardarMovimientos.call(PCC, arr);
      if (!_aplicandoSnapshot) {
        espejarMovimientos(arr);
      }
      return r;
    };
    PCC.guardarConfig = function (cfg) {
      var r = _orig.guardarConfig.call(PCC, cfg);
      if (!_aplicandoSnapshot) {
        // Reutilizamos cargarConfig para espejar el objeto ya normalizado.
        espejarConfig(PCC.cargarConfig());
      }
      return r;
    };
    PCC.setTheme = function (theme) {
      var r = _orig.setTheme.call(PCC, theme);
      if (!_aplicandoSnapshot) {
        espejarTema(PCC.getTheme());
      }
      return r;
    };
  }

  // Restaura los setters ORIGINALES de PCC. Se invoca al cerrar sesion para
  // que una escritura local sin sesion NO intente ir al backend (el backend
  // la rechazaria con 401). Al reiniciar _setersParcheados, un nuevo login
  // vuelve a parchear bien.
  function restaurarSeters() {
    if (!_setersParcheados) {
      return;
    }
    PCC.guardarClientes = _orig.guardarClientes;
    PCC.guardarMovimientos = _orig.guardarMovimientos;
    PCC.guardarConfig = _orig.guardarConfig;
    PCC.setTheme = _orig.setTheme;
    _setersParcheados = false;
  }

  /* --------------------------------------------------------
     LECTURA: backend -> espejo local -> UI.
     -------------------------------------------------------- */
  function aplicarRemoto(fn) {
    _aplicandoSnapshot = true;
    try {
      fn();
    } finally {
      _aplicandoSnapshot = false;
    }
  }

  // Aplica un snapshot completo {clientes, movimientos, config, theme}.
  function aplicarSnapshot(estado) {
    estado = estado || {};
    aplicarRemoto(function () {
      if (Array.isArray(estado.clientes)) {
        _orig.guardarClientes.call(PCC, estado.clientes);
      }
      if (Array.isArray(estado.movimientos)) {
        _orig.guardarMovimientos.call(PCC, estado.movimientos);
      }
      // config puede ser null hasta el primer PUT; solo aplicamos si viene.
      if (estado.config && typeof estado.config === "object") {
        _orig.guardarConfig.call(PCC, estado.config);
      }
      if (estado.theme === "oscuro" || estado.theme === "claro") {
        _orig.setTheme.call(PCC, estado.theme);
      }
    });
    refrescarTema();
    refrescarUI();
  }

  // Aplica un mensaje de dominio {domain, data} recibido por WebSocket.
  function aplicarDominio(domain, data) {
    if (domain === "state") {
      aplicarSnapshot(data);
      return;
    }
    if (domain === "clientes") {
      aplicarRemoto(function () {
        _orig.guardarClientes.call(PCC, Array.isArray(data) ? data : []);
      });
      refrescarUI();
    } else if (domain === "movimientos") {
      aplicarRemoto(function () {
        _orig.guardarMovimientos.call(PCC, Array.isArray(data) ? data : []);
      });
      refrescarUI();
    } else if (domain === "config") {
      if (data && typeof data === "object") {
        aplicarRemoto(function () {
          _orig.guardarConfig.call(PCC, data);
        });
        refrescarUI();
      }
    } else if (domain === "theme") {
      aplicarRemoto(function () {
        _orig.setTheme.call(PCC, data);
      });
      refrescarTema();
    }
  }

  /* --------------------------------------------------------
     WebSocket: sincronizacion en vivo.
     -------------------------------------------------------- */
  function urlWebSocket() {
    var proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + window.location.host + "/ws";
  }

  function abrirWebSocket() {
    if (_cerradoPorUsuario) {
      return;
    }
    try {
      _ws = new WebSocket(urlWebSocket());
    } catch (e) {
      console.warn("[backend-sync] No se pudo abrir el WebSocket:", e);
      return;
    }

    _ws.addEventListener("message", function (ev) {
      var mensaje;
      try {
        mensaje = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (mensaje && mensaje.domain) {
        aplicarDominio(mensaje.domain, mensaje.data);
      }
    });

    _ws.addEventListener("close", function () {
      _ws = null;
      // Reconexion con pequeno retardo salvo que el usuario cerrara sesion.
      if (!_cerradoPorUsuario) {
        if (_reintentoWS) {
          clearTimeout(_reintentoWS);
        }
        _reintentoWS = setTimeout(abrirWebSocket, 3000);
      }
    });

    _ws.addEventListener("error", function () {
      // El evento 'close' se encargara de reintentar.
      try {
        if (_ws) {
          _ws.close();
        }
      } catch (e) {}
    });
  }

  function cerrarWebSocket() {
    if (_reintentoWS) {
      clearTimeout(_reintentoWS);
      _reintentoWS = null;
    }
    if (_ws) {
      try {
        _ws.close();
      } catch (e) {}
      _ws = null;
    }
  }

  /* --------------------------------------------------------
     Arranque / parada de la sincronizacion.
     -------------------------------------------------------- */
  // Arranca la sincronizacion. Si ya traemos el estado inicial (por ejemplo
  // de la sonda de sesion en la carga), lo pasamos en `estadoInicial` para
  // no repetir el GET /api/state.
  function iniciarSincronizacion(estadoInicial) {
    _cerradoPorUsuario = false;
    parchearSeters();
    if (estadoInicial && typeof estadoInicial === "object") {
      aplicarSnapshot(estadoInicial);
      abrirWebSocket();
      return;
    }
    // Carga inicial (equivalente a getDocs de Firestore) y luego el WS.
    apiFetch("/api/state")
      .then(function (resp) {
        if (!resp.ok) {
          throw new Error("estado HTTP " + resp.status);
        }
        return resp.json();
      })
      .then(function (estado) {
        aplicarSnapshot(estado);
        abrirWebSocket();
      })
      .catch(function (e) {
        console.warn("[backend-sync] No se pudo cargar el estado inicial:", e);
        // Aun sin estado inicial intentamos el WS (enviara un snapshot).
        abrirWebSocket();
      });
  }

  function detenerSincronizacion() {
    cerrarWebSocket();
    restaurarSeters();
  }

  /* --------------------------------------------------------
     Flujo de login con contrasena unica.
     -------------------------------------------------------- */
  function intentarLogin(password) {
    mostrarError("");
    habilitarFormulario(false);
    apiFetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password })
    })
      .then(function (resp) {
        if (resp.ok) {
          habilitarFormulario(true);
          if ($password) {
            $password.value = "";
          }
          ocultarOverlay();
          iniciarSincronizacion();
          return;
        }
        habilitarFormulario(true);
        if (resp.status === 401) {
          mostrarError("Contraseña incorrecta. Intenta de nuevo.");
        } else {
          mostrarError(
            "No se pudo iniciar sesión. Intenta de nuevo en unos momentos."
          );
        }
        if ($password) {
          $password.focus();
          $password.select();
        }
      })
      .catch(function () {
        habilitarFormulario(true);
        mostrarError(
          "No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo."
        );
      });
  }

  if ($form) {
    $form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var password = $password ? $password.value : "";
      if (!password) {
        mostrarError("Escribe la contraseña para entrar.");
        if ($password) {
          $password.focus();
        }
        return;
      }
      intentarLogin(password);
    });
  }

  /* --------------------------------------------------------
     Logout: cierra sesion en el backend, detiene el WS, restaura los
     setters y vuelve a mostrar el overlay.
     -------------------------------------------------------- */
  if ($btnLogout) {
    $btnLogout.addEventListener("click", function () {
      _cerradoPorUsuario = true;
      detenerSincronizacion();
      apiFetch("/api/logout", { method: "POST" })
        .catch(function (e) {
          console.warn("[backend-sync] No se pudo cerrar la sesion:", e);
        })
        .then(function () {
          mostrarOverlay();
          habilitarFormulario(true);
          if ($password) {
            $password.value = "";
            $password.focus();
          }
        });
    });
  }

  /* --------------------------------------------------------
     Reanudar sesion en la carga (equivalente a onAuthStateChanged de
     firebase-sync.js). La cookie de sesion es HttpOnly (JS no la ve), asi
     que sondeamos GET /api/state:
       - 200: la cookie de 30 dias sigue vigente -> saltamos el overlay y
         arrancamos la sincronizacion directamente con ese estado.
       - 401 (o cualquier otro): no hay sesion -> mostramos el overlay para
         que el usuario escriba la contrasena.
     Esto recupera el "no volver a pedir contrasena en cada recarga" que daba
     Firebase, sin cambiar el resto del flujo de login/logout/reconexion.
     -------------------------------------------------------- */
  function reanudarSesion() {
    apiFetch("/api/state")
      .then(function (resp) {
        if (resp.ok) {
          return resp.json().then(function (estado) {
            ocultarOverlay();
            iniciarSincronizacion(estado);
          });
        }
        // Sin sesion valida (401) o error del servidor: pedir contrasena.
        mostrarOverlay();
      })
      .catch(function () {
        // Sin conexion con el backend: mostramos el overlay (el login
        // reintentara y reportara el error de red si persiste).
        mostrarOverlay();
      });
  }

  reanudarSesion();
})();

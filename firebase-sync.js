/* ============================================================
   Panel de Control de Clientes - Sincronizacion con Firebase (FEAT-002)
   ------------------------------------------------------------
   Modulo ES (cargado SOLO en el navegador con <script type="module">)
   que anade Autenticacion (Google + Anonimo) y persistencia en la nube
   con Cloud Firestore, SIN romper la UI sincrona existente ni el nucleo
   window.PCC (cubierto por 66 pruebas).

   ESTRATEGIA: "cache local sincrono + sync en segundo plano".
   - localStorage sigue siendo el ESPEJO sincrono que la UI y el arnes
     de pruebas leen via PCC.cargarX(). NO se vuelve asincrona la capa
     de datos.
   - Al llegar un snapshot remoto de Firestore, escribimos ese espejo
     local con los setters del nucleo (PCC.guardarClientes /
     guardarMovimientos / guardarConfig / setTheme) y luego llamamos a
     window.PCC.UI.render() (y aplicarTema() si cambio el tema) para
     refrescar la vista.
   - Las escrituras locales (acciones del usuario) se propagan a
     Firestore envolviendo (parcheando) esos mismos setters de PCC: se
     conserva su comportamiento original (espejo local sincrono) y,
     ademas, se espeja el estado a la nube. NO se cambian las firmas
     publicas de PCC.
   - Para evitar bucles de escritura usamos un flag (_aplicandoSnapshot)
     mientras aplicamos datos remotos, de modo que no se reenvien a
     Firestore.

   ESTRUCTURA FIRESTORE (COMPARTIDA entre todos los usuarios, no por-uid):
     - Coleccion raiz 'clientes'      -> un documento por cliente,
                                         docId = cliente.id
     - Coleccion raiz 'movimientos'   -> un documento por movimiento,
                                         docId = movimiento.id
     - Documento 'config/app'         -> objeto de configuracion
     - Documento 'config/theme'       -> { valor: 'claro' | 'oscuro' }

   DEGRADACION SEGURA: toda la inicializacion de Firebase va en try/catch.
   Si el SDK no carga (sin red) o falla el login, la app NO lanza
   excepciones no capturadas y muestra un mensaje en espanol en el
   overlay de login.
   ============================================================ */

// --- Imports del SDK modular de Firebase por CDN gstatic (v10.x) ---------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInAnonymously,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  deleteDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* ------------------------------------------------------------
   Gating defensivo: sin DOM/ventana no hacemos nada. Como este
   modulo se carga por <script type="module">, no se ejecuta en el
   arnes de Node de todas formas; aun asi dejamos el guard explicito.
   ------------------------------------------------------------ */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  // firebaseConfig EXACTA del proyecto panel-clientes-12a4a.
  // Las claves Web son publicas por diseno (no son secretas).
  var firebaseConfig = {
    apiKey: "AIzaSyAVPg2CTz3g0M7Ve7yw54Ne36j_nZD-n6w",
    authDomain: "panel-clientes-12a4a.firebaseapp.com",
    projectId: "panel-clientes-12a4a",
    storageBucket: "panel-clientes-12a4a.firebasestorage.app",
    messagingSenderId: "1023830180013",
    appId: "1:1023830180013:web:cd5db924a87d62916c8624"
  };

  // Paths de Firestore (compartidos, consistentes en lectura/escritura).
  var COL_CLIENTES = "clientes";
  var COL_MOVIMIENTOS = "movimientos";
  var DOC_CONFIG_APP = { col: "config", id: "app" };
  var DOC_CONFIG_THEME = { col: "config", id: "theme" };

  /* --------------------------------------------------------
     Referencias al DOM del overlay de login.
     -------------------------------------------------------- */
  var $login = document.getElementById("pcc-login");
  var $btnGoogle = document.getElementById("btn-login-google");
  var $btnAnon = document.getElementById("btn-login-anonimo");
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

  function habilitarBotonesLogin(habilitado) {
    if ($btnGoogle) {
      $btnGoogle.disabled = !habilitado;
    }
    if ($btnAnon) {
      $btnAnon.disabled = !habilitado;
    }
  }

  // El overlay arranca visible (bloquea hasta que haya sesion).
  mostrarOverlay();

  var PCC = window.PCC;
  if (!PCC) {
    mostrarError(
      "No se pudo cargar el nucleo de la aplicacion. Recarga la pagina."
    );
    return;
  }

  /* --------------------------------------------------------
     Inicializacion de Firebase (envuelta en try/catch).
     -------------------------------------------------------- */
  var app, auth, db;
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (e) {
    habilitarBotonesLogin(false);
    mostrarError(
      "No se pudo conectar con Firebase. Revisa tu conexion a internet e intenta de nuevo."
    );
    return;
  }

  /* --------------------------------------------------------
     Estado interno de sincronizacion.
     -------------------------------------------------------- */
  // Flag: true mientras aplicamos un snapshot remoto, para que los
  // setters parcheados NO reenvien esos datos a Firestore (evita bucles).
  var _aplicandoSnapshot = false;
  // Guardamos las funciones originales de PCC para preservar su semantica.
  var _orig = {
    guardarClientes: PCC.guardarClientes,
    guardarMovimientos: PCC.guardarMovimientos,
    guardarConfig: PCC.guardarConfig,
    setTheme: PCC.setTheme
  };
  var _setersParcheados = false;
  var _subscripciones = [];
  var _sembradoVerificado = false;

  function refrescarUI() {
    try {
      if (window.PCC && window.PCC.UI && typeof window.PCC.UI.render === "function") {
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
     ESCRITURA: espejar el estado local a Firestore.
     -------------------------------------------------------- */

  // Sincroniza una coleccion (clientes / movimientos) con el array dado:
  // escribe/mergea cada doc por su id y borra los que ya no existen.
  function espejarColeccion(nombreCol, arr) {
    arr = Array.isArray(arr) ? arr : [];
    getDocs(collection(db, nombreCol))
      .then(function (snap) {
        var idsActuales = {};
        arr.forEach(function (item) {
          if (item && item.id != null) {
            idsActuales[String(item.id)] = true;
          }
        });

        var batch = writeBatch(db);
        // Altas / actualizaciones.
        arr.forEach(function (item) {
          if (item && item.id != null) {
            batch.set(doc(db, nombreCol, String(item.id)), item);
          }
        });
        // Bajas: docs remotos que ya no estan en el array local.
        snap.forEach(function (d) {
          if (!idsActuales[d.id]) {
            batch.delete(doc(db, nombreCol, d.id));
          }
        });
        return batch.commit();
      })
      .catch(function () {
        // Error de red/escritura: la UI ya reflejo el cambio localmente.
      });
  }

  function espejarConfig(cfg) {
    setDoc(doc(db, DOC_CONFIG_APP.col, DOC_CONFIG_APP.id), cfg || {}, {
      merge: true
    }).catch(function () {});
  }

  function espejarTema(valor) {
    setDoc(
      doc(db, DOC_CONFIG_THEME.col, DOC_CONFIG_THEME.id),
      { valor: valor === "oscuro" ? "oscuro" : "claro" },
      { merge: true }
    ).catch(function () {});
  }

  // Parchea los setters de PCC para que, ademas de su comportamiento
  // original (espejo local sincrono), espejen a Firestore. Solo ocurre en
  // el navegador tras login. NO cambia las firmas publicas de PCC: la UI
  // sigue sin esperar a la nube.
  function parchearSeters() {
    if (_setersParcheados) {
      return;
    }
    _setersParcheados = true;

    PCC.guardarClientes = function (arr) {
      var r = _orig.guardarClientes.call(PCC, arr);
      if (!_aplicandoSnapshot) {
        espejarColeccion(COL_CLIENTES, arr);
      }
      return r;
    };
    PCC.guardarMovimientos = function (arr) {
      var r = _orig.guardarMovimientos.call(PCC, arr);
      if (!_aplicandoSnapshot) {
        espejarColeccion(COL_MOVIMIENTOS, arr);
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

  /* --------------------------------------------------------
     LECTURA: Firestore -> espejo local -> UI (onSnapshot).
     -------------------------------------------------------- */
  function aplicarRemoto(fn) {
    _aplicandoSnapshot = true;
    try {
      fn();
    } finally {
      _aplicandoSnapshot = false;
    }
  }

  function suscribir() {
    // Clientes.
    _subscripciones.push(
      onSnapshot(collection(db, COL_CLIENTES), function (snap) {
        var arr = [];
        snap.forEach(function (d) {
          arr.push(d.data());
        });
        aplicarRemoto(function () {
          _orig.guardarClientes.call(PCC, arr);
        });
        refrescarUI();
      })
    );

    // Movimientos.
    _subscripciones.push(
      onSnapshot(collection(db, COL_MOVIMIENTOS), function (snap) {
        var arr = [];
        snap.forEach(function (d) {
          arr.push(d.data());
        });
        aplicarRemoto(function () {
          _orig.guardarMovimientos.call(PCC, arr);
        });
        refrescarUI();
      })
    );

    // Config de la app.
    _subscripciones.push(
      onSnapshot(
        doc(db, DOC_CONFIG_APP.col, DOC_CONFIG_APP.id),
        function (d) {
          if (d.exists()) {
            var cfg = d.data();
            aplicarRemoto(function () {
              _orig.guardarConfig.call(PCC, cfg);
            });
            refrescarUI();
          }
        }
      )
    );

    // Tema.
    _subscripciones.push(
      onSnapshot(
        doc(db, DOC_CONFIG_THEME.col, DOC_CONFIG_THEME.id),
        function (d) {
          if (d.exists()) {
            var data = d.data() || {};
            aplicarRemoto(function () {
              _orig.setTheme.call(PCC, data.valor);
            });
            refrescarTema();
          }
        }
      )
    );
  }

  function cancelarSuscripciones() {
    _subscripciones.forEach(function (desuscribir) {
      try {
        if (typeof desuscribir === "function") {
          desuscribir();
        }
      } catch (e) {}
    });
    _subscripciones = [];
  }

  /* --------------------------------------------------------
     MIGRACION / SIEMBRA inicial (una sola vez si Firestore vacio).
     Si la nube ya tiene datos, NO se duplica ni sobrescribe: la nube
     es la fuente de verdad y se refleja localmente via onSnapshot.
     -------------------------------------------------------- */
  function sembrarSiNubeVacia() {
    if (_sembradoVerificado) {
      return Promise.resolve();
    }
    _sembradoVerificado = true;

    return Promise.all([
      getDocs(collection(db, COL_CLIENTES)),
      getDocs(collection(db, COL_MOVIMIENTOS))
    ])
      .then(function (res) {
        var snapClientes = res[0];
        var snapMovs = res[1];
        // Si ya hay datos en la nube, no sembrar.
        if (!snapClientes.empty || !snapMovs.empty) {
          return;
        }

        // Nube vacia: sembrar una sola vez.
        // Si el navegador ya tiene datos locales, subir esos; si no,
        // usar el SEED del nucleo (PCC.construirSeed) y los defaults.
        var clientesLocales = PCC.cargarClientes();
        var movsLocales = PCC.cargarMovimientos();
        var clientes =
          clientesLocales && clientesLocales.length
            ? clientesLocales
            : PCC.construirSeed();
        var movimientos =
          movsLocales && movsLocales.length ? movsLocales : [];
        var cfg = PCC.cargarConfig();
        var tema = PCC.getTheme();

        var batch = writeBatch(db);
        clientes.forEach(function (c) {
          if (c && c.id != null) {
            batch.set(doc(db, COL_CLIENTES, String(c.id)), c);
          }
        });
        movimientos.forEach(function (m) {
          if (m && m.id != null) {
            batch.set(doc(db, COL_MOVIMIENTOS, String(m.id)), m);
          }
        });
        batch.set(doc(db, DOC_CONFIG_APP.col, DOC_CONFIG_APP.id), cfg || {});
        batch.set(doc(db, DOC_CONFIG_THEME.col, DOC_CONFIG_THEME.id), {
          valor: tema === "oscuro" ? "oscuro" : "claro"
        });
        return batch.commit();
      })
      .catch(function () {
        // Si falla la verificacion/siembra, los onSnapshot seguiran
        // intentando reflejar lo que haya; no rompemos la app.
      });
  }

  /* --------------------------------------------------------
     Flujo de autenticacion.
     -------------------------------------------------------- */
  function iniciarSincronizacion() {
    parchearSeters();
    // Primero sembramos si la nube esta vacia; luego suscribimos para
    // reflejar siempre la fuente de verdad remota.
    sembrarSiNubeVacia().then(function () {
      suscribir();
    });
  }

  function manejarErrorLogin(e) {
    habilitarBotonesLogin(true);
    var codigo = e && e.code ? String(e.code) : "";
    if (codigo === "auth/popup-closed-by-user" || codigo === "auth/cancelled-popup-request") {
      mostrarError("Cerraste la ventana de inicio de sesion. Intenta de nuevo.");
    } else if (codigo === "auth/popup-blocked") {
      mostrarError(
        "El navegador bloqueo la ventana emergente. Habilita las ventanas emergentes e intenta de nuevo."
      );
    } else if (codigo === "auth/network-request-failed") {
      mostrarError("Error de red. Revisa tu conexion a internet e intenta de nuevo.");
    } else {
      mostrarError("No se pudo iniciar sesion. Intenta de nuevo.");
    }
  }

  if ($btnGoogle) {
    $btnGoogle.addEventListener("click", function () {
      mostrarError("");
      habilitarBotonesLogin(false);
      try {
        signInWithPopup(auth, new GoogleAuthProvider()).catch(manejarErrorLogin);
      } catch (e) {
        manejarErrorLogin(e);
      }
    });
  }

  if ($btnAnon) {
    $btnAnon.addEventListener("click", function () {
      mostrarError("");
      habilitarBotonesLogin(false);
      try {
        signInAnonymously(auth).catch(manejarErrorLogin);
      } catch (e) {
        manejarErrorLogin(e);
      }
    });
  }

  if ($btnLogout) {
    $btnLogout.addEventListener("click", function () {
      try {
        signOut(auth).catch(function () {});
      } catch (e) {}
    });
  }

  // onAuthStateChanged controla mostrar/ocultar el overlay y arrancar
  // o detener la sincronizacion.
  try {
    onAuthStateChanged(
      auth,
      function (usuario) {
        if (usuario) {
          ocultarOverlay();
          iniciarSincronizacion();
        } else {
          cancelarSuscripciones();
          habilitarBotonesLogin(true);
          mostrarOverlay();
        }
      },
      function () {
        habilitarBotonesLogin(true);
        mostrarError(
          "Error de autenticacion. Revisa tu conexion e intenta de nuevo."
        );
      }
    );
  } catch (e) {
    habilitarBotonesLogin(false);
    mostrarError(
      "No se pudo iniciar el servicio de autenticacion. Recarga la pagina."
    );
  }
})();

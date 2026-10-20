/* ============================================================
   Panel de Control de Clientes - Capa de datos (SQLite embebido)
   ------------------------------------------------------------
   Usa el modulo integrado `node:sqlite` de Node 22 (DatabaseSync),
   de modo que el backend NO tiene dependencias nativas ni de npm.
   Esto encaja con el objetivo de poca RAM (1 GB) del servidor Vultr.

   MODELO: espejo exacto del modelo doc-por-item de Firestore.
     - tabla `clientes`     : un registro por cliente, columna `data`
                              = JSON del objeto cliente completo.
     - tabla `movimientos`  : un registro por movimiento, columna `data`
                              = JSON del objeto movimiento completo.
     - tabla `config`       : fila unica (key='app'), `data` = JSON.
     - tabla `theme`        : fila unica (key='theme'), `valor` TEXT.

   Guardar el objeto completo como JSON evita un mapeo de columnas con
   perdida y preserva TODOS los campos actuales y futuros (incluidos los
   campos mas ricos del CSV que se anaden en FEAT-005: ssid, passWifi,
   passModem, ipPrincipal) sin migraciones de esquema.
   ============================================================ */

import { DatabaseSync } from "node:sqlite";

const THEME_DEFAULT = "claro";

/**
 * Abre (o crea) la base de datos SQLite en `dbPath` y asegura el esquema.
 * Pasa ':memory:' para una base en memoria (usada en las pruebas).
 *
 * Devuelve un objeto con metodos de alto nivel que el servidor usa para
 * leer/escribir los cuatro dominios de datos.
 */
export function abrirBaseDeDatos(dbPath) {
  const sqlite = new DatabaseSync(dbPath);

  // WAL mejora la concurrencia lectura/escritura y es seguro para un
  // archivo unico; para ':memory:' SQLite lo ignora silenciosamente.
  try {
    sqlite.exec("PRAGMA journal_mode = WAL;");
  } catch (e) {
    // En algunos modos (memoria) WAL no aplica; no es un error fatal.
  }
  sqlite.exec("PRAGMA foreign_keys = ON;");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS clientes (
      id        TEXT PRIMARY KEY,
      data      TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS movimientos (
      id        TEXT PRIMARY KEY,
      data      TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS config (
      key       TEXT PRIMARY KEY,
      data      TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS theme (
      key       TEXT PRIMARY KEY,
      valor     TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);

  // --- Sentencias preparadas reutilizables -----------------------------
  const stmts = {
    selClientes: sqlite.prepare("SELECT data FROM clientes"),
    selMovimientos: sqlite.prepare("SELECT data FROM movimientos"),
    selConfig: sqlite.prepare("SELECT data FROM config WHERE key = 'app'"),
    selTheme: sqlite.prepare("SELECT valor FROM theme WHERE key = 'theme'"),

    delClientes: sqlite.prepare("DELETE FROM clientes"),
    delMovimientos: sqlite.prepare("DELETE FROM movimientos"),
    insCliente: sqlite.prepare(
      "INSERT INTO clientes (id, data, updatedAt) VALUES (?, ?, ?)"
    ),
    insMovimiento: sqlite.prepare(
      "INSERT INTO movimientos (id, data, updatedAt) VALUES (?, ?, ?)"
    ),
    upsConfig: sqlite.prepare(
      "INSERT INTO config (key, data, updatedAt) VALUES ('app', ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt"
    ),
    upsTheme: sqlite.prepare(
      "INSERT INTO theme (key, valor, updatedAt) VALUES ('theme', ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET valor = excluded.valor, updatedAt = excluded.updatedAt"
    )
  };

  function ahora() {
    return new Date().toISOString();
  }

  function leerClientes() {
    return stmts.selClientes.all().map((fila) => JSON.parse(fila.data));
  }

  function leerMovimientos() {
    return stmts.selMovimientos.all().map((fila) => JSON.parse(fila.data));
  }

  function leerConfig() {
    const fila = stmts.selConfig.get();
    return fila ? JSON.parse(fila.data) : null;
  }

  function leerTheme() {
    const fila = stmts.selTheme.get();
    const valor = fila ? fila.valor : THEME_DEFAULT;
    return valor === "oscuro" ? "oscuro" : "claro";
  }

  /** Ejecuta `fn` dentro de una transaccion SQLite (BEGIN/COMMIT/ROLLBACK). */
  function enTransaccion(fn) {
    sqlite.exec("BEGIN");
    try {
      fn();
      sqlite.exec("COMMIT");
    } catch (e) {
      try {
        sqlite.exec("ROLLBACK");
      } catch (e2) {}
      throw e;
    }
  }

  /**
   * Reemplaza TODA la coleccion `clientes` con el array dado, dentro de
   * una transaccion (borra todo + inserta), espejando la semantica de
   * "reemplazar coleccion" del modulo de sync del cliente.
   */
  function reemplazarClientes(arr) {
    enTransaccion(() => {
      const ts = ahora();
      stmts.delClientes.run();
      for (const c of Array.isArray(arr) ? arr : []) {
        if (c && c.id != null) {
          stmts.insCliente.run(String(c.id), JSON.stringify(c), ts);
        }
      }
    });
  }

  function reemplazarMovimientos(arr) {
    enTransaccion(() => {
      const ts = ahora();
      stmts.delMovimientos.run();
      for (const m of Array.isArray(arr) ? arr : []) {
        if (m && m.id != null) {
          stmts.insMovimiento.run(String(m.id), JSON.stringify(m), ts);
        }
      }
    });
  }

  function guardarConfig(cfg) {
    stmts.upsConfig.run(JSON.stringify(cfg || {}), ahora());
  }

  function guardarTheme(valor) {
    stmts.upsTheme.run(valor === "oscuro" ? "oscuro" : "claro", ahora());
  }

  /** Snapshot completo equivalente a la carga inicial de Firestore. */
  function estadoCompleto() {
    return {
      clientes: leerClientes(),
      movimientos: leerMovimientos(),
      config: leerConfig(),
      theme: leerTheme()
    };
  }

  function cerrar() {
    try {
      sqlite.close();
    } catch (e) {
      // ya cerrada
    }
  }

  return {
    _sqlite: sqlite,
    leerClientes,
    leerMovimientos,
    leerConfig,
    leerTheme,
    estadoCompleto,
    reemplazarClientes,
    reemplazarMovimientos,
    guardarConfig,
    guardarTheme,
    cerrar
  };
}

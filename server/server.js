/* ============================================================
   Panel de Control de Clientes - Servidor HTTP + REST + WebSocket
   ------------------------------------------------------------
   Un unico servidor Node (node:http) que:
     1) sirve el frontend estatico (index.html, app.js, red-mapa.js,
        styles.css y el modulo de sync) para rutas no-/api / no-/ws;
     2) expone la API REST autenticada de los cuatro dominios de datos
        (clientes, movimientos, config, theme) respaldada por SQLite;
     3) provee sincronizacion en vivo por WebSocket (/ws): cada escritura
        se difunde al resto de clientes conectados;
     4) valida el login de contrasena unica y gestiona la sesion por cookie.

   Pensado para correr detras de Caddy (TLS autofirmado) en el box de 1 GB.
   Sin dependencias de npm: todo con modulos integrados de Node 22.
   ============================================================ */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { abrirBaseDeDatos } from "./db.js";
import { crearAuth } from "./auth.js";
import { crearGestorWS } from "./ws.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cabeceras de seguridad que antes fijaba netlify.toml.
const CABECERAS_SEGURIDAD = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin"
};

const TIPOS_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json; charset=utf-8"
};

/**
 * Crea (sin arrancar a escuchar) el servidor del panel.
 *
 * @param {object} opciones
 * @param {string} opciones.appPassword    Contrasena compartida.
 * @param {string} opciones.sessionSecret  Secreto HMAC de sesiones.
 * @param {string} opciones.dbPath         Ruta del archivo SQLite (o ':memory:').
 * @param {string} [opciones.staticDir]    Directorio del frontend estatico.
 * @param {boolean} [opciones.cookieSegura] Fuerza el atributo Secure en la cookie.
 *        Por defecto true (produccion HTTPS); las pruebas lo ponen en false (http).
 * @returns {{ server, db, ws, close }}
 */
export function crearServidor(opciones = {}) {
  const appPassword = opciones.appPassword ?? process.env.APP_PASSWORD;
  const sessionSecret = opciones.sessionSecret ?? process.env.SESSION_SECRET;
  const dbPath = opciones.dbPath ?? process.env.DB_PATH ?? "/data/pcc.sqlite";
  // El frontend vive en la raiz del repo (un nivel por encima de server/).
  const staticDir =
    opciones.staticDir ?? path.resolve(__dirname, "..");
  const cookieSegura =
    opciones.cookieSegura ?? process.env.COOKIE_INSECURE !== "1";

  const db = abrirBaseDeDatos(dbPath);
  const auth = crearAuth(appPassword, sessionSecret);

  // --- WebSocket: autoriza por la cookie de sesion en el upgrade --------
  const ws = crearGestorWS({
    autorizar: (req) => auth.peticionAutenticada(req),
    alConectar: (socket) => {
      // Al conectar, mandamos el estado completo para que un cliente que
      // (re)conecta se resincronice sin pedir GET /api/state otra vez.
      try {
        ws.enviar(
          socket,
          JSON.stringify({ domain: "state", data: db.estadoCompleto() })
        );
      } catch (e) {}
    }
  });

  // --- Utilidades HTTP --------------------------------------------------
  function enviarJSON(res, status, obj, cabecerasExtra) {
    const cuerpo = JSON.stringify(obj);
    res.writeHead(status, {
      ...CABECERAS_SEGURIDAD,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(cuerpo),
      ...(cabecerasExtra || {})
    });
    res.end(cuerpo);
  }

  function leerCuerpo(req, limiteBytes = 5 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const partes = [];
      let total = 0;
      req.on("data", (chunk) => {
        total += chunk.length;
        if (total > limiteBytes) {
          reject(new Error("payload demasiado grande"));
          req.destroy();
          return;
        }
        partes.push(chunk);
      });
      req.on("end", () => {
        const crudo = Buffer.concat(partes).toString("utf8");
        if (!crudo) return resolve(null);
        try {
          resolve(JSON.parse(crudo));
        } catch (e) {
          reject(new Error("JSON invalido"));
        }
      });
      req.on("error", reject);
    });
  }

  // --- Servir archivos estaticos ---------------------------------------
  function servirEstatico(req, res, urlPath) {
    let rel = decodeURIComponent(urlPath.split("?")[0]);
    if (rel === "/" || rel === "") rel = "/index.html";

    // Normaliza y evita path traversal fuera de staticDir.
    const destino = path.normalize(path.join(staticDir, rel));
    if (!destino.startsWith(staticDir)) {
      enviarJSON(res, 403, { error: "Prohibido" });
      return;
    }

    fs.stat(destino, (err, stat) => {
      if (err || !stat.isFile()) {
        // SPA simple: desconocido no-API => index.html.
        const indexPath = path.join(staticDir, "index.html");
        fs.readFile(indexPath, (e2, buf) => {
          if (e2) {
            enviarJSON(res, 404, { error: "No encontrado" });
            return;
          }
          res.writeHead(200, {
            ...CABECERAS_SEGURIDAD,
            "Content-Type": TIPOS_MIME[".html"]
          });
          res.end(buf);
        });
        return;
      }
      const ext = path.extname(destino).toLowerCase();
      fs.readFile(destino, (e3, buf) => {
        if (e3) {
          enviarJSON(res, 500, { error: "Error al leer el archivo" });
          return;
        }
        res.writeHead(200, {
          ...CABECERAS_SEGURIDAD,
          "Content-Type": TIPOS_MIME[ext] || "application/octet-stream"
        });
        res.end(buf);
      });
    });
  }

  // --- Enrutado principal ----------------------------------------------
  const server = http.createServer(async (req, res) => {
    const url = req.url || "/";
    const metodo = req.method || "GET";
    const ruta = url.split("?")[0];

    // ---- Rutas de API -------------------------------------------------
    if (ruta === "/api/login" && metodo === "POST") {
      let cuerpo;
      try {
        cuerpo = await leerCuerpo(req);
      } catch (e) {
        return enviarJSON(res, 400, { error: "Solicitud invalida" });
      }
      const password = cuerpo && cuerpo.password;
      if (!auth.passwordValida(password)) {
        return enviarJSON(res, 401, { error: "Contrasena incorrecta" });
      }
      const token = auth.emitirToken();
      return enviarJSON(
        res,
        200,
        { ok: true },
        { "Set-Cookie": auth.cookieSesion(token, { seguro: cookieSegura }) }
      );
    }

    if (ruta === "/api/logout" && metodo === "POST") {
      return enviarJSON(
        res,
        200,
        { ok: true },
        { "Set-Cookie": auth.cookieBorrado({ seguro: cookieSegura }) }
      );
    }

    // Todas las rutas /api/* restantes requieren sesion valida.
    if (ruta.startsWith("/api/")) {
      if (!auth.peticionAutenticada(req)) {
        return enviarJSON(res, 401, { error: "No autenticado" });
      }

      if (ruta === "/api/state" && metodo === "GET") {
        return enviarJSON(res, 200, db.estadoCompleto());
      }

      if (ruta === "/api/clientes" && metodo === "PUT") {
        let cuerpo;
        try {
          cuerpo = await leerCuerpo(req);
        } catch (e) {
          return enviarJSON(res, 400, { error: "JSON invalido" });
        }
        const arr = Array.isArray(cuerpo) ? cuerpo : [];
        db.reemplazarClientes(arr);
        ws.difundir({ domain: "clientes", data: db.leerClientes() });
        return enviarJSON(res, 200, { ok: true, count: arr.length });
      }

      if (ruta === "/api/movimientos" && metodo === "PUT") {
        let cuerpo;
        try {
          cuerpo = await leerCuerpo(req);
        } catch (e) {
          return enviarJSON(res, 400, { error: "JSON invalido" });
        }
        const arr = Array.isArray(cuerpo) ? cuerpo : [];
        db.reemplazarMovimientos(arr);
        ws.difundir({ domain: "movimientos", data: db.leerMovimientos() });
        return enviarJSON(res, 200, { ok: true, count: arr.length });
      }

      if (ruta === "/api/config" && metodo === "PUT") {
        let cuerpo;
        try {
          cuerpo = await leerCuerpo(req);
        } catch (e) {
          return enviarJSON(res, 400, { error: "JSON invalido" });
        }
        const cfg = cuerpo && typeof cuerpo === "object" ? cuerpo : {};
        db.guardarConfig(cfg);
        ws.difundir({ domain: "config", data: db.leerConfig() });
        return enviarJSON(res, 200, { ok: true });
      }

      if (ruta === "/api/theme" && metodo === "PUT") {
        let cuerpo;
        try {
          cuerpo = await leerCuerpo(req);
        } catch (e) {
          return enviarJSON(res, 400, { error: "JSON invalido" });
        }
        const valor = cuerpo && cuerpo.valor;
        db.guardarTheme(valor);
        ws.difundir({ domain: "theme", data: db.leerTheme() });
        return enviarJSON(res, 200, { ok: true });
      }

      return enviarJSON(res, 404, { error: "Ruta de API no encontrada" });
    }

    // ---- /ws por HTTP normal no es valido (solo upgrade) --------------
    if (ruta === "/ws") {
      return enviarJSON(res, 426, { error: "Se requiere Upgrade a WebSocket" });
    }

    // ---- Estatico -----------------------------------------------------
    if (metodo === "GET" || metodo === "HEAD") {
      return servirEstatico(req, res, url);
    }

    enviarJSON(res, 405, { error: "Metodo no permitido" });
  });

  // --- Upgrade WebSocket (autorizado por cookie de sesion) --------------
  server.on("upgrade", (req, socket, head) => {
    const ruta = (req.url || "").split("?")[0];
    if (ruta !== "/ws") {
      socket.destroy();
      return;
    }
    ws.manejarUpgrade(req, socket, head);
  });

  function close() {
    return new Promise((resolve) => {
      ws.cerrarTodo();
      server.close(() => {
        db.cerrar();
        resolve();
      });
    });
  }

  return { server, db, ws, auth, close };
}

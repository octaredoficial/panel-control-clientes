/* ============================================================
   Pruebas del backend (node:test, sin dependencias externas).
   Cubren: login exito/fallo, gating de autenticacion, round-trip
   de datos por SQLite, y difusion por WebSocket entre dos clientes.
   Cada prueba usa una base SQLite en memoria (':memory:').
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";

import { crearServidor } from "./server.js";
import { crearAuth } from "./auth.js";
import { aceptarClave } from "./ws.js";

const APP_PASSWORD = "secreto-de-prueba";
const SESSION_SECRET = "secreto-de-sesion-muy-largo-para-pruebas-1234567890";

/** Arranca un servidor de prueba en un puerto efimero. */
async function arrancarServidor() {
  const inst = crearServidor({
    appPassword: APP_PASSWORD,
    sessionSecret: SESSION_SECRET,
    dbPath: ":memory:",
    cookieSegura: false
  });
  await new Promise((resolve) => inst.server.listen(0, "127.0.0.1", resolve));
  const { port } = inst.server.address();
  return { inst, port };
}

/** Peticion HTTP minima que devuelve {status, headers, body, cookies}. */
function pedir(port, metodo, ruta, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const datos = body != null ? JSON.stringify(body) : null;
    const headers = {};
    if (datos) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(datos);
    }
    if (cookie) headers["Cookie"] = cookie;

    const req = http.request(
      { host: "127.0.0.1", port, method: metodo, path: ruta, headers },
      (res) => {
        const partes = [];
        res.on("data", (c) => partes.push(c));
        res.on("end", () => {
          const texto = Buffer.concat(partes).toString("utf8");
          let json = null;
          try {
            json = texto ? JSON.parse(texto) : null;
          } catch (e) {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json,
            cookies: res.headers["set-cookie"] || []
          });
        });
      }
    );
    req.on("error", reject);
    if (datos) req.write(datos);
    req.end();
  });
}

/** Devuelve el valor de la cookie de sesion (nombre=valor) para reenviar. */
function cookieDe(resp) {
  const sc = resp.cookies[0] || "";
  return sc.split(";")[0];
}

/** Hace login con la contrasena correcta y devuelve la cookie reutilizable. */
async function loginOk(port) {
  const resp = await pedir(port, "POST", "/api/login", {
    body: { password: APP_PASSWORD }
  });
  assert.equal(resp.status, 200);
  return cookieDe(resp);
}

test("login: contrasena incorrecta devuelve 401 y sin cookie", async () => {
  const { inst, port } = await arrancarServidor();
  try {
    const resp = await pedir(port, "POST", "/api/login", {
      body: { password: "mala" }
    });
    assert.equal(resp.status, 401);
    assert.equal(resp.cookies.length, 0);
  } finally {
    await inst.close();
  }
});

test("login: contrasena correcta devuelve 200 y Set-Cookie de sesion", async () => {
  const { inst, port } = await arrancarServidor();
  try {
    const resp = await pedir(port, "POST", "/api/login", {
      body: { password: APP_PASSWORD }
    });
    assert.equal(resp.status, 200);
    assert.ok(resp.cookies.length >= 1);
    const sc = resp.cookies[0];
    assert.match(sc, /pcc_session=/);
    assert.match(sc, /HttpOnly/i);
  } finally {
    await inst.close();
  }
});

test("auth: /api/state sin cookie devuelve 401", async () => {
  const { inst, port } = await arrancarServidor();
  try {
    const resp = await pedir(port, "GET", "/api/state");
    assert.equal(resp.status, 401);
  } finally {
    await inst.close();
  }
});

test("auth: PUT /api/clientes sin cookie devuelve 401", async () => {
  const { inst, port } = await arrancarServidor();
  try {
    const resp = await pedir(port, "PUT", "/api/clientes", { body: [] });
    assert.equal(resp.status, 401);
  } finally {
    await inst.close();
  }
});

test("state: GET inicial devuelve la forma vacia esperada", async () => {
  const { inst, port } = await arrancarServidor();
  try {
    const cookie = await loginOk(port);
    const resp = await pedir(port, "GET", "/api/state", { cookie });
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.body.clientes, []);
    assert.deepEqual(resp.body.movimientos, []);
    assert.equal(resp.body.config, null);
    assert.equal(resp.body.theme, "claro");
  } finally {
    await inst.close();
  }
});

test("round-trip: PUT clientes/movimientos/config/theme persiste y GET lo devuelve", async () => {
  const { inst, port } = await arrancarServidor();
  try {
    const cookie = await loginOk(port);

    const clientes = [
      { id: "c1", nombre: "Ana", monto: 500, ssid: "RedAna", passWifi: "x" },
      { id: "c2", nombre: "Beto", monto: 600 }
    ];
    const movimientos = [
      {
        id: "m1",
        tipo: "ingreso",
        concepto: "pago",
        monto: 500,
        fecha: "2025-01-01",
        esPago: true,
        folio: "F-001",
        periodo: "2025-01",
        clienteId: "c1",
        prevUltimoPago: "",
        prevFechaProximoPago: "2025-01-01"
      }
    ];
    const config = { moneda: "MXN", nombreNegocio: "WISP" };

    assert.equal(
      (await pedir(port, "PUT", "/api/clientes", { cookie, body: clientes }))
        .status,
      200
    );
    assert.equal(
      (
        await pedir(port, "PUT", "/api/movimientos", {
          cookie,
          body: movimientos
        })
      ).status,
      200
    );
    assert.equal(
      (await pedir(port, "PUT", "/api/config", { cookie, body: config }))
        .status,
      200
    );
    assert.equal(
      (
        await pedir(port, "PUT", "/api/theme", {
          cookie,
          body: { valor: "oscuro" }
        })
      ).status,
      200
    );

    const resp = await pedir(port, "GET", "/api/state", { cookie });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.clientes.length, 2);
    // Preserva campos ricos (ssid/passWifi) intactos.
    const c1 = resp.body.clientes.find((c) => c.id === "c1");
    assert.equal(c1.ssid, "RedAna");
    assert.equal(c1.passWifi, "x");
    // Preserva campos de pago (folio/periodo/prev*).
    assert.equal(resp.body.movimientos[0].folio, "F-001");
    assert.equal(resp.body.movimientos[0].periodo, "2025-01");
    assert.equal(resp.body.movimientos[0].prevFechaProximoPago, "2025-01-01");
    assert.equal(resp.body.config.nombreNegocio, "WISP");
    assert.equal(resp.body.theme, "oscuro");
  } finally {
    await inst.close();
  }
});

test("estatico: sirve index.html con las cabeceras de seguridad", async () => {
  const { inst, port } = await arrancarServidor();
  try {
    const resp = await pedir(port, "GET", "/index.html");
    assert.equal(resp.status, 200);
    assert.equal(resp.headers["x-content-type-options"], "nosniff");
    assert.equal(
      resp.headers["referrer-policy"],
      "strict-origin-when-cross-origin"
    );
  } finally {
    await inst.close();
  }
});

test("estatico (regresion): el codigo del backend NO es descargable", async () => {
  // El servidor vive en server/ bajo la raiz del repo (staticDir). La
  // allowlist debe impedir que /server/*.js devuelvan su contenido: cualquier
  // ruta fuera de la lista blanca cae al fallback del SPA (index.html), nunca
  // al archivo del backend. Esto cierra la fuga que exponia el diseno de auth.
  const { inst, port } = await arrancarServidor();
  try {
    const rutas = [
      "/server/auth.js",
      "/server/server.js",
      "/server/db.js",
      "/server/ws.js",
      "/server/index.js"
    ];
    for (const ruta of rutas) {
      const resp = await pedir(port, "GET", ruta);
      // No debe revelar el fuente: si responde 200, debe ser el HTML del SPA,
      // nunca JavaScript del backend.
      if (resp.status === 200) {
        assert.equal(
          resp.headers["content-type"],
          "text/html; charset=utf-8",
          "La ruta " + ruta + " devolvio algo distinto del SPA (posible fuga)"
        );
      } else {
        assert.notEqual(resp.status, 200);
      }
    }
  } finally {
    await inst.close();
  }
});

test("estatico (regresion): .env y documentos NO se sirven por allowlist", async () => {
  const { inst, port } = await arrancarServidor();
  try {
    for (const ruta of ["/.env", "/README.md", "/MIGRATION.md", "/.env.example"]) {
      const resp = await pedir(port, "GET", ruta);
      if (resp.status === 200) {
        assert.equal(resp.headers["content-type"], "text/html; charset=utf-8");
      }
    }
  } finally {
    await inst.close();
  }
});

test("estatico: sirve los archivos del frontend de la allowlist", async () => {
  const { inst, port } = await arrancarServidor();
  try {
    const resp = await pedir(port, "GET", "/backend-sync.js");
    assert.equal(resp.status, 200);
    assert.match(resp.headers["content-type"], /javascript/);
  } finally {
    await inst.close();
  }
});

test("auth: rechaza APP_PASSWORD de ejemplo ('change-me') en el arranque", () => {
  assert.throws(
    () => crearAuth("change-me", SESSION_SECRET),
    /APP_PASSWORD/
  );
});

test("auth: rechaza SESSION_SECRET de ejemplo en el arranque", () => {
  assert.throws(
    () => crearAuth(APP_PASSWORD, "generate-a-long-random-string"),
    /SESSION_SECRET/
  );
});

test("auth: rechaza un SESSION_SECRET demasiado corto", () => {
  assert.throws(() => crearAuth(APP_PASSWORD, "corto"), /corto|SESSION_SECRET/);
});

/* ------------------------------------------------------------
   Cliente WebSocket minimo para la prueba de difusion.
   ------------------------------------------------------------ */
function abrirWS(port, cookie) {
  return new Promise((resolve, reject) => {
    const clave = crypto.randomBytes(16).toString("base64");
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: "/ws",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": clave,
        "Sec-WebSocket-Version": "13",
        Cookie: cookie || ""
      }
    });
    // Si el servidor responde en vez de hacer upgrade (p. ej. 401), no hay
    // handshake WS: lo tratamos como rechazo.
    req.on("response", (res) => {
      reject(new Error("WS rechazado con status " + res.statusCode));
    });
    req.on("upgrade", (res, socket, head) => {
      const esperado = aceptarClave(clave);
      if (res.headers["sec-websocket-accept"] !== esperado) {
        reject(new Error("handshake WS invalido"));
        return;
      }
      const mensajes = [];
      const oyentes = [];
      // `head` puede traer el/los primeros frames WS que llegaron junto con
      // la respuesta 101 en el mismo segmento TCP: hay que procesarlos.
      let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);

      function consumir() {
        let seguir = true;
        while (seguir) {
          const f = leerFrameCliente(buf);
          if (!f) {
            seguir = false;
            break;
          }
          buf = f.resto;
          if (f.opcode === 0x1) {
            const texto = f.payload.toString("utf8");
            mensajes.push(texto);
            const o = oyentes.shift();
            if (o) o(texto);
          }
        }
      }

      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        consumir();
      });

      // Procesa cualquier frame ya presente en `head`.
      consumir();

      function siguienteMensaje(timeoutMs = 2000) {
        if (mensajes.length) {
          return Promise.resolve(mensajes.shift());
        }
        return new Promise((res2, rej2) => {
          const t = setTimeout(() => rej2(new Error("timeout WS")), timeoutMs);
          oyentes.push((texto) => {
            clearTimeout(t);
            res2(texto);
          });
        });
      }

      resolve({
        socket,
        siguienteMensaje,
        cerrar: () => socket.destroy()
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function leerFrameCliente(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const segundo = buffer[1];
  let longitud = segundo & 0x7f;
  let offset = 2;
  if (longitud === 126) {
    if (buffer.length < offset + 2) return null;
    longitud = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (longitud === 127) {
    if (buffer.length < offset + 8) return null;
    longitud = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  // El servidor no enmascara, asi que no leemos mascara.
  if (buffer.length < offset + longitud) return null;
  const payload = buffer.slice(offset, offset + longitud);
  return { opcode, payload, resto: buffer.slice(offset + longitud) };
}

test("ws: upgrade sin sesion valida se rechaza", async () => {
  const { inst, port } = await arrancarServidor();
  try {
    await assert.rejects(abrirWS(port, ""));
  } finally {
    await inst.close();
  }
});

test("ws: una escritura de un cliente llega a otro cliente conectado", async () => {
  const { inst, port } = await arrancarServidor();
  let a, b;
  try {
    const cookie = await loginOk(port);
    a = await abrirWS(port, cookie);
    b = await abrirWS(port, cookie);

    // Al conectar, cada cliente recibe {domain:'state'}: lo consumimos.
    const estadoA = JSON.parse(await a.siguienteMensaje());
    const estadoB = JSON.parse(await b.siguienteMensaje());
    assert.equal(estadoA.domain, "state");
    assert.equal(estadoB.domain, "state");

    // El cliente A escribe clientes via REST; B debe recibir la difusion.
    const clientes = [{ id: "z1", nombre: "Zoe", monto: 400 }];
    const put = await pedir(port, "PUT", "/api/clientes", {
      cookie,
      body: clientes
    });
    assert.equal(put.status, 200);

    const msg = JSON.parse(await b.siguienteMensaje());
    assert.equal(msg.domain, "clientes");
    assert.equal(msg.data.length, 1);
    assert.equal(msg.data[0].nombre, "Zoe");
  } finally {
    if (a) a.cerrar();
    if (b) b.cerrar();
    await inst.close();
  }
});

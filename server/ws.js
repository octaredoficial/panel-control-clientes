/* ============================================================
   Panel de Control de Clientes - Servidor WebSocket minimo
   ------------------------------------------------------------
   Implementacion RFC 6455 con SOLO modulos integrados de Node
   (node:crypto). Evita la dependencia `ws` para mantener el
   backend sin dependencias de npm (objetivo de poca RAM, 1 GB).

   Soporta lo que esta app necesita:
     - handshake de upgrade (Sec-WebSocket-Accept);
     - envio de frames de texto (server -> cliente) con broadcast;
     - lectura/descarte de frames entrantes (ping/pong/close, y texto
       que el cliente pudiera enviar, aunque aqui el cliente solo lee);
     - respuesta a ping con pong y cierre limpio.

   NO fragmenta mensajes salientes grandes (payload < 2^53); para el
   volumen de esta app (30-50 clientes) es mas que suficiente.
   ============================================================ */

import crypto from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/** Calcula el valor del header Sec-WebSocket-Accept. */
export function aceptarClave(claveCliente) {
  return crypto
    .createHash("sha1")
    .update(claveCliente + GUID)
    .digest("base64");
}

/** Codifica un payload de texto en un frame WebSocket (sin mascara: server). */
export function codificarFrameTexto(texto) {
  const payload = Buffer.from(texto, "utf8");
  const len = payload.length;
  let encabezado;

  if (len < 126) {
    encabezado = Buffer.alloc(2);
    encabezado[1] = len;
  } else if (len < 65536) {
    encabezado = Buffer.alloc(4);
    encabezado[1] = 126;
    encabezado.writeUInt16BE(len, 2);
  } else {
    encabezado = Buffer.alloc(10);
    encabezado[1] = 127;
    // writeBigUInt64BE requiere BigInt; para esta app len cabe de sobra.
    encabezado.writeBigUInt64BE(BigInt(len), 2);
  }
  encabezado[0] = 0x80 | OP_TEXT; // FIN + opcode texto
  return Buffer.concat([encabezado, payload]);
}

function codificarFrameControl(opcode, payload = Buffer.alloc(0)) {
  // Los frames de control tienen payload < 126 siempre en este server.
  const encabezado = Buffer.alloc(2);
  encabezado[0] = 0x80 | opcode;
  encabezado[1] = payload.length;
  return Buffer.concat([encabezado, payload]);
}

/**
 * Crea un gestor de WebSocket sobre un servidor http existente.
 *
 * @param {object} opciones
 * @param {(req) => boolean} opciones.autorizar  Decide si el upgrade se acepta
 *        (p. ej. validando la cookie de sesion). Si devuelve false, se rechaza.
 * @param {(socket) => void} [opciones.alConectar]  Callback tras aceptar un
 *        cliente (p. ej. para enviarle el estado actual).
 */
export function crearGestorWS({ autorizar, alConectar } = {}) {
  const clientes = new Set();

  function manejarUpgrade(req, socket, head) {
    // Rechazo de autorizacion: cerramos con 401 antes de hacer el handshake.
    if (typeof autorizar === "function" && !autorizar(req)) {
      socket.write(
        "HTTP/1.1 401 Unauthorized\r\n" +
          "Connection: close\r\n" +
          "Content-Length: 0\r\n\r\n"
      );
      socket.destroy();
      return;
    }

    const clave = req.headers["sec-websocket-key"];
    if (!clave) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const accept = aceptarClave(clave);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: " +
        accept +
        "\r\n\r\n"
    );

    socket.setTimeout(0);
    socket.setNoDelay(true);
    clientes.add(socket);

    // Buffer acumulador para parsear frames entrantes del cliente.
    let buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);

    function limpiar() {
      clientes.delete(socket);
    }

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Parseo iterativo de todos los frames completos disponibles.
      let seguir = true;
      while (seguir) {
        const resultado = leerFrame(buffer);
        if (!resultado) {
          seguir = false;
          break;
        }
        const { fin, opcode, payload, resto } = resultado;
        buffer = resto;

        if (opcode === OP_CLOSE) {
          try {
            socket.write(codificarFrameControl(OP_CLOSE));
          } catch (e) {}
          socket.end();
          seguir = false;
        } else if (opcode === OP_PING) {
          try {
            socket.write(codificarFrameControl(OP_PONG, payload));
          } catch (e) {}
        } else if (opcode === OP_PONG) {
          // nada que hacer
        }
        // Frames de texto/binarios entrantes: esta app no espera que el
        // cliente escriba por WS (las escrituras van por REST), asi que se
        // ignoran de forma segura. `fin`/`OP_CONT`/`OP_TEXT`/`OP_BINARY`
        // quedan referenciados para claridad del protocolo.
        void fin;
        void OP_CONT;
        void OP_TEXT;
        void OP_BINARY;
      }
    });

    socket.on("close", limpiar);
    socket.on("end", limpiar);
    socket.on("error", () => {
      limpiar();
      try {
        socket.destroy();
      } catch (e) {}
    });

    if (typeof alConectar === "function") {
      try {
        alConectar(socket);
      } catch (e) {}
    }
  }

  /** Envia un mensaje de texto a un socket concreto. */
  function enviar(socket, texto) {
    try {
      return socket.write(codificarFrameTexto(texto));
    } catch (e) {
      clientes.delete(socket);
      return false;
    }
  }

  /**
   * Difunde un objeto (serializado a JSON) a todos los clientes conectados,
   * opcionalmente excluyendo al emisor (`excepto`).
   */
  function difundir(objeto, excepto) {
    const texto = JSON.stringify(objeto);
    for (const socket of clientes) {
      if (socket === excepto) continue;
      enviar(socket, texto);
    }
  }

  function cerrarTodo() {
    for (const socket of clientes) {
      try {
        socket.write(codificarFrameControl(OP_CLOSE));
        socket.end();
      } catch (e) {}
    }
    clientes.clear();
  }

  return {
    manejarUpgrade,
    difundir,
    enviar,
    cerrarTodo,
    get numClientes() {
      return clientes.size;
    }
  };
}

/**
 * Intenta leer UN frame del buffer. Devuelve null si aun no hay bytes
 * suficientes. Desenmascara el payload (los clientes SIEMPRE enmascaran).
 */
function leerFrame(buffer) {
  if (buffer.length < 2) return null;

  const primero = buffer[0];
  const fin = (primero & 0x80) !== 0;
  const opcode = primero & 0x0f;

  const segundo = buffer[1];
  const enmascarado = (segundo & 0x80) !== 0;
  let longitud = segundo & 0x7f;
  let offset = 2;

  if (longitud === 126) {
    if (buffer.length < offset + 2) return null;
    longitud = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (longitud === 127) {
    if (buffer.length < offset + 8) return null;
    const big = buffer.readBigUInt64BE(offset);
    longitud = Number(big);
    offset += 8;
  }

  let mascara;
  if (enmascarado) {
    if (buffer.length < offset + 4) return null;
    mascara = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + longitud) return null;

  let payload = buffer.slice(offset, offset + longitud);
  if (enmascarado && mascara) {
    const desenmascarado = Buffer.alloc(longitud);
    for (let i = 0; i < longitud; i++) {
      desenmascarado[i] = payload[i] ^ mascara[i & 3];
    }
    payload = desenmascarado;
  }

  const resto = buffer.slice(offset + longitud);
  return { fin, opcode, payload, resto };
}

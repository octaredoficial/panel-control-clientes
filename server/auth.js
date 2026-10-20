/* ============================================================
   Panel de Control de Clientes - Autenticacion de contrasena unica
   ------------------------------------------------------------
   Reemplaza Firebase Auth por una sola contrasena compartida.

   - La contrasena esperada viene de la variable de entorno APP_PASSWORD.
   - La comparacion es de tiempo constante (crypto.timingSafeEqual) sobre
     hashes SHA-256 de ambas cadenas, para no filtrar informacion por el
     tiempo ni por la longitud.
   - Tras un acierto se emite un TOKEN DE SESION firmado (HMAC-SHA256 con
     SESSION_SECRET): payload = { exp } codificado en base64url + firma.
     Es sin estado (no requiere almacen de sesiones en memoria/SQLite),
     lo que simplifica el despliegue y sobrevive a reinicios del proceso.
   - El token viaja en una cookie HttpOnly; el navegador la reenvia sola
     con fetch(credentials:'include') y con el upgrade del WebSocket.
   ============================================================ */

import crypto from "node:crypto";

export const COOKIE_SESION = "pcc_session";
// Duracion de la sesion: 30 dias (uso personal, bajo riesgo).
const DURACION_MS = 30 * 24 * 60 * 60 * 1000;

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function desdeBase64url(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(
    str.replace(/-/g, "+").replace(/_/g, "/") + pad,
    "base64"
  );
}

/** Comparacion de tiempo constante de dos cadenas (via hash SHA-256). */
export function igualdadConstante(a, b) {
  const ha = crypto.createHash("sha256").update(String(a), "utf8").digest();
  const hb = crypto.createHash("sha256").update(String(b), "utf8").digest();
  // Ambos hashes miden 32 bytes, asi que timingSafeEqual no lanza.
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Crea un gestor de autenticacion con la contrasena y el secreto dados.
 * @param {string} appPassword   Contrasena compartida (APP_PASSWORD).
 * @param {string} sessionSecret Secreto para firmar los tokens (SESSION_SECRET).
 */
export function crearAuth(appPassword, sessionSecret) {
  if (!appPassword) {
    throw new Error("APP_PASSWORD es obligatoria y no esta definida.");
  }
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET es obligatorio y no esta definido.");
  }

  function firmar(datos) {
    return base64url(
      crypto.createHmac("sha256", sessionSecret).update(datos).digest()
    );
  }

  /** Comprueba la contrasena de login. */
  function passwordValida(password) {
    if (typeof password !== "string" || password.length === 0) {
      return false;
    }
    return igualdadConstante(password, appPassword);
  }

  /** Emite un token de sesion firmado con caducidad. */
  function emitirToken() {
    const payload = base64url(
      JSON.stringify({ exp: Date.now() + DURACION_MS })
    );
    const firma = firmar(payload);
    return payload + "." + firma;
  }

  /** Verifica un token: firma valida y no caducado. */
  function tokenValido(token) {
    if (typeof token !== "string" || token.indexOf(".") === -1) {
      return false;
    }
    const [payload, firma] = token.split(".");
    if (!payload || !firma) return false;

    const esperada = firmar(payload);
    const fb = Buffer.from(firma);
    const eb = Buffer.from(esperada);
    if (fb.length !== eb.length || !crypto.timingSafeEqual(fb, eb)) {
      return false;
    }
    try {
      const datos = JSON.parse(desdeBase64url(payload).toString("utf8"));
      return typeof datos.exp === "number" && datos.exp > Date.now();
    } catch (e) {
      return false;
    }
  }

  /** Parsea las cookies de una cabecera Cookie en un objeto. */
  function parsearCookies(cookieHeader) {
    const out = {};
    if (!cookieHeader) return out;
    for (const parte of cookieHeader.split(";")) {
      const idx = parte.indexOf("=");
      if (idx === -1) continue;
      const k = parte.slice(0, idx).trim();
      const v = parte.slice(idx + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
    return out;
  }

  /** Extrae y valida el token de sesion de una peticion. */
  function peticionAutenticada(req) {
    const cookies = parsearCookies(req.headers.cookie);
    return tokenValido(cookies[COOKIE_SESION]);
  }

  /**
   * Construye el valor de Set-Cookie para la sesion.
   * `seguro` activa el atributo Secure (produccion bajo HTTPS por Caddy).
   */
  function cookieSesion(token, { seguro = true } = {}) {
    const attrs = [
      COOKIE_SESION + "=" + token,
      "HttpOnly",
      "SameSite=Strict",
      "Path=/",
      "Max-Age=" + Math.floor(DURACION_MS / 1000)
    ];
    if (seguro) attrs.push("Secure");
    return attrs.join("; ");
  }

  /** Cookie de borrado (logout). */
  function cookieBorrado({ seguro = true } = {}) {
    const attrs = [
      COOKIE_SESION + "=",
      "HttpOnly",
      "SameSite=Strict",
      "Path=/",
      "Max-Age=0"
    ];
    if (seguro) attrs.push("Secure");
    return attrs.join("; ");
  }

  return {
    passwordValida,
    emitirToken,
    tokenValido,
    peticionAutenticada,
    parsearCookies,
    cookieSesion,
    cookieBorrado
  };
}

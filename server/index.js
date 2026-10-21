/* ============================================================
   Panel de Control de Clientes - Punto de entrada del backend
   ------------------------------------------------------------
   Lee la configuracion de variables de entorno y arranca el servidor.

   Variables de entorno:
     APP_PASSWORD    (obligatoria) contrasena unica de acceso.
     SESSION_SECRET  (obligatorio) secreto largo y aleatorio para firmar
                     los tokens de sesion (HMAC-SHA256).
     DB_PATH         ruta del archivo SQLite (def. /data/pcc.sqlite).
     PORT            puerto de escucha (def. 8080).
     COOKIE_INSECURE =1 para no marcar la cookie como Secure (solo pruebas
                     o acceso por http sin proxy TLS).
   ============================================================ */

import { crearServidor } from "./server.js";

const PORT = Number(process.env.PORT || 8080);

try {
  const { server } = crearServidor();
  server.listen(PORT, () => {
    console.log(
      "[pcc] Panel de Control de Clientes escuchando en el puerto " + PORT
    );
  });
} catch (e) {
  console.error("[pcc] No se pudo iniciar el servidor:", e.message);
  process.exit(1);
}

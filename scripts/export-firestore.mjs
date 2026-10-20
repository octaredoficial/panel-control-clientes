/* ============================================================
   scripts/export-firestore.mjs  (FEAT-005)
   ------------------------------------------------------------
   Exporta los datos que hoy viven en Firestore a un solo archivo
   export.json con la forma { clientes, movimientos, config, theme }.

   ESTE SCRIPT LO CORRE EL USUARIO EN SU MAQUINA (no en el sandbox),
   porque necesita las credenciales de la cuenta de servicio de Firebase
   y acceso a internet al proyecto Firestore.

   Requisitos:
     1) Node 18+ (ya tienes Node 22).
     2) Instalar la dependencia (solo para este export):
            npm i firebase-admin
     3) Credenciales de una cuenta de servicio del proyecto
        panel-clientes-12a4a. Descarga el JSON desde la consola de
        Firebase (Configuracion del proyecto -> Cuentas de servicio ->
        Generar nueva clave privada) y exporta la variable:
            export GOOGLE_APPLICATION_CREDENTIALS=/ruta/al/serviceAccount.json

   Uso:
            node scripts/export-firestore.mjs
     (escribe ./export.json en el directorio actual)

   Variables de entorno opcionales:
     FIREBASE_PROJECT_ID  (por defecto: panel-clientes-12a4a)
     EXPORT_OUT           (ruta de salida, por defecto: export.json)

   Colecciones/documentos leidos (coinciden con firebase-sync.js):
     - coleccion 'clientes'
     - coleccion 'movimientos'
     - documento 'config/app'    -> config
     - documento 'config/theme'  -> theme ({ valor } o cadena)
   ============================================================ */

import fs from "node:fs";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "panel-clientes-12a4a";
const SALIDA = process.env.EXPORT_OUT || "export.json";

async function main() {
  let admin;
  try {
    admin = await import("firebase-admin");
  } catch (e) {
    console.error(
      "[export-firestore] Falta la dependencia 'firebase-admin'.\n" +
        "Instalala con:  npm i firebase-admin\n" +
        "y vuelve a correr este script."
    );
    process.exit(1);
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      "[export-firestore] Falta GOOGLE_APPLICATION_CREDENTIALS.\n" +
        "Exporta la ruta al JSON de la cuenta de servicio:\n" +
        "  export GOOGLE_APPLICATION_CREDENTIALS=/ruta/al/serviceAccount.json"
    );
    process.exit(1);
  }

  const app = admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID
  });
  const db = admin.firestore(app);

  console.log(`[export-firestore] Proyecto: ${PROJECT_ID}`);

  const clientes = await leerColeccion(db, "clientes");
  console.log(`[export-firestore] clientes: ${clientes.length}`);

  const movimientos = await leerColeccion(db, "movimientos");
  console.log(`[export-firestore] movimientos: ${movimientos.length}`);

  const config = await leerDoc(db, "config", "app");
  console.log(`[export-firestore] config: ${config ? "ok" : "(sin doc)"}`);

  const themeDoc = await leerDoc(db, "config", "theme");
  const theme =
    themeDoc && typeof themeDoc.valor === "string"
      ? themeDoc.valor
      : typeof themeDoc === "string"
        ? themeDoc
        : "claro";
  console.log(`[export-firestore] theme: ${theme}`);

  const salida = { clientes, movimientos, config: config || null, theme };
  fs.writeFileSync(SALIDA, JSON.stringify(salida, null, 2) + "\n", "utf8");
  console.log(`[export-firestore] Escrito ${SALIDA}`);
  console.log(
    "[export-firestore] IMPORTANTE: respalda este export.json antes de " +
      "desmantelar Firebase."
  );
}

async function leerColeccion(db, nombre) {
  const snap = await db.collection(nombre).get();
  const items = [];
  snap.forEach((doc) => {
    const data = doc.data() || {};
    // Preservar el id del documento como id del registro si no viene dentro.
    if (data.id == null) data.id = doc.id;
    items.push(data);
  });
  return items;
}

async function leerDoc(db, coleccion, id) {
  const ref = db.collection(coleccion).doc(id);
  const snap = await ref.get();
  return snap.exists ? snap.data() : null;
}

main().catch((e) => {
  console.error("[export-firestore] Error:", e && e.message ? e.message : e);
  process.exit(1);
});

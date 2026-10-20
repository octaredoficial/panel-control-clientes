/* ============================================================
   scripts/merge-and-seed.mjs  (FEAT-005)
   ------------------------------------------------------------
   Reconcilia el export de Firestore (export.json) con los clientes del
   CSV (clientes-from-csv.json) y carga el resultado en el backend
   autohospedado via su API REST (login + PUT), o lo escribe a disco en
   modo --dry-run para revisarlo antes.

   Regla de reconciliacion (ver lib-mapeo.reconciliarClientes):
     - Cotejo por "IP Cliente" (campo ip) y, si no, por nombre normalizado.
     - Campos ricos (ssid/passWifi/passModem/ipPrincipal/megas/monto/
       direccion/celular/tipoConexion): gana el CSV si trae valor.
     - Campos de historial (fechaProximoPago/ultimoPago/diaPago/apId/socio):
       gana Firestore si trae valor.
     - Nunca se descarta un cliente presente en una sola fuente.
     - movimientos, config y theme vienen SOLO de Firestore (export.json).

   Solo usa modulos integrados de Node (fetch nativo en Node 18+/22).

   Uso tipico (desde el directorio del repo, con el backend corriendo):
     node scripts/merge-and-seed.mjs \
       --firestore export.json \
       --csv clientes-from-csv.json \
       --base-url https://64.177.92.121 \
       --password "TU_APP_PASSWORD"

   Opciones:
     --firestore <ruta>   export.json (opcional; si falta, solo CSV)
     --csv <ruta>         clientes-from-csv.json (opcional; si falta, solo FS)
     --base-url <url>     URL del backend (por defecto http://localhost:8080)
     --password <pass>    APP_PASSWORD (o variable de entorno APP_PASSWORD)
     --out <ruta>         escribe el dataset final a un archivo (siempre util)
     --dry-run            NO envia nada al backend: solo reconcilia, imprime
                          el resumen y (si --out) escribe el JSON final
     --insecure           acepta el certificado autofirmado (HTTPS por IP)

   NOTA sobre el certificado autofirmado: al apuntar a https://<IP> con
   el cert interno de Caddy, Node rechazara el TLS. Pasa --insecure para
   desactivar la verificacion SOLO para esta carga puntual.
   ============================================================ */

import fs from "node:fs";
import { reconciliarClientes } from "./lib-mapeo.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const clave = a.slice(2);
      const siguiente = argv[i + 1];
      if (siguiente == null || siguiente.startsWith("--")) {
        args[clave] = true;
      } else {
        args[clave] = siguiente;
        i += 1;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function leerJSON(ruta) {
  if (!ruta || !fs.existsSync(ruta)) return null;
  return JSON.parse(fs.readFileSync(ruta, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = (args["base-url"] || "http://localhost:8080").replace(
    /\/$/,
    ""
  );
  const password = args.password || process.env.APP_PASSWORD || "";
  const dryRun = Boolean(args["dry-run"]);
  const out = args.out;

  if (args.insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  const exportFs = leerJSON(args.firestore);
  const clientesCsv = leerJSON(args.csv);

  const fsClientes = (exportFs && exportFs.clientes) || [];
  const fsMovimientos = (exportFs && exportFs.movimientos) || [];
  const fsConfig = exportFs ? exportFs.config || null : null;
  const fsTheme = (exportFs && exportFs.theme) || "claro";
  const csvClientes = Array.isArray(clientesCsv) ? clientesCsv : [];

  if (!exportFs && !clientesCsv) {
    console.error(
      "[merge-and-seed] No hay fuentes de datos. Pasa --firestore y/o --csv."
    );
    process.exit(1);
  }

  const { clientes, resumen } = reconciliarClientes(csvClientes, fsClientes);

  // Resumen legible.
  console.log("[merge-and-seed] Resumen de reconciliacion:");
  console.log(`  CSV:              ${resumen.totalCsv}`);
  console.log(`  Firestore:        ${resumen.totalFirestore}`);
  console.log(`  Emparejados:      ${resumen.emparejados}`);
  console.log(`  Solo en CSV:      ${resumen.soloCsv}`);
  console.log(`  Solo en Firestore:${resumen.soloFirestore}`);
  console.log(`  Clientes finales: ${clientes.length}`);
  console.log(`  Movimientos (FS): ${fsMovimientos.length}`);
  if (resumen.conflictos.length) {
    console.log(`  Conflictos (gano CSV): ${resumen.conflictos.length}`);
    for (const c of resumen.conflictos) {
      console.log(
        `    - ${c.nombre} [${c.campo}] firestore="${c.firestore}" csv="${c.csv}"`
      );
    }
  }

  if (out) {
    const dataset = {
      clientes,
      movimientos: fsMovimientos,
      config: fsConfig,
      theme: fsTheme
    };
    fs.writeFileSync(out, JSON.stringify(dataset, null, 2) + "\n", "utf8");
    console.log(`[merge-and-seed] Dataset final escrito en ${out}`);
  }

  if (dryRun) {
    console.log("[merge-and-seed] --dry-run: no se envio nada al backend.");
    return;
  }

  if (!password) {
    console.error(
      "[merge-and-seed] Falta la contrasena. Usa --password o APP_PASSWORD."
    );
    process.exit(1);
  }

  // 1) Login para obtener la cookie de sesion.
  console.log(`[merge-and-seed] Login en ${baseUrl}/api/login ...`);
  const loginRes = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  if (!loginRes.ok) {
    console.error(
      `[merge-and-seed] Login fallo (${loginRes.status}). ` +
        "Revisa la contrasena."
    );
    process.exit(1);
  }
  const cookie = extraerCookie(loginRes);
  if (!cookie) {
    console.error("[merge-and-seed] El login no devolvio cookie de sesion.");
    process.exit(1);
  }

  const headers = {
    "Content-Type": "application/json",
    Cookie: cookie
  };

  // 2) Cargar cada dominio (replace-whole-collection, igual que el frontend).
  await put(baseUrl, "/api/clientes", clientes, headers);
  console.log(`[merge-and-seed] PUT /api/clientes (${clientes.length})`);

  await put(baseUrl, "/api/movimientos", fsMovimientos, headers);
  console.log(`[merge-and-seed] PUT /api/movimientos (${fsMovimientos.length})`);

  if (fsConfig && typeof fsConfig === "object") {
    await put(baseUrl, "/api/config", fsConfig, headers);
    console.log("[merge-and-seed] PUT /api/config");
  }

  await put(baseUrl, "/api/theme", { valor: fsTheme }, headers);
  console.log(`[merge-and-seed] PUT /api/theme (${fsTheme})`);

  console.log("[merge-and-seed] Carga completada.");
}

function extraerCookie(res) {
  // Node fetch: getSetCookie() devuelve el arreglo de Set-Cookie.
  let setCookies = [];
  if (typeof res.headers.getSetCookie === "function") {
    setCookies = res.headers.getSetCookie();
  } else {
    const sc = res.headers.get("set-cookie");
    if (sc) setCookies = [sc];
  }
  // Nos quedamos con el par nombre=valor (antes del primer ';').
  return setCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function put(baseUrl, ruta, cuerpo, headers) {
  const res = await fetch(`${baseUrl}${ruta}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(cuerpo)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`PUT ${ruta} fallo (${res.status}): ${txt}`);
  }
  return res;
}

main().catch((e) => {
  console.error("[merge-and-seed] Error:", e && e.message ? e.message : e);
  process.exit(1);
});

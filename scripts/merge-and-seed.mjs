/* ============================================================
   scripts/merge-and-seed.mjs
   ------------------------------------------------------------
   Carga desde cero del CSV: toma los clientes ya mapeados por
   import-csv.mjs (clientes-from-csv.json) y los carga en el backend
   autohospedado via su API REST (login + PUT), o los escribe a disco en
   modo --dry-run para revisarlos antes.

   Firestore quedo ABANDONADO: ya no hay reconciliacion ni export.json.
   El dataset se arma desde cero:
     - clientes:    los del CSV, tal cual (valores literales, sin limpiar).
     - movimientos: arreglo vacio (el historial arranca limpio).
     - config:      minima, con nombreNegocio 'OCTARED'; el resto de las
                    claves las completa el backend/app con sus defaults.
     - theme:       'claro'.

   Solo usa modulos integrados de Node (fetch nativo en Node 18+/22).

   Uso tipico (desde el directorio del repo, con el backend corriendo):
     node scripts/merge-and-seed.mjs \
       --csv clientes-from-csv.json \
       --base-url https://64.177.92.121 \
       --password "TU_APP_PASSWORD" \
       --insecure

   Opciones:
     --csv <ruta>         clientes-from-csv.json (por defecto ese nombre)
     --base-url <url>     URL del backend (por defecto http://localhost:8080)
     --password <pass>    APP_PASSWORD (o variable de entorno APP_PASSWORD)
     --out <ruta>         escribe el dataset final a un archivo (siempre util)
     --dry-run            NO envia nada al backend: solo arma el dataset,
                          imprime el resumen y (si --out) escribe el JSON
     --insecure           acepta el certificado autofirmado (HTTPS por IP)

   NOTA sobre el certificado autofirmado: al apuntar a https://<IP> con
   el cert interno de Caddy, Node rechazara el TLS. Pasa --insecure para
   desactivar la verificacion SOLO para esta carga puntual.
   ============================================================ */

import fs from "node:fs";

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
  const rutaCsv = args.csv || "clientes-from-csv.json";

  if (args.insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  const clientesCsv = leerJSON(rutaCsv);
  if (!Array.isArray(clientesCsv)) {
    console.error(
      `[merge-and-seed] No pude leer un arreglo de clientes desde ${rutaCsv}.` +
        " Corre primero import-csv.mjs."
    );
    process.exit(1);
  }

  // Dataset desde cero: clientes del CSV, historial vacio y config minima.
  const clientes = clientesCsv;
  const movimientos = [];
  const config = { nombreNegocio: "OCTARED" };
  const theme = "claro";

  // Resumen legible (solo cuenta de clientes; sin Firestore/reconcile).
  console.log("[merge-and-seed] Carga desde cero del CSV:");
  console.log(`  Clientes:    ${clientes.length}`);
  console.log(`  Movimientos: ${movimientos.length} (arranca vacio)`);
  console.log(`  Negocio:     ${config.nombreNegocio}`);
  console.log(`  Theme:       ${theme}`);

  if (out) {
    const dataset = { clientes, movimientos, config, theme };
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

  await put(baseUrl, "/api/movimientos", movimientos, headers);
  console.log(`[merge-and-seed] PUT /api/movimientos (${movimientos.length})`);

  await put(baseUrl, "/api/config", config, headers);
  console.log("[merge-and-seed] PUT /api/config");

  await put(baseUrl, "/api/theme", { valor: theme }, headers);
  console.log(`[merge-and-seed] PUT /api/theme (${theme})`);

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

/* ============================================================
   scripts/import-csv.mjs  (FEAT-005)
   ------------------------------------------------------------
   Lee el CSV de clientes del usuario y produce clientes-from-csv.json
   con un arreglo de objetos cliente (esquema extendido de app.js).

   Solo usa modulos integrados de Node (sin dependencias). El parseo de
   CSV y todo el mapeo vive en scripts/lib-mapeo.mjs (probado con node:test).

   Cabeceras esperadas (exactas, primera fila del CSV):
     Nombre, Telefono, Direccion, Plan, Mensualidad, Proximo Pago, Estado,
     Tipo Internet, IP Cliente, IP Principal, SSID, Pass WiFi, Pass Modem

   Uso:
     node scripts/import-csv.mjs <ruta-al-csv> [salida.json]
   Por defecto la salida es clientes-from-csv.json en el directorio actual.
   ============================================================ */

import fs from "node:fs";
import {
  parsearCSV,
  filaCsvACliente,
  COLUMNAS_CSV
} from "./lib-mapeo.mjs";

function main() {
  const entrada = process.argv[2];
  const salida = process.argv[3] || "clientes-from-csv.json";

  if (!entrada) {
    console.error(
      "Uso: node scripts/import-csv.mjs <ruta-al-csv> [salida.json]"
    );
    process.exit(1);
  }
  if (!fs.existsSync(entrada)) {
    console.error(`[import-csv] No existe el archivo: ${entrada}`);
    process.exit(1);
  }

  const texto = fs.readFileSync(entrada, "utf8");
  const filas = parsearCSV(texto);
  if (filas.length === 0) {
    console.error("[import-csv] El CSV no tiene filas de datos.");
    process.exit(1);
  }

  // Avisar si faltan columnas esperadas (no aborta: mapea lo que haya).
  const cabeceras = Object.keys(filas[0]);
  const faltantes = COLUMNAS_CSV.filter((c) => !cabeceras.includes(c));
  if (faltantes.length) {
    console.warn(
      "[import-csv] AVISO: faltan columnas esperadas: " +
        faltantes.join(", ") +
        "\n  (esos campos quedaran vacios en los clientes resultantes)"
    );
  }

  const clientes = filas.map(filaCsvACliente);
  fs.writeFileSync(salida, JSON.stringify(clientes, null, 2) + "\n", "utf8");

  const conSsid = clientes.filter((c) => c.ssid).length;
  const conPassWifi = clientes.filter((c) => c.passWifi).length;
  console.log(`[import-csv] Filas leidas: ${clientes.length}`);
  console.log(`[import-csv] Con SSID: ${conSsid} | con Pass WiFi: ${conPassWifi}`);
  console.log(`[import-csv] Escrito ${salida}`);
}

main();

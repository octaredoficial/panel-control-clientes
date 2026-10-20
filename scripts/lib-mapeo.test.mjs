/* ============================================================
   scripts/lib-mapeo.test.mjs  (FEAT-005)
   ------------------------------------------------------------
   Pruebas de la logica PURA de migracion (node:test, sin dependencias
   ni archivos/red reales). Cubre:
     - parsearCSV con campos entre comillas y comas internas
     - filaCsvACliente: mapeo de las 13 columnas, fecha dd/mm/aaaa,
       Estado, Tipo Internet, y preservacion de SSID/passWifi/passModem/
       ipPrincipal
     - reconciliarClientes: conserva clientes de una sola fuente y
       aplica la preferencia documentada por campo en conflicto

   Correr:  node --test   (desde scripts/ o con la ruta al archivo)
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parsearCSV,
  filaCsvACliente,
  normalizarTipoInternet,
  parsearEstado,
  parsearFechaISO,
  reconciliarClientes
} from "./lib-mapeo.mjs";

test("parsearCSV maneja comillas, comas internas y comillas escapadas", () => {
  const texto =
    'Nombre,Direccion,Pass WiFi\r\n' +
    '"Juan, Perez","Calle 1, #2","clave ""fuerte"""\n' +
    "Ana,Calle 3,abc123\n";
  const filas = parsearCSV(texto);
  assert.equal(filas.length, 2);
  assert.equal(filas[0]["Nombre"], "Juan, Perez");
  assert.equal(filas[0]["Direccion"], "Calle 1, #2");
  assert.equal(filas[0]["Pass WiFi"], 'clave "fuerte"');
  assert.equal(filas[1]["Nombre"], "Ana");
  assert.equal(filas[1]["Pass WiFi"], "abc123");
});

test("parsearFechaISO interpreta dd/mm/aaaa, iso y anio de 2 digitos", () => {
  assert.equal(parsearFechaISO("05/03/2024"), "2024-03-05");
  assert.equal(parsearFechaISO("5-3-2024"), "2024-03-05");
  assert.equal(parsearFechaISO("2024-03-05"), "2024-03-05");
  assert.equal(parsearFechaISO("05/03/24"), "2024-03-05");
  assert.equal(parsearFechaISO(""), "");
  assert.equal(parsearFechaISO("no es fecha"), "");
  assert.equal(parsearFechaISO("32/13/2024"), "");
});

test("normalizarTipoInternet mapea a AP/PtP/Modem o '' si desconocido", () => {
  assert.equal(normalizarTipoInternet("PtP"), "PtP");
  assert.equal(normalizarTipoInternet("Enlace dedicado"), "PtP");
  assert.equal(normalizarTipoInternet("Modem por cable"), "Modem");
  assert.equal(normalizarTipoInternet("Fibra"), "Modem");
  assert.equal(normalizarTipoInternet("AP"), "AP");
  assert.equal(normalizarTipoInternet("Antena inalambrica"), "AP");
  assert.equal(normalizarTipoInternet("otra cosa"), "");
  assert.equal(normalizarTipoInternet(""), "");
});

test("parsearEstado reconoce pausados y por defecto Activo", () => {
  assert.equal(parsearEstado("Activo"), "Activo");
  assert.equal(parsearEstado(""), "Activo");
  assert.equal(parsearEstado("Pausado"), "Pausado");
  assert.equal(parsearEstado("suspendido"), "Pausado");
  assert.equal(parsearEstado("moroso"), "Pausado");
});

test("filaCsvACliente mapea las 13 columnas y preserva campos ricos", () => {
  const fila = {
    Nombre: "Lupita casa 7",
    Telefono: "5551234567",
    Direccion: "Calle Flores 7",
    Plan: "10 MB",
    Mensualidad: "$450",
    "Proximo Pago": "15/04/2024",
    Estado: "Activo",
    "Tipo Internet": "PtP",
    "IP Cliente": "192.168.10.50",
    "IP Principal": "192.168.10.1",
    SSID: "LupitaWiFi",
    "Pass WiFi": "wifi-secreta",
    "Pass Modem": "modem-secreta"
  };
  const c = filaCsvACliente(fila);
  assert.equal(c.nombre, "Lupita casa 7");
  assert.equal(c.celular, "5551234567");
  assert.equal(c.direccion, "Calle Flores 7");
  assert.equal(c.megas, "10 MB");
  assert.equal(c.monto, 450); // "$450" -> number
  assert.equal(c.fechaProximoPago, "2024-04-15"); // dd/mm/aaaa -> ISO
  assert.equal(c.estatus, "Activo");
  assert.equal(c.tipoConexion, "PtP");
  assert.equal(c.ip, "192.168.10.50");
  assert.equal(c.ipPrincipal, "192.168.10.1");
  assert.equal(c.ssid, "LupitaWiFi");
  assert.equal(c.passWifi, "wifi-secreta");
  assert.equal(c.passModem, "modem-secreta");
  assert.ok(typeof c.id === "string" && c.id.startsWith("c_"));
});

test("filaCsvACliente: Mensualidad vacia -> 0 y Estado vacio -> Activo", () => {
  const c = filaCsvACliente({ Nombre: "Sin monto", Mensualidad: "" });
  assert.equal(c.monto, 0);
  assert.equal(c.estatus, "Activo");
  assert.equal(c.ssid, "");
});

test("reconciliarClientes conserva clientes de una sola fuente", () => {
  const csv = [filaCsvACliente({ Nombre: "Solo CSV", "IP Cliente": "10.0.0.9" })];
  const fs = [
    { id: "fs1", nombre: "Solo Firestore", ip: "10.0.0.1", monto: 300 }
  ];
  const { clientes, resumen } = reconciliarClientes(csv, fs);
  assert.equal(clientes.length, 2);
  assert.equal(resumen.soloCsv, 1);
  assert.equal(resumen.soloFirestore, 1);
  assert.equal(resumen.emparejados, 0);
  const nombres = clientes.map((c) => c.nombre).sort();
  assert.deepEqual(nombres, ["Solo CSV", "Solo Firestore"]);
});

test("reconciliarClientes empareja por IP y prefiere CSV en campos ricos", () => {
  const csv = [
    filaCsvACliente({
      Nombre: "Cliente A",
      "IP Cliente": "192.168.10.20",
      SSID: "NuevoSSID",
      "Pass WiFi": "nueva",
      Plan: "20 MB",
      Mensualidad: "500"
    })
  ];
  const fs = [
    {
      id: "fsA",
      nombre: "Cliente A",
      ip: "192.168.10.20",
      ssid: "ViejoSSID",
      passWifi: "vieja",
      megas: "5 MB",
      monto: 400,
      fechaProximoPago: "2024-05-01",
      ultimoPago: "2024-04-01",
      diaPago: 1
    }
  ];
  const { clientes, resumen } = reconciliarClientes(csv, fs);
  assert.equal(clientes.length, 1);
  assert.equal(resumen.emparejados, 1);
  const out = clientes[0];
  // id de Firestore se conserva (no romper referencias de movimientos).
  assert.equal(out.id, "fsA");
  // Campos ricos: gana CSV.
  assert.equal(out.ssid, "NuevoSSID");
  assert.equal(out.passWifi, "nueva");
  assert.equal(out.megas, "20 MB");
  assert.equal(out.monto, 500);
  // Campos de historial: gana Firestore.
  assert.equal(out.fechaProximoPago, "2024-05-01");
  assert.equal(out.ultimoPago, "2024-04-01");
  assert.equal(out.diaPago, 1);
  // Se registra el conflicto de los campos ricos.
  assert.ok(resumen.conflictos.length >= 1);
});

test("reconciliarClientes empareja por nombre cuando no hay IP", () => {
  const csv = [
    filaCsvACliente({ Nombre: "María  López", SSID: "casaML" })
  ];
  const fs = [{ id: "fsML", nombre: "Maria Lopez", monto: 350 }];
  const { clientes, resumen } = reconciliarClientes(csv, fs);
  assert.equal(clientes.length, 1);
  assert.equal(resumen.emparejados, 1);
  assert.equal(clientes[0].id, "fsML");
  assert.equal(clientes[0].ssid, "casaML");
  // monto de Firestore se conserva (CSV no trajo monto > 0).
  assert.equal(clientes[0].monto, 350);
});

test("reconciliarClientes: CSV vacio conserva solo los de Firestore", () => {
  const fs = [{ id: "fs1", nombre: "Uno", ip: "1.1.1.1" }];
  const { clientes, resumen } = reconciliarClientes([], fs);
  assert.equal(clientes.length, 1);
  assert.equal(resumen.soloFirestore, 1);
});

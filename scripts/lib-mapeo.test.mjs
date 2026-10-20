/* ============================================================
   scripts/lib-mapeo.test.mjs
   ------------------------------------------------------------
   Pruebas de la logica PURA de migracion (node:test, sin dependencias
   ni archivos/red reales). Cubre:
     - parsearCSV con campos entre comillas y comas internas
     - filaCsvACliente: mapeo de las 13 columnas, fecha dd/mm/aaaa,
       Estado, Tipo Internet, y preservacion de SSID/passWifi/passModem/
       ipPrincipal
     - carga LITERAL: IPs sucias se conservan verbatim (sin limpieza)
     - el cliente mapeado NO lleva socio ni tipoPago (campos eliminados)

   Correr:  node --test   (desde scripts/ o con la ruta al archivo)
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parsearCSV,
  filaCsvACliente,
  normalizarTipoInternet,
  parsearEstado,
  parsearFechaISO
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

test("filaCsvACliente carga IPs sucias LITERALMENTE (sin limpieza)", () => {
  // Carga desde cero: los valores del CSV se toman verbatim; solo se
  // recorta el espacio EXTERIOR via toma(), nunca el texto interno.
  const fila = {
    Nombre: "Cliente sucio",
    "IP Cliente": "  192.168.6.87    STEREN:8888  ",
    "IP Principal": "192.168.6.24 - modem 192.168.6.90",
    SSID: "  Red  con  espacios  ",
    "Pass WiFi": "clave - con guion"
  };
  const c = filaCsvACliente(fila);
  // Solo se recorta el espacio exterior; el texto interno queda intacto.
  assert.equal(c.ip, "192.168.6.87    STEREN:8888");
  assert.equal(c.ipPrincipal, "192.168.6.24 - modem 192.168.6.90");
  assert.equal(c.ssid, "Red  con  espacios");
  assert.equal(c.passWifi, "clave - con guion");
});

test("filaCsvACliente NO incluye las claves socio ni tipoPago", () => {
  const c = filaCsvACliente({ Nombre: "Cualquiera", "IP Cliente": "10.0.0.1" });
  assert.ok(!("socio" in c), "el cliente no debe tener la clave socio");
  assert.ok(!("tipoPago" in c), "el cliente no debe tener la clave tipoPago");
});

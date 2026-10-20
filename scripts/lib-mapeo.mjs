/* ============================================================
   scripts/lib-mapeo.mjs  (FEAT-005)
   ------------------------------------------------------------
   Logica PURA y reutilizable de la migracion de datos, sin efectos
   secundarios (no lee archivos, no hace red): asi se puede probar con
   node:test usando fixtures en linea.

   Carga desde cero del CSV (sin Firestore): los valores del CSV se
   toman LITERALMENTE, sin limpieza de datos. Campos sucios como una IP
   con texto extra ('192.168.6.87    STEREN:8888') se conservan verbatim
   (solo se recorta el espacio exterior via toma()); el operador los
   corrige despues en la app.

   Contiene:
     - parsearCSV(texto)            -> filas [{header: valor}] (CSV RFC-4180ish)
     - normalizarTipoInternet(v)    -> 'AP' | 'PtP' | 'Modem' | ''
     - parsearEstado(v)             -> 'Activo' | 'Pausado'
     - parsearFechaISO(v)           -> 'YYYY-MM-DD' | ''
     - filaCsvACliente(fila)        -> objeto cliente extendido
     - generarIdCliente()           -> id estable estilo crearCliente

   El mapeo refleja el esquema de cliente de app.js crearCliente:
     id, nombre, celular, direccion, ip, tipoConexion, apId, ssid,
     passWifi, passModem, ipPrincipal, megas, monto, fechaInstalacion,
     diaPago, estatus, fechaProximoPago, ultimoPago.
   ============================================================ */

/* ----------------------------------------------------------
   Parser de CSV (solo Node built-ins; maneja campos entre
   comillas, comas internas y comillas escapadas "").
   Devuelve un arreglo de objetos usando la primera fila como
   cabecera. Tolera \r\n y \n. Ignora lineas vacias finales.
   ---------------------------------------------------------- */
export function parsearCSV(texto) {
  if (typeof texto !== "string") return [];
  // Quitar BOM si existe.
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);

  const filas = [];
  let campo = "";
  let fila = [];
  let enComillas = false;
  let i = 0;
  const n = texto.length;

  function finCampo() {
    fila.push(campo);
    campo = "";
  }
  function finFila() {
    finCampo();
    // No agregar filas totalmente vacias (p. ej. salto final).
    const vacia = fila.length === 1 && fila[0] === "";
    if (!vacia) filas.push(fila);
    fila = [];
  }

  while (i < n) {
    const ch = texto[i];
    if (enComillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        enComillas = false;
        i += 1;
        continue;
      }
      campo += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      enComillas = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      finCampo();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // Consumir \r\n como un solo salto.
      if (texto[i + 1] === "\n") i += 1;
      finFila();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      finFila();
      i += 1;
      continue;
    }
    campo += ch;
    i += 1;
  }
  // Ultimo campo/fila sin salto final.
  if (campo !== "" || fila.length > 0) finFila();

  if (filas.length === 0) return [];
  const cabecera = filas[0].map((h) => h.trim());
  const registros = [];
  for (let f = 1; f < filas.length; f++) {
    const valores = filas[f];
    const obj = {};
    for (let c = 0; c < cabecera.length; c++) {
      obj[cabecera[c]] = valores[c] != null ? valores[c] : "";
    }
    registros.push(obj);
  }
  return registros;
}

/* ----------------------------------------------------------
   Cabeceras EXACTAS que se esperan del CSV del usuario.
   (Documentadas en MIGRATION.md.)
   ---------------------------------------------------------- */
export const COLUMNAS_CSV = [
  "Nombre",
  "Telefono",
  "Direccion",
  "Plan",
  "Mensualidad",
  "Proximo Pago",
  "Estado",
  "Tipo Internet",
  "IP Cliente",
  "IP Principal",
  "SSID",
  "Pass WiFi",
  "Pass Modem"
];

/**
 * Mapea el texto de "Tipo Internet" del CSV al tipoConexion del modelo.
 * Reglas (sin coincidencia -> '' = "falta identificar"):
 *   - contiene "ptp" / "punto a punto" / "enlace"   -> 'PtP'
 *   - contiene "modem" / "cable" / "directo" / "fibra" -> 'Modem'
 *   - contiene "ap" / "ptmp" / "antena" / "inalambr" / "wifi" -> 'AP'
 */
export function normalizarTipoInternet(valor) {
  const v = String(valor || "")
    .toLowerCase()
    .trim();
  if (!v) return "";
  if (/ptp|punto a punto|punto-a-punto|enlace/.test(v)) return "PtP";
  if (/modem|m[óo]dem|cable|directo|fibra/.test(v)) return "Modem";
  if (/\bap\b|ptmp|antena|inal[áa]mbr|wifi|wi-fi|aire/.test(v)) return "AP";
  return "";
}

/**
 * Mapea "Estado" del CSV a estatus ('Activo' | 'Pausado').
 * Cualquier variante de pausa/suspension/corte/baja -> 'Pausado';
 * el resto (incluyendo vacio) -> 'Activo' (por defecto del modelo).
 */
export function parsearEstado(valor) {
  const v = String(valor || "")
    .toLowerCase()
    .trim();
  if (/pausad|suspend|inactiv|cortad|baja|desactiv|moroso/.test(v)) {
    return "Pausado";
  }
  return "Activo";
}

/**
 * Convierte una fecha del CSV a 'YYYY-MM-DD'. Acepta:
 *   - dd/mm/aaaa o dd-mm-aaaa (formato tipico en MX)
 *   - aaaa-mm-dd (ISO)
 *   - dd/mm/aa (dos digitos de anio -> 20aa)
 * Devuelve '' si no se puede interpretar.
 */
export function parsearFechaISO(valor) {
  const s = String(valor || "").trim();
  if (!s) return "";

  // ISO ya formado: aaaa-mm-dd
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    return armarISO(m[1], m[2], m[3]);
  }
  // dd/mm/aaaa o dd-mm-aaaa (o con anio de 2 digitos)
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s);
  if (m) {
    let anio = m[3];
    if (anio.length === 2) anio = "20" + anio;
    return armarISO(anio, m[2], m[1]);
  }
  return "";
}

function armarISO(anio, mes, dia) {
  const a = Number(anio);
  const mm = Number(mes);
  const dd = Number(dia);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(dd) ||
    mm < 1 ||
    mm > 12 ||
    dd < 1 ||
    dd > 31
  ) {
    return "";
  }
  const pad = (x) => String(x).padStart(2, "0");
  return a + "-" + pad(mm) + "-" + pad(dd);
}

let _contadorId = 0;
/**
 * Genera un id estable estilo crearCliente de app.js
 * ("c_" + base36(tiempo) + "_" + contador + aleatorio). No depende del
 * navegador; sirve para sembrar clientes nuevos venidos del CSV.
 */
export function generarIdCliente() {
  _contadorId += 1;
  return (
    "c_" +
    Date.now().toString(36) +
    "_" +
    _contadorId.toString(36) +
    Math.floor(Math.random() * 1e6).toString(36)
  );
}

/**
 * Convierte una fila del CSV (objeto con las cabeceras de COLUMNAS_CSV)
 * en un objeto cliente extendido. Carga desde cero: los valores se toman
 * LITERALMENTE (solo se recorta el espacio exterior via toma()), sin
 * limpiar datos sucios (IP/SSID con texto extra se conservan verbatim).
 * NO calcula fechaProximoPago derivada: conserva la del CSV si viene y
 * deja que el operador rellene lo que falte en la app.
 *
 * Mapeo de columnas (las 13):
 *   Nombre        -> nombre
 *   Telefono      -> celular
 *   Direccion     -> direccion
 *   Plan          -> megas
 *   Mensualidad   -> monto (number)
 *   Proximo Pago  -> fechaProximoPago (ISO)
 *   Estado        -> estatus ('Activo'|'Pausado')
 *   Tipo Internet -> tipoConexion ('AP'|'PtP'|'Modem'|'')
 *   IP Cliente    -> ip
 *   IP Principal  -> ipPrincipal
 *   SSID          -> ssid
 *   Pass WiFi     -> passWifi
 *   Pass Modem    -> passModem
 */
export function filaCsvACliente(fila) {
  fila = fila || {};
  const toma = (k) => String(fila[k] != null ? fila[k] : "").trim();

  // Mensualidad vacia -> monto 0 (DECISION DELIBERADA, no bug). En la
  // MIGRACION de datos reales no inventamos una cuota: si el CSV no trae
  // Mensualidad, el cliente queda en 0 y el operador lo corrige en la ficha.
  // Esto difiere a proposito de app.js crearCliente, que usa MONTO_DEFAULT
  // (500) para clientes NUEVOS creados a mano en la UI (ahi 500 es un valor
  // de arranque razonable; aqui seria inventar ingresos). merge-and-seed
  // registra montos 0 para que se revisen.
  const montoRaw = toma("Mensualidad").replace(/[$,\s]/g, "");
  const montoNum = montoRaw === "" ? 0 : Number(montoRaw);

  return {
    id: generarIdCliente(),
    nombre: toma("Nombre"),
    celular: toma("Telefono"),
    direccion: toma("Direccion"),
    ip: toma("IP Cliente"),
    tipoConexion: normalizarTipoInternet(toma("Tipo Internet")),
    apId: "",
    ssid: toma("SSID"),
    passWifi: toma("Pass WiFi"),
    passModem: toma("Pass Modem"),
    ipPrincipal: toma("IP Principal"),
    megas: toma("Plan"),
    monto: Number.isFinite(montoNum) ? montoNum : 0,
    fechaInstalacion: "",
    diaPago: null,
    estatus: parsearEstado(toma("Estado")),
    fechaProximoPago: parsearFechaISO(toma("Proximo Pago")),
    ultimoPago: ""
  };
}

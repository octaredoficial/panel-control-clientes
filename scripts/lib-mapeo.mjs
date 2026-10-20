/* ============================================================
   scripts/lib-mapeo.mjs  (FEAT-005)
   ------------------------------------------------------------
   Logica PURA y reutilizable de la migracion de datos, sin efectos
   secundarios (no lee archivos, no hace red): asi se puede probar con
   node:test usando fixtures en linea.

   Contiene:
     - parsearCSV(texto)            -> filas [{header: valor}] (CSV RFC-4180ish)
     - normalizarTipoInternet(v)    -> 'AP' | 'PtP' | 'Modem' | ''
     - parsearEstado(v)             -> 'Activo' | 'Pausado'
     - parsearFechaISO(v)           -> 'YYYY-MM-DD' | ''
     - filaCsvACliente(fila)        -> objeto cliente extendido
     - generarIdCliente()           -> id estable estilo crearCliente
     - normalizarNombre(v)          -> clave de cotejo
     - reconciliarClientes(csv, fs) -> {clientes, resumen}

   El mapeo refleja el esquema de cliente de app.js crearCliente:
     id, nombre, celular, direccion, ip, tipoConexion, apId, ssid,
     passWifi, passModem, ipPrincipal, megas, monto, fechaInstalacion,
     diaPago, tipoPago, estatus, socio, fechaProximoPago, ultimoPago.
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
 * Normaliza un nombre para cotejo laxo: minusculas, sin acentos, sin
 * espacios repetidos.
 */
export function normalizarNombre(valor) {
  return String(valor || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convierte una fila del CSV (objeto con las cabeceras de COLUMNAS_CSV)
 * en un objeto cliente extendido. NO calcula fechaProximoPago derivada:
 * conserva la del CSV si viene, y deja que crearCliente (en la app) o la
 * reconciliacion rellene lo que falte.
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
    tipoPago: "PTP",
    estatus: parsearEstado(toma("Estado")),
    socio: "Carlos",
    fechaProximoPago: parsearFechaISO(toma("Proximo Pago")),
    ultimoPago: ""
  };
}

/* ----------------------------------------------------------
   Reconciliacion CSV <-> Firestore.

   Regla de cotejo (documentada): se emparejan clientes por
   "IP Cliente" (campo `ip`) si ambos la tienen; si no, por nombre
   normalizado. Para cada par:
     - Campos mas ricos (ssid, passWifi, passModem, ipPrincipal, megas,
       monto, direccion, celular, tipoConexion) -> se PREFIERE el CSV
       cuando trae valor; si el CSV lo deja vacio, se conserva el de
       Firestore.
     - Campos derivados del historial de pagos (fechaProximoPago,
       ultimoPago, diaPago, apId, socio) -> se PREFIERE Firestore cuando
       trae valor; si no, el del CSV.
     - El `id` se toma de Firestore si existe el par (para no romper
       referencias de movimientos); si el cliente solo esta en el CSV, se
       usa el id generado por el CSV.
   Nunca se descarta un cliente presente en una sola fuente.
   ---------------------------------------------------------- */
export function reconciliarClientes(clientesCsv, clientesFirestore) {
  const csv = Array.isArray(clientesCsv) ? clientesCsv : [];
  const fs = Array.isArray(clientesFirestore) ? clientesFirestore : [];

  const resumen = {
    totalCsv: csv.length,
    totalFirestore: fs.length,
    emparejados: 0,
    soloCsv: 0,
    soloFirestore: 0,
    conflictos: []
  };

  // Indices de Firestore por ip y por nombre normalizado.
  const porIp = new Map();
  const porNombre = new Map();
  for (const c of fs) {
    const ip = String(c.ip || "").trim();
    if (ip) porIp.set(ip, c);
    const nom = normalizarNombre(c.nombre);
    if (nom) porNombre.set(nom, c);
  }

  const fsUsados = new Set();
  const resultado = [];

  for (const cliente of csv) {
    const ip = String(cliente.ip || "").trim();
    let par = null;
    if (ip && porIp.has(ip)) {
      par = porIp.get(ip);
    } else {
      const nom = normalizarNombre(cliente.nombre);
      if (nom && porNombre.has(nom)) par = porNombre.get(nom);
    }

    if (par) {
      fsUsados.add(par);
      resumen.emparejados += 1;
      resultado.push(fusionarCliente(cliente, par, resumen));
    } else {
      resumen.soloCsv += 1;
      resultado.push({ ...cliente });
    }
  }

  // Clientes que solo existen en Firestore (nunca se descartan).
  for (const c of fs) {
    if (!fsUsados.has(c)) {
      resumen.soloFirestore += 1;
      resultado.push({ ...c });
    }
  }

  return { clientes: resultado, resumen };
}

// Campos donde gana el CSV si trae valor.
const CAMPOS_PREF_CSV = [
  "ssid",
  "passWifi",
  "passModem",
  "ipPrincipal",
  "megas",
  "direccion",
  "celular",
  "tipoConexion"
];
// Campos donde gana Firestore si trae valor.
const CAMPOS_PREF_FS = [
  "fechaProximoPago",
  "ultimoPago",
  "diaPago",
  "apId",
  "socio",
  "fechaInstalacion",
  "tipoPago"
];

function tieneValor(v) {
  return v != null && v !== "";
}

function fusionarCliente(csv, fs, resumen) {
  // Base: todo lo de Firestore (conserva id y lo que la app ya calculo).
  const out = { ...fs };

  for (const campo of CAMPOS_PREF_CSV) {
    const vCsv = csv[campo];
    if (tieneValor(vCsv)) {
      if (tieneValor(out[campo]) && String(out[campo]) !== String(vCsv)) {
        resumen.conflictos.push({
          id: out.id,
          nombre: out.nombre,
          campo,
          firestore: out[campo],
          csv: vCsv,
          elegido: "csv"
        });
      }
      out[campo] = vCsv;
    }
  }

  for (const campo of CAMPOS_PREF_FS) {
    if (!tieneValor(out[campo]) && tieneValor(csv[campo])) {
      out[campo] = csv[campo];
    }
  }

  // monto: preferir CSV si trae un numero > 0; si no, conservar FS.
  const montoCsv = Number(csv.monto);
  if (Number.isFinite(montoCsv) && montoCsv > 0) {
    if (tieneValor(out.monto) && Number(out.monto) !== montoCsv) {
      resumen.conflictos.push({
        id: out.id,
        nombre: out.nombre,
        campo: "monto",
        firestore: out.monto,
        csv: montoCsv,
        elegido: "csv"
      });
    }
    out.monto = montoCsv;
  }

  return out;
}

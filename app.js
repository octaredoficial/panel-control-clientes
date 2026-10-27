/* ============================================================
   Panel de Control de Clientes - Nucleo de datos (FEAT-001)
   ------------------------------------------------------------
   HTML + CSS + JavaScript vanilla. Sin build, sin dependencias,
   sin CDNs. Funciona abriendo index.html directamente (file://).

   Este archivo define EL NUCLEO que consumen las demas features:
     - Claves de localStorage con prefijo 'pcc.'
     - Utilidades de moneda y fecha en espanol (Intl, es-MX)
     - Modelo de Cliente y calculos de negocio (proximo pago,
       dias restantes, estado de pago)
     - Capa de persistencia robusta (try/catch)
     - Dataset SEED de ejemplo (~24 clientes)
     - Inicializacion (siembra el SEED solo en la primera carga)
     - Namespace global window.PCC para que FEAT-002/FEAT-003
       se enganchen.
   ============================================================ */
(function () {
  "use strict";

  /* ----------------------------------------------------------
     1. Claves de localStorage (prefijo 'pcc.')
     ---------------------------------------------------------- */
  var STORAGE_KEYS = {
    clientes: "pcc.clientes",
    movimientos: "pcc.movimientos",
    config: "pcc.config",
    theme: "pcc.theme"
  };

  /* ----------------------------------------------------------
     2. Configuracion por defecto
     ---------------------------------------------------------- */
  var CONFIG_DEFAULT = {
    diasAviso: 3, // dias de antelacion para considerar un pago "proximo"
    moneda: "MXN",
    // Gastos fijos del negocio (reparto de fin de mes entre socios).
    // Starlink: numAntenas * costoAntena = 2 * 1305 = 2610 fijo todos
    // los meses. Luz: costoLuz cada luzPeriodicidadMeses meses, empezando
    // en luzMesAncla (noviembre 2025 es el primer mes que paga luz).
    costoAntena: 1305,
    numAntenas: 2,
    costoLuz: 300,
    luzPeriodicidadMeses: 2,
    luzMesAncla: "2025-11",
    // Datos del negocio para los recibos (valores GENERICOS por defecto;
    // el dueno los personaliza desde Configuracion). Se usan al armar el
    // recibo de un pago: encabezado, pie y datos de contacto.
    //   nombreNegocio:    nombre comercial que aparece en el recibo
    //   telefonoContacto: telefono de contacto del negocio (texto libre)
    //   direccionNegocio: domicilio/referencia del negocio
    //   mensajePie:       linea de agradecimiento al pie del recibo
    nombreNegocio: "Mi WISP",
    telefonoContacto: "",
    direccionNegocio: "",
    mensajePie: "Gracias por su preferencia."
  };

  var MONTO_DEFAULT = 500;
  var THEME_DEFAULT = "claro"; // 'claro' | 'oscuro'

  /* ----------------------------------------------------------
     3. Utilidades de moneda y fecha (espanol, es-MX)
     ---------------------------------------------------------- */

  // Formateador de moneda. Resultado estilo '$500.00' / '$1,250.00'.
  // Usamos estilo 'currency' con MXN y es-MX; el simbolo resultante es '$'.
  var _formatoMonedaIntl = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  /**
   * formatoMoneda(n) -> '$X,XXX.00'
   * @param {number} n cantidad numerica
   * @returns {string}
   */
  function formatoMoneda(n) {
    var valor = Number(n);
    if (!isFinite(valor)) {
      valor = 0;
    }
    // Algunas plataformas anteponen 'MX$'; normalizamos a '$'.
    return _formatoMonedaIntl.format(valor).replace(/^MX\$/, "$");
  }

  var _formatoFechaLargaIntl = new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  /**
   * formatoFechaLarga(date) -> '29 de septiembre de 2026'
   * @param {Date|string|number} date Date, ISO string o timestamp
   * @returns {string}
   */
  function formatoFechaLarga(date) {
    var d = aFecha(date);
    if (!d) {
      return "";
    }
    return _formatoFechaLargaIntl.format(d);
  }

  var _formatoFechaCortaIntl = new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

  /**
   * formatoFechaCorta(date) -> '29/09/2026'
   * @param {Date|string|number} date
   * @returns {string}
   */
  function formatoFechaCorta(date) {
    var d = aFecha(date);
    if (!d) {
      return "";
    }
    return _formatoFechaCortaIntl.format(d);
  }

  /* ----------------------------------------------------------
     4. Helpers de fecha
     ---------------------------------------------------------- */

  /**
   * aFecha: normaliza cualquier entrada a un objeto Date (o null).
   * Acepta Date, timestamp numerico o cadena ISO ('YYYY-MM-DD'
   * o 'YYYY-MM-DDTHH:mm...').
   * @param {Date|string|number} value
   * @returns {Date|null}
   */
  function aFecha(value) {
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === "number") {
      var dn = new Date(value);
      return isNaN(dn.getTime()) ? null : dn;
    }
    if (typeof value === "string" && value.trim() !== "") {
      // Para 'YYYY-MM-DD' construimos fecha local (evita saltos de zona).
      var soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
      if (soloFecha) {
        return new Date(
          Number(soloFecha[1]),
          Number(soloFecha[2]) - 1,
          Number(soloFecha[3])
        );
      }
      var d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  /**
   * fechaISO: serializa una fecha a 'YYYY-MM-DD' (fecha local).
   * @param {Date|string|number} date
   * @returns {string}
   */
  function fechaISO(date) {
    var d = aFecha(date);
    if (!d) {
      return "";
    }
    var mes = String(d.getMonth() + 1).padStart(2, "0");
    var dia = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + mes + "-" + dia;
  }

  /**
   * aMedianoche: devuelve una copia de la fecha fijada a las 00:00:00
   * local, para comparaciones de dias sin ruido de horas.
   * @param {Date|string|number} date
   * @returns {Date|null}
   */
  function aMedianoche(date) {
    var d = aFecha(date);
    if (!d) {
      return null;
    }
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  var MS_POR_DIA = 24 * 60 * 60 * 1000;

  /**
   * diferenciaEnDias: (b - a) en dias enteros, normalizando a medianoche.
   * Positivo si 'b' es posterior a 'a'.
   * @param {Date|string|number} a
   * @param {Date|string|number} b
   * @returns {number}
   */
  function diferenciaEnDias(a, b) {
    var ma = aMedianoche(a);
    var mb = aMedianoche(b);
    if (!ma || !mb) {
      return 0;
    }
    return Math.round((mb.getTime() - ma.getTime()) / MS_POR_DIA);
  }

  /**
   * sumarMeses: suma 'n' meses a una fecha, ajustando el dia al ultimo
   * dia del mes destino si el mes es mas corto (ej. 31 -> 30/28).
   * @param {Date} fecha
   * @param {number} n
   * @returns {Date}
   */
  function sumarMeses(fecha, n) {
    var base = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
    base.setMonth(base.getMonth() + n);
    var ultimoDia = new Date(
      base.getFullYear(),
      base.getMonth() + 1,
      0
    ).getDate();
    var dia = Math.min(fecha.getDate(), ultimoDia);
    return new Date(base.getFullYear(), base.getMonth(), dia);
  }

  /**
   * fechaConDiaDeMes: construye una fecha en el anio/mes dados usando
   * 'diaPago', ajustando al ultimo dia valido del mes.
   */
  function fechaConDiaDeMes(anio, mesIndex, diaPago) {
    var ultimoDia = new Date(anio, mesIndex + 1, 0).getDate();
    var dia = Math.min(diaPago || 1, ultimoDia);
    return new Date(anio, mesIndex, dia);
  }

  /* ----------------------------------------------------------
     5. Modelo de Cliente
     ------------------------------------------------------------
     Un Cliente tiene la forma:
     {
       id:               string   identificador unico
       nombre:           string   nombre o alias del cliente
       celular:          string   telefono (10 digitos MX) para WhatsApp
       direccion:        string   domicilio / referencia
       ip:               string   IP asignada en la red
       megas:            string   plan contratado (ej. '10 MB')
       monto:            number   cuota mensual (default 500)
       fechaInstalacion: string   ISO 'YYYY-MM-DD'
       diaPago:          number   dia del mes en que vence el pago (1-31)
       tipoPago:         string   'PTP' | 'Directo'
       estatus:          string   'Activo' | 'Pausado'
       socio:            string   'Carlos' | 'Octavio' (a quien le paga el
                                  cliente; default 'Carlos'. Solo Octavio
                                  cobra directo algun cliente. Los clientes
                                  v1 sin este campo migran a 'Carlos')
       fechaProximoPago: string   ISO 'YYYY-MM-DD' (vencimiento vigente)
       ultimoPago:       string   ISO 'YYYY-MM-DD' del ultimo pago, o ''
       tipoConexion:     string   'AP' | 'PtP' | 'Modem' | '' (topologia de
                                  red; '' = falta identificar)
       apId:             string   id del AP o enlace padre (ver RED_IDS), o ''
     }
     ---------------------------------------------------------- */

  /* ----------------------------------------------------------
     5.0 Topologia de red (FEAT-002)
     ------------------------------------------------------------
     Identificadores estables de los AP/enlaces de la red. Se usan como
     'apId' en el modelo de Cliente y los reutilizara el mapa (FEAT-003)
     para no duplicar strings. Core: MikroTik hEX S 192.168.10.1
     (RouterOS 7.24.4, red 192.168.10.0/24).
     ---------------------------------------------------------- */
  var RED_IDS = {
    CORE: "CORE_MIKROTIK",           // MikroTik hEX S 192.168.10.1
    AP_OCTARED_3: "AP_OCTARED_3",    // AP PtMP .26, SSID OCTARED3, 5105 MHz
    LITEAP_AC1: "LITEAP_AC1",        // LiteAP AC-1 .20, SSID CALOSWiFi, 5230 MHz
    LITEAP_AC2: "LITEAP_AC2",        // LiteAP AC-2 .21, SSID CARLOSWiFi, 5135 MHz
    PTP_MERCEDES_RH: "PTP_MERCEDES_RH", // Enlace PtP, punta .25 -> Mercedez RH .36
    PTP_CASA_44: "PTP_CASA_44"       // Enlace PtP, punta .15 -> casa 44 .145
  };

  // Tipos de conexion validos para 'tipoConexion'.
  var TIPOS_CONEXION = ["AP", "PtP", "Modem"];

  // Estructura de topologia que consumira el mapa (FEAT-003). Se declara aqui
  // para que SEED y mapa coincidan en ids, IPs y jerarquia (nodo padre).
  var TOPOLOGIA = {
    core: { id: RED_IDS.CORE, nombre: "MikroTik hEX S", ip: "192.168.10.1", tipo: "core" },
    aps: [
      {
        id: RED_IDS.AP_OCTARED_3, nombre: "AP OCTARED3", ip: "192.168.10.26",
        ssid: "OCTARED3", frecuencia: "5105 MHz", tipo: "AP",
        // Antenas FIJAS de infraestructura del AP (nombre + IP). Las que
        // tambien son clientes de cobro reales (Lupita casa 26, Tienda
        // Indomable, NIETO) salen de los clientes de Firebase y se fusionan
        // por IP (ver fusionarAntenas en red-mapa.js) para no duplicar.
        antenas: [
          { nombre: "Lupita casa 26", ip: "192.168.10.111" },
          { nombre: "CASA 30", ip: "192.168.10.100" },
          { nombre: "LB-LINDA_S", ip: "192.168.10.37" },
          { nombre: "NIETO (cámaras, modem .99)", ip: "192.168.10.38" },
          { nombre: "LiteBeam 5AC", ip: "192.168.10.49" },
          { nombre: "Tienda Indomable", ip: "192.168.10.129" }
        ]
      },
      {
        id: RED_IDS.LITEAP_AC1, nombre: "LiteAP AC-1", ip: "192.168.10.20",
        ssid: "CALOSWiFi", frecuencia: "5230 MHz", tipo: "AP",
        antenas: [
          { nombre: "Jessy casa 43", ip: "192.168.10.40" },
          { nombre: "Reyes vecino", ip: "192.168.10.34" },
          { nombre: "Octarednuevaultima", ip: "192.168.10.72" }
        ]
      },
      {
        id: RED_IDS.LITEAP_AC2, nombre: "LiteAP AC-2", ip: "192.168.10.21",
        ssid: "CARLOSWiFi", frecuencia: "5135 MHz", tipo: "AP",
        antenas: [
          { nombre: "Berenice", ip: "192.168.10.31" },
          { nombre: "CASA 54", ip: "192.168.10.134" }
        ]
      }
    ],
    // Puntas de los enlaces PtP dedicados (1 a 1 con su cliente). 'antenas'
    // lista el cliente dedicado esperado como fila fija (se fusiona por IP
    // con el cliente real de Firebase si existe).
    puntas: [
      {
        id: RED_IDS.PTP_MERCEDES_RH, nombre: "PtP Mercedes RH", ip: "192.168.10.25", tipo: "PtP",
        antenas: [{ nombre: "Mercedez RH", ip: "192.168.10.36" }]
      },
      {
        id: RED_IDS.PTP_CASA_44, nombre: "PtP Casa 44", ip: "192.168.10.15", tipo: "PtP",
        antenas: [{ nombre: "casa 44 LIZBETH", ip: "192.168.10.145" }]
      }
    ],
    // Modems directos por cable (acceso http://IP:8090). CADA MODEM ES UN
    // CLIENTE distinto que falta por ligar (no es infraestructura compartida).
    // Estas IPs se muestran en el mapa como "huecos por ligar": el usuario
    // elige a cual de sus clientes pendientes asignarle cada una. En cuanto un
    // cliente queda con tipoConexion 'Modem' + esa IP, su hueco desaparece y
    // el cliente aparece con su nombre en la seccion de modems.
    modems: ["192.168.10.19", "192.168.10.22", "192.168.10.24", "192.168.10.101"],
    // Nodos pendientes por identificar (infraestructura sin cliente asignado).
    pendientes: ["192.168.10.61", "192.168.10.18"]
  };

  /**
   * normalizarTipoConexion: devuelve un tipo de conexion valido o '' si el
   * valor no pertenece al conjunto {AP, PtP, Modem}.
   * @param {*} valor
   * @returns {string}
   */
  function normalizarTipoConexion(valor) {
    return TIPOS_CONEXION.indexOf(valor) !== -1 ? valor : "";
  }

  /**
   * crearCliente: fabrica un objeto Cliente aplicando valores por defecto.
   * @param {Object} datos campos parciales del cliente
   * @returns {Object} cliente normalizado
   */
  function crearCliente(datos) {
    datos = datos || {};
    var diaPago = datos.diaPago;
    if (diaPago == null && datos.fechaInstalacion) {
      var fi = aFecha(datos.fechaInstalacion);
      diaPago = fi ? fi.getDate() : 1;
    }
    var cliente = {
      id: datos.id || generarId(),
      nombre: datos.nombre || "",
      celular: datos.celular ? String(datos.celular) : "",
      direccion: datos.direccion || "",
      ip: datos.ip || "",
      // Topologia de red (FEAT-002): la IP sigue siendo 'ip'. tipoConexion
      // indica como se conecta el cliente (AP PtMP, enlace PtP, modem por
      // cable) y apId el AP/enlace padre (ver RED_IDS). Clientes viejos sin
      // estos campos quedan como '' -> "falta identificar".
      tipoConexion: normalizarTipoConexion(datos.tipoConexion),
      apId: datos.apId ? String(datos.apId) : "",
      megas: datos.megas || "",
      monto: datos.monto != null ? Number(datos.monto) : MONTO_DEFAULT,
      fechaInstalacion: datos.fechaInstalacion
        ? fechaISO(datos.fechaInstalacion)
        : "",
      diaPago: diaPago != null ? Number(diaPago) : 1,
      tipoPago: datos.tipoPago === "Directo" ? "Directo" : "PTP",
      estatus: datos.estatus === "Pausado" ? "Pausado" : "Activo",
      socio: datos.socio === "Octavio" ? "Octavio" : "Carlos",
      fechaProximoPago: datos.fechaProximoPago
        ? fechaISO(datos.fechaProximoPago)
        : "",
      ultimoPago: datos.ultimoPago ? fechaISO(datos.ultimoPago) : ""
    };
    // Si no se definio fechaProximoPago, calcularla a partir de los datos.
    if (!cliente.fechaProximoPago) {
      cliente.fechaProximoPago = fechaISO(calcularProximoPago(cliente));
    }
    return cliente;
  }

  var _idCounter = 0;
  /**
   * generarId: id unico simple (sin dependencias externas).
   * @returns {string}
   */
  function generarId() {
    _idCounter += 1;
    return (
      "c_" +
      Date.now().toString(36) +
      "_" +
      _idCounter.toString(36) +
      Math.floor(Math.random() * 1e6).toString(36)
    );
  }

  /* ----------------------------------------------------------
     6. Calculos de negocio
     ---------------------------------------------------------- */

  /**
   * calcularProximoPago(cliente, hoy): determina la proxima fecha de
   * vencimiento del cliente.
   *
   * Reglas:
   *  - Si hay 'ultimoPago', el proximo vence un mes despues del ultimo
   *    pago (respetando 'diaPago' cuando esta definido).
   *  - Si no hay 'ultimoPago', se parte de 'fechaInstalacion' y se
   *    avanza mes a mes el 'diaPago' hasta llegar al primer vencimiento
   *    que sea hoy o futuro.
   *  - Si no hay datos suficientes, se usa 'diaPago' del mes actual.
   *
   * @param {Object} cliente
   * @param {Date|string|number} [hoy] fecha de referencia (default: ahora)
   * @returns {Date}
   */
  function calcularProximoPago(cliente, hoy) {
    var ref = aMedianoche(hoy || new Date()) || aMedianoche(new Date());
    var diaPago = cliente && cliente.diaPago ? Number(cliente.diaPago) : null;

    // Caso 1: hay ultimo pago -> un mes despues del ultimo pago.
    if (cliente && cliente.ultimoPago) {
      var up = aFecha(cliente.ultimoPago);
      if (up) {
        var siguiente = sumarMeses(up, 1);
        if (diaPago) {
          siguiente = fechaConDiaDeMes(
            siguiente.getFullYear(),
            siguiente.getMonth(),
            diaPago
          );
        }
        return siguiente;
      }
    }

    // Caso 2: partir de la instalacion y avanzar hasta hoy/futuro.
    var inicio = aFecha(cliente && cliente.fechaInstalacion);
    if (inicio) {
      var dp = diaPago || inicio.getDate();
      var cursor = fechaConDiaDeMes(
        inicio.getFullYear(),
        inicio.getMonth(),
        dp
      );
      // Si el primer vencimiento cae antes de la instalacion, avanzar uno.
      if (cursor.getTime() < aMedianoche(inicio).getTime()) {
        cursor = sumarMeses(cursor, 1);
      }
      var guard = 0;
      while (cursor.getTime() < ref.getTime() && guard < 600) {
        cursor = sumarMeses(cursor, 1);
        cursor = fechaConDiaDeMes(
          cursor.getFullYear(),
          cursor.getMonth(),
          dp
        );
        guard += 1;
      }
      return cursor;
    }

    // Caso 3: fallback con diaPago en el mes actual (o futuro inmediato).
    var dpFinal = diaPago || ref.getDate();
    var candidato = fechaConDiaDeMes(
      ref.getFullYear(),
      ref.getMonth(),
      dpFinal
    );
    if (candidato.getTime() < ref.getTime()) {
      candidato = sumarMeses(candidato, 1);
      candidato = fechaConDiaDeMes(
        candidato.getFullYear(),
        candidato.getMonth(),
        dpFinal
      );
    }
    return candidato;
  }

  /**
   * diasRestantes(cliente, hoy): dias hasta el proximo vencimiento.
   * Positivo = faltan dias; 0 = vence hoy; negativo = vencido hace N dias.
   * @param {Object} cliente
   * @param {Date|string|number} [hoy]
   * @returns {number}
   */
  function diasRestantes(cliente, hoy) {
    var ref = hoy || new Date();
    var vence =
      cliente && cliente.fechaProximoPago
        ? aFecha(cliente.fechaProximoPago)
        : calcularProximoPago(cliente, ref);
    if (!vence) {
      return 0;
    }
    return diferenciaEnDias(ref, vence);
  }

  /**
   * estadoPago(cliente, hoy): clasifica el estado de pago del cliente.
   *
   * Devuelve: {
   *   clase: 'vencido' | 'proximo' | 'pagado' | 'ok',
   *   texto: string legible en espanol,
   *   diasVencido: number (>0 solo cuando esta vencido)
   * }
   *
   * - 'pagado': el ultimo pago cubre el ciclo vigente (ultimoPago en el
   *   mismo ciclo que el proximo vencimiento futuro) o faltan muchos dias
   *   y ya hay un pago registrado reciente.
   * - 'vencido': la fecha de vencimiento ya paso.
   * - 'proximo': vence dentro de los proximos 'diasAviso' dias.
   * - 'ok': aun no entra en la ventana de aviso.
   *
   * @param {Object} cliente
   * @param {Date|string|number} [hoy]
   * @returns {{clase:string, texto:string, diasVencido:number}}
   */
  function estadoPago(cliente, hoy) {
    var cfg = cargarConfig();
    var diasAviso = cfg && cfg.diasAviso != null ? Number(cfg.diasAviso) : 3;
    var dias = diasRestantes(cliente, hoy);

    if (dias < 0) {
      var vencidoN = Math.abs(dias);
      return {
        clase: "vencido",
        texto:
          vencidoN === 1
            ? "Vencido hace 1 día"
            : "Vencido hace " + vencidoN + " días",
        diasVencido: vencidoN
      };
    }

    if (dias === 0) {
      return { clase: "proximo", texto: "Vence hoy", diasVencido: 0 };
    }

    if (dias === 1) {
      return { clase: "proximo", texto: "Vence mañana", diasVencido: 0 };
    }

    if (dias <= diasAviso) {
      return {
        clase: "proximo",
        texto: "Vence en " + dias + " días",
        diasVencido: 0
      };
    }

    // Fuera de la ventana de aviso: si hay un pago registrado, 'pagado';
    // de lo contrario 'ok' (al corriente, sin urgencia).
    if (cliente && cliente.ultimoPago) {
      return {
        clase: "pagado",
        texto: "Pagado · vence en " + dias + " días",
        diasVencido: 0
      };
    }

    return {
      clase: "ok",
      texto: "Vence en " + dias + " días",
      diasVencido: 0
    };
  }

  /**
   * textoDiasCobranza(dias, diasAviso): helper PURO que arma el detalle de
   * dias que se muestra en la tarjeta de un cliente que FALTA por pagar el
   * mes en curso. Traduce los dias restantes contra su fecha de vencimiento
   * individual (diaPago del mes) a { clase, texto }, reutilizando las clases
   * de color existentes:
   *
   *   dias < 0            -> { 'vencido', 'Vencido hace N días' }   (rojo)
   *   dias === 0          -> { 'proximo', 'Vence hoy' }             (ambar)
   *   dias === 1          -> { 'proximo', 'Vence mañana' }          (ambar)
   *   1 < dias <= aviso   -> { 'proximo', 'Vence en N días' }       (ambar)
   *   dias > diasAviso    -> { 'ok',      'Faltan N días' }         (neutro)
   *
   * OJO: esto es SOLO presentacion del detalle de dias. NO decide si el
   * cliente esta "atrasado/por pagar" (eso lo hace estaAtrasado, por mes
   * calendario). Un cliente puede faltar por pagar el mes y, segun su dia
   * de pago, mostrar "Faltan 6 días" (aun no llega su dia) o "Vencido hace
   * 3 días" (su dia ya paso).
   *
   * @param {number} dias dias restantes (de diasRestantes); negativo = vencido
   * @param {number} [diasAviso] ventana de aviso (default: config o 3)
   * @returns {{clase:string, texto:string}}
   */
  function textoDiasCobranza(dias, diasAviso) {
    if (diasAviso == null) {
      var cfg = cargarConfig();
      diasAviso = cfg && cfg.diasAviso != null ? Number(cfg.diasAviso) : 3;
    }
    dias = Number(dias) || 0;

    if (dias < 0) {
      var vencidoN = Math.abs(dias);
      return {
        clase: "vencido",
        texto:
          vencidoN === 1
            ? "Vencido hace 1 día"
            : "Vencido hace " + vencidoN + " días"
      };
    }
    if (dias === 0) {
      return { clase: "proximo", texto: "Vence hoy" };
    }
    if (dias === 1) {
      return { clase: "proximo", texto: "Vence mañana" };
    }
    if (dias <= diasAviso) {
      return { clase: "proximo", texto: "Vence en " + dias + " días" };
    }
    return { clase: "ok", texto: "Faltan " + dias + " días" };
  }

  /**
   * compararUrgencia(a, b, hoy): comparador PURO para ordenar clientes de MAS
   * VENCIDO a MENOS. Ordena por diasRestantes ascendente: los mas negativos
   * (mas dias vencidos) primero, luego 0/positivos crecientes. Pensado para
   * el bloque "Faltan por pagar este mes" (panel de pagos y grupo de la lista
   * de clientes). Se usa como argumento de Array.prototype.sort.
   * @param {Object} a
   * @param {Object} b
   * @param {Date|string|number} [hoy]
   * @returns {number}
   */
  function compararUrgencia(a, b, hoy) {
    return diasRestantes(a, hoy) - diasRestantes(b, hoy);
  }

  /* ----------------------------------------------------------
     6.b Reparto de fin de mes entre socios (Carlos / Octavio)
     ------------------------------------------------------------
     El negocio es de dos socios: Carlos y Octavio. Al cierre de mes
     se reparte la ganancia 50/50, pero antes se descuentan los gastos
     fijos compartidos (Starlink + luz) y se aparta el pago directo de
     los clientes marcados socio 'Octavio' (ese dinero Octavio YA lo
     cobro directo, por eso se le descuenta de su parte del reparto).

     Formula (confirmada por el usuario):
       ingresosMes  = pagos cobrados (esPago) con fecha en el mes
       pagosOctavio = de esos pagos, los de clientes socio 'Octavio'
       gastos       = Starlink (2610 fijo) + luz (300 si aplica el mes)
       gananciaRepartir = ingresosMes - gastos - pagosOctavio
       mitad        = gananciaRepartir / 2
       totalCarlos  = mitad
       totalOctavio = mitad - pagosOctavio   (ya los cobro directo)
     ---------------------------------------------------------- */

  /**
   * luzAplicaEnMes(fecha, cfg): true si el mes de 'fecha' paga luz.
   * La luz se paga cada 'luzPeriodicidadMeses' meses empezando en
   * 'luzMesAncla'. Aplica cuando el numero de meses transcurridos desde
   * el ancla es >= 0 y multiplo de la periodicidad.
   * Ej.: ancla '2025-11', periodicidad 2 -> nov-2025 true, dic-2025
   * false, ene-2026 true, feb-2026 false.
   * @param {Date|string|number} fecha
   * @param {Object} [cfg]
   * @returns {boolean}
   */
  function luzAplicaEnMes(fecha, cfg) {
    cfg = cfg || cargarConfig();
    var d = aFecha(fecha);
    if (!d) {
      return false;
    }
    var periodo = Number(cfg.luzPeriodicidadMeses);
    if (!isFinite(periodo) || periodo <= 0) {
      return false;
    }
    var ancla = aFecha(cfg.luzMesAncla + "-01") || aFecha(cfg.luzMesAncla);
    if (!ancla) {
      return false;
    }
    var offset =
      (d.getFullYear() - ancla.getFullYear()) * 12 +
      (d.getMonth() - ancla.getMonth());
    return offset >= 0 && offset % periodo === 0;
  }

  /**
   * gastosFijosDelMes(fecha, cfg): desglose de gastos fijos del mes.
   * starlink = numAntenas * costoAntena; luz = costoLuz si aplica el mes.
   * @param {Date|string|number} fecha
   * @param {Object} [cfg]
   * @returns {{starlink:number, luz:number, total:number}}
   */
  function gastosFijosDelMes(fecha, cfg) {
    cfg = cfg || cargarConfig();
    var starlink = Number(cfg.numAntenas) * Number(cfg.costoAntena);
    if (!isFinite(starlink)) {
      starlink = 0;
    }
    var aplica = luzAplicaEnMes(fecha, cfg);
    var luz = aplica ? Number(cfg.costoLuz) : 0;
    if (!isFinite(luz)) {
      luz = 0;
    }
    return { starlink: starlink, luz: luz, total: starlink + luz };
  }

  /**
   * facturacionTotalMensual(clientes): suma de las cuotas mensuales
   * (campo 'monto') de los clientes con estatus === 'Activo'. Representa
   * el POTENCIAL de cobro del mes (lo que entraria si todos los clientes
   * activos pagaran su cuota), es decir, la facturacion objetivo.
   *
   * Es una cifra puramente informativa: NO depende del mes navegado
   * (monto es una cuota fija mensual) y NO afecta al reparto ni a la
   * ganancia. Los clientes Pausados NO cuentan (no se les cobra). Un
   * cliente con monto 0 (p.ej. "en curso") no afecta la suma.
   *
   * @param {Array<Object>} clientes
   * @returns {number} suma de cuotas mensuales de los activos
   */
  function facturacionTotalMensual(clientes) {
    clientes = Array.isArray(clientes) ? clientes : [];
    var total = 0;
    for (var i = 0; i < clientes.length; i++) {
      var c = clientes[i];
      if (c && c.estatus === "Activo") {
        total += Number(c.monto) || 0;
      }
    }
    return total;
  }

  /* ----------------------------------------------------------
     6.a.bis Cobranza por MES CALENDARIO (regla principal de estado)
     ------------------------------------------------------------
     Regla confirmada por el usuario (OPCION A): el cobro es por mes
     natural. Un cliente esta "atrasado" si NO ha registrado un pago del
     MES EN CURSO, sin importar su fecha de vencimiento rodante individual.

     - pagoDelMes(cliente, movimientos, fechaRef): true si existe un
       movimiento de pago (esPago) de ese cliente cuyo 'periodo' sea el mes
       de fechaRef (YYYY-MM). Para pagos viejos sin 'periodo', se usa el mes
       de su 'fecha'. Es puro y no muta nada.
     - estaAtrasado(cliente, movimientos, fechaRef): true si el cliente es
       Activo y NO pago el mes de fechaRef. Un Pausado NUNCA esta atrasado
       (no se le cobra mientras esta en pausa), igual que antes.

     "Mes en curso" = el mes de HOY. Como la regla mira el periodo del mes
     actual, al cambiar de mes natural TODOS vuelven a faltar por pagar de
     forma automatica (no hay pago con el periodo del nuevo mes). No hace
     falta ningun cron ni reinicio manual: la ausencia del pago del nuevo mes
     los marca atrasados por si sola.
     ---------------------------------------------------------- */

  /**
   * mesDe(fecha) -> 'YYYY-MM' del mes de 'fecha' (o '' si no es valida).
   * @param {Date|string|number} fecha
   * @returns {string}
   */
  function mesDe(fecha) {
    var d = aFecha(fecha);
    if (!d) {
      return "";
    }
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  /**
   * pagoDelMes(cliente, movimientos, fechaRef): true si el cliente registro
   * un pago (movimiento esPago) que cubre el mes de 'fechaRef'. Se compara
   * por 'periodo' (YYYY-MM) cuando el movimiento lo trae; para pagos viejos
   * sin 'periodo' se cae al mes de su 'fecha'. No muta nada.
   * @param {Object} cliente
   * @param {Array<Object>} movimientos
   * @param {Date|string|number} [fechaRef] default: hoy
   * @returns {boolean}
   */
  function pagoDelMes(cliente, movimientos, fechaRef) {
    if (!cliente || !cliente.id) {
      return false;
    }
    movimientos = Array.isArray(movimientos) ? movimientos : [];
    var mesObjetivo = mesDe(fechaRef || new Date());
    if (!mesObjetivo) {
      return false;
    }
    for (var i = 0; i < movimientos.length; i++) {
      var mov = movimientos[i];
      if (!mov || !mov.esPago || mov.clienteId !== cliente.id) {
        continue;
      }
      var mesMov = mov.periodo ? String(mov.periodo) : mesDe(mov.fecha);
      if (mesMov === mesObjetivo) {
        return true;
      }
    }
    return false;
  }

  /**
   * estaAtrasado(cliente, movimientos, fechaRef): true si el cliente es
   * Activo y NO pago el mes de 'fechaRef'. Un Pausado nunca esta atrasado.
   * @param {Object} cliente
   * @param {Array<Object>} movimientos
   * @param {Date|string|number} [fechaRef] default: hoy
   * @returns {boolean}
   */
  function estaAtrasado(cliente, movimientos, fechaRef) {
    if (!cliente || cliente.estatus !== "Activo") {
      return false;
    }
    return !pagoDelMes(cliente, movimientos, fechaRef);
  }

  /**
   * calcularReparto(fecha, clientes, movimientos, cfg): calcula el
   * reparto de fin de mes para el mes de 'fecha'.
   *
   * ingresosMes se basa en los PAGOS COBRADOS (movimientos tipo
   * 'ingreso' con esPago===true) cuya fecha cae en el mismo mes.
   * Un pago se atribuye a Octavio si su movimiento.clienteId apunta a
   * un cliente con socio 'Octavio' (si falta clienteId, no cuenta como
   * de Octavio).
   *
   * @param {Date|string|number} fecha
   * @param {Array<Object>} clientes
   * @param {Array<Object>} movimientos
   * @param {Object} [cfg]
   * @returns {Object}
   */
  function calcularReparto(fecha, clientes, movimientos, cfg) {
    cfg = cfg || cargarConfig();
    var ref = aFecha(fecha);
    clientes = Array.isArray(clientes) ? clientes : [];
    movimientos = Array.isArray(movimientos) ? movimientos : [];

    // Indice de socio por id de cliente.
    var socioPorId = {};
    for (var i = 0; i < clientes.length; i++) {
      var c = clientes[i];
      if (c && c.id) {
        socioPorId[c.id] = c.socio === "Octavio" ? "Octavio" : "Carlos";
      }
    }

    var ingresosMes = 0;
    var pagosOctavio = 0;
    for (var j = 0; j < movimientos.length; j++) {
      var mov = movimientos[j];
      if (!mov || mov.tipo !== "ingreso" || !mov.esPago) {
        continue;
      }
      var fMov = aFecha(mov.fecha);
      if (!fMov || !ref) {
        continue;
      }
      if (
        fMov.getFullYear() !== ref.getFullYear() ||
        fMov.getMonth() !== ref.getMonth()
      ) {
        continue;
      }
      var monto = Number(mov.monto) || 0;
      ingresosMes += monto;
      if (mov.clienteId && socioPorId[mov.clienteId] === "Octavio") {
        pagosOctavio += monto;
      }
    }

    var gastos = gastosFijosDelMes(ref, cfg);
    var gananciaRepartir = ingresosMes - gastos.total - pagosOctavio;
    var mitad = gananciaRepartir / 2;

    return {
      ingresosMes: ingresosMes,
      starlink: gastos.starlink,
      luz: gastos.luz,
      gastosFijos: gastos.total,
      pagosOctavio: pagosOctavio,
      gananciaRepartir: gananciaRepartir,
      mitadCarlos: mitad,
      mitadOctavio: mitad,
      totalCarlos: mitad,
      totalOctavio: mitad - pagosOctavio,
      luzAplica: luzAplicaEnMes(ref, cfg)
    };
  }

  /**
   * calcularRepartoPrevisto(fecha, clientes, cfg): reparto PREVISTO del mes.
   *
   * Misma logica/formula que calcularReparto, pero en vez de partir de los
   * pagos COBRADOS parte de la FACTURACION TOTAL del mes (lo que entraria si
   * TODOS los clientes activos pagaran su cuota). Sirve para mostrarle al
   * socio cuanto le toca "aunque todavia no se haya cobrado".
   *
   *   facturacion      = facturacionTotalMensual(clientes) (cuotas de Activos)
   *   gastosFijos      = Starlink + Luz (si aplica el mes de 'fecha')
   *   pagosOctavio     = suma de cuotas (monto) de Activos con socio 'Octavio'
   *   gananciaPrevista = facturacion − gastosFijos − pagosOctavio
   *   mitad            = gananciaPrevista / 2
   *   totalCarlos      = su mitad
   *   totalOctavio     = su mitad − sus pagos directos (los ya "cobra" directo)
   *
   * NOTA: la facturacion y los pagos directos de Octavio usan el PADRON
   * ACTUAL de clientes (las cuotas son fijas, no dependen del mes). Solo los
   * gastos fijos (luz bimestral) dependen del mes navegado. Reutiliza
   * facturacionTotalMensual y gastosFijosDelMes SIN cambiar la formula.
   * Es puro: no muta nada ni toca el DOM/persistencia.
   *
   * @param {Date|string|number} fecha  mes seleccionado (para la luz)
   * @param {Array<Object>} clientes    padron actual
   * @param {Object} [cfg]
   * @returns {Object}
   */
  function calcularRepartoPrevisto(fecha, clientes, cfg) {
    cfg = cfg || cargarConfig();
    var ref = aFecha(fecha);
    clientes = Array.isArray(clientes) ? clientes : [];

    var facturacion = facturacionTotalMensual(clientes);

    // Pago(s) directo(s) PREVISTO(s) de Octavio: suma de las cuotas (monto)
    // de los clientes Activos cuyo socio es 'Octavio'. Es sobre facturacion
    // (lo que deberia cobrar este mes), no sobre lo ya cobrado.
    var pagosOctavioPrevisto = 0;
    for (var i = 0; i < clientes.length; i++) {
      var c = clientes[i];
      if (c && c.estatus === "Activo" && c.socio === "Octavio") {
        pagosOctavioPrevisto += Number(c.monto) || 0;
      }
    }

    var gastos = gastosFijosDelMes(ref, cfg);
    var gananciaPrevista = facturacion - gastos.total - pagosOctavioPrevisto;
    var mitad = gananciaPrevista / 2;

    return {
      facturacion: facturacion,
      starlink: gastos.starlink,
      luz: gastos.luz,
      gastosFijos: gastos.total,
      pagosOctavioPrevisto: pagosOctavioPrevisto,
      gananciaPrevista: gananciaPrevista,
      mitad: mitad,
      totalCarlos: mitad,
      totalOctavio: mitad - pagosOctavioPrevisto,
      luzAplica: luzAplicaEnMes(ref, cfg)
    };
  }

  /* ----------------------------------------------------------
     6.b.bis HISTORIAL DE MESES (logica pura, testeable)
     ------------------------------------------------------------
     Resume cada mes reutilizando el negocio existente (calcularReparto,
     gastosFijosDelMes, facturacionTotalMensual, pagoDelMes) SIN cambiar
     ninguna formula. La UI (FEAT-002) consume estas funciones para pintar
     la tabla + grafica; aqui todo es puro (no toca DOM ni persistencia).

     Meses manuales: capturas historicas que viven en
     cfg.historialManual = [{ mes:'YYYY-MM', cobrado, gastos?, totalCarlos?,
     totalOctavio?, nota? }]. Las funciones de meses manuales SOLO
     transforman el objeto cfg (puras). La persistencia la hace la UI con
     PCC.guardarConfig(nuevoCfg) (firebase-sync.js lo propaga a Firestore).
     ---------------------------------------------------------- */

  /**
   * resumenMensual(fecha, clientes, movimientos, cfg): datos de UN mes,
   * REUTILIZANDO calcularReparto (misma logica de pagos esPago del mes que
   * ya usa el Reparto). Es puro: no muta nada.
   *
   * NOTA sobre meses pasados: 'facturado', 'pagaron' y 'noPagaron' se
   * calculan con el padron ACTUAL de clientes (facturacionTotalMensual y
   * pagoDelMes recorren la lista de clientes de hoy). Para meses historicos
   * son una referencia aproximada, no una foto del padron de ese mes.
   *
   * @param {Date|string|number} fecha
   * @param {Array<Object>} clientes
   * @param {Array<Object>} movimientos
   * @param {Object} [cfg]
   * @returns {Object} resumen con fuente:'real'
   */
  function resumenMensual(fecha, clientes, movimientos, cfg) {
    cfg = cfg || cargarConfig();
    clientes = Array.isArray(clientes) ? clientes : [];
    movimientos = Array.isArray(movimientos) ? movimientos : [];
    var ref = aFecha(fecha);
    var r = calcularReparto(ref, clientes, movimientos, cfg);
    var facturado = facturacionTotalMensual(clientes);
    var cobrado = r.ingresosMes;
    var porcentaje = facturado > 0 ? cobrado / facturado : 0;

    // pagaron/noPagaron evaluados contra el mes dado (no contra hoy).
    var pagaron = 0;
    var noPagaron = 0;
    for (var i = 0; i < clientes.length; i++) {
      var c = clientes[i];
      if (!c) {
        continue;
      }
      var pago = pagoDelMes(c, movimientos, ref);
      if (pago) {
        pagaron += 1;
      } else if (c.estatus === "Activo") {
        noPagaron += 1;
      }
    }

    return {
      mes: mesDe(ref),
      fecha: ref,
      cobrado: cobrado,
      facturado: facturado,
      porcentajeCobranza: porcentaje,
      gastosFijos: r.gastosFijos,
      starlink: r.starlink,
      luz: r.luz,
      luzAplica: r.luzAplica,
      gananciaRepartir: r.gananciaRepartir,
      totalCarlos: r.totalCarlos,
      totalOctavio: r.totalOctavio,
      pagaron: pagaron,
      noPagaron: noPagaron,
      fuente: "real"
    };
  }

  /**
   * esMesValido(mes): true si 'mes' tiene forma 'YYYY-MM'.
   * @param {string} mes
   * @returns {boolean}
   */
  function esMesValido(mes) {
    return typeof mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes);
  }

  /**
   * leerHistorialManual(cfg): devuelve SIEMPRE un array saneado de meses
   * manuales. Tolera cfg sin la clave, descarta entradas sin 'mes' valido
   * ('YYYY-MM'), numeriza montos y deduplica por mes quedandose con la
   * ULTIMA aparicion. Es puro: no muta cfg.
   * @param {Object} [cfg]
   * @returns {Array<Object>}
   */
  function leerHistorialManual(cfg) {
    cfg = cfg || {};
    var lista = Array.isArray(cfg.historialManual) ? cfg.historialManual : [];
    var porMes = {};
    var orden = [];
    for (var i = 0; i < lista.length; i++) {
      var e = lista[i];
      if (!e || !esMesValido(e.mes)) {
        continue;
      }
      var saneada = {
        mes: e.mes,
        cobrado: Number(e.cobrado) || 0
      };
      if (e.gastos !== undefined && e.gastos !== null && e.gastos !== "") {
        saneada.gastos = Number(e.gastos) || 0;
      }
      if (
        e.totalCarlos !== undefined &&
        e.totalCarlos !== null &&
        e.totalCarlos !== ""
      ) {
        saneada.totalCarlos = Number(e.totalCarlos) || 0;
      }
      if (
        e.totalOctavio !== undefined &&
        e.totalOctavio !== null &&
        e.totalOctavio !== ""
      ) {
        saneada.totalOctavio = Number(e.totalOctavio) || 0;
      }
      if (e.nota !== undefined && e.nota !== null) {
        saneada.nota = String(e.nota);
      }
      if (porMes[e.mes] === undefined) {
        orden.push(e.mes);
      }
      porMes[e.mes] = saneada;
    }
    var out = [];
    for (var j = 0; j < orden.length; j++) {
      out.push(porMes[orden[j]]);
    }
    return out;
  }

  /**
   * guardarMesManual(cfg, entrada): devuelve un NUEVO objeto cfg con la
   * entrada manual agregada o REEMPLAZADA por 'mes'. PURO: no muta el cfg
   * recibido ni su arreglo historialManual. Si 'entrada.mes' no es valido,
   * devuelve una copia del cfg sin cambios en el historial.
   * @param {Object} cfg
   * @param {Object} entrada { mes, cobrado, gastos?, totalCarlos?, totalOctavio?, nota? }
   * @returns {Object} nuevo cfg
   */
  function guardarMesManual(cfg, entrada) {
    cfg = cfg || {};
    var base = leerHistorialManual(cfg);
    var nuevoCfg = {};
    for (var k in cfg) {
      if (Object.prototype.hasOwnProperty.call(cfg, k)) {
        nuevoCfg[k] = cfg[k];
      }
    }
    if (!entrada || !esMesValido(entrada.mes)) {
      nuevoCfg.historialManual = base;
      return nuevoCfg;
    }
    var reemplazo = {};
    for (var p in entrada) {
      if (Object.prototype.hasOwnProperty.call(entrada, p)) {
        reemplazo[p] = entrada[p];
      }
    }
    var lista = [];
    var reemplazado = false;
    for (var i = 0; i < base.length; i++) {
      if (base[i].mes === entrada.mes) {
        lista.push(reemplazo);
        reemplazado = true;
      } else {
        lista.push(base[i]);
      }
    }
    if (!reemplazado) {
      lista.push(reemplazo);
    }
    // Normalizar/sanear la lista resultante.
    nuevoCfg.historialManual = leerHistorialManual({ historialManual: lista });
    return nuevoCfg;
  }

  /**
   * eliminarMesManual(cfg, mes): devuelve un NUEVO cfg sin el mes manual
   * indicado. PURO: no muta el cfg recibido.
   * @param {Object} cfg
   * @param {string} mes 'YYYY-MM'
   * @returns {Object} nuevo cfg
   */
  function eliminarMesManual(cfg, mes) {
    cfg = cfg || {};
    var base = leerHistorialManual(cfg);
    var nuevoCfg = {};
    for (var k in cfg) {
      if (Object.prototype.hasOwnProperty.call(cfg, k)) {
        nuevoCfg[k] = cfg[k];
      }
    }
    var lista = [];
    for (var i = 0; i < base.length; i++) {
      if (base[i].mes !== mes) {
        lista.push(base[i]);
      }
    }
    nuevoCfg.historialManual = lista;
    return nuevoCfg;
  }

  /**
   * resumenDesdeManual(entrada, clientes, cfg): construye un resumen con la
   * misma forma que resumenMensual pero a partir de una captura manual.
   * fuente:'manual'. pagaron/noPagaron NO aplican (null). Es puro.
   *
   * NOTA DE DISEÑO (reparto por socio en capturas manuales): cuando la
   * captura NO trae totalCarlos/totalOctavio se reparte la ganancia 50/50
   * (mitad para cada socio), A PROPOSITO. La formula asimetrica del resto de
   * la app (Octavio = su mitad menos sus pagos directos) necesita el detalle
   * de pagos por cliente de ese mes, dato que una captura manual de un mes
   * viejo (p.ej. tomada del Excel) no incluye. Sin ese desglose, 50/50 es el
   * unico reparto defendible. El modal 'Agregar mes historico' permite
   * sobreescribir ambos totales a mano cuando se conocen. Esto solo afecta a
   * meses capturados a mano; los meses reales siguen usando calcularReparto.
   *
   * @param {Object} entrada entrada ya saneada de historialManual
   * @param {Array<Object>} clientes
   * @param {Object} cfg
   * @returns {Object} resumen con fuente:'manual'
   */
  function resumenDesdeManual(entrada, clientes, cfg) {
    clientes = Array.isArray(clientes) ? clientes : [];
    var ref = aFecha(entrada.mes + "-01");
    var cobrado = Number(entrada.cobrado) || 0;
    var gastosDesglose = gastosFijosDelMes(ref, cfg);
    var gastos =
      entrada.gastos !== undefined ? Number(entrada.gastos) || 0 : gastosDesglose.total;
    var gananciaRepartir = cobrado - gastos;
    // Reparto 50/50 por defecto (ver NOTA DE DISEÑO del encabezado): sin
    // desglose por cliente no se puede aplicar la formula asimetrica.
    var mitad = gananciaRepartir / 2;
    var totalCarlos =
      entrada.totalCarlos !== undefined ? Number(entrada.totalCarlos) || 0 : mitad;
    var totalOctavio =
      entrada.totalOctavio !== undefined ? Number(entrada.totalOctavio) || 0 : mitad;
    var facturado = facturacionTotalMensual(clientes);
    var porcentaje = facturado > 0 ? cobrado / facturado : 0;
    return {
      mes: entrada.mes,
      fecha: ref,
      cobrado: cobrado,
      facturado: facturado,
      porcentajeCobranza: porcentaje,
      gastosFijos: gastos,
      starlink: gastosDesglose.starlink,
      luz: gastosDesglose.luz,
      luzAplica: luzAplicaEnMes(ref, cfg),
      gananciaRepartir: gananciaRepartir,
      totalCarlos: totalCarlos,
      totalOctavio: totalOctavio,
      pagaron: null,
      noPagaron: null,
      nota: entrada.nota || "",
      fuente: "manual"
    };
  }

  /**
   * hayPagoRealEnMes(mes, movimientos): true si existe algun pago cobrado
   * (ingreso con esPago) cuya FECHA caiga en 'mes' ('YYYY-MM'). Puro.
   *
   * IMPORTANTE: clasifica por el mes de 'mov.fecha', NO por 'mov.periodo'.
   * Esto mantiene el mismo criterio de mes que calcularReparto/resumenMensual
   * (que agregan el Cobrado por 'fecha' y nunca miran 'periodo'). Asi la
   * decision real-vs-manual y el monto Cobrado siempre hablan del mismo mes:
   * un pago tardio (periodo de un mes, fecha de otro) ya no marca "real" en
   * $0 el mes del periodo pisando una captura manual; el Cobrado se atribuye
   * al mes de la fecha, igual que en el panel Reparto. Tambien se exige
   * mov.tipo === 'ingreso' para alinear el universo de movimientos con
   * calcularReparto.
   *
   * @param {string} mes
   * @param {Array<Object>} movimientos
   * @returns {boolean}
   */
  function hayPagoRealEnMes(mes, movimientos) {
    movimientos = Array.isArray(movimientos) ? movimientos : [];
    for (var i = 0; i < movimientos.length; i++) {
      var mov = movimientos[i];
      if (!mov || mov.tipo !== "ingreso" || !mov.esPago) {
        continue;
      }
      if (mesDe(mov.fecha) === mes) {
        return true;
      }
    }
    return false;
  }

  /**
   * construirHistorial(mesesAtras, clientes, movimientos, cfg, hoy):
   * array ordenado de resumenes de mes del MAS RECIENTE al MAS ANTIGUO,
   * FUSIONANDO real + manual con PRECEDENCIA real-sobre-manual:
   *
   *   - Si un mes tiene pagos reales (cobrado>0 o algun esPago de ese mes)
   *     se usa el resumen REAL (fuente:'real').
   *   - Si NO hay pagos reales pero existe captura en historialManual, se
   *     construye el resumen desde el manual (fuente:'manual').
   *
   * Rango: 'mesesAtras' meses contando hacia atras desde el mes de 'hoy'
   * (default 12), incluyendo ademas cualquier mes manual anterior al rango
   * para no perder capturas viejas. Es puro.
   *
   * @param {number} [mesesAtras] default 12
   * @param {Array<Object>} clientes
   * @param {Array<Object>} movimientos
   * @param {Object} [cfg]
   * @param {Date|string|number} [hoy] default new Date()
   * @returns {Array<Object>}
   */
  function construirHistorial(mesesAtras, clientes, movimientos, cfg, hoy) {
    cfg = cfg || cargarConfig();
    clientes = Array.isArray(clientes) ? clientes : [];
    movimientos = Array.isArray(movimientos) ? movimientos : [];
    var n = Number(mesesAtras);
    if (!isFinite(n) || n <= 0) {
      n = 12;
    }
    var refHoy = aFecha(hoy) || new Date();
    var manual = leerHistorialManual(cfg);
    var manualPorMes = {};
    for (var m = 0; m < manual.length; m++) {
      manualPorMes[manual[m].mes] = manual[m];
    }

    // Conjunto ordenado de meses a incluir: el rango [hoy-n+1 .. hoy] mas
    // cualquier mes manual (incluso anterior al rango).
    var mesesSet = {};
    var listaMeses = [];
    function agregarMes(mes) {
      if (mes && mesesSet[mes] === undefined) {
        mesesSet[mes] = true;
        listaMeses.push(mes);
      }
    }
    for (var i = 0; i < n; i++) {
      agregarMes(mesDe(sumarMeses(refHoy, -i)));
    }
    for (var j = 0; j < manual.length; j++) {
      agregarMes(manual[j].mes);
    }

    var out = [];
    for (var k = 0; k < listaMeses.length; k++) {
      var mes = listaMeses[k];
      var fechaMes = aFecha(mes + "-01");
      var tieneReal = hayPagoRealEnMes(mes, movimientos);
      if (tieneReal) {
        out.push(resumenMensual(fechaMes, clientes, movimientos, cfg));
      } else if (manualPorMes[mes]) {
        out.push(resumenDesdeManual(manualPorMes[mes], clientes, cfg));
      } else {
        // Mes del rango sin datos reales ni manuales: resumen real en $0.
        out.push(resumenMensual(fechaMes, clientes, movimientos, cfg));
      }
    }

    // Ordenar del mas reciente al mas antiguo por 'mes' ('YYYY-MM').
    out.sort(function (a, b) {
      if (a.mes < b.mes) {
        return 1;
      }
      if (a.mes > b.mes) {
        return -1;
      }
      return 0;
    });
    return out;
  }

  /* ----------------------------------------------------------
     6.c Registrar y REVERTIR un pago (logica pura, testeable)
     ------------------------------------------------------------
     El boton "Pagar" de la UI puede pulsarse por error. Para poder
     deshacerlo con exactitud, al registrar el pago guardamos en el
     propio movimiento el estado PREVIO del cliente (prevUltimoPago y
     prevFechaProximoPago). Asi, revertir simplemente borra el
     movimiento y RESTAURA esos valores tal cual, sin recomputar.
     ---------------------------------------------------------- */

  /**
   * periodoPorDefecto(cliente, hoy) -> 'YYYY-MM'
   * Devuelve el periodo (mes) que cubre un pago. Usa el mes de
   * cliente.fechaProximoPago si existe; si no, el mes de 'hoy' (o la
   * fecha actual). Es puro y determinista: no muta nada.
   * @param {Object} cliente
   * @param {Date|string|number} [hoy]
   * @returns {string} 'YYYY-MM'
   */
  function periodoPorDefecto(cliente, hoy) {
    cliente = cliente || {};
    var ref =
      aFecha(cliente.fechaProximoPago) || aFecha(hoy) || new Date();
    var mes = String(ref.getMonth() + 1).padStart(2, "0");
    return ref.getFullYear() + "-" + mes;
  }

  var _formatoPeriodoIntl = new Intl.DateTimeFormat("es-MX", {
    month: "long",
    year: "numeric"
  });

  /**
   * formatoPeriodo('YYYY-MM') -> 'febrero 2026'
   * Convierte un periodo 'YYYY-MM' a texto en espanol (Intl es-MX) sobre
   * el dia 1 del mes. Tolera entradas vacias/invalidas devolviendo ''.
   * @param {string} periodoYYYYMM
   * @returns {string}
   */
  function formatoPeriodo(periodoYYYYMM) {
    if (typeof periodoYYYYMM !== "string") {
      return "";
    }
    var m = /^(\d{4})-(\d{2})$/.exec(periodoYYYYMM.trim());
    if (!m) {
      return "";
    }
    var anio = Number(m[1]);
    var mesIndex = Number(m[2]) - 1;
    if (mesIndex < 0 || mesIndex > 11) {
      return "";
    }
    // Algunas plataformas (ICU) devuelven 'febrero de 2026'; normalizamos
    // a 'febrero 2026' quitando el conector ' de ' intermedio.
    var texto = _formatoPeriodoIntl.format(new Date(anio, mesIndex, 1));
    return texto.replace(/\sde\s(\d{4})$/, " $1");
  }

  /**
   * generarFolio(anio, movimientos) -> 'REC-AAAA-NNNN'
   * Calcula el folio CONSECUTIVO del anio en formato 'REC-AAAA-NNNN'
   * (NNNN con padStart a 4 digitos). Recorre los movimientos esPago que
   * ya tengan folio del MISMO anio, extrae el consecutivo maximo y
   * devuelve max+1 formateado. Si no hay ninguno, empieza en 0001.
   *
   * Estrategia: el consecutivo se calcula al registrar el pago como
   * (max folio existente del mismo anio) + 1.
   * Limitacion: posible colision teorica si dos dispositivos registran
   * un pago en el mismo instante antes de sincronizar; aceptable para
   * este negocio (volumen bajo, se corrige editando el folio).
   * @param {number|string} anio
   * @param {Array<Object>} movimientos
   * @returns {string}
   */
  function generarFolio(anio, movimientos) {
    var anioNum = Number(anio);
    if (!isFinite(anioNum)) {
      anioNum = new Date().getFullYear();
    }
    var anioStr = String(anioNum);
    movimientos = Array.isArray(movimientos) ? movimientos : [];
    var max = 0;
    var re = /^REC-(\d{4})-(\d{4,})$/;
    for (var i = 0; i < movimientos.length; i++) {
      var m = movimientos[i];
      if (!m || !m.esPago || typeof m.folio !== "string") {
        continue;
      }
      var exec = re.exec(m.folio.trim());
      if (!exec || exec[1] !== anioStr) {
        continue;
      }
      var consecutivo = Number(exec[2]);
      if (isFinite(consecutivo) && consecutivo > max) {
        max = consecutivo;
      }
    }
    return "REC-" + anioStr + "-" + String(max + 1).padStart(4, "0");
  }

  /**
   * construirMovimientoPago(cliente, hoy, opciones): crea el objeto de
   * movimiento de un pago cobrado, incluyendo el estado PREVIO del
   * cliente para poder revertir con exactitud. NO muta al cliente.
   *
   * El tercer parametro 'opciones' es OPCIONAL; las llamadas de 2
   * argumentos siguen funcionando igual. opciones = {
   *   periodo:     'YYYY-MM' que cubre el pago (default periodoPorDefecto)
   *   monto:       monto cobrado (default Number(cliente.monto))
   *   folio:       folio explicito (si no, se calcula con 'movimientos')
   *   movimientos: lista de movimientos existentes para generar el folio
   * }
   * @param {Object} cliente
   * @param {Date|string|number} [hoy]
   * @param {Object} [opciones]
   * @returns {Object} movimiento { id, tipo:'ingreso', esPago:true, ... }
   */
  function construirMovimientoPago(cliente, hoy, opciones) {
    cliente = cliente || {};
    opciones = opciones || {};
    var hoyISO = fechaISO(aFecha(hoy) || new Date());

    // (a) Monto: usar opciones.monto si es un numero valido; si no, el
    // monto del cliente.
    var monto;
    if (opciones.monto != null && isFinite(Number(opciones.monto))) {
      monto = Number(opciones.monto);
    } else {
      monto = Number(cliente.monto) || 0;
    }

    // (b) Periodo: el indicado o el calculado por defecto.
    var periodo = opciones.periodo || periodoPorDefecto(cliente, hoy);

    // (c) Folio: el indicado o, si llega la lista de movimientos, uno
    // consecutivo del anio del pago. Si no se puede calcular, folio ''.
    var folio = "";
    if (opciones.folio) {
      folio = opciones.folio;
    } else if (Array.isArray(opciones.movimientos)) {
      var anioPago = (aFecha(hoyISO) || new Date()).getFullYear();
      folio = generarFolio(anioPago, opciones.movimientos);
    }

    return {
      id: generarId(),
      tipo: "ingreso",
      esPago: true,
      clienteId: cliente.id,
      concepto: "Pago de " + (cliente.nombre || "cliente"),
      monto: monto,
      fecha: hoyISO,
      periodo: periodo,
      folio: folio,
      // Estado previo del cliente (para revertir sin recomputar).
      prevUltimoPago: cliente.ultimoPago != null ? cliente.ultimoPago : "",
      prevFechaProximoPago:
        cliente.fechaProximoPago != null ? cliente.fechaProximoPago : ""
    };
  }

  /**
   * datosRecibo(cliente, movimientoPago, cfg) -> objeto plano con todo lo
   * necesario para renderizar un recibo. Aplica fallbacks para pagos
   * viejos sin folio/periodo. NO depende del DOM.
   * @param {Object} cliente
   * @param {Object} movimientoPago
   * @param {Object} [cfg]
   * @returns {Object}
   */
  function datosRecibo(cliente, movimientoPago, cfg) {
    cliente = cliente || {};
    var mov = movimientoPago || {};
    cfg = cfg || {};

    var fechaEmision = mov.fecha || fechaISO(new Date());

    // Fallback de folio: pagos viejos sin folio -> 'sin folio'.
    var folio = mov.folio ? mov.folio : "sin folio";

    // Fallback de periodo: si el movimiento no trae periodo, derivarlo del
    // mes de su fecha.
    var periodo = mov.periodo;
    if (!periodo) {
      periodo = periodoPorDefecto({ fechaProximoPago: fechaEmision }, fechaEmision);
    }

    var monto = Number(mov.monto) || 0;

    return {
      negocio: {
        nombre: cfg.nombreNegocio || CONFIG_DEFAULT.nombreNegocio,
        telefono: cfg.telefonoContacto || "",
        direccion: cfg.direccionNegocio || "",
        pie: cfg.mensajePie || CONFIG_DEFAULT.mensajePie
      },
      folio: folio,
      fechaEmision: fechaEmision,
      fechaEmisionLarga: formatoFechaLarga(fechaEmision),
      cliente: {
        nombre: cliente.nombre || "cliente",
        celular: cliente.celular || ""
      },
      periodo: periodo,
      periodoTexto: formatoPeriodo(periodo),
      concepto: mov.concepto || "Pago de " + (cliente.nombre || "cliente"),
      monto: monto,
      montoTexto: formatoMoneda(monto),
      socio: cliente.socio || ""
    };
  }

  /**
   * textoWhatsAppRecibo(datosRecibo) -> string en espanol con el resumen
   * del recibo para enviar por WhatsApp. Determinista, sin DOM.
   * @param {Object} datos resultado de datosRecibo(...)
   * @returns {string}
   */
  function textoWhatsAppRecibo(datos) {
    datos = datos || {};
    var negocio = datos.negocio || {};
    var lineas = [];
    lineas.push("Recibo de pago - " + (negocio.nombre || "Mi WISP"));
    lineas.push("Folio: " + (datos.folio || "sin folio"));
    lineas.push("Cliente: " + (datos.cliente && datos.cliente.nombre ? datos.cliente.nombre : "cliente"));
    if (datos.periodoTexto) {
      lineas.push("Periodo: " + datos.periodoTexto);
    }
    lineas.push("Concepto: " + (datos.concepto || "Pago"));
    lineas.push("Monto: " + (datos.montoTexto || formatoMoneda(datos.monto)));
    if (datos.fechaEmisionLarga) {
      lineas.push("Fecha: " + datos.fechaEmisionLarga);
    }
    lineas.push(negocio.pie || CONFIG_DEFAULT.mensajePie);
    return lineas.join("\n");
  }

  /**
   * revertirPago(movimientoId, clientes, movimientos): deshace un pago.
   * Logica pura (no toca localStorage): devuelve nuevas listas de
   * clientes y movimientos ya actualizadas.
   *
   * - Elimina de 'movimientos' el movimiento de pago con ese id.
   * - Restaura en el cliente ultimoPago/fechaProximoPago a los valores
   *   prevUltimoPago/prevFechaProximoPago guardados en el movimiento.
   * - Fallback para pagos antiguos SIN esos campos: limpia ultimoPago y
   *   recalcula fechaProximoPago con calcularProximoPago.
   *
   * @param {string} movimientoId
   * @param {Array<Object>} clientes
   * @param {Array<Object>} movimientos
   * @returns {{clientes:Array, movimientos:Array, revertido:boolean, usoFallback:boolean}}
   */
  function revertirPago(movimientoId, clientes, movimientos) {
    clientes = Array.isArray(clientes) ? clientes : [];
    movimientos = Array.isArray(movimientos) ? movimientos : [];

    var mov = null;
    for (var i = 0; i < movimientos.length; i++) {
      if (movimientos[i] && movimientos[i].id === movimientoId) {
        mov = movimientos[i];
        break;
      }
    }
    if (!mov || !mov.esPago) {
      return {
        clientes: clientes,
        movimientos: movimientos,
        revertido: false,
        usoFallback: false
      };
    }

    var nuevosMovs = movimientos.filter(function (m) {
      return m.id !== movimientoId;
    });

    var usoFallback = false;
    var tienePrev =
      Object.prototype.hasOwnProperty.call(mov, "prevUltimoPago") ||
      Object.prototype.hasOwnProperty.call(mov, "prevFechaProximoPago");

    for (var j = 0; j < clientes.length; j++) {
      var c = clientes[j];
      if (!c || c.id !== mov.clienteId) {
        continue;
      }
      if (tienePrev) {
        c.ultimoPago = mov.prevUltimoPago != null ? mov.prevUltimoPago : "";
        c.fechaProximoPago =
          mov.prevFechaProximoPago != null ? mov.prevFechaProximoPago : "";
        if (!c.fechaProximoPago) {
          c.fechaProximoPago = fechaISO(calcularProximoPago(c, new Date()));
        }
      } else {
        // Pago antiguo sin datos de reversion: fallback seguro.
        usoFallback = true;
        c.ultimoPago = "";
        c.fechaProximoPago = fechaISO(calcularProximoPago(c, new Date()));
      }
      break;
    }

    return {
      clientes: clientes,
      movimientos: nuevosMovs,
      revertido: true,
      usoFallback: usoFallback
    };
  }

  /* ----------------------------------------------------------
     7. Capa de persistencia (localStorage) robusta
     ---------------------------------------------------------- */

  function _leer(clave, porDefecto) {
    try {
      if (typeof localStorage === "undefined") {
        return porDefecto;
      }
      var crudo = localStorage.getItem(clave);
      if (crudo == null) {
        return porDefecto;
      }
      return JSON.parse(crudo);
    } catch (e) {
      // JSON corrupto o acceso denegado: devolvemos el valor por defecto.
      return porDefecto;
    }
  }

  function _escribir(clave, valor) {
    try {
      if (typeof localStorage === "undefined") {
        return false;
      }
      localStorage.setItem(clave, JSON.stringify(valor));
      return true;
    } catch (e) {
      return false;
    }
  }

  function cargarClientes() {
    var arr = _leer(STORAGE_KEYS.clientes, []);
    return Array.isArray(arr) ? arr : [];
  }

  function guardarClientes(arr) {
    return _escribir(STORAGE_KEYS.clientes, Array.isArray(arr) ? arr : []);
  }

  function cargarMovimientos() {
    var arr = _leer(STORAGE_KEYS.movimientos, []);
    return Array.isArray(arr) ? arr : [];
  }

  function guardarMovimientos(arr) {
    return _escribir(STORAGE_KEYS.movimientos, Array.isArray(arr) ? arr : []);
  }

  function cargarConfig() {
    var cfg = _leer(STORAGE_KEYS.config, null);
    if (!cfg || typeof cfg !== "object") {
      return clonar(CONFIG_DEFAULT);
    }
    // Mezclar con los valores por defecto por si faltan claves nuevas.
    // Esto migra configuraciones viejas {diasAviso,moneda} anadiendo las
    // claves de gastos fijos con sus defaults.
    return {
      diasAviso: cfg.diasAviso != null ? cfg.diasAviso : CONFIG_DEFAULT.diasAviso,
      moneda: cfg.moneda != null ? cfg.moneda : CONFIG_DEFAULT.moneda,
      costoAntena:
        cfg.costoAntena != null ? cfg.costoAntena : CONFIG_DEFAULT.costoAntena,
      numAntenas:
        cfg.numAntenas != null ? cfg.numAntenas : CONFIG_DEFAULT.numAntenas,
      costoLuz: cfg.costoLuz != null ? cfg.costoLuz : CONFIG_DEFAULT.costoLuz,
      luzPeriodicidadMeses:
        cfg.luzPeriodicidadMeses != null
          ? cfg.luzPeriodicidadMeses
          : CONFIG_DEFAULT.luzPeriodicidadMeses,
      luzMesAncla:
        cfg.luzMesAncla != null ? cfg.luzMesAncla : CONFIG_DEFAULT.luzMesAncla,
      // Datos del negocio para recibos (migran con default si faltan).
      nombreNegocio:
        cfg.nombreNegocio != null
          ? cfg.nombreNegocio
          : CONFIG_DEFAULT.nombreNegocio,
      telefonoContacto:
        cfg.telefonoContacto != null
          ? cfg.telefonoContacto
          : CONFIG_DEFAULT.telefonoContacto,
      direccionNegocio:
        cfg.direccionNegocio != null
          ? cfg.direccionNegocio
          : CONFIG_DEFAULT.direccionNegocio,
      mensajePie:
        cfg.mensajePie != null ? cfg.mensajePie : CONFIG_DEFAULT.mensajePie
    };
  }

  function guardarConfig(cfg) {
    cfg = cfg || {};
    var merge = {
      diasAviso:
        cfg.diasAviso != null ? cfg.diasAviso : CONFIG_DEFAULT.diasAviso,
      moneda: cfg.moneda != null ? cfg.moneda : CONFIG_DEFAULT.moneda,
      costoAntena:
        cfg.costoAntena != null ? cfg.costoAntena : CONFIG_DEFAULT.costoAntena,
      numAntenas:
        cfg.numAntenas != null ? cfg.numAntenas : CONFIG_DEFAULT.numAntenas,
      costoLuz: cfg.costoLuz != null ? cfg.costoLuz : CONFIG_DEFAULT.costoLuz,
      luzPeriodicidadMeses:
        cfg.luzPeriodicidadMeses != null
          ? cfg.luzPeriodicidadMeses
          : CONFIG_DEFAULT.luzPeriodicidadMeses,
      luzMesAncla:
        cfg.luzMesAncla != null ? cfg.luzMesAncla : CONFIG_DEFAULT.luzMesAncla,
      // Datos del negocio para recibos (migran con default si faltan).
      nombreNegocio:
        cfg.nombreNegocio != null
          ? cfg.nombreNegocio
          : CONFIG_DEFAULT.nombreNegocio,
      telefonoContacto:
        cfg.telefonoContacto != null
          ? cfg.telefonoContacto
          : CONFIG_DEFAULT.telefonoContacto,
      direccionNegocio:
        cfg.direccionNegocio != null
          ? cfg.direccionNegocio
          : CONFIG_DEFAULT.direccionNegocio,
      mensajePie:
        cfg.mensajePie != null ? cfg.mensajePie : CONFIG_DEFAULT.mensajePie
    };
    return _escribir(STORAGE_KEYS.config, merge);
  }

  function getTheme() {
    var t = _leer(STORAGE_KEYS.theme, THEME_DEFAULT);
    return t === "oscuro" || t === "claro" ? t : THEME_DEFAULT;
  }

  function setTheme(theme) {
    var valor = theme === "oscuro" ? "oscuro" : "claro";
    return _escribir(STORAGE_KEYS.theme, valor);
  }

  function clonar(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /* ----------------------------------------------------------
     8. Dataset SEED real (18 clientes)
     ------------------------------------------------------------
     Lista REAL confirmada por el usuario (tabla + diagrama de red).
     Reemplaza por completo al dataset ficticio anterior.
     Fechas en ISO 'YYYY-MM-DD' (convertidas desde dd/mm/aaaa).
     diaPago = dia del mes en que vence el pago del cliente (columna
     "DIAS POR PAGAR" del Excel del usuario). NO es el dia de la fecha de
     instalacion: p.ej. 'casa 44 LIZBETH' se instalo el 12 pero paga el 15.
     Todos los clientes quedan 'Activo'. Instalacion $0 en todos.

     Decisiones de negocio (NO inventar datos que alteren el reparto):
      - tipoPago financiero = 'Directo' para TODOS por defecto. La tabla
        del usuario no distingue PTP/Directo a nivel financiero; usar
        'Directo' evita atribuir pagos a reparto de forma arbitraria.
      - socio = 'Octavio' SOLO para 'casa 44 LIZBETH' (unico que paga
        directo a Octavio); el resto 'Carlos'.
      - estatusPago (marca de la fila, NO el estatus Activo/Pausado):
        'pagado' => al corriente (con pago del ciclo);
        'debe' => vencido (sin pago del ciclo). Se usa por marca de fila,
        sin indices magicos. ('enCurso' se conserva por compatibilidad en
        aplicarEscenarios, pero ningun cliente real lo usa.)

     Campos de red (tipoConexion/apId/ip) precargados SOLO para los 8
     clientes con IP confirmada en el diagrama. El resto queda sin ip y
     con tipoConexion/apId '' => "falta identificar".

     Cada fila es un objeto para legibilidad:
      { nombre, celular, megas, instalacion (ISO), monto, estatusPago,
        socio?, ip?, tipoConexion?, apId? }
     ---------------------------------------------------------- */
  var SEED_RAW = [
    { nombre: "VECINA YOLANDA CASA 15", celular: "", megas: "10 MB", instalacion: "2026-05-05", diaPago: 5, monto: 500, estatusPago: "pagado" },
    { nombre: "Hermelinda", celular: "9841311983", megas: "10 MB", instalacion: "2024-07-05", diaPago: 7, monto: 500, estatusPago: "pagado" },
    { nombre: "MICAELA HERNANDEZ CASA 54", celular: "9671949286", megas: "10 MB", instalacion: "2026-02-07", diaPago: 8, monto: 500, estatusPago: "pagado" },
    // casa 44 LIZBETH: unico cliente de socio 'Octavio'. IP .145 por el enlace
    // PtP CASA 44. PENDIENTE CONFIRMAR si la .145 corresponde a Lizbeth o a
    // 'Daniel casa 44'; por nombre del diagrama ('CASA 44') se asigna aqui.
    { nombre: "casa 44 LIZBETH", celular: "9842704365", megas: "10 MB", instalacion: "2025-11-12", diaPago: 15, monto: 500, estatusPago: "pagado", socio: "Octavio", ip: "192.168.10.145", tipoConexion: "PtP", apId: RED_IDS.PTP_CASA_44 },
    { nombre: "Daniel casa 44", celular: "9842086116", megas: "10 MB", instalacion: "2025-04-16", diaPago: 17, monto: 500, estatusPago: "pagado" },
    { nombre: "Nieto", celular: "9848062139", megas: "20 MB", instalacion: "2024-07-17", diaPago: 17, monto: 600, estatusPago: "debe", ip: "192.168.10.38", tipoConexion: "AP", apId: RED_IDS.AP_OCTARED_3 },
    { nombre: "Lupita casa 26 alado de nieto", celular: "9982047915", megas: "20 MB", instalacion: "2025-03-21", diaPago: 21, monto: 700, estatusPago: "debe", ip: "192.168.10.111", tipoConexion: "AP", apId: RED_IDS.AP_OCTARED_3 },
    { nombre: "Gabriela", celular: "9844491677", megas: "15 MB", instalacion: "2024-09-21", diaPago: 22, monto: 600, estatusPago: "pagado" },
    { nombre: "URIEL", celular: "9841913321", megas: "10 MB", instalacion: "2025-12-25", diaPago: 25, monto: 500, estatusPago: "debe" },
    { nombre: "Reyes vecino", celular: "9841163234", megas: "30 MB", instalacion: "2024-04-27", diaPago: 28, monto: 600, estatusPago: "debe", ip: "192.168.10.34", tipoConexion: "AP", apId: RED_IDS.LITEAP_AC1 },
    { nombre: "TIENDA INDOMABLE", celular: "9841163234", megas: "5 MB", instalacion: "2025-03-24", diaPago: 28, monto: 500, estatusPago: "debe", ip: "192.168.10.129", tipoConexion: "AP", apId: RED_IDS.AP_OCTARED_3 },
    { nombre: "Mercedez RH", celular: "2711657112", megas: "10 MB", instalacion: "2024-04-28", diaPago: 29, monto: 400, estatusPago: "debe", ip: "192.168.10.36", tipoConexion: "PtP", apId: RED_IDS.PTP_MERCEDES_RH },
    { nombre: "Berenice", celular: "9841417166", megas: "10 MB", instalacion: "2024-10-30", diaPago: 30, monto: 500, estatusPago: "debe", ip: "192.168.10.31", tipoConexion: "AP", apId: RED_IDS.LITEAP_AC2 },
    { nombre: "Jessy casa 43", celular: "", megas: "5 MB", instalacion: "2025-02-24", diaPago: 30, monto: 500, estatusPago: "debe", ip: "192.168.10.40", tipoConexion: "AP", apId: RED_IDS.LITEAP_AC1 },
    { nombre: "Obed", celular: "9841564118", megas: "10 MB", instalacion: "2024-07-27", diaPago: 30, monto: 500, estatusPago: "debe" },
    { nombre: "VECINO DE BRANDON", celular: "", megas: "10 MB", instalacion: "2026-03-28", diaPago: 30, monto: 500, estatusPago: "debe" },
    { nombre: "CASA 17 CARMEN LAVANDERIA", celular: "9841003920", megas: "10 MB", instalacion: "2026-09-16", diaPago: 16, monto: 500, estatusPago: "debe" },
    { nombre: "PERRUCHA", celular: "9842046584", megas: "5 MB", instalacion: "2026-10-22", diaPago: 30, monto: 500, estatusPago: "pagado" }
  ];

  /**
   * construirSeed: construye el array de clientes del SEED.
   * Para generar casos realistas de 'vencido'/'proximo', ajustamos
   * algunas fechas de proximo pago en relacion con 'hoy'.
   * @returns {Array<Object>}
   */
  function construirSeed() {
    var hoy = new Date();
    var clientes = SEED_RAW.map(function (fila) {
      var cliente = crearCliente({
        nombre: fila.nombre,
        celular: fila.celular,
        direccion: "", // ubicacion real no provista; dejar generica/vacia
        ip: fila.ip || "",
        tipoConexion: fila.tipoConexion || "",
        apId: fila.apId || "",
        megas: fila.megas,
        monto: fila.monto,
        fechaInstalacion: fila.instalacion,
        // diaPago explicito de la fila (columna "DIAS POR PAGAR"); crearCliente
        // lo respeta y NO cae al dia de la fecha de instalacion.
        diaPago: fila.diaPago,
        tipoPago: "Directo", // default financiero para todos (ver nota del SEED)
        estatus: "Activo",   // todos Activos por ahora
        socio: fila.socio    // undefined -> 'Carlos' por default
      });
      // Guardar la marca de pago de la fila para aplicarEscenarios (no se
      // persiste como campo del cliente; se consume y descarta abajo).
      cliente._estatusPago = fila.estatusPago;
      return cliente;
    });

    // Aplicar la interpretacion de pago (al corriente vs vencido) segun la
    // marca de la fila, sin depender de indices fijos del dataset.
    aplicarEscenarios(clientes, hoy);

    // Limpiar la marca auxiliar antes de devolver/persistir.
    clientes.forEach(function (c) { delete c._estatusPago; });
    return clientes;
  }

  /**
   * aplicarEscenarios: deja a TODOS los clientes del SEED como ATRASADOS del
   * MES EN CURSO.
   *
   * Decision de negocio (cobranza por mes calendario, confirmada por el
   * usuario): el estado "atrasado/al corriente" ya NO depende de la fecha de
   * vencimiento rodante individual, sino de si existe un PAGO (movimiento
   * esPago) con el periodo del mes en curso. Como al sembrar/reiniciar la
   * lista de movimientos queda VACIA, ningun cliente tiene un pago del mes
   * actual y, por tanto, los 18 aparecen en "Faltan por pagar (mes en curso)".
   * El usuario los ira marcando manualmente con el boton "Pagar".
   *
   * Por eso la marca '_estatusPago' del SEED ('pagado'/'debe') ya NO crea un
   * pago del mes en curso: solo la usamos para fijar una fechaProximoPago
   * historica coherente de cara al display (no afecta la cobranza):
   *  - a nadie se le pone 'ultimoPago' (no hay pago del ciclo actual).
   *  - fechaProximoPago se fija al dia de pago del mes en curso, de modo que
   *    la ficha muestre un vencimiento del mes que efectivamente deben.
   * Al cambiar de mes natural, la ausencia de un pago con el periodo del nuevo
   * mes vuelve a marcarlos atrasados automaticamente (reinicio natural).
   */
  function aplicarEscenarios(clientes, hoy) {
    clientes.forEach(function (c) {
      // Nadie tiene pago del ciclo actual: todos quedan atrasados del mes.
      c.ultimoPago = "";
      // Vencimiento en el mes en curso (dia de pago del cliente), solo para el
      // display de la ficha; NO determina el estado de cobranza.
      var dia = Number(c.diaPago) || hoy.getDate();
      c.fechaProximoPago = fechaISO(
        fechaConDiaDeMes(hoy.getFullYear(), hoy.getMonth(), dia)
      );
    });
  }

  /* ----------------------------------------------------------
     9. Inicializacion (siembra el SEED solo en la primera carga)
     ---------------------------------------------------------- */

  /**
   * sembrarSiHaceFalta: si 'pcc.clientes' no existe en localStorage,
   * siembra el SEED, la config por defecto y el tema por defecto.
   * No sobrescribe datos existentes del usuario.
   * @returns {boolean} true si se sembro, false si ya existian datos
   */
  function sembrarSiHaceFalta() {
    var yaExiste = false;
    try {
      yaExiste =
        typeof localStorage !== "undefined" &&
        localStorage.getItem(STORAGE_KEYS.clientes) != null;
    } catch (e) {
      yaExiste = false;
    }

    if (yaExiste) {
      return false;
    }

    guardarClientes(construirSeed());
    guardarMovimientos([]);
    guardarConfig(clonar(CONFIG_DEFAULT));
    setTheme(THEME_DEFAULT);
    return true;
  }

  /**
   * reiniciarDatosEjemplo: fuerza el reemplazo de los datos por el SEED.
   * Usado luego por la pantalla de Configuracion (FEAT-003).
   *
   * IMPORTANTE: escribe a traves de las PROPIEDADES del namespace
   * (PCC.guardarClientes / PCC.guardarMovimientos / PCC.guardarConfig),
   * NO de los closures internos. firebase-sync.js parchea esas propiedades
   * para espejar a Firestore; si usaramos los closures internos el reinicio
   * solo tocaria localStorage y los 18 clientes NO llegarian a la nube.
   * Con las propiedades parcheadas, "Reiniciar datos de ejemplo" sobrescribe
   * clientes y vacia movimientos tambien en Firestore. Si el namespace aun
   * no esta disponible (p. ej. durante el arranque del nucleo), caemos a los
   * closures internos para no romper. El flag _aplicandoSnapshot interno de
   * firebase-sync sigue evitando reenviar snapshots remotos (no hay bucle).
   */
  function reiniciarDatosEjemplo() {
    var ns = typeof PCC !== "undefined" && PCC ? PCC : null;
    var setClientes =
      ns && typeof ns.guardarClientes === "function"
        ? ns.guardarClientes
        : guardarClientes;
    var setMovimientos =
      ns && typeof ns.guardarMovimientos === "function"
        ? ns.guardarMovimientos
        : guardarMovimientos;
    var setConfig =
      ns && typeof ns.guardarConfig === "function"
        ? ns.guardarConfig
        : guardarConfig;

    setClientes(construirSeed());
    setMovimientos([]);
    setConfig(clonar(CONFIG_DEFAULT));
    return true;
  }

  /* ----------------------------------------------------------
     10. Namespace global window.PCC
     ------------------------------------------------------------
     Punto de enganche para FEAT-002 (UI) y FEAT-003 (interactividad).
     ---------------------------------------------------------- */
  var PCC = {
    // Constantes
    STORAGE_KEYS: STORAGE_KEYS,
    CONFIG_DEFAULT: CONFIG_DEFAULT,
    MONTO_DEFAULT: MONTO_DEFAULT,
    THEME_DEFAULT: THEME_DEFAULT,

    // Utilidades de formato
    formatoMoneda: formatoMoneda,
    formatoFechaLarga: formatoFechaLarga,
    formatoFechaCorta: formatoFechaCorta,

    // Helpers de fecha
    aFecha: aFecha,
    fechaISO: fechaISO,
    aMedianoche: aMedianoche,
    diferenciaEnDias: diferenciaEnDias,
    sumarMeses: sumarMeses,

    // Modelo
    crearCliente: crearCliente,
    generarId: generarId,

    // Topologia de red (reutilizada por el mapa en FEAT-003)
    RED_IDS: RED_IDS,
    TIPOS_CONEXION: TIPOS_CONEXION,
    TOPOLOGIA: TOPOLOGIA,

    // Calculos de negocio
    calcularProximoPago: calcularProximoPago,
    diasRestantes: diasRestantes,
    estadoPago: estadoPago,
    textoDiasCobranza: textoDiasCobranza,
    compararUrgencia: compararUrgencia,

    // Facturacion objetivo (potencial de cobro mensual)
    facturacionTotalMensual: facturacionTotalMensual,

    // Cobranza por mes calendario (regla principal de estado)
    mesDe: mesDe,
    pagoDelMes: pagoDelMes,
    estaAtrasado: estaAtrasado,

    // Reparto de fin de mes entre socios
    luzAplicaEnMes: luzAplicaEnMes,
    gastosFijosDelMes: gastosFijosDelMes,
    calcularReparto: calcularReparto,
    calcularRepartoPrevisto: calcularRepartoPrevisto,

    // Historial de meses (logica pura; la UI la consume en FEAT-002)
    resumenMensual: resumenMensual,
    construirHistorial: construirHistorial,
    leerHistorialManual: leerHistorialManual,
    guardarMesManual: guardarMesManual,
    eliminarMesManual: eliminarMesManual,

    // Registrar / revertir pagos
    construirMovimientoPago: construirMovimientoPago,
    revertirPago: revertirPago,

    // Recibos (folio, periodo y datos de render)
    periodoPorDefecto: periodoPorDefecto,
    formatoPeriodo: formatoPeriodo,
    generarFolio: generarFolio,
    datosRecibo: datosRecibo,
    textoWhatsAppRecibo: textoWhatsAppRecibo,

    // Persistencia
    cargarClientes: cargarClientes,
    guardarClientes: guardarClientes,
    cargarMovimientos: cargarMovimientos,
    guardarMovimientos: guardarMovimientos,
    cargarConfig: cargarConfig,
    guardarConfig: guardarConfig,
    getTheme: getTheme,
    setTheme: setTheme,

    // Inicializacion / datos de ejemplo
    construirSeed: construirSeed,
    sembrarSiHaceFalta: sembrarSiHaceFalta,
    reiniciarDatosEjemplo: reiniciarDatosEjemplo
  };

  // Exponer el namespace de forma segura (navegador / entorno sin window).
  if (typeof window !== "undefined") {
    window.PCC = PCC;
  } else if (typeof globalThis !== "undefined") {
    globalThis.PCC = PCC;
  }

  // Sembrar datos de ejemplo en la primera carga del navegador.
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    try {
      sembrarSiHaceFalta();
    } catch (e) {
      // Entornos restringidos (file:// con storage deshabilitado): ignorar.
    }
  }
})();

/* ============================================================
   Panel de Control de Clientes - Capa de interactividad (FEAT-003)
   ------------------------------------------------------------
   Esta IIFE consume el nucleo window.PCC (FEAT-001) y el DOM de
   FEAT-002 para cablear TODA la interactividad:
     - render() principal (resumen, estadisticas, pagos, clientes,
       detalle de movimientos)
     - Estado de UI en memoria (mes, busqueda, filtro, orden, pestana)
     - Navegacion de mes, busqueda, chips de filtro con conteos, orden
     - CRUD de clientes via modal + acciones por tarjeta
       (Avisar WhatsApp, Pagar, editar, pausar/reanudar, eliminar)
     - Movimientos (gasto / ingreso / ahorro)
     - Exportar a CSV
     - Modo oscuro persistente y modal de Configuracion
   No reescribe el nucleo: se engancha tras DOMContentLoaded.
   ============================================================ */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") {
    return; // Entorno sin DOM (ej. 'node --check'): no hacer nada.
  }

  var PCC = window.PCC;
  if (!PCC) {
    return; // El nucleo no esta disponible: abortar con seguridad.
  }

  /* ----------------------------------------------------------
     Helpers cortos de DOM
     ---------------------------------------------------------- */
  function $(sel, ctx) {
    return (ctx || document).querySelector(sel);
  }
  function $all(sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  }

  /**
   * iconoSVG(nombre, claseExtra): markup de un icono SVG de linea (FEAT-002)
   * via el helper global window.PCC_ICONOS (sprite #pcc-iconos-sprite). Si el
   * helper no esta cargado por algun motivo, devuelve "" para no romper el
   * render. Se usa en el markup que genera la capa UI (encabezados de grupo,
   * boton de tema, pausar/reanudar, filas de recibo). Los SVG salen con
   * fill="none" + stroke="currentColor", por lo que heredan el color del
   * tema (claro/oscuro).
   */
  function iconoSVG(nombre, claseExtra) {
    if (typeof window !== "undefined" && window.PCC_ICONOS) {
      return window.PCC_ICONOS.svg(nombre, claseExtra);
    }
    return "";
  }

  var MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
  ];

  function nombreMesAnio(fecha) {
    var mes = MESES[fecha.getMonth()] || "";
    var titulo = mes.charAt(0).toUpperCase() + mes.slice(1);
    return titulo + " de " + fecha.getFullYear();
  }

  function inicioDeMes(fecha) {
    return new Date(fecha.getFullYear(), fecha.getMonth(), 1);
  }

  function finDeMes(fecha) {
    return new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0);
  }

  function mismoMes(a, b) {
    if (!a || !b) {
      return false;
    }
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }

  /* ----------------------------------------------------------
     Estado de UI en memoria
     ---------------------------------------------------------- */
  var estado = {
    mesSeleccionado: inicioDeMes(new Date()),
    terminoBusqueda: "",
    filtroActivo: "todos",
    ordenActual: "proximo",
    pestanaMovimiento: "gastos"
  };

  // Fecha "hoy" fijada al cargar (coherencia entre calculos del render).
  var HOY = new Date();

  /* ----------------------------------------------------------
     Acceso a datos (siempre desde localStorage via PCC)
     ---------------------------------------------------------- */
  function clientes() {
    return PCC.cargarClientes();
  }
  function movimientos() {
    return PCC.cargarMovimientos();
  }
  function clientePorId(id) {
    var lista = clientes();
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === id) {
        return lista[i];
      }
    }
    return null;
  }
  function movimientoPorId(id) {
    var movs = movimientos();
    for (var i = 0; i < movs.length; i++) {
      if (movs[i] && movs[i].id === id) {
        return movs[i];
      }
    }
    return null;
  }

  /* ----------------------------------------------------------
     Criterio UNICO de "atrasado" (cobranza por MES CALENDARIO)
     ------------------------------------------------------------
     Regla confirmada por el usuario (OPCION A): un cliente esta
     "atrasado/vencido" si esta Activo y NO ha registrado un pago del MES
     EN CURSO (el mes de HOY). Ya NO se usa la fecha de vencimiento rodante
     individual para decidir el estado de cobranza. Un cliente Pausado
     NUNCA cuenta como atrasado: no se le cobra mientras esta en pausa.

     Esta funcion se usa en TODOS los conteos y vistas de cobranza (chip
     "Vencidos" = faltan por pagar este mes, estadistica de vencidos/al
     corriente, panel de Pagos y los dos bloques de la lista de clientes)
     para que todo sea coherente. 'movs' es opcional: si no se pasa, se
     cargan desde PCC (util para pruebas y llamadas sueltas).
     ---------------------------------------------------------- */
  function esVencido(cliente, movs) {
    movs = Array.isArray(movs) ? movs : movimientos();
    return PCC.estaAtrasado(cliente, movs, HOY);
  }

  /* ----------------------------------------------------------
     Normalizacion de celular para WhatsApp (MX)
     ---------------------------------------------------------- */
  function normalizarCelular(celular) {
    var digitos = String(celular || "").replace(/\D+/g, "");
    if (!digitos) {
      return "";
    }
    // Si son 10 digitos (numero nacional MX), anteponer el codigo de pais 52.
    if (digitos.length === 10) {
      return "52" + digitos;
    }
    return digitos;
  }

  /* ==========================================================
     RENDER PRINCIPAL
     ========================================================== */
  function render() {
    var lista = clientes();
    var movs = movimientos();
    var cfg = PCC.cargarConfig();

    renderResumen(lista, movs);
    renderPrevisto(lista, cfg);
    renderReparto(lista, movs, cfg);
    renderEstadisticas(lista, movs);
    renderPagos(lista, movs);
    renderClientes(lista, movs);
    renderDetalle(movs);
    renderBadgeAviso(cfg);
  }

  /* ---------------------- Resumen del mes ------------------- */
  function renderResumen(lista, movs) {
    var mes = estado.mesSeleccionado;
    var tituloMes = nombreMesAnio(mes);
    var elMesResumen = $("#resumen-mes");
    if (elMesResumen) {
      elMesResumen.textContent = tituloMes;
    }
    var elDetalleMes = $("#detalle-mes");
    if (elDetalleMes) {
      elDetalleMes.textContent = tituloMes;
    }

    var ingresos = 0;
    var egresos = 0;
    movs.forEach(function (m) {
      var f = PCC.aFecha(m.fecha);
      if (!f || !mismoMes(f, mes)) {
        return;
      }
      var monto = Number(m.monto) || 0;
      if (m.tipo === "ingreso") {
        ingresos += monto;
      } else if (m.tipo === "gasto") {
        egresos += monto;
      }
    });

    var ganancia = ingresos - egresos;

    // Por cobrar: clientes activos cuyo proximo pago cae hasta fin del mes
    // seleccionado y que no estan pagados (sin pago que cubra ese ciclo).
    var finMes = PCC.aMedianoche(finDeMes(mes));
    var porCobrar = 0;
    lista.forEach(function (c) {
      if (c.estatus !== "Activo") {
        return;
      }
      var vence = PCC.aFecha(c.fechaProximoPago);
      if (!vence) {
        return;
      }
      if (PCC.aMedianoche(vence).getTime() <= finMes.getTime()) {
        var est = PCC.estadoPago(c, HOY);
        if (est.clase !== "pagado") {
          porCobrar += Number(c.monto) || 0;
        }
      }
    });

    // Facturacion total del mes: potencial de cobro = suma de cuotas
    // (monto) de los clientes activos. Es la facturacion OBJETIVO (lo que
    // entraria si todos pagaran). Es informativa: no cambia por mes y no
    // afecta el reparto ni la ganancia. La diferencia con "Ingresos"
    // (lo cobrado real) es lo que todavia falta por cobrar.
    var facturacion = PCC.facturacionTotalMensual(lista);

    setTexto("#metrica-ingresos", PCC.formatoMoneda(ingresos));
    setTexto("#metrica-egresos", PCC.formatoMoneda(egresos));
    setTexto("#metrica-ganancia", PCC.formatoMoneda(ganancia));
    setTexto("#metrica-porcobrar", PCC.formatoMoneda(porCobrar));
    setTexto("#metrica-facturacion", PCC.formatoMoneda(facturacion));
  }

  /* ---------------------- Reparto PREVISTO del mes ---------- */
  // Panel visible desde el inicio: cuanto le toca a cada socio sobre la
  // FACTURACION total del mes (si todos pagan), reutilizando la formula del
  // reparto real via PCC.calcularRepartoPrevisto. La facturacion usa el padron
  // actual de clientes; la luz depende del mes seleccionado.
  function renderPrevisto(lista, cfg) {
    var mes = estado.mesSeleccionado;
    var elMes = $("#previsto-mes");
    if (elMes) {
      elMes.textContent = nombreMesAnio(mes);
    }

    var p = PCC.calcularRepartoPrevisto(inicioDeMes(mes), lista, cfg);

    setTexto("#previsto-facturacion", PCC.formatoMoneda(p.facturacion));
    setTexto("#previsto-gastos", PCC.formatoMoneda(p.gastosFijos));
    setTexto("#previsto-octavio", PCC.formatoMoneda(p.pagosOctavioPrevisto));
    setTexto("#previsto-ganancia", PCC.formatoMoneda(p.gananciaPrevista));
    setTexto("#previsto-mitad", PCC.formatoMoneda(p.mitad));
    setTexto("#previsto-carlos", PCC.formatoMoneda(p.totalCarlos));
    setTexto("#previsto-octavio-total", PCC.formatoMoneda(p.totalOctavio));

    var nota = $("#previsto-gastos-nota");
    if (nota) {
      nota.textContent = p.luzAplica
        ? "Incluye luz este mes"
        : "Sin luz este mes";
      nota.classList.toggle("reparto__nota--aplica", !!p.luzAplica);
    }
  }

  /* ---------------------- Reparto de fin de mes ------------- */
  function renderReparto(lista, movs, cfg) {
    var mes = estado.mesSeleccionado;
    var elMes = $("#reparto-mes");
    if (elMes) {
      elMes.textContent = nombreMesAnio(mes);
    }

    // El nucleo (PCC.calcularReparto) hace todo el calculo de negocio
    // sobre el primer dia del mes seleccionado. La UI solo formatea.
    var r = PCC.calcularReparto(inicioDeMes(mes), lista, movs, cfg);

    setTexto("#reparto-ingresos", PCC.formatoMoneda(r.ingresosMes));
    setTexto("#reparto-starlink", PCC.formatoMoneda(r.starlink));
    setTexto("#reparto-luz", PCC.formatoMoneda(r.luz));
    setTexto("#reparto-pagos-octavio", PCC.formatoMoneda(r.pagosOctavio));
    setTexto("#reparto-ganancia", PCC.formatoMoneda(r.gananciaRepartir));
    setTexto("#reparto-mitad", PCC.formatoMoneda(r.mitadCarlos));
    setTexto("#reparto-total-carlos", PCC.formatoMoneda(r.totalCarlos));
    setTexto("#reparto-total-octavio", PCC.formatoMoneda(r.totalOctavio));

    var nota = $("#reparto-luz-nota");
    if (nota) {
      nota.textContent = r.luzAplica ? "Aplica este mes" : "No aplica este mes";
      nota.classList.toggle("reparto__nota--aplica", !!r.luzAplica);
    }
  }

  /* ---------------------- Estadisticas ---------------------- */
  function renderEstadisticas(lista, movs) {
    var mes = estado.mesSeleccionado;
    var activos = 0;
    var pausados = 0;
    var corriente = 0;
    var vencidos = 0;
    var ptp = 0;
    var directo = 0;

    lista.forEach(function (c) {
      if (c.estatus === "Pausado") {
        pausados += 1;
      } else {
        activos += 1;
      }
      if (c.tipoPago === "PTP") {
        ptp += 1;
      } else if (c.tipoPago === "Directo") {
        directo += 1;
      }
      // Cobranza por mes calendario (ver esVencido / PCC.estaAtrasado):
      //  - "vencidos"  = Activos que NO han pagado el mes en curso.
      //  - "corriente" = Activos que SI pagaron el mes en curso.
      // Un Pausado no cuenta ni como vencido ni como al corriente (no se le
      // cobra mientras esta en pausa).
      if (c.estatus === "Activo") {
        if (esVencido(c, movs)) {
          vencidos += 1;
        } else {
          corriente += 1;
        }
      }
    });

    var cobrados = 0;
    var ahorro = 0;
    movs.forEach(function (m) {
      var f = PCC.aFecha(m.fecha);
      if (!f || !mismoMes(f, mes)) {
        return;
      }
      // "Pagos cobrados este mes" cuenta SOLO los ingresos marcados con
      // esPago=true, es decir, los cobros registrados con el boton "Pagar"
      // de una tarjeta de cliente. Es intencional: un ingreso manual
      // (modal "Nuevo Ingreso") no representa el cobro de una mensualidad,
      // asi que no incrementa este contador (aunque si suma a "Ingresos").
      if (m.tipo === "ingreso" && m.esPago) {
        cobrados += 1;
      }
      if (m.tipo === "ahorro") {
        ahorro += Number(m.monto) || 0;
      }
    });

    setTexto("#stat-activos", String(activos));
    setTexto("#stat-pausados", String(pausados));
    setTexto("#stat-mes-corriente", String(corriente));
    setTexto("#stat-mes-vencidos", String(vencidos));
    setTexto("#stat-mes-cobrados", String(cobrados));
    setTexto("#stat-mes-ptp", String(ptp));
    setTexto("#stat-mes-directo", String(directo));
    setTexto("#stat-mes-ahorro", PCC.formatoMoneda(ahorro));
  }

  /* ---------------------- Pagos proximos/vencidos ----------- */
  function renderPagos(lista, movs) {
    movs = Array.isArray(movs) ? movs : movimientos();
    var contenedor = $("#lista-pagos");
    var vacio = $("#pagos-vacio");
    if (!contenedor) {
      return;
    }

    // Cobranza por mes calendario: lista a los Activos que FALTAN por pagar
    // el mes en curso (atrasados). Los Pausados quedan fuera: mismo criterio
    // que esVencido() usa en chips y estadisticas, para que todo sea
    // coherente. Al marcar "Pagar" el cliente deja de faltar y sale de aqui.
    var pendientes = lista.filter(function (c) {
      return esVencido(c, movs);
    });

    // Ordenar por urgencia (helper puro PCC.compararUrgencia): mas vencido
    // primero (diasRestantes ascendente -> los mas negativos arriba), luego
    // los que vencen pronto y al final los que aun les faltan dias.
    pendientes.sort(function (a, b) {
      return PCC.compararUrgencia(a, b, HOY);
    });

    // Resumen de la cabecera: cuantos faltan por pagar y la suma de sus cuotas.
    var numVencidos = pendientes.length;
    var montoVencidos = 0;
    pendientes.forEach(function (c) {
      montoVencidos += Number(c.monto) || 0;
    });
    setTexto("#pagos-resumen-num", String(numVencidos));
    setTexto("#pagos-resumen-monto", PCC.formatoMoneda(montoVencidos));

    limpiarTarjetas(contenedor, vacio);

    if (pendientes.length === 0) {
      if (vacio) {
        vacio.hidden = false;
      }
      return;
    }
    if (vacio) {
      vacio.hidden = true;
    }
    pendientes.forEach(function (c) {
      contenedor.appendChild(crearTarjeta(c));
    });
  }

  /* ---------------------- Clientes (busqueda/filtro/orden) -- */
  function renderClientes(lista, movs) {
    movs = Array.isArray(movs) ? movs : movimientos();
    // Conteos de los chips (sobre toda la cartera, independientes de la
    // busqueda, para que reflejen la totalidad por categoria). El chip
    // "Vencidos" cuenta a los Activos que FALTAN por pagar el mes en curso.
    var conteos = {
      todos: lista.length,
      activos: 0,
      pausados: 0,
      vencidos: 0,
      ptp: 0,
      directo: 0
    };
    lista.forEach(function (c) {
      if (c.estatus === "Pausado") {
        conteos.pausados += 1;
      } else {
        conteos.activos += 1;
      }
      if (c.tipoPago === "PTP") {
        conteos.ptp += 1;
      } else if (c.tipoPago === "Directo") {
        conteos.directo += 1;
      }
      if (esVencido(c, movs)) {
        conteos.vencidos += 1;
      }
    });
    setTexto("#cuenta-todos", String(conteos.todos));
    setTexto("#cuenta-activos", String(conteos.activos));
    setTexto("#cuenta-pausados", String(conteos.pausados));
    setTexto("#cuenta-vencidos", String(conteos.vencidos));
    setTexto("#cuenta-ptp", String(conteos.ptp));
    setTexto("#cuenta-directo", String(conteos.directo));

    // Aplicar filtro por chip. El chip "Vencidos" = faltan por pagar el mes.
    var filtrados = lista.filter(function (c) {
      switch (estado.filtroActivo) {
        case "activos":
          return c.estatus === "Activo";
        case "pausados":
          return c.estatus === "Pausado";
        case "vencidos":
          return esVencido(c, movs);
        case "ptp":
          return c.tipoPago === "PTP";
        case "directo":
          return c.tipoPago === "Directo";
        default:
          return true;
      }
    });

    // Aplicar busqueda (nombre / celular / direccion / ip).
    var termino = estado.terminoBusqueda.trim().toLowerCase();
    if (termino) {
      filtrados = filtrados.filter(function (c) {
        var campos = [c.nombre, c.celular, c.direccion, c.ip];
        return campos.some(function (v) {
          return String(v || "").toLowerCase().indexOf(termino) !== -1;
        });
      });
    }

    // Aplicar orden.
    filtrados.sort(function (a, b) {
      if (estado.ordenActual === "nombre") {
        return String(a.nombre).localeCompare(String(b.nombre), "es");
      }
      if (estado.ordenActual === "monto") {
        return (Number(b.monto) || 0) - (Number(a.monto) || 0);
      }
      // 'proximo' (default): por urgencia (helper puro). diasRestantes
      // ascendente -> mas vencido primero. Como el bloque "Faltan por pagar"
      // se construye filtrando este array ya ordenado, queda de mas vencido a
      // menos sin reordenar.
      return PCC.compararUrgencia(a, b, HOY);
    });

    var contenedor = $("#lista-clientes");
    var vacio = $("#clientes-vacio");
    if (!contenedor) {
      return;
    }
    limpiarTarjetas(contenedor, vacio);

    if (filtrados.length === 0) {
      if (vacio) {
        vacio.hidden = false;
      }
      return;
    }
    if (vacio) {
      vacio.hidden = true;
    }

    // Separacion visual por cobranza del mes en curso. Cuando el filtro por
    // chip permite ver atrasados y al corriente juntos ("todos" o "activos"),
    // se muestran DOS bloques con encabezado: primero "Faltan por pagar"
    // (arriba, acento rojo) y luego "Ya pagaron". En los demas filtros
    // (Pausados, PTP, Directo, Vencidos) se pinta una lista plana, pues el
    // propio filtro ya acota el conjunto. Al marcar Pagar y re-renderizar, el
    // cliente salta del bloque "faltan" al bloque "ya pagaron".
    var mesTexto = (MESES[HOY.getMonth()] || "").toLowerCase();
    var usaBloques =
      estado.filtroActivo === "todos" || estado.filtroActivo === "activos";

    if (!usaBloques) {
      filtrados.forEach(function (c) {
        contenedor.appendChild(crearTarjeta(c, movs));
      });
      return;
    }

    // Tres grupos: (1) Activos que FALTAN por pagar el mes (arriba, rojo),
    // (2) Activos que YA pagaron el mes (verde) y (3) Pausados (no se les
    // cobra, van al final sin entrar en ninguno de los dos cobros).
    var faltan = filtrados.filter(function (c) {
      return c.estatus === "Activo" && esVencido(c, movs);
    });
    var pagaron = filtrados.filter(function (c) {
      return c.estatus === "Activo" && !esVencido(c, movs);
    });
    var pausados = filtrados.filter(function (c) {
      return c.estatus === "Pausado";
    });

    // El bloque "Faltan por pagar" SIEMPRE se muestra por urgencia (mas
    // vencido primero), aunque el usuario elija ordenar por nombre o monto:
    // asi lo mas atrasado queda arriba del todo. Con el orden por defecto
    // ("por proximo pago") el array ya viene ordenado por urgencia, por lo
    // que este sort no cambia nada; con otros ordenes, reordena solo este
    // bloque de atrasados.
    faltan.sort(function (a, b) {
      return PCC.compararUrgencia(a, b, HOY);
    });

    if (faltan.length) {
      contenedor.appendChild(
        crearEncabezadoGrupo(
          "Faltan por pagar (" + mesTexto + ")",
          faltan.length,
          "grupo-clientes__titulo--faltan",
          "alerta"
        )
      );
      faltan.forEach(function (c) {
        contenedor.appendChild(crearTarjeta(c, movs));
      });
    }

    if (pagaron.length) {
      contenedor.appendChild(
        crearEncabezadoGrupo(
          "Ya pagaron (" + mesTexto + ")",
          pagaron.length,
          "grupo-clientes__titulo--pagaron",
          "check_circulo"
        )
      );
      pagaron.forEach(function (c) {
        contenedor.appendChild(crearTarjeta(c, movs));
      });
    }

    if (pausados.length) {
      contenedor.appendChild(
        crearEncabezadoGrupo("Pausados", pausados.length, "", "pausar")
      );
      pausados.forEach(function (c) {
        contenedor.appendChild(crearTarjeta(c, movs));
      });
    }
  }

  /**
   * crearEncabezadoGrupo(texto, cuenta, claseExtra): crea el subtitulo de un
   * bloque de la lista de clientes ("Faltan por pagar" / "Ya pagaron") con el
   * conteo entre parentesis. Ocupa una fila completa del grid.
   */
  function crearEncabezadoGrupo(texto, cuenta, claseExtra, icono) {
    var h = document.createElement("h3");
    h.className = "grupo-clientes__titulo " + (claseExtra || "");
    // Icono SVG de linea al inicio (decorativo) + texto y conteo entre
    // "·" como antes. El texto va en su propio <span> para no mezclar el
    // SVG con el nodo de texto.
    var txt = texto + " · " + cuenta;
    if (icono) {
      h.innerHTML =
        '<span class="grupo-clientes__icono" aria-hidden="true">' +
        iconoSVG(icono) +
        "</span>";
      var etiqueta = document.createElement("span");
      etiqueta.className = "grupo-clientes__texto";
      etiqueta.textContent = txt;
      h.appendChild(etiqueta);
    } else {
      h.textContent = txt;
    }
    return h;
  }

  /* ---------------------- Detalle de movimientos ------------ */
  function renderDetalle(movs) {
    var tab = estado.pestanaMovimiento; // 'gastos' | 'ingresos' | 'ahorros'
    var tipo = tab === "gastos" ? "gasto" : tab === "ingresos" ? "ingreso" : "ahorro";
    var etiqueta =
      tab === "gastos" ? "Gastos" : tab === "ingresos" ? "Ingresos" : "Ahorros";
    setTexto("#detalle-tipo", etiqueta);

    var mes = estado.mesSeleccionado;
    var delMes = movs.filter(function (m) {
      if (m.tipo !== tipo) {
        return false;
      }
      var f = PCC.aFecha(m.fecha);
      return f && mismoMes(f, mes);
    });

    // Mas recientes primero.
    delMes.sort(function (a, b) {
      var fa = PCC.aFecha(a.fecha);
      var fb = PCC.aFecha(b.fecha);
      return (fb ? fb.getTime() : 0) - (fa ? fa.getTime() : 0);
    });

    var total = delMes.reduce(function (acc, m) {
      return acc + (Number(m.monto) || 0);
    }, 0);
    setTexto("#detalle-total", PCC.formatoMoneda(total));

    var contenedor = $("#lista-movimientos");
    var vacio = $("#detalle-vacio");
    if (!contenedor) {
      return;
    }
    limpiarTarjetas(contenedor, vacio);

    if (delMes.length === 0) {
      if (vacio) {
        vacio.textContent =
          tab === "gastos"
            ? "No hay gastos registrados este mes."
            : tab === "ingresos"
            ? "No hay ingresos registrados este mes."
            : "No hay ahorros registrados este mes.";
        vacio.hidden = false;
      }
      return;
    }
    if (vacio) {
      vacio.hidden = true;
    }
    delMes.forEach(function (m) {
      contenedor.appendChild(crearTarjetaMovimiento(m));
    });
  }

  function renderBadgeAviso(cfg) {
    var dias = cfg && cfg.diasAviso != null ? Number(cfg.diasAviso) : 3;
    setTexto("#pagos-badge-aviso", "Aviso: " + dias + (dias === 1 ? " día antes" : " días antes"));
  }

  /* ==========================================================
     CONSTRUCCION DE TARJETAS
     ========================================================== */
  var tplTarjeta = $("#tpl-tarjeta-cliente");

  /**
   * estadoCobranza(cliente, movs): resuelve el badge de cobranza de una
   * tarjeta. La PERTENENCIA (falta por pagar vs ya pago) sigue siendo por MES
   * CALENDARIO (esVencido / PCC.estaAtrasado); lo que cambia aqui es el
   * DETALLE que se muestra:
   *  - Pausado         -> { 'ok',      'Pausado' }
   *  - Activo atrasado -> dias contra SU vencimiento del mes (diaPago), via
   *                       PCC.textoDiasCobranza(diasRestantes): "Vencido hace
   *                       N días" (rojo) / "Vence hoy|mañana|en N días"
   *                       (ambar) / "Faltan N días" (neutro).
   *  - Activo al dia   -> { 'pagado',  'Pagado (<mes>)' } (ya pago el mes)
   * El <mes> es el mes en curso (HOY). 'clase' reutiliza las clases CSS
   * existentes (estado-vencido / estado-proximo / estado-pagado / estado-ok).
   */
  function estadoCobranza(cliente, movs) {
    var mesTexto = (MESES[HOY.getMonth()] || "").toLowerCase();
    if (cliente && cliente.estatus === "Pausado") {
      return { clase: "ok", texto: "Pausado" };
    }
    if (esVencido(cliente, movs)) {
      // Falta por pagar el mes (criterio por mes calendario). El TEXTO detalla
      // los dias contra su fecha de vencimiento individual del mes (diaPago).
      var dias = PCC.diasRestantes(cliente, HOY);
      return PCC.textoDiasCobranza(dias);
    }
    return { clase: "pagado", texto: "Pagado (" + mesTexto + ")" };
  }

  function crearTarjeta(cliente, movs) {
    movs = Array.isArray(movs) ? movs : movimientos();
    var frag = tplTarjeta.content.cloneNode(true);
    var art = frag.querySelector(".tarjeta");
    var est = estadoCobranza(cliente, movs);

    art.setAttribute("data-id", cliente.id);
    art.classList.add("tarjeta--" + est.clase);

    $(".tarjeta__nombre", art).textContent = cliente.nombre || "(sin nombre)";
    $(".tarjeta__megas", art).textContent =
      (cliente.megas || "") + (cliente.estatus === "Pausado" ? " · Pausado" : "");

    var badge = $(".tarjeta__estado", art);
    badge.className = "badge tarjeta__estado estado-" + est.clase;
    badge.textContent = est.texto;

    $(".tarjeta__monto", art).textContent = PCC.formatoMoneda(cliente.monto);
    $(".tarjeta__fecha", art).textContent = PCC.formatoFechaLarga(
      cliente.fechaProximoPago
    );
    $(".etiqueta-tipo", art).textContent = cliente.tipoPago || "";
    var socioEl = $(".etiqueta-socio", art);
    if (socioEl) {
      var socio = cliente.socio === "Octavio" ? "Octavio" : "Carlos";
      socioEl.textContent = "Paga a: " + socio;
      socioEl.classList.toggle("etiqueta-socio--octavio", socio === "Octavio");
    }

    // Texto del boton pausar/reanudar segun estatus.
    var btnPausar = $(".accion-pausar", art);
    if (btnPausar) {
      if (cliente.estatus === "Pausado") {
        btnPausar.innerHTML = iconoSVG("reanudar");
        btnPausar.title = "Reanudar";
        btnPausar.setAttribute("aria-label", "Reanudar");
      } else {
        btnPausar.innerHTML = iconoSVG("pausar");
        btnPausar.title = "Pausar";
        btnPausar.setAttribute("aria-label", "Pausar");
      }
    }

    // Boton "Revertir pago": solo visible si el cliente tiene algun pago
    // registrado que se pueda deshacer (p.ej. pulsado por error).
    var btnRevertir = $(".accion-revertir", art);
    if (btnRevertir) {
      var tienePago = !!ultimoPagoDeCliente(cliente.id);
      btnRevertir.hidden = !tienePago;
    }

    return frag;
  }

  function crearTarjetaMovimiento(mov) {
    var art = document.createElement("article");
    art.className = "tarjeta tarjeta--movimiento";
    var claseMonto =
      mov.tipo === "gasto" ? "estado-vencido" : mov.tipo === "ingreso" ? "estado-pagado" : "estado-proximo";

    var cabecera = document.createElement("div");
    cabecera.className = "tarjeta__cabecera";

    var identidad = document.createElement("div");
    identidad.className = "tarjeta__identidad";
    var nombre = document.createElement("h3");
    nombre.className = "tarjeta__nombre";
    nombre.textContent = mov.concepto || "(sin concepto)";
    var fecha = document.createElement("span");
    fecha.className = "tarjeta__megas";
    fecha.textContent = PCC.formatoFechaLarga(mov.fecha);
    identidad.appendChild(nombre);
    identidad.appendChild(fecha);

    var badge = document.createElement("span");
    badge.className = "badge " + claseMonto;
    badge.textContent = PCC.formatoMoneda(mov.monto);

    cabecera.appendChild(identidad);
    cabecera.appendChild(badge);
    art.appendChild(cabecera);
    return art;
  }

  /* ==========================================================
     UTILIDADES DE RENDER
     ========================================================== */
  function setTexto(sel, texto) {
    var el = $(sel);
    if (el) {
      el.textContent = texto;
    }
  }

  // Elimina las tarjetas renderizadas conservando el nodo de estado vacio.
  function limpiarTarjetas(contenedor, nodoVacio) {
    var hijos = Array.prototype.slice.call(contenedor.children);
    hijos.forEach(function (h) {
      if (h !== nodoVacio) {
        contenedor.removeChild(h);
      }
    });
  }

  /* ==========================================================
     ACCIONES SOBRE CLIENTES
     ========================================================== */
  function accionAvisar(cliente) {
    var tel = normalizarCelular(cliente.celular);
    if (!tel) {
      window.alert("Este cliente no tiene un número de celular registrado.");
      return;
    }
    // Cobranza por MES CALENDARIO: el recordatorio es sobre el pago del MES
    // EN CURSO. "atrasado" = Activo que aun no paga el mes (esVencido).
    var atrasado = esVencido(cliente, movimientos());
    var mesTexto = (MESES[HOY.getMonth()] || "").toLowerCase();
    var montoTxt = PCC.formatoMoneda(cliente.monto);
    var mensaje =
      "Hola " +
      (cliente.nombre || "") +
      ", le recordamos su pago de internet de " +
      mesTexto +
      " por " +
      montoTxt +
      ". " +
      (atrasado
        ? "Aún no lo tenemos registrado este mes, agradecemos ponerse al corriente. "
        : "") +
      "¡Gracias!";
    var url =
      "https://wa.me/" + tel + "?text=" + encodeURIComponent(mensaje);
    window.open(url, "_blank");
  }

  /**
   * abrirModalPago(cliente): abre el modal de confirmacion de pago. Precarga
   * el id del cliente, prefija el monto con el del cliente y genera opciones
   * de periodo alrededor del periodo por defecto (meses anteriores y
   * siguientes), dejando preseleccionado el periodo por defecto.
   */
  function abrirModalPago(cliente) {
    setValor("#pago-cliente-id", cliente.id);
    setTexto("#pago-cliente-nombre", cliente.nombre || "");
    setValor("#pago-monto", cliente.monto != null ? cliente.monto : "");

    // Cobranza por MES CALENDARIO: por defecto el pago cubre el MES EN CURSO
    // (el mes de HOY), para que al pagar el cliente pase a "ya pago este mes"
    // y salga del bloque "Faltan por pagar". El usuario puede elegir otro mes
    // en el selector (meses alrededor) si necesita registrar un pago atrasado
    // o adelantado.
    var porDefecto = PCC.mesDe(HOY);
    var opciones = construirOpcionesPeriodo(porDefecto, 3, 3);
    var sel = $("#pago-periodo");
    if (sel) {
      sel.innerHTML = "";
      opciones.forEach(function (periodo) {
        var opt = document.createElement("option");
        opt.value = periodo;
        opt.textContent = PCC.formatoPeriodo(periodo) || periodo;
        if (periodo === porDefecto) {
          opt.selected = true;
        }
        sel.appendChild(opt);
      });
    }
    abrirModal("#modal-pago");
  }

  /**
   * construirOpcionesPeriodo(base, atras, adelante): devuelve una lista de
   * periodos 'YYYY-MM' que abarca 'atras' meses antes y 'adelante' meses
   * despues del periodo 'base', en orden cronologico. Determinista.
   */
  function construirOpcionesPeriodo(base, atras, adelante) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(base || ""));
    var ref;
    if (m) {
      ref = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    } else {
      ref = inicioDeMes(new Date());
    }
    var lista = [];
    for (var i = -atras; i <= adelante; i++) {
      var d = new Date(ref.getFullYear(), ref.getMonth() + i, 1);
      var mes = String(d.getMonth() + 1).padStart(2, "0");
      lista.push(d.getFullYear() + "-" + mes);
    }
    return lista;
  }

  /**
   * confirmarPago(ev): submit del modal de pago. Localiza al cliente, lee
   * periodo y monto, construye el movimiento con folio consecutivo, lo
   * guarda, avanza al cliente, re-renderiza y abre el recibo del pago
   * recien creado.
   */
  function confirmarPago(ev) {
    ev.preventDefault();
    var id = valor("#pago-cliente-id");
    var lista = clientes();
    var idx = -1;
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === id) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      return;
    }
    var c = lista[idx];

    var periodo = valor("#pago-periodo");
    var montoRaw = valor("#pago-monto");
    if (montoRaw === "" || isNaN(Number(montoRaw)) || Number(montoRaw) < 0) {
      window.alert("El monto debe ser un número válido.");
      return;
    }

    var hoyISO = PCC.fechaISO(new Date());

    // Construir el movimiento con periodo y folio consecutivo del anio.
    // El movimiento guarda el estado PREVIO del cliente para revertir.
    var movs = movimientos();
    var movimiento = PCC.construirMovimientoPago(c, hoyISO, {
      periodo: periodo,
      monto: Number(montoRaw),
      movimientos: movs
    });
    movs.push(movimiento);
    PCC.guardarMovimientos(movs);

    // Actualizar ultimoPago y recalcular proximo ciclo.
    c.ultimoPago = hoyISO;
    c.fechaProximoPago = PCC.fechaISO(PCC.calcularProximoPago(c, new Date()));
    PCC.guardarClientes(lista);

    cerrarModales();
    render();

    // Abrir el recibo del pago recien creado (con el cliente ya actualizado).
    mostrarRecibo(c, movimiento);
  }

  // Ultimo recibo mostrado: lo usan Imprimir y Enviar por WhatsApp.
  var _ultimoRecibo = null;

  // Recuerda si el recibo abierto proviene del historial. Si es asi, al
  // cerrarlo solo se oculta #modal-recibo y el historial queda visible debajo;
  // si proviene del flujo de pago, cerrarlo devuelve al panel (cierra todo).
  var _reciboVieneDeHistorial = false;

  /**
   * mostrarRecibo(cliente, movimientoPago, desdeHistorial): arma los datos del
   * recibo con el nucleo, pinta el contenido en #recibo y abre el modal del
   * recibo. Guarda el ultimo recibo mostrado (datos + cliente) para
   * Imprimir/WhatsApp y recuerda el origen (historial o flujo de pago) para
   * decidir como se cierra.
   */
  function mostrarRecibo(cliente, movimientoPago, desdeHistorial) {
    _reciboVieneDeHistorial = !!desdeHistorial;
    var datos = PCC.datosRecibo(cliente, movimientoPago, PCC.cargarConfig());
    _ultimoRecibo = { datos: datos, cliente: cliente };

    var negocio = datos.negocio || {};
    setTexto("#recibo-negocio-nombre", negocio.nombre || "");

    var elTel = $("#recibo-negocio-telefono");
    if (elTel) {
      elTel.textContent = negocio.telefono ? "Tel: " + negocio.telefono : "";
      elTel.hidden = !negocio.telefono;
    }
    var elDir = $("#recibo-negocio-direccion");
    if (elDir) {
      elDir.textContent = negocio.direccion || "";
      elDir.hidden = !negocio.direccion;
    }

    setTexto("#recibo-folio", datos.folio || "sin folio");
    setTexto("#recibo-fecha", datos.fechaEmisionLarga || "");
    setTexto("#recibo-cliente", datos.cliente ? datos.cliente.nombre : "");
    setTexto("#recibo-periodo", datos.periodoTexto || "Sin registro");
    setTexto("#recibo-concepto", datos.concepto || "");
    setTexto("#recibo-monto", datos.montoTexto || PCC.formatoMoneda(datos.monto));
    setTexto("#recibo-pie", negocio.pie || "");

    abrirModal("#modal-recibo");
  }

  /**
   * cerrarRecibo(): cierra solo #modal-recibo. Si el recibo se abrio desde el
   * historial, deja #modal-historial visible debajo (no saca al usuario al
   * panel); si vino del flujo de pago, no hay otro modal apilado, asi que
   * ocultar solo el recibo tambien devuelve al panel.
   */
  function cerrarRecibo() {
    var modal = $("#modal-recibo");
    if (modal) {
      modal.hidden = true;
    }
    _reciboVieneDeHistorial = false;
  }

  /**
   * imprimirRecibo(): lanza la impresion del navegador (el @media print deja
   * visible solo #recibo).
   */
  function imprimirRecibo() {
    window.print();
  }

  /**
   * enviarReciboWhatsApp(): abre WhatsApp con el resumen del recibo del
   * ultimo recibo mostrado, usando el celular del cliente normalizado (+52).
   */
  function enviarReciboWhatsApp() {
    if (!_ultimoRecibo) {
      return;
    }
    var cliente = _ultimoRecibo.cliente || {};
    var tel = normalizarCelular(cliente.celular);
    if (!tel) {
      window.alert("Este cliente no tiene un número de celular registrado.");
      return;
    }
    var texto = PCC.textoWhatsAppRecibo(_ultimoRecibo.datos);
    var url = "https://wa.me/" + tel + "?text=" + encodeURIComponent(texto);
    window.open(url, "_blank");
  }

  /**
   * abrirHistorial(cliente): filtra los pagos del cliente, calcula el estado
   * de cuenta y pinta una fila por pago (fecha, periodo, monto, socio, folio)
   * con botones para ver el recibo y revertir cuando aplica.
   */
  function abrirHistorial(cliente) {
    var pagos = movimientos().filter(function (m) {
      return m && m.esPago && m.clienteId === cliente.id;
    });

    // Ordenar por fecha descendente (mas reciente primero).
    pagos.sort(function (a, b) {
      var fa = PCC.aFecha(a.fecha);
      var fb = PCC.aFecha(b.fecha);
      return (fb ? fb.getTime() : 0) - (fa ? fa.getTime() : 0);
    });

    // Estado de cuenta.
    var totalPagado = pagos.reduce(function (acc, m) {
      return acc + (Number(m.monto) || 0);
    }, 0);
    var ultimoPagoMov = pagos.length ? pagos[0] : null;
    var estCob = estadoCobranza(cliente, movimientos());

    setTexto("#historial-cliente", cliente.nombre ? "· " + cliente.nombre : "");
    setTexto("#historial-total", PCC.formatoMoneda(totalPagado));
    setTexto(
      "#historial-ultimo",
      ultimoPagoMov ? PCC.formatoFechaLarga(ultimoPagoMov.fecha) : "Sin registro"
    );
    setTexto(
      "#historial-proximo",
      cliente.fechaProximoPago ? PCC.formatoFechaLarga(cliente.fechaProximoPago) : "Sin registro"
    );
    var elEstado = $("#historial-estado");
    if (elEstado) {
      // Estado de cuenta: reutiliza estadoCobranza (mismo criterio y mismo
      // badge que la tarjeta). Si falta pagar el mes, muestra el detalle de
      // dias contra su dia de pago ("Vencido hace N días" / "Vence hoy|
      // mañana|en N días" / "Faltan N días"); "Pagado (<mes>)" si ya pago y
      // "Pausado" si no se le cobra. La clase CSS (estado-<clase>) da el color.
      elEstado.textContent = estCob.texto;
      elEstado.className = "estado-cuenta__valor badge estado-" + estCob.clase;
    }

    // El pago reversible es el ultimo pago del cliente (mismo criterio que
    // la tarjeta): se compara por id contra ultimoPagoDeCliente.
    var reversible = ultimoPagoDeCliente(cliente.id);
    var reversibleId = reversible ? reversible.id : null;

    var contenedor = $("#historial-lista");
    var vacio = $("#historial-vacio");
    if (!contenedor) {
      return;
    }
    limpiarTarjetas(contenedor, vacio);

    if (pagos.length === 0) {
      if (vacio) {
        vacio.hidden = false;
      }
      abrirModal("#modal-historial");
      return;
    }
    if (vacio) {
      vacio.hidden = true;
    }

    pagos.forEach(function (mov) {
      contenedor.appendChild(
        crearFilaHistorial(cliente, mov, mov.id === reversibleId)
      );
    });

    abrirModal("#modal-historial");
  }

  /**
   * crearFilaHistorial(cliente, mov, esReversible): construye el nodo DOM de
   * una fila del historial. El movimiento se identifica por data-mov-id para
   * la delegacion de 'Ver recibo' / 'Revertir'.
   */
  function crearFilaHistorial(cliente, mov, esReversible) {
    var fila = document.createElement("div");
    fila.className = "historial__fila";
    fila.setAttribute("data-mov-id", mov.id);

    var periodoTexto = PCC.formatoPeriodo(mov.periodo);
    if (!periodoTexto) {
      // Pago viejo sin periodo: derivar del mes de la fecha.
      periodoTexto = PCC.formatoPeriodo(
        PCC.periodoPorDefecto({ fechaProximoPago: mov.fecha }, mov.fecha)
      );
    }
    var socio = cliente.socio === "Octavio" ? "Octavio" : "Carlos";

    var info = document.createElement("div");
    info.className = "historial__info";

    var linea1 = document.createElement("div");
    linea1.className = "historial__linea historial__linea--principal";
    var monto = document.createElement("span");
    monto.className = "historial__monto";
    monto.textContent = PCC.formatoMoneda(mov.monto);
    var periodo = document.createElement("span");
    periodo.className = "historial__periodo";
    periodo.textContent = periodoTexto || "Sin registro";
    linea1.appendChild(monto);
    linea1.appendChild(periodo);

    var linea2 = document.createElement("div");
    linea2.className = "historial__linea historial__linea--meta";
    linea2.textContent =
      PCC.formatoFechaLarga(mov.fecha) +
      " · Paga a: " +
      socio +
      " · Folio: " +
      (mov.folio ? mov.folio : "sin folio");

    info.appendChild(linea1);
    info.appendChild(linea2);

    var acciones = document.createElement("div");
    acciones.className = "historial__acciones";

    var btnRecibo = document.createElement("button");
    btnRecibo.type = "button";
    btnRecibo.className = "btn btn--chip historial-ver-recibo";
    btnRecibo.innerHTML = '<span aria-hidden="true">' + iconoSVG("recibo") + "</span> Ver recibo";
    acciones.appendChild(btnRecibo);

    if (esReversible) {
      var btnRev = document.createElement("button");
      btnRev.type = "button";
      btnRev.className = "btn btn--chip btn--revertir historial-revertir";
      btnRev.innerHTML = '<span aria-hidden="true">' + iconoSVG("revertir") + "</span> Revertir";
      acciones.appendChild(btnRev);
    }

    fila.appendChild(info);
    fila.appendChild(acciones);
    return fila;
  }

  /**
   * ultimoPagoDeCliente(id): devuelve el movimiento de pago (esPago) mas
   * reciente de un cliente, o null si no tiene ninguno. "Mas reciente" se
   * decide por fecha; a igual fecha, por orden de registro (el ultimo).
   */
  function ultimoPagoDeCliente(id) {
    var movs = movimientos();
    var elegido = null;
    for (var i = 0; i < movs.length; i++) {
      var m = movs[i];
      if (!m || !m.esPago || m.clienteId !== id) {
        continue;
      }
      if (!elegido) {
        elegido = m;
        continue;
      }
      var fa = PCC.aFecha(m.fecha);
      var fb = PCC.aFecha(elegido.fecha);
      // Fecha mas reciente gana; a igualdad, el de registro posterior.
      if (fa && fb ? fa.getTime() >= fb.getTime() : true) {
        elegido = m;
      }
    }
    return elegido;
  }

  /**
   * accionRevertir(cliente): deshace el ultimo pago registrado del cliente.
   * Pide confirmacion, borra el movimiento de pago y restaura al cliente al
   * estado previo (ultimoPago/fechaProximoPago). El reparto y las metricas
   * del mes se recalculan solos al re-renderizar.
   */
  function accionRevertir(cliente) {
    var mov = ultimoPagoDeCliente(cliente.id);
    if (!mov) {
      window.alert(
        'No hay ningún pago registrado para "' +
          (cliente.nombre || "") +
          '" que se pueda revertir.'
      );
      return;
    }
    var ok = window.confirm(
      '¿Revertir el último pago de "' +
        (cliente.nombre || "") +
        '"? El cliente volverá a quedar como estaba antes del pago.'
    );
    if (!ok) {
      return;
    }

    var resultado = PCC.revertirPago(mov.id, clientes(), movimientos());
    if (!resultado.revertido) {
      return;
    }
    PCC.guardarMovimientos(resultado.movimientos);
    PCC.guardarClientes(resultado.clientes);

    if (resultado.usoFallback) {
      window.alert(
        "El pago se revirtió, pero era un pago antiguo sin datos de " +
          "reversión. Se recalculó la fecha de próximo pago; conviene " +
          "revisarla por si no coincide con la que tenía antes."
      );
    }

    render();
  }

  /**
   * revertirDesdeHistorial(cliente, mov): revierte un pago concreto desde el
   * modal de historial, reutilizando la logica del nucleo (PCC.revertirPago).
   * Tras revertir, refresca el render principal y vuelve a pintar el historial
   * del mismo cliente para que quede al dia.
   */
  function revertirDesdeHistorial(cliente, mov) {
    var ok = window.confirm(
      '¿Revertir este pago de "' +
        (cliente.nombre || "") +
        '"? El cliente volverá a quedar como estaba antes del pago.'
    );
    if (!ok) {
      return;
    }

    var resultado = PCC.revertirPago(mov.id, clientes(), movimientos());
    if (!resultado.revertido) {
      return;
    }
    PCC.guardarMovimientos(resultado.movimientos);
    PCC.guardarClientes(resultado.clientes);

    if (resultado.usoFallback) {
      window.alert(
        "El pago se revirtió, pero era un pago antiguo sin datos de " +
          "reversión. Se recalculó la fecha de próximo pago; conviene " +
          "revisarla por si no coincide con la que tenía antes."
      );
    }

    render();

    // Refrescar el historial con el cliente ya actualizado (si sigue existiendo).
    var actualizado = clientePorId(cliente.id);
    if (actualizado) {
      abrirHistorial(actualizado);
    } else {
      cerrarModales();
    }
  }

  function accionPausar(cliente) {
    var lista = clientes();
    lista.forEach(function (c) {
      if (c.id === cliente.id) {
        c.estatus = c.estatus === "Pausado" ? "Activo" : "Pausado";
      }
    });
    PCC.guardarClientes(lista);
    render();
  }

  function accionEliminar(cliente) {
    var ok = window.confirm(
      '¿Eliminar al cliente "' + (cliente.nombre || "") + '"? Esta acción no se puede deshacer.'
    );
    if (!ok) {
      return;
    }
    var lista = clientes().filter(function (c) {
      return c.id !== cliente.id;
    });
    PCC.guardarClientes(lista);
    render();
  }

  /* ==========================================================
     MODAL CLIENTE (crear / editar)
     ========================================================== */
  function abrirModalCliente(cliente) {
    var form = $("#form-cliente");
    if (form) {
      form.reset();
    }
    var titulo = $("#modal-cliente-titulo");
    setValor("#cliente-id", cliente ? cliente.id : "");

    if (cliente) {
      if (titulo) {
        titulo.textContent = "Editar Cliente";
      }
      setValor("#cliente-nombre", cliente.nombre);
      setValor("#cliente-celular", cliente.celular);
      setValor("#cliente-direccion", cliente.direccion);
      setValor("#cliente-ip", cliente.ip);
      setValor("#cliente-megas", cliente.megas);
      setValor("#cliente-monto", cliente.monto);
      setValor("#cliente-fecha-instalacion", cliente.fechaInstalacion);
      setValor("#cliente-dia-pago", cliente.diaPago);
      setValor("#cliente-tipo-pago", cliente.tipoPago);
      setValor("#cliente-estatus", cliente.estatus);
      setValor("#cliente-socio", cliente.socio === "Octavio" ? "Octavio" : "Carlos");
      // Campos de red (FEAT-003): tipo de conexion y AP/enlace padre.
      setValor("#cliente-tipo-conexion", cliente.tipoConexion || "");
      setValor("#cliente-ap", cliente.apId || "");
    } else {
      if (titulo) {
        titulo.textContent = "Nuevo Cliente";
      }
      setValor("#cliente-monto", PCC.MONTO_DEFAULT);
      setValor("#cliente-tipo-pago", "PTP");
      setValor("#cliente-estatus", "Activo");
      setValor("#cliente-socio", "Carlos");
      setValor("#cliente-tipo-conexion", "");
      setValor("#cliente-ap", "");
    }
    abrirModal("#modal-cliente");
  }

  function guardarCliente(ev) {
    ev.preventDefault();
    var nombre = (valor("#cliente-nombre") || "").trim();
    var celular = (valor("#cliente-celular") || "").trim();
    var montoRaw = valor("#cliente-monto");
    var diaPagoRaw = valor("#cliente-dia-pago");

    // Validacion de requeridos con mensajes en espanol.
    var errores = [];
    if (!nombre) {
      errores.push("El nombre es obligatorio.");
    }
    // El celular es OPCIONAL: varios clientes reales se siembran sin numero
    // (p. ej. Yolanda casa 15, Jessy casa 43, Vecino de Brandon) y deben
    // poder abrirse desde el mapa para asignarles IP/AP sin inventar datos.
    // Si viene vacio se guarda como "" (WhatsApp quedara deshabilitado para
    // ese cliente). Obligatorios: nombre, monto y dia de pago.
    if (montoRaw === "" || isNaN(Number(montoRaw)) || Number(montoRaw) < 0) {
      errores.push("El monto debe ser un número válido.");
    }
    var diaPago = Number(diaPagoRaw);
    if (diaPagoRaw === "" || isNaN(diaPago) || diaPago < 1 || diaPago > 31) {
      errores.push("El día de pago debe estar entre 1 y 31.");
    }
    if (errores.length) {
      window.alert(errores.join("\n"));
      return;
    }

    var id = valor("#cliente-id");
    var datos = {
      id: id || undefined,
      nombre: nombre,
      celular: celular,
      direccion: (valor("#cliente-direccion") || "").trim(),
      ip: (valor("#cliente-ip") || "").trim(),
      megas: (valor("#cliente-megas") || "").trim(),
      monto: Number(montoRaw),
      fechaInstalacion: valor("#cliente-fecha-instalacion") || "",
      diaPago: diaPago,
      tipoPago: valor("#cliente-tipo-pago"),
      estatus: valor("#cliente-estatus"),
      socio: valor("#cliente-socio"),
      // Campos de red (FEAT-003). crearCliente normaliza tipoConexion
      // (valores invalidos -> '') y conserva apId tal cual.
      tipoConexion: valor("#cliente-tipo-conexion"),
      apId: valor("#cliente-ap")
    };

    var lista = clientes();
    if (id) {
      // Edicion: conservar ultimoPago / fechaProximoPago existentes.
      var existente = null;
      for (var i = 0; i < lista.length; i++) {
        if (lista[i].id === id) {
          existente = lista[i];
          break;
        }
      }
      if (existente) {
        datos.ultimoPago = existente.ultimoPago || "";
        // Recalcular fechaProximoPago con el diaPago nuevo.
      }
      var actualizado = PCC.crearCliente(datos);
      lista = lista.map(function (c) {
        return c.id === id ? actualizado : c;
      });
    } else {
      lista.push(PCC.crearCliente(datos));
    }
    PCC.guardarClientes(lista);
    cerrarModales();
    render();
  }

  /* ==========================================================
     MODALES DE MOVIMIENTOS (gasto / ingreso / ahorro)
     ========================================================== */
  function abrirModalMovimiento(tipo) {
    var mapa = {
      gasto: { modal: "#modal-gasto", fecha: "#gasto-fecha" },
      ingreso: { modal: "#modal-ingreso", fecha: "#ingreso-fecha" },
      ahorro: { modal: "#modal-ahorro", fecha: "#ahorro-fecha" }
    };
    var cfg = mapa[tipo];
    if (!cfg) {
      return;
    }
    var form = $(cfg.modal + " form");
    if (form) {
      form.reset();
    }
    setValor(cfg.fecha, PCC.fechaISO(new Date()));
    abrirModal(cfg.modal);
  }

  function guardarMovimiento(tipo, prefijo, ev) {
    ev.preventDefault();
    var concepto = (valor("#" + prefijo + "-concepto") || "").trim();
    var montoRaw = valor("#" + prefijo + "-monto");
    var fecha = valor("#" + prefijo + "-fecha");

    var errores = [];
    if (!concepto) {
      errores.push("El concepto es obligatorio.");
    }
    if (montoRaw === "" || isNaN(Number(montoRaw)) || Number(montoRaw) < 0) {
      errores.push("El monto debe ser un número válido.");
    }
    if (errores.length) {
      window.alert(errores.join("\n"));
      return;
    }

    var movs = movimientos();
    movs.push({
      id: PCC.generarId(),
      tipo: tipo,
      concepto: concepto,
      monto: Number(montoRaw),
      fecha: fecha ? PCC.fechaISO(fecha) : PCC.fechaISO(new Date())
    });
    PCC.guardarMovimientos(movs);
    cerrarModales();

    // Mostrar la pestana correspondiente al movimiento recien creado.
    estado.pestanaMovimiento =
      tipo === "gasto" ? "gastos" : tipo === "ingreso" ? "ingresos" : "ahorros";
    sincronizarPestanas();
    render();
  }

  /* ==========================================================
     MODAL CONFIGURACION
     ========================================================== */
  function abrirModalConfig() {
    var cfg = PCC.cargarConfig();
    setValor("#config-dias-aviso", cfg.diasAviso);
    setValor("#config-moneda", cfg.moneda);
    setValor("#config-costo-antena", cfg.costoAntena);
    setValor("#config-num-antenas", cfg.numAntenas);
    setValor("#config-costo-luz", cfg.costoLuz);
    setValor("#config-luz-periodicidad", cfg.luzPeriodicidadMeses);
    setValor("#config-luz-ancla", cfg.luzMesAncla);
    // Datos del negocio para el recibo (FEAT-003).
    setValor("#config-nombre-negocio", cfg.nombreNegocio);
    setValor("#config-telefono-contacto", cfg.telefonoContacto);
    setValor("#config-direccion-negocio", cfg.direccionNegocio);
    setValor("#config-mensaje-pie", cfg.mensajePie);
    abrirModal("#modal-config");
  }

  function guardarConfig(ev) {
    ev.preventDefault();
    var diasRaw = valor("#config-dias-aviso");
    var dias = Number(diasRaw);
    if (diasRaw === "" || isNaN(dias) || dias < 0 || dias > 30) {
      window.alert("Los días de aviso deben estar entre 0 y 30.");
      return;
    }

    // Gastos fijos del negocio (reparto de fin de mes).
    var costoAntena = Number(valor("#config-costo-antena"));
    var numAntenas = Number(valor("#config-num-antenas"));
    var costoLuz = Number(valor("#config-costo-luz"));
    var luzPeriodicidad = Number(valor("#config-luz-periodicidad"));
    var luzMesAncla = valor("#config-luz-ancla");

    var errores = [];
    if (isNaN(costoAntena) || costoAntena < 0) {
      errores.push("El costo por antena debe ser un número válido.");
    }
    if (isNaN(numAntenas) || numAntenas < 0) {
      errores.push("El número de antenas debe ser un número válido.");
    }
    if (isNaN(costoLuz) || costoLuz < 0) {
      errores.push("El costo de luz debe ser un número válido.");
    }
    if (isNaN(luzPeriodicidad) || luzPeriodicidad < 1) {
      errores.push("La periodicidad de luz debe ser 1 o más meses.");
    }
    if (!/^\d{4}-\d{2}$/.test(luzMesAncla || "")) {
      errores.push("El mes ancla de luz debe tener el formato AAAA-MM.");
    }
    if (errores.length) {
      window.alert(errores.join("\n"));
      return;
    }

    // Datos del negocio para el recibo (FEAT-003). Validacion minima:
    // si el nombre del negocio queda vacio, usar el generico 'Mi WISP'.
    var nombreNegocio = (valor("#config-nombre-negocio") || "").trim();
    if (!nombreNegocio) {
      nombreNegocio = "Mi WISP";
    }

    PCC.guardarConfig({
      diasAviso: dias,
      moneda: valor("#config-moneda") || "MXN",
      costoAntena: costoAntena,
      numAntenas: numAntenas,
      costoLuz: costoLuz,
      luzPeriodicidadMeses: luzPeriodicidad,
      luzMesAncla: luzMesAncla,
      nombreNegocio: nombreNegocio,
      telefonoContacto: (valor("#config-telefono-contacto") || "").trim(),
      direccionNegocio: (valor("#config-direccion-negocio") || "").trim(),
      mensajePie: (valor("#config-mensaje-pie") || "").trim()
    });
    cerrarModales();
    render();
  }

  function reiniciarDatos() {
    var ok = window.confirm(
      "¿Reiniciar todos los datos de ejemplo? Se reemplazarán los clientes y movimientos actuales."
    );
    if (!ok) {
      return;
    }
    PCC.reiniciarDatosEjemplo();
    cerrarModales();
    render();
  }

  /* ==========================================================
     EXPORTAR A CSV
     ========================================================== */
  function escaparCSV(valor) {
    var s = valor == null ? "" : String(valor);
    if (/[",\n]/.test(s)) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function exportarCSV() {
    // Las dos ultimas columnas (Tipo de conexión / AP o enlace) se anaden al
    // final para NO romper el orden de las columnas existentes.
    var cabeceras = [
      "Nombre", "Celular", "Dirección", "IP", "Megas", "Monto",
      "Fecha instalación", "Día de pago", "Tipo", "Estatus", "Próximo pago",
      "Tipo de conexión", "AP o enlace"
    ];
    var filas = [cabeceras.map(escaparCSV).join(",")];
    clientes().forEach(function (c) {
      var fila = [
        c.nombre,
        c.celular,
        c.direccion,
        c.ip,
        c.megas,
        c.monto,
        c.fechaInstalacion ? PCC.formatoFechaCorta(c.fechaInstalacion) : "",
        c.diaPago,
        c.tipoPago,
        c.estatus,
        c.fechaProximoPago ? PCC.formatoFechaCorta(c.fechaProximoPago) : "",
        c.tipoConexion || "",
        c.apId || ""
      ];
      filas.push(fila.map(escaparCSV).join(","));
    });

    // BOM para que Excel reconozca UTF-8 (acentos).
    var contenido = "\ufeff" + filas.join("\r\n");
    var blob = new Blob([contenido], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "clientes.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Liberar la URL del objeto tras un breve lapso (compatible con file://).
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  /* ==========================================================
     MODO OSCURO
     ========================================================== */
  function aplicarTema() {
    var tema = PCC.getTheme();
    document.documentElement.setAttribute("data-theme", tema);
    var icono = $("#btn-tema-icono");
    if (icono) {
      // En modo oscuro mostramos el sol (para volver a claro) y viceversa.
      // Iconos SVG de linea (FEAT-002); #btn-tema-icono se conserva.
      icono.innerHTML = iconoSVG(tema === "oscuro" ? "sol" : "luna");
    }
  }

  function alternarTema() {
    var nuevo = PCC.getTheme() === "oscuro" ? "claro" : "oscuro";
    PCC.setTheme(nuevo);
    aplicarTema();
  }

  /* ==========================================================
     HELPERS DE MODALES Y CAMPOS
     ========================================================== */
  function abrirModal(sel) {
    var modal = $(sel);
    if (modal) {
      modal.hidden = false;
    }
  }

  function cerrarModales() {
    $all(".modal").forEach(function (m) {
      m.hidden = true;
    });
  }

  function valor(sel) {
    var el = $(sel);
    return el ? el.value : "";
  }

  function setValor(sel, v) {
    var el = $(sel);
    if (el) {
      el.value = v == null ? "" : v;
    }
  }

  function sincronizarPestanas() {
    $all(".pestana").forEach(function (p) {
      var activa = p.getAttribute("data-tab") === estado.pestanaMovimiento;
      p.classList.toggle("pestana--activa", activa);
      p.setAttribute("aria-selected", activa ? "true" : "false");
    });
  }

  function sincronizarChips() {
    $all(".chip").forEach(function (chip) {
      var activo = chip.getAttribute("data-filtro") === estado.filtroActivo;
      chip.classList.toggle("chip--activo", activo);
    });
  }

  /* ==========================================================
     ENGANCHE DE EVENT LISTENERS
     ========================================================== */
  function engancharListeners() {
    // Header
    on("#btn-config", "click", abrirModalConfig);
    on("#btn-nuevo-ahorro", "click", function () {
      abrirModalMovimiento("ahorro");
    });
    on("#btn-nuevo-gasto", "click", function () {
      abrirModalMovimiento("gasto");
    });
    on("#btn-nuevo-cliente", "click", function () {
      abrirModalCliente(null);
    });
    on("#btn-tema", "click", alternarTema);

    // Navegacion de mes
    on("#btn-mes-prev", "click", function () {
      estado.mesSeleccionado = new Date(
        estado.mesSeleccionado.getFullYear(),
        estado.mesSeleccionado.getMonth() - 1,
        1
      );
      render();
    });
    on("#btn-mes-next", "click", function () {
      estado.mesSeleccionado = new Date(
        estado.mesSeleccionado.getFullYear(),
        estado.mesSeleccionado.getMonth() + 1,
        1
      );
      render();
    });

    // Busqueda
    on("#buscador", "input", function (ev) {
      estado.terminoBusqueda = ev.target.value || "";
      renderClientes(clientes());
    });

    // Chips de filtro
    $all(".chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        estado.filtroActivo = chip.getAttribute("data-filtro") || "todos";
        sincronizarChips();
        renderClientes(clientes());
      });
    });

    // Orden
    on("#orden-clientes", "change", function (ev) {
      estado.ordenActual = ev.target.value || "proximo";
      renderClientes(clientes());
    });

    // Exportar CSV
    on("#btn-exportar-csv", "click", exportarCSV);

    // Pestanas de detalle
    $all(".pestana").forEach(function (p) {
      p.addEventListener("click", function () {
        estado.pestanaMovimiento = p.getAttribute("data-tab") || "gastos";
        sincronizarPestanas();
        renderDetalle(movimientos());
      });
    });

    // Acciones por tarjeta (delegacion en los contenedores de listas).
    [$("#lista-pagos"), $("#lista-clientes")].forEach(function (cont) {
      if (!cont) {
        return;
      }
      cont.addEventListener("click", function (ev) {
        var boton = ev.target.closest("button");
        if (!boton) {
          return;
        }
        var tarjeta = ev.target.closest(".tarjeta");
        if (!tarjeta) {
          return;
        }
        var id = tarjeta.getAttribute("data-id");
        var cliente = clientePorId(id);
        if (!cliente) {
          return;
        }
        if (boton.classList.contains("accion-avisar")) {
          accionAvisar(cliente);
        } else if (boton.classList.contains("accion-pagar")) {
          abrirModalPago(cliente);
        } else if (boton.classList.contains("accion-historial")) {
          abrirHistorial(cliente);
        } else if (boton.classList.contains("accion-revertir")) {
          accionRevertir(cliente);
        } else if (boton.classList.contains("accion-editar")) {
          abrirModalCliente(cliente);
        } else if (boton.classList.contains("accion-pausar")) {
          accionPausar(cliente);
        } else if (boton.classList.contains("accion-eliminar")) {
          accionEliminar(cliente);
        }
      });
    });

    // Formularios de modales
    on("#form-cliente", "submit", guardarCliente);
    on("#form-gasto", "submit", function (ev) {
      guardarMovimiento("gasto", "gasto", ev);
    });
    on("#form-ingreso", "submit", function (ev) {
      guardarMovimiento("ingreso", "ingreso", ev);
    });
    on("#form-ahorro", "submit", function (ev) {
      guardarMovimiento("ahorro", "ahorro", ev);
    });
    on("#form-config", "submit", guardarConfig);
    on("#btn-reiniciar-datos", "click", reiniciarDatos);

    // Pago, recibo e historial (FEAT-003).
    on("#form-pago", "submit", confirmarPago);
    on("#btn-recibo-imprimir", "click", imprimirRecibo);
    on("#btn-recibo-whatsapp", "click", enviarReciboWhatsApp);

    // Historial: delegacion de click para 'Ver recibo' y 'Revertir' por fila.
    on("#historial-lista", "click", function (ev) {
      var boton = ev.target.closest("button");
      if (!boton) {
        return;
      }
      var fila = ev.target.closest(".historial__fila");
      if (!fila) {
        return;
      }
      var movId = fila.getAttribute("data-mov-id");
      var mov = movimientoPorId(movId);
      if (!mov) {
        return;
      }
      var cliente = clientePorId(mov.clienteId);
      if (!cliente) {
        return;
      }
      if (boton.classList.contains("historial-ver-recibo")) {
        mostrarRecibo(cliente, mov, true);
      } else if (boton.classList.contains("historial-revertir")) {
        revertirDesdeHistorial(cliente, mov);
      }
    });

    // Cierre de modales (botones/overlay con data-cerrar-modal).
    $all("[data-cerrar-modal]").forEach(function (el) {
      el.addEventListener("click", cerrarModales);
    });

    // Cierre especifico del recibo (botones/overlay con data-cerrar-recibo):
    // solo oculta #modal-recibo para no sacar al usuario del historial cuando
    // el recibo se abrio desde ahi.
    $all("[data-cerrar-recibo]").forEach(function (el) {
      el.addEventListener("click", cerrarRecibo);
    });

    // Cerrar modal con Escape. Si el recibo esta abierto, cerrarlo solo a el
    // (preservando el historial debajo cuando corresponde); si no, cerrar
    // todos los modales como hasta ahora.
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") {
        return;
      }
      var recibo = $("#modal-recibo");
      if (recibo && !recibo.hidden) {
        cerrarRecibo();
      } else {
        cerrarModales();
      }
    });

    engancharMenuAcciones();
  }

  /* ==========================================================
     POPOVER '•••' DE ACCIONES SECUNDARIAS POR TARJETA (FEAT-004)
     ----------------------------------------------------------
     Las acciones secundarias (Historial, editar, pausar, eliminar,
     revertir) siguen siendo los MISMOS botones .accion-* dentro del
     panel .acciones-menu__panel; la delegacion que los ejecuta no
     cambia (ver el bloque de "Acciones por tarjeta" mas arriba). Aqui
     solo se controla mostrar/ocultar el panel:
       - Toggle via delegacion GLOBAL por clase (.acciones-menu__toggle),
         para que funcione con tarjetas recreadas en cada render sin
         re-enganchar listeners.
       - Click fuera cierra cualquier menu abierto.
       - Escape cierra el menu abierto (sin interferir con modales:
         solo actua cuando hay un menu abierto).
     ========================================================== */
  function cerrarMenusAcciones(excepto) {
    $all(".acciones-menu__panel").forEach(function (panel) {
      if (panel === excepto) {
        return;
      }
      if (!panel.hidden) {
        panel.hidden = true;
        var menu = panel.closest(".acciones-menu");
        var toggle = menu ? menu.querySelector(".acciones-menu__toggle") : null;
        if (toggle) {
          toggle.setAttribute("aria-expanded", "false");
        }
      }
    });
  }

  function engancharMenuAcciones() {
    // Toggle: delegacion global por clase (robusto ante re-render).
    document.addEventListener("click", function (ev) {
      var toggle = ev.target.closest
        ? ev.target.closest(".acciones-menu__toggle")
        : null;
      if (toggle) {
        var menu = toggle.closest(".acciones-menu");
        var panel = menu ? menu.querySelector(".acciones-menu__panel") : null;
        if (panel) {
          var abrir = panel.hidden;
          // Cerrar los demas antes de abrir/cerrar este.
          cerrarMenusAcciones(abrir ? panel : null);
          panel.hidden = !abrir;
          toggle.setAttribute("aria-expanded", abrir ? "true" : "false");
        }
        return;
      }
      // Click fuera de cualquier panel/menu: cerrar todo. Si el click cayo
      // dentro de un .acciones-menu (p.ej. una accion secundaria), no se
      // cierra aqui; la propia accion re-renderiza la lista.
      if (!(ev.target.closest && ev.target.closest(".acciones-menu"))) {
        cerrarMenusAcciones(null);
      }
    });

    // Escape cierra el menu abierto (solo si hay alguno visible).
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") {
        return;
      }
      var abierto = $(".acciones-menu__panel:not([hidden])");
      if (abierto) {
        cerrarMenusAcciones(null);
      }
    });
  }

  function on(sel, evento, handler) {
    var el = $(sel);
    if (el) {
      el.addEventListener(evento, handler);
    }
  }

  /* ==========================================================
     ARRANQUE
     ========================================================== */
  function iniciar() {
    // Por si el nucleo no pudo sembrar en la carga inicial (timing).
    try {
      PCC.sembrarSiHaceFalta();
    } catch (e) {}

    aplicarTema();
    sincronizarChips();
    sincronizarPestanas();
    engancharListeners();

    // Hook aditivo para la capa de sincronizacion (FEAT-002: firebase-sync.js).
    // Expone las funciones de UI para que, al llegar datos remotos de Firestore,
    // se pueda disparar un re-render sin tocar el nucleo window.PCC ni su logica.
    // Solo se asigna en entorno con document (navegador); el arnes no lo crea.
    window.PCC.UI = {
      render: render,
      aplicarTema: aplicarTema,
      sincronizarChips: sincronizarChips,
      sincronizarPestanas: sincronizarPestanas,
      // Expuesto para el mapa de red (FEAT-003): permite abrir la ficha de
      // un cliente desde un nodo del mapa para identificarlo (IP/AP).
      abrirModalCliente: abrirModalCliente
    };

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();

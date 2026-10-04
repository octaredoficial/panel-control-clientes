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
    moneda: "MXN"
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
       fechaProximoPago: string   ISO 'YYYY-MM-DD' (vencimiento vigente)
       ultimoPago:       string   ISO 'YYYY-MM-DD' del ultimo pago, o ''
     }
     ---------------------------------------------------------- */

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
      megas: datos.megas || "",
      monto: datos.monto != null ? Number(datos.monto) : MONTO_DEFAULT,
      fechaInstalacion: datos.fechaInstalacion
        ? fechaISO(datos.fechaInstalacion)
        : "",
      diaPago: diaPago != null ? Number(diaPago) : 1,
      tipoPago: datos.tipoPago === "Directo" ? "Directo" : "PTP",
      estatus: datos.estatus === "Pausado" ? "Pausado" : "Activo",
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
            ? "Vencido hace 1 dia"
            : "Vencido hace " + vencidoN + " dias",
        diasVencido: vencidoN
      };
    }

    if (dias === 0) {
      return { clase: "proximo", texto: "Vence hoy", diasVencido: 0 };
    }

    if (dias === 1) {
      return { clase: "proximo", texto: "Vence manana", diasVencido: 0 };
    }

    if (dias <= diasAviso) {
      return {
        clase: "proximo",
        texto: "Vence en " + dias + " dias",
        diasVencido: 0
      };
    }

    // Fuera de la ventana de aviso: si hay un pago registrado, 'pagado';
    // de lo contrario 'ok' (al corriente, sin urgencia).
    if (cliente && cliente.ultimoPago) {
      return {
        clase: "pagado",
        texto: "Pagado - vence en " + dias + " dias",
        diasVencido: 0
      };
    }

    return {
      clase: "ok",
      texto: "Vence en " + dias + " dias",
      diasVencido: 0
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
    return {
      diasAviso: cfg.diasAviso != null ? cfg.diasAviso : CONFIG_DEFAULT.diasAviso,
      moneda: cfg.moneda != null ? cfg.moneda : CONFIG_DEFAULT.moneda
    };
  }

  function guardarConfig(cfg) {
    cfg = cfg || {};
    var merge = {
      diasAviso:
        cfg.diasAviso != null ? cfg.diasAviso : CONFIG_DEFAULT.diasAviso,
      moneda: cfg.moneda != null ? cfg.moneda : CONFIG_DEFAULT.moneda
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
     8. Dataset SEED de ejemplo (~24 clientes)
     ------------------------------------------------------------
     Basado en la tabla de referencia del briefing. Fechas en ISO.
     Las direcciones/IP son genericas de ejemplo. Mezcla de tipos
     PTP/Directo, al menos 1 Pausado y varios Vencidos.
     ---------------------------------------------------------- */

  // Datos crudos: [nombre, celular, megas, instalacionISO, monto, diaPago,
  //                tipoPago, estatus, ultimoPagoISO]
  // ultimoPago '' = aun sin pagar el ciclo (puede quedar vencido).
  var SEED_RAW = [
    ["Cresencia caraos casa P4", "9842785595", "5 MB", "2025-11-02", 500, 2, "Directo", "Activo", "2025-11-02"],
    ["VECINA YOLANDA CASA 15", "9841000015", "10 MB", "2026-05-05", 500, 5, "PTP", "Activo", ""],
    ["Hermelinda", "9841311983", "10 MB", "2024-07-05", 500, 5, "Directo", "Activo", ""],
    ["MICAELA HERNANDEZ", "9671949286", "10 MB", "2026-02-07", 500, 7, "PTP", "Activo", ""],
    ["casa 44 LIZBETH", "9842704365", "10 MB", "2025-11-12", 500, 12, "Directo", "Activo", ""],
    ["Daniel casa 44", "9842086116", "10 MB", "2024-04-16", 500, 16, "PTP", "Activo", ""],
    ["Nieto", "9848062139", "20 MB", "2024-07-17", 600, 17, "Directo", "Activo", ""],
    ["Lupita casa 26", "9982047915", "20 MB", "2025-03-21", 700, 21, "PTP", "Activo", ""],
    ["Gabriela", "9844491677", "20 MB", "2024-09-21", 600, 21, "Directo", "Activo", ""],
    ["URIEL", "9841913321", "10 MB", "2026-12-25", 500, 25, "PTP", "Activo", ""],
    ["Reyes vecino", "9841163234", "30 MB", "2024-04-27", 600, 27, "Directo", "Activo", ""],
    ["TIENDA INDOMABLE", "9841163234", "5 MB", "2025-03-24", 500, 24, "PTP", "Activo", ""],
    ["Mercedez RH", "2711657112", "10 MB", "2024-04-28", 400, 28, "Directo", "Activo", ""],
    ["Berenice", "9841417166", "10 MB", "2024-10-30", 500, 30, "PTP", "Activo", ""],
    ["Jessy casa 43", "9841000043", "5 MB", "2025-02-24", 500, 24, "Directo", "Activo", ""],
    ["Obed", "9841564118", "10 MB", "2024-07-27", 500, 27, "PTP", "Activo", ""],
    ["VECINO DE BRANDON", "9841000088", "10 MB", "2026-03-28", 500, 28, "Directo", "Activo", ""],
    ["CASA 17 CARMEN LAVAND", "9841003920", "10 MB", "2026-09-16", 500, 16, "PTP", "Activo", "2026-09-16"],
    // Relleno hasta ~24 con mezcla de tipos/estatus:
    ["Fernando casa 8", "9841002008", "15 MB", "2024-06-10", 550, 10, "Directo", "Activo", ""],
    ["Rosa Maria", "9841002009", "10 MB", "2025-01-18", 500, 18, "PTP", "Pausado", ""],
    ["Taqueria El Buen Sabor", "9841002010", "30 MB", "2024-08-03", 800, 3, "Directo", "Activo", ""],
    ["Jorge casa 12", "9841002011", "10 MB", "2025-05-09", 500, 9, "PTP", "Activo", ""],
    ["Abarrotes Lupita", "9841002012", "20 MB", "2024-12-14", 650, 14, "Directo", "Activo", ""],
    ["Veronica casa 30", "9841002013", "10 MB", "2025-07-22", 500, 22, "PTP", "Activo", ""]
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
      var fechaInstalacion = fila[3];
      var diaPago = fila[5];
      var ultimoPago = fila[8];

      var cliente = crearCliente({
        nombre: fila[0],
        celular: fila[1],
        direccion: "Col. Centro, calle de ejemplo",
        ip: ipEjemplo(),
        megas: fila[2],
        monto: fila[4],
        fechaInstalacion: fechaInstalacion,
        diaPago: diaPago,
        tipoPago: fila[6],
        estatus: fila[7],
        ultimoPago: ultimoPago
      });
      return cliente;
    });

    // Forzar escenarios de prueba deterministas en los primeros clientes:
    //  - ~3 vencidos (vencimiento en el pasado, sin pago del ciclo)
    //  - algunos proximos (dentro de la ventana de aviso)
    //  - algunos pagados (ultimoPago cubre un ciclo futuro)
    aplicarEscenarios(clientes, hoy);
    return clientes;
  }

  var _ipSeq = 100;
  function ipEjemplo() {
    _ipSeq += 1;
    return "192.168.1." + _ipSeq;
  }

  /**
   * aplicarEscenarios: fija fechaProximoPago/ultimoPago para que el
   * dataset muestre vencidos, proximos y pagados de forma predecible.
   */
  function aplicarEscenarios(clientes, hoy) {
    function en(dias) {
      var d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
      d.setDate(d.getDate() + dias);
      return fechaISO(d);
    }

    if (clientes[2]) {
      // Hermelinda -> VENCIDO hace 5 dias
      clientes[2].fechaProximoPago = en(-5);
      clientes[2].ultimoPago = "";
    }
    if (clientes[13]) {
      // Berenice -> VENCIDO hace 8 dias (en la tabla aparece "debe")
      clientes[13].fechaProximoPago = en(-8);
      clientes[13].ultimoPago = "";
    }
    if (clientes[15]) {
      // Obed -> VENCIDO hace 2 dias (en la tabla aparece "debe")
      clientes[15].fechaProximoPago = en(-2);
      clientes[15].ultimoPago = "";
    }
    if (clientes[14]) {
      // Jessy casa 43 -> VENCIDO hace 1 dia (en la tabla aparece "debe")
      clientes[14].fechaProximoPago = en(-1);
      clientes[14].ultimoPago = "";
    }
    if (clientes[5]) {
      // Daniel casa 44 -> PROXIMO (vence manana)
      clientes[5].fechaProximoPago = en(1);
    }
    if (clientes[7]) {
      // Lupita casa 26 -> PROXIMO (vence en 3 dias)
      clientes[7].fechaProximoPago = en(3);
    }
    if (clientes[0]) {
      // Cresencia -> PAGADO (vence en 25 dias y tiene ultimo pago)
      clientes[0].fechaProximoPago = en(25);
      clientes[0].ultimoPago = en(-5);
    }
    if (clientes[17]) {
      // CARMEN LAVAND -> PAGADO (vence en 20 dias con pago registrado)
      clientes[17].fechaProximoPago = en(20);
      clientes[17].ultimoPago = en(-10);
    }
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
   */
  function reiniciarDatosEjemplo() {
    guardarClientes(construirSeed());
    guardarMovimientos([]);
    guardarConfig(clonar(CONFIG_DEFAULT));
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

    // Calculos de negocio
    calcularProximoPago: calcularProximoPago,
    diasRestantes: diasRestantes,
    estadoPago: estadoPago,

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

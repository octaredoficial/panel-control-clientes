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
    luzMesAncla: "2025-11"
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

  /* ----------------------------------------------------------
     6.b Reparto de fin de mes entre socios (Carlos / Octavio)
     ------------------------------------------------------------
     El negocio es de dos socios: Carlos y Octavio. Al cierre de mes
     se reparte la ganancia 50/50, pero antes se descuentan los gastos
     fijos compartidos (Starlink + luz) y se aparta el pago directo de
     los clientes marcados socio 'Octavio' (ese dinero es 100% suyo).

     Formula (confirmada por el usuario):
       ingresosMes  = pagos cobrados (esPago) con fecha en el mes
       pagosOctavio = de esos pagos, los de clientes socio 'Octavio'
       gastos       = Starlink (2610 fijo) + luz (300 si aplica el mes)
       gananciaRepartir = ingresosMes - gastos - pagosOctavio
       mitad        = gananciaRepartir / 2
       totalCarlos  = mitad
       totalOctavio = mitad + pagosOctavio
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
      totalOctavio: mitad + pagosOctavio,
      luzAplica: luzAplicaEnMes(ref, cfg)
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
        cfg.luzMesAncla != null ? cfg.luzMesAncla : CONFIG_DEFAULT.luzMesAncla
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
        cfg.luzMesAncla != null ? cfg.luzMesAncla : CONFIG_DEFAULT.luzMesAncla
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
  //                tipoPago, estatus, ultimoPagoISO, socio?]
  // ultimoPago '' = aun sin pagar el ciclo (puede quedar vencido).
  // socio (10a columna, opcional): 'Octavio' marca al UNICO cliente que
  // le paga directo a Octavio (monto 500). El resto omite la columna y
  // queda en 'Carlos' por default via crearCliente.
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
    // Unico cliente que le paga directo a Octavio (socio 'Octavio', $500).
    ["CASA 17 CARMEN LAVAND", "9841003920", "10 MB", "2026-09-16", 500, 16, "PTP", "Activo", "2026-09-16", "Octavio"],
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
        ultimoPago: ultimoPago,
        socio: fila[9] // undefined para la mayoria -> 'Carlos' por default
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

    // Reparto de fin de mes entre socios
    luzAplicaEnMes: luzAplicaEnMes,
    gastosFijosDelMes: gastosFijosDelMes,
    calcularReparto: calcularReparto,

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

  /* ----------------------------------------------------------
     Criterio UNICO de "vencido" (hallazgo de revision #1)
     ------------------------------------------------------------
     Un cliente SOLO cuenta como vencido si esta Activo y su fecha de
     vencimiento ya paso. Un cliente Pausado NUNCA es "vencido": no se
     le cobra mientras esta en pausa. Esta funcion se usa en TODOS los
     conteos (chip "Vencidos", estadistica de vencidos y panel de Pagos)
     para que los numeros sean coherentes entre si.
     ---------------------------------------------------------- */
  function esVencido(cliente) {
    if (!cliente || cliente.estatus !== "Activo") {
      return false;
    }
    return PCC.estadoPago(cliente, HOY).clase === "vencido";
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
    renderEstadisticas(lista, movs);
    renderPagos(lista);
    renderClientes(lista);
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

    setTexto("#metrica-ingresos", PCC.formatoMoneda(ingresos));
    setTexto("#metrica-egresos", PCC.formatoMoneda(egresos));
    setTexto("#metrica-ganancia", PCC.formatoMoneda(ganancia));
    setTexto("#metrica-porcobrar", PCC.formatoMoneda(porCobrar));
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
      // Criterio unico: un Pausado nunca cuenta como vencido (ver esVencido).
      if (esVencido(c)) {
        vencidos += 1;
      } else {
        corriente += 1;
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
  function renderPagos(lista) {
    var contenedor = $("#lista-pagos");
    var vacio = $("#pagos-vacio");
    if (!contenedor) {
      return;
    }

    // Solo clientes vencidos o proximos (dentro de la ventana de aviso).
    // Los Pausados quedan fuera: mismo criterio que esVencido() usa en los
    // conteos de chips y estadisticas, para que todo sea coherente.
    var pendientes = lista.filter(function (c) {
      if (c.estatus !== "Activo") {
        return false;
      }
      var est = PCC.estadoPago(c, HOY);
      return est.clase === "vencido" || est.clase === "proximo";
    });

    // Ordenar por urgencia: menos dias restantes primero (mas vencido antes).
    pendientes.sort(function (a, b) {
      return PCC.diasRestantes(a, HOY) - PCC.diasRestantes(b, HOY);
    });

    // Resumen de la cabecera: numero de vencidos y suma de sus montos.
    var numVencidos = 0;
    var montoVencidos = 0;
    pendientes.forEach(function (c) {
      if (esVencido(c)) {
        numVencidos += 1;
        montoVencidos += Number(c.monto) || 0;
      }
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
  function renderClientes(lista) {
    // Conteos de los chips (sobre toda la cartera, independientes de la
    // busqueda, para que reflejen la totalidad por categoria).
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
      if (esVencido(c)) {
        conteos.vencidos += 1;
      }
    });
    setTexto("#cuenta-todos", String(conteos.todos));
    setTexto("#cuenta-activos", String(conteos.activos));
    setTexto("#cuenta-pausados", String(conteos.pausados));
    setTexto("#cuenta-vencidos", String(conteos.vencidos));
    setTexto("#cuenta-ptp", String(conteos.ptp));
    setTexto("#cuenta-directo", String(conteos.directo));

    // Aplicar filtro por chip.
    var filtrados = lista.filter(function (c) {
      switch (estado.filtroActivo) {
        case "activos":
          return c.estatus === "Activo";
        case "pausados":
          return c.estatus === "Pausado";
        case "vencidos":
          return esVencido(c);
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
      // 'proximo' (default): por dias restantes ascendente (urgencia).
      return PCC.diasRestantes(a, HOY) - PCC.diasRestantes(b, HOY);
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
    filtrados.forEach(function (c) {
      contenedor.appendChild(crearTarjeta(c));
    });
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

  function crearTarjeta(cliente) {
    var frag = tplTarjeta.content.cloneNode(true);
    var art = frag.querySelector(".tarjeta");
    var est = PCC.estadoPago(cliente, HOY);

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

    // Texto del boton pausar/reanudar segun estatus.
    var btnPausar = $(".accion-pausar", art);
    if (btnPausar) {
      if (cliente.estatus === "Pausado") {
        btnPausar.textContent = "▶️";
        btnPausar.title = "Reanudar";
        btnPausar.setAttribute("aria-label", "Reanudar");
      } else {
        btnPausar.textContent = "⏸️";
        btnPausar.title = "Pausar";
        btnPausar.setAttribute("aria-label", "Pausar");
      }
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
    var est = PCC.estadoPago(cliente, HOY);
    var venceTxt = PCC.formatoFechaLarga(cliente.fechaProximoPago);
    var montoTxt = PCC.formatoMoneda(cliente.monto);
    var mensaje =
      "Hola " +
      (cliente.nombre || "") +
      ", le recordamos su pago de internet por " +
      montoTxt +
      ". Fecha de vencimiento: " +
      venceTxt +
      ". " +
      (est.clase === "vencido"
        ? "Su pago está vencido, agradecemos ponerse al corriente. "
        : "") +
      "¡Gracias!";
    var url =
      "https://wa.me/" + tel + "?text=" + encodeURIComponent(mensaje);
    window.open(url, "_blank");
  }

  function accionPagar(cliente) {
    var lista = clientes();
    var idx = -1;
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === cliente.id) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      return;
    }
    var c = lista[idx];
    var hoyISO = PCC.fechaISO(new Date());

    // Registrar el movimiento de ingreso (pago).
    var movs = movimientos();
    movs.push({
      id: PCC.generarId(),
      tipo: "ingreso",
      esPago: true,
      concepto: "Pago de " + (c.nombre || "cliente"),
      monto: Number(c.monto) || 0,
      fecha: hoyISO
    });
    PCC.guardarMovimientos(movs);

    // Actualizar ultimoPago y recalcular proximo ciclo.
    c.ultimoPago = hoyISO;
    c.fechaProximoPago = PCC.fechaISO(PCC.calcularProximoPago(c, new Date()));
    PCC.guardarClientes(lista);

    render();
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
    } else {
      if (titulo) {
        titulo.textContent = "Nuevo Cliente";
      }
      setValor("#cliente-monto", PCC.MONTO_DEFAULT);
      setValor("#cliente-tipo-pago", "PTP");
      setValor("#cliente-estatus", "Activo");
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
    if (!celular.replace(/\D+/g, "")) {
      errores.push("El celular es obligatorio.");
    }
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
      estatus: valor("#cliente-estatus")
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
    PCC.guardarConfig({
      diasAviso: dias,
      moneda: valor("#config-moneda") || "MXN"
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
    var cabeceras = [
      "Nombre", "Celular", "Dirección", "IP", "Megas", "Monto",
      "Fecha instalación", "Día de pago", "Tipo", "Estatus", "Próximo pago"
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
        c.fechaProximoPago ? PCC.formatoFechaCorta(c.fechaProximoPago) : ""
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
      icono.textContent = tema === "oscuro" ? "☀️" : "🌙";
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
          accionPagar(cliente);
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

    // Cierre de modales (botones/overlay con data-cerrar-modal).
    $all("[data-cerrar-modal]").forEach(function (el) {
      el.addEventListener("click", cerrarModales);
    });

    // Cerrar modal con Escape.
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        cerrarModales();
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
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();

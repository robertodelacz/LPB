/**
 * ============================================================================
 * LPB · Bitacora.gs
 * Registro append-only, límites de uso y alertas.
 * ----------------------------------------------------------------------------
 * La bitácora cumple tres funciones distintas:
 *
 *   1. EVIDENCIA ANTE CNBV — demuestra que existe un sistema razonable de
 *      detección, análisis y reacción, con quién consultó qué y cuándo.
 *
 *   2. DETECCIÓN DE ABUSO — es el ÚNICO control real contra la reconstrucción
 *      de la lista por fuerza bruta. Un usuario autorizado puede lanzar
 *      consultas sistemáticas desde la consola y reconstruir buena parte del
 *      contenido; solo la bitácora lo delata. Por eso se guarda el texto
 *      completo de la consulta y no un hash: un hash no permite ver que
 *      alguien está enumerando el alfabeto.
 *
 *   3. TRAZABILIDAD DEL DICTAMEN — si alguien reclama una decisión, permite
 *      reconstruir exactamente qué mostró el sistema ese día.
 *
 * Como consecuencia de (2), la bitácora acumula nombres de personas
 * consultadas. Eso es tratamiento de datos personales bajo LFPDPPP con su
 * propio deber de resguardo: la hoja se protege y solo la ven ADMIN y AUDITOR.
 * ============================================================================
 */

var LPB_COL_BIT = {
  FECHA: 0, CORREO: 1, NOMBRE: 2, ROL: 3, ACCION: 4, CONSULTA: 5,
  TIPO: 6, RESULTADOS: 7, NIVEL_MAX: 8, FILAS: 9, MS: 10, DETALLE: 11
};

/**
 * Crea la hoja BITACORA. Ejecutar una sola vez.
 */
function lpbCrearHojaBitacora() {
  var ss = lpbLibroSistema_();
  if (ss.getSheetByName(LPB_HOJAS.BITACORA)) {
    throw new Error('La hoja BITACORA ya existe.');
  }
  var hoja = ss.insertSheet(LPB_HOJAS.BITACORA);
  var enc = ['FECHA Y HORA', 'CORREO', 'NOMBRE', 'ROL', 'ACCION',
             'CONSULTA', 'TIPO', 'RESULTADOS', 'NIVEL MAXIMO',
             'FILAS MOSTRADAS', 'MS', 'DETALLE'];
  hoja.getRange(1, 1, 1, enc.length).setValues([enc])
      .setFontWeight('bold').setBackground('#515151').setFontColor('#FFFFFF');
  hoja.setFrozenRows(1);
  hoja.autoResizeColumns(1, enc.length);
  return 'Hoja BITACORA creada.';
}

/**
 * Escribe una línea. Solo agrega; nunca modifica ni borra.
 * @param {Array} fila
 */
function lpbEscribirBitacora_(fila) {
  var lock = null;
  try {
    // BLOQUEO ENTRE EJECUCIONES SIMULTÁNEAS.
    //
    // appendRow calcula la última fila y escribe en dos pasos. Si dos usuarios
    // consultan en el mismo instante, ambos pueden leer el mismo número de
    // fila y uno sobrescribe al otro: se pierde un registro de bitácora sin
    // que nadie se entere. Con doce usuarios en horario de dictaminación es
    // un escenario realista, y perder evidencia es justo lo que este registro
    // existe para evitar.
    //
    // Se esperan hasta 10 segundos. Si no se obtiene el bloqueo se escribe
    // igual: una fila con riesgo de colisión es preferible a ninguna.
    lock = LockService.getScriptLock();
    try { lock.waitLock(10000); } catch (e) { lock = null; }

    var ss = lpbLibroSistema_();
    var hoja = ss.getSheetByName(LPB_HOJAS.BITACORA);
    if (!hoja) return;
    hoja.appendRow(fila);
  } catch (e) {
    // La bitácora nunca debe tumbar una consulta legítima. Si falla el
    // registro, la búsqueda sigue: es preferible una consulta sin registrar
    // a un analista que no puede consultar.
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e) {} }
  }
}

/**
 * Registra una consulta.
 * @param {Object} u  usuario
 * @param {string} texto
 * @param {Object} resultado  salida de lpbBuscar_
 * @param {number} ms
 */
function lpbRegistrarConsulta_(u, texto, resultado, ms) {
  var nivelMax = '', filas = [];
  if (resultado.resultados.length) {
    nivelMax = resultado.resultados[0].nivel || resultado.resultados[0].banda;
    filas = resultado.resultados.map(function (r) { return r.filaLPB; });
  }
  lpbEscribirBitacora_([
    new Date(), u.correo, u.nombre, u.rol, 'CONSULTA',
    String(texto), resultado.tipo, resultado.total,
    nivelMax, filas.join(','), ms,
    'evaluados=' + resultado.evaluados
  ]);
}

/**
 * Registra una exportación. El documento sale del sistema; sin este registro
 * no quedaría rastro de quién se llevó qué.
 */
function lpbRegistrarExportacion_(u, texto, total) {
  lpbEscribirBitacora_([
    new Date(), u.correo, u.nombre, u.rol, 'EXPORTACION',
    String(texto), '', total, '', '', '', 'Documento de evidencia generado'
  ]);
}

/** Registra un intento de acceso rechazado. */
function lpbRegistrarAccesoDenegado_(correo, motivo) {
  lpbEscribirBitacora_([
    new Date(), correo || '(sin identificar)', '', '', 'ACCESO_DENEGADO',
    '', '', 0, '', '', '', motivo
  ]);
}

/** Registra una acción administrativa sobre usuarios. */
function lpbRegistrarAdmin_(admin, accion, objetivo, detalle) {
  lpbEscribirBitacora_([
    new Date(), admin.correo, admin.nombre, admin.rol, 'ADMIN_' + accion,
    objetivo, '', 0, '', '', '', detalle
  ]);
}

/* ==========================================================================
 * Límite de uso
 * ========================================================================== */

/**
 * Controla el número de consultas por usuario por hora.
 *
 * Éste es el freno contra la reconstrucción por fuerza bruta: un usuario
 * autorizado que lanzara consultas sistemáticas desde la consola podría
 * reconstruir buena parte de la lista. El tope no lo impide del todo, pero
 * lo vuelve lento y ruidoso — y dispara la alerta.
 *
 * @param {Object} u
 * @return {{permitido: boolean, usadas: number, restantes: number}}
 */
function lpbVerificarLimite_(u) {
  var props = PropertiesService.getScriptProperties();
  var clave = 'lpb_uso_' + u.correo;
  var ahora = new Date().getTime();
  var ventana = 3600000;   // una hora

  var crudo = props.getProperty(clave);
  var marcas = crudo ? JSON.parse(crudo) : [];
  marcas = marcas.filter(function (t) { return ahora - t < ventana; });

  if (marcas.length >= LPB_PARAMS.MAX_CONSULTAS_HORA) {
    lpbAlertarUsoAnomalo_(u, marcas.length);
    return { permitido: false, usadas: marcas.length, restantes: 0 };
  }

  marcas.push(ahora);
  props.setProperty(clave, JSON.stringify(marcas));

  // Aviso temprano al 80% del tope, antes de que el usuario se tope con pared.
  if (marcas.length === Math.floor(LPB_PARAMS.MAX_CONSULTAS_HORA * 0.8)) {
    lpbAlertarUsoAnomalo_(u, marcas.length);
  }

  return {
    permitido: true,
    usadas: marcas.length,
    restantes: LPB_PARAMS.MAX_CONSULTAS_HORA - marcas.length
  };
}

/**
 * Notifica al Oficial de Cumplimiento un patrón de uso anómalo.
 * @param {Object} u
 * @param {number} consultas
 */
function lpbAlertarUsoAnomalo_(u, consultas) {
  // El registro en bitácora ocurre SIEMPRE: es evidencia, no notificación.
  lpbEscribirBitacora_([
    new Date(), u.correo, u.nombre, u.rol, 'ALERTA_USO',
    '', '', consultas, '', '', '',
    'Volumen inusual: ' + consultas + ' consultas en una hora'
  ]);

  // El correo sí se puede apagar por ambiente.
  if (!LPB_CORREOS_ACTIVOS) return;

  var admins = lpbDestinatariosAlerta_();
  if (!admins.length) return;
  try {
    MailApp.sendEmail({
      to: admins.join(','),
      subject: '[LPB] Volumen de consulta inusual — ' + u.nombre,
      body: 'El sistema de consulta de la Lista de Personas Bloqueadas registró ' +
            'un volumen inusual de consultas.\n\n' +
            'Usuario : ' + u.nombre + ' (' + u.correo + ')\n' +
            'Área    : ' + u.area + '\n' +
            'Rol     : ' + u.rol + '\n' +
            'Consultas en la última hora: ' + consultas + '\n\n' +
            'Puede tratarse de trabajo legítimo en volumen. Revise la hoja ' +
            'BITACORA para ver el detalle de las consultas.\n\n' +
            '— Aviso automático. No responda a este correo.'
    });
  } catch (e) { /* el correo es best-effort */ }
}

/**
 * Correos activos de un rol.
 * @param {string} rol
 * @return {string[]}
 */
function lpbCorreosPorRol_(rol) {
  var usuarios = lpbLeerAutorizados_(false);
  var salida = [];
  for (var c in usuarios) {
    if (usuarios[c].rol === rol && usuarios[c].activo) salida.push(usuarios[c].correo);
  }
  return salida;
}

/**
 * Destinatarios de las alertas: los administradores activos más los buzones
 * institucionales configurados en Config.gs.
 *
 * Los buzones se agregan aquí y no en AUTORIZADOS porque no son usuarios: no
 * entran al sistema, solo reciben avisos. Darles acceso rompería la
 * trazabilidad, ya que una dirección compartida no identifica a nadie.
 *
 * @return {string[]}  sin duplicados
 */
function lpbDestinatariosAlerta_() {
  var lista = lpbCorreosPorRol_(LPB_ROLES.ADMIN);

  if (typeof LPB_BUZONES_ALERTA !== 'undefined') {
    LPB_BUZONES_ALERTA.forEach(function (b) {
      var c = String(b || '').trim().toLowerCase();
      if (c && lista.indexOf(c) === -1) lista.push(c);
    });
  }
  return lista;
}

/* ==========================================================================
 * Alerta de coincidencia confirmada
 * ========================================================================== */

/**
 * Notifica una coincidencia CONFIRMADA al Oficial de Cumplimiento.
 *
 * DISEÑO DELIBERADO — solo dispara en CONFIRMADA, es decir cuando coincidió
 * un RFC completo o un CURP. NO dispara con nombres parecidos.
 *
 * Si alertara con coincidencias de nombre, el Oficial recibiría correos a
 * diario, dejaría de leerlos, y el control moriría por saturación. Un control
 * que nadie lee es peor que no tenerlo: da falsa tranquilidad.
 *
 * @param {Object} u
 * @param {string} texto
 * @param {Object} r  primer resultado
 */
function lpbAlertarCoincidenciaConfirmada_(u, texto, r) {
  // Interruptor de ambiente: en pruebas las consultas de ensayo generan
  // coincidencias reales y alertarían por operaciones que no existen.
  if (!LPB_CORREOS_ACTIVOS) return;

  var admins = lpbDestinatariosAlerta_();
  if (!admins.length) return;
  try {
    MailApp.sendEmail({
      to: admins.join(','),
      subject: '[LPB] Coincidencia CONFIRMADA — atención inmediata',
      body: 'Se detectó una coincidencia confirmada por identificador oficial ' +
            'en la Lista de Personas Bloqueadas.\n\n' +
            'Consultó   : ' + u.nombre + ' (' + u.correo + '), ' + u.area + '\n' +
            'Fecha      : ' + Utilities.formatDate(new Date(),
                                Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') + '\n' +
            'Búsqueda   : ' + texto + '\n' +
            'Coincidió por: ' + (r.motivos || []).join(', ') + '\n' +
            'Puntaje    : ' + r.puntaje + '\n\n' +
            'Este aviso NO constituye dictamen. Verifique contra el oficio ' +
            'original antes de resolver.\n\n' +
            'CONFIDENCIAL — prohibida su divulgación a terceros y al titular ' +
            'de los datos.\n\n' +
            '— Aviso automático. No responda a este correo.'
    });
  } catch (e) { /* best-effort */ }
}

/* ==========================================================================
 * Consulta de bitácora — ADMIN y AUDITOR
 * ========================================================================== */

/**
 * Devuelve los registros más recientes de la bitácora.
 * @param {Object=} filtros {correo, accion, desde, hasta, limite}
 * @return {Array}
 */
function lpbConsultarBitacora(filtros) {
  lpbExigir_('bitacora');
  filtros = filtros || {};
  var limite = Math.min(filtros.limite || 200, 1000);

  var ss = lpbLibroSistema_();
  var hoja = ss.getSheetByName(LPB_HOJAS.BITACORA);
  if (!hoja || hoja.getLastRow() < 2) return [];

  var n = hoja.getLastRow() - 1;
  // Con filtro de fecha se rastrea más atrás: sin eso, pedir un día de hace
  // seis meses no encontraría nada porque solo se leían las filas recientes.
  var leer = Math.min(n, (filtros.desde || filtros.hasta) ? 20000 : 5000);
  var datos = hoja.getRange(hoja.getLastRow() - leer + 1, 1, leer, 12).getValues();

  var salida = [];
  for (var i = datos.length - 1; i >= 0 && salida.length < limite; i--) {
    var f = datos[i];
    if (filtros.correo && String(f[LPB_COL_BIT.CORREO]).toLowerCase()
        .indexOf(String(filtros.correo).toLowerCase()) === -1) continue;
    if (filtros.accion && f[LPB_COL_BIT.ACCION] !== filtros.accion) continue;
    // Las fechas se comparan como objetos Date del propio Sheet. El filtro
    // 'hasta' incluye el día completo: sin el ajuste, pedir "hasta el 29" no
    // devolvería nada de ese día, porque la medianoche es su inicio.
    if (filtros.desde) {
      var d1 = new Date(filtros.desde + 'T00:00:00');
      if (!(f[LPB_COL_BIT.FECHA] instanceof Date) || f[LPB_COL_BIT.FECHA] < d1) continue;
    }
    if (filtros.hasta) {
      var d2 = new Date(filtros.hasta + 'T23:59:59');
      if (!(f[LPB_COL_BIT.FECHA] instanceof Date) || f[LPB_COL_BIT.FECHA] > d2) continue;
    }
    if (filtros.texto) {
      var t = String(filtros.texto).toLowerCase();
      var enFila = (String(f[LPB_COL_BIT.CONSULTA]) + ' ' + String(f[LPB_COL_BIT.NOMBRE]) +
                    ' ' + String(f[LPB_COL_BIT.CORREO])).toLowerCase();
      if (enFila.indexOf(t) === -1) continue;
    }

    // La fecha se formatea EN EL SERVIDOR. Devolver objetos Date a través de
    // google.script.run es frágil: cualquier valor no serializable en la fila
    // rompe la respuesta completa y el cliente se queda en "Cargando…" sin
    // disparar el manejador de error. Enviar texto elimina esa clase de falla.
    salida.push({
      fecha:      lpbFechaHoraTexto_(f[LPB_COL_BIT.FECHA]),
      correo:     String(f[LPB_COL_BIT.CORREO] || ''),
      nombre:     String(f[LPB_COL_BIT.NOMBRE] || ''),
      rol:        String(f[LPB_COL_BIT.ROL] || ''),
      accion:     String(f[LPB_COL_BIT.ACCION] || ''),
      consulta:   String(f[LPB_COL_BIT.CONSULTA] || ''),
      tipo:       String(f[LPB_COL_BIT.TIPO] || ''),
      resultados: Number(f[LPB_COL_BIT.RESULTADOS] || 0),
      nivelMax:   String(f[LPB_COL_BIT.NIVEL_MAX] || ''),
      detalle:    String(f[LPB_COL_BIT.DETALLE] || '')
    });
  }
  return salida;
}

/**
 * Fecha y hora en texto, listo para mostrar.
 * @param {*} v
 * @return {string}
 */
function lpbFechaHoraTexto_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  }
  return String(v);
}

/**
 * Lista de acciones distintas registradas en la bitácora.
 * Alimenta el selector de filtro, para no ofrecer opciones inexistentes.
 * @return {string[]}
 */
function apiAccionesBitacora() {
  lpbExigir_('bitacora');
  var ss = lpbLibroSistema_();
  var hoja = ss.getSheetByName(LPB_HOJAS.BITACORA);
  if (!hoja || hoja.getLastRow() < 2) return [];

  var n = Math.min(hoja.getLastRow() - 1, 20000);
  var col = hoja.getRange(hoja.getLastRow() - n + 1, LPB_COL_BIT.ACCION + 1, n, 1).getValues();
  var vistas = {};
  for (var i = 0; i < col.length; i++) {
    var a = String(col[i][0] || '').trim();
    if (a) vistas[a] = true;
  }
  return Object.keys(vistas).sort();
}

/**
 * Resumen de actividad para el panel de vigilancia.
 * @param {number=} dias
 * @return {Object}
 */
function lpbResumenActividad(dias) {
  lpbExigir_('bitacora');
  dias = dias || 30;
  var corte = new Date(new Date().getTime() - dias * 86400000);

  var registros = lpbConsultarBitacora({ limite: 1000, desde: corte });
  var porDia = {};
  var porUsuario = {}, porAccion = {}, confirmadas = 0, denegados = 0;

  registros.forEach(function (r) {
    porUsuario[r.nombre || r.correo] = (porUsuario[r.nombre || r.correo] || 0) + 1;
    porAccion[r.accion] = (porAccion[r.accion] || 0) + 1;
    if (r.nivelMax === 'CONFIRMADA') confirmadas++;
    if (r.accion === 'ACCESO_DENEGADO') denegados++;
    var dia = String(r.fecha).substring(0, 10);
    if (dia) porDia[dia] = (porDia[dia] || 0) + 1;
  });

  return {
    dias: dias, total: registros.length,
    porUsuario: porUsuario, porAccion: porAccion, porDia: porDia,
    confirmadas: confirmadas, accesosDenegados: denegados
  };
}

/* ==========================================================================
 * Vigencia de la lista y reindexado automático
 * ========================================================================== */

/**
 * Estado de vigencia que se muestra en el encabezado de la interfaz.
 *
 * Dos fechas distintas y ambas necesarias:
 *   · fechaCorte      — el acuerdo más reciente capturado. Es lo que va en el
 *                       documento de evidencia: "sin coincidencias con fecha
 *                       de corte DD/MM/AAAA".
 *   · fechaIndice     — cuándo se reconstruyó el índice. Si la captura avanzó
 *                       y el índice no, hay registros invisibles.
 *
 * @return {Object}
 */
function lpbEstadoVigencia_() {
  var props = PropertiesService.getScriptProperties();
  var fechaIndice = props.getProperty('lpb_indice_fecha');
  var registros   = props.getProperty('lpb_indice_registros');

  // La fecha de corte se lee de una propiedad, calculada durante el
  // reindexado. Antes se obtenía recorriendo la columna de fechas de los
  // 10,010 registros EN CADA ENTRADA al sistema, y era lo que hacía lento el
  // arranque. Si la propiedad no existe todavía se recurre al recorrido, para
  // que un índice antiguo no deje la pantalla sin fecha.
  var fechaCorte = props.getProperty('lpb_fecha_corte') || null;

  if (!fechaCorte) {
    var ss = lpbLibroLista_();
    var hoja = ss.getSheetByName(LPB_HOJAS.LISTA);
    if (hoja && hoja.getLastRow() >= LPB_FILA_DATOS) {
      var n = hoja.getLastRow() - LPB_FILA_DATOS + 1;
      var col = hoja.getRange(LPB_FILA_DATOS, LPB_COL.FECHA_PUBLICACION + 1, n, 1).getValues();
      for (var i = 0; i < col.length; i++) {
        var f = lpbFechaISO_(col[i][0]);
        if (f && (!fechaCorte || f > fechaCorte)) fechaCorte = f;
      }
      if (fechaCorte) props.setProperty('lpb_fecha_corte', fechaCorte);
    }
  }

  var diasIndice = fechaIndice
    ? Math.floor((new Date() - new Date(fechaIndice)) / 86400000) : 999;

  // DÍAS SIN CAPTURA. Es el indicador que importa: mide el trabajo humano de
  // incorporar oficios, no el trabajo automático de reconstruir el índice.
  //
  // Si nunca se ha registrado una captura —instalación reciente— se toma la
  // fecha del índice como punto de partida para no alarmar sin motivo.
  var ultimaCaptura = props.getProperty('lpb_ultima_captura') || fechaIndice;
  var diasCaptura = ultimaCaptura
    ? Math.floor((new Date() - new Date(ultimaCaptura)) / 86400000) : 999;

  var semaforo = 'verde';
  var aviso = '';

  // 1) Índice desfasado — falla técnica del disparador
  if (diasIndice > LPB_PARAMS.DIAS_ALERTA_VIGENCIA) {
    semaforo = 'ambar';
    aviso = 'El índice no se ha reconstruido en ' + diasIndice + ' días. ' +
            'Puede haber registros capturados que aún no son consultables.';
  }
  if (diasIndice > 15) {
    semaforo = 'rojo';
    aviso = 'El índice tiene ' + diasIndice + ' días sin reconstruirse. ' +
            'Avise al Oficial de Cumplimiento antes de confiar en un resultado.';
  }

  // 2) Lista sin captura — falla del proceso, y pesa más que la anterior.
  //    Se evalúa después para que su mensaje prevalezca: un índice al día
  //    sobre una lista vieja es más engañoso que un índice desfasado, porque
  //    no hay ninguna señal de que algo esté mal.
  if (diasCaptura > LPB_PARAMS.DIAS_SIN_CAPTURA_AMBAR) {
    semaforo = 'ambar';
    aviso = 'No se incorporan registros nuevos desde hace ' + diasCaptura + ' días. ' +
            'Confirme con Cumplimiento que los oficios de la UIF estén al corriente.';
  }
  if (diasCaptura > LPB_PARAMS.DIAS_SIN_CAPTURA_ROJO) {
    semaforo = 'rojo';
    aviso = 'La lista lleva ' + diasCaptura + ' días sin incorporar registros nuevos. ' +
            'Un resultado negativo NO garantiza que la persona no esté bloqueada: ' +
            'verifique con el Oficial de Cumplimiento antes de resolver.';
  }

  return {
    fechaCorte:    fechaCorte,
    fechaIndice:   fechaIndice,
    diasIndice:    diasIndice,
    ultimaCaptura: ultimaCaptura,
    diasCaptura:   diasCaptura,
    registros:   registros ? parseInt(registros, 10) : 0,
    semaforo:    semaforo,
    aviso:       aviso
  };
}

/**
 * Instala el disparador que reconstruye el índice al editar la hoja LPB.
 *
 * Si Verónica captura registros y nadie reindexa, esos registros son
 * INVISIBLES para el buscador aunque estén escritos en la hoja. Es el fallo
 * silencioso más peligroso del sistema, y por eso el reindexado no puede
 * depender de que alguien recuerde apretar un botón.
 *
 * Ejecutar una sola vez, manualmente.
 */
function lpbInstalarDisparadores() {
  lpbExigir_('reindexar');

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'lpbReindexarProgramado') ScriptApp.deleteTrigger(t);
  });

  // Cada hora. No en cada edición: capturar 40 registros dispararía 40
  // reconstrucciones y agotaría la cuota de ejecución.
  ScriptApp.newTrigger('lpbReindexarProgramado').timeBased().everyHours(1).create();

  return 'Disparador instalado: reindexado automático cada hora.';
}

/**
 * Reconstruye el índice solo si la hoja LPB creció desde la última vez.
 */
function lpbReindexarProgramado() {
  try {
    var props = PropertiesService.getScriptProperties();
    var ss = lpbLibroLista_();
    var hoja = ss.getSheetByName(LPB_HOJAS.LISTA);
    if (!hoja) return;

    var filasActuales = hoja.getLastRow() - LPB_FILA_DATOS + 1;
    var ultimas = parseInt(props.getProperty('lpb_ultimas_filas') || '0', 10);

    if (filasActuales === ultimas) return;   // nada cambió

    var stats = lpbConstruirIndice_();

    // Se guarda CUÁNDO CRECIÓ LA LISTA, no solo cuándo se reindexó.
    //
    // El semáforo vigilaba únicamente el reindexado, y éste corre cada hora
    // haya o no registros nuevos: si nadie capturaba oficios durante un mes,
    // el índice seguía reconstruyéndose puntualmente y la pantalla se veía
    // verde. El fallo silencioso no era el índice viejo, era la lista vieja.
    if (filasActuales > ultimas) {
      props.setProperty('lpb_ultima_captura', new Date().toISOString());
      props.setProperty('lpb_altas_ultima_captura', String(filasActuales - ultimas));
    }
    props.setProperty('lpb_ultimas_filas', String(filasActuales));

    lpbEscribirBitacora_([
      new Date(), '(sistema)', 'Reindexado automático', '', 'REINDEXADO',
      '', '', stats.registros, '', '', '',
      'conRFC=' + stats.conRFC + ' conCURP=' + stats.conCURP +
      ' soloNombre=' + stats.soloNombre + ' multiIdentidad=' + stats.multiIdentidad
    ]);
  } catch (e) {
    lpbEscribirBitacora_([
      new Date(), '(sistema)', 'Reindexado automático', '', 'ERROR_REINDEXADO',
      '', '', 0, '', '', '', String(e)
    ]);
  }
}

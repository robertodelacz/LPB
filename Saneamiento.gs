/**
 * ============================================================================
 * LPB · Saneador.gs
 * Clasificación de identificadores POR CONTENIDO, no por columna.
 * ----------------------------------------------------------------------------
 * MOTIVO — hallazgo sobre datos reales (21 registros, acuerdo 311/2026):
 *
 *   De 21 valores en la columna RFC:
 *      12  RFC verdadero
 *       2  CURP  (VISJ700720HJCLNR02 y otro)
 *       6  fecha de constitución (30/06/2023, 02/08/2019, ...)
 *       1  marcador de nulo "(-----)"
 *   Las columnas FECHA NACIMIENTO/CONSTITUCION y CURP venían vacías.
 *
 * Quien captura coloca en la columna de RFC el identificador que traiga el
 * oficio, sea del tipo que sea. Es una decisión operativa entendible, pero
 * significa que el TIPO DE DATO NO SE PUEDE DEDUCIR DE LA COLUMNA.
 *
 * Dos consecuencias medidas antes de escribir este módulo:
 *
 *   a) Los CURP quedaban invisibles: se leían como RFC, no cuadraban con
 *      ningún formato, y nadie podía encontrar a esa persona por su CURP.
 *
 *   b) PEOR — las fechas producían alertas críticas falsas. Dos empresas sin
 *      relación con "30/06/2023" en la columna RFC se limpiaban a "30062023"
 *      y comparaban como RFC_RAIZ_EXACTA = 98 puntos, banda CRÍTICA. Como las
 *      fechas de constitución se repiten mucho (cierres de semestre y de año),
 *      esto no habría sido un caso aislado sino un ruido permanente.
 *
 * Este módulo lee las tres columnas de identificador (C, D y E) como un solo
 * costal y reparte cada valor a donde corresponde según lo que sea.
 * ============================================================================
 */

/** Textos que significan "no hay dato". */
var LPB_MARCADORES_NULOS = [
  '(-----)', '(----)', '(---)', '(--)', '(-)', '-----', '----', '---', '--', '-',
  'N/A', 'NA', 'S/D', 'SD', 'SIN DATO', 'SIN RFC', 'SIN CURP', 'NO APLICA',
  'NO DISPONIBLE', 'NO CUENTA CON RFC', 'NO CUENTA CON CURP', '.', '..', '...'
];

var LPB_MESES = {
  'ENERO': 1, 'FEBRERO': 2, 'MARZO': 3, 'ABRIL': 4, 'MAYO': 5, 'JUNIO': 6,
  'JULIO': 7, 'AGOSTO': 8, 'SEPTIEMBRE': 9, 'SETIEMBRE': 9, 'OCTUBRE': 10,
  'NOVIEMBRE': 11, 'DICIEMBRE': 12
};

/**
 * ¿Este valor significa "no hay dato"?
 * @param {*} v
 * @return {boolean}
 */
function lpbEsNulo_(v) {
  if (v === null || v === undefined) return true;
  var s = String(v).trim().toUpperCase();
  if (s === '') return true;
  if (LPB_MARCADORES_NULOS.indexOf(s) !== -1) return true;
  // Solo guiones, paréntesis, puntos o espacios
  if (/^[\s\-\(\)\.\_]*$/.test(s)) return true;
  return false;
}

/**
 * Extrae TODOS los CURP válidos contenidos en un texto.
 * Un registro puede traer varios; cada uno debe ser buscable por separado.
 * @param {*} v
 * @return {string[]}
 */
function lpbExtraerCURPs_(v) {
  if (lpbEsNulo_(v)) return [];
  var texto = lpbUnirSeparadores_(String(v).toUpperCase());
  var encontrados = [];
  var re = /[A-ZÑ]{4}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-ZÑ]{3}[A-Z0-9]\d/g;
  var m;
  while ((m = re.exec(texto)) !== null) {
    // Se acepta con estructura y fecha embebida válidas AUNQUE FALLE EL
    // DÍGITO VERIFICADOR. Un CURP mal transcrito sigue siendo altamente
    // identificatorio; rechazarlo lo vuelve invisible, que es peor que
    // indexarlo con una marca. La validación estricta sigue existiendo en
    // lpbValidarCURP_ para avisar al capturista.
    var v18 = lpbValidarCURP_(m[0]);
    if (v18.fecha && encontrados.indexOf(m[0]) === -1) encontrados.push(m[0]);
  }
  return encontrados;
}

/**
 * Une identificadores partidos por guiones o espacios internos.
 * Detectado sobre datos reales: "AAA999999-999" y "AAA999999-A99" traían el
 * RFC con guion antes de la homoclave, y el delimitador de palabra impedía
 * reconocerlo.
 * @param {string} texto
 * @return {string}
 */
function lpbUnirSeparadores_(texto) {
  return String(texto)
    .replace(/([A-ZÑ&])[\-\s]+(?=\d)/g, '$1')
    .replace(/(\d)[\-\s]+(?=[A-Z0-9]{2,3}\b)/g, '$1');
}

/**
 * Extrae TODOS los RFC válidos contenidos en un texto.
 * Cubre el caso de dos RFC separados por diagonal, coma o "y".
 * @param {*} v
 * @return {string[]}
 */
function lpbExtraerRFCs_(v) {
  if (lpbEsNulo_(v)) return [];
  var texto = lpbUnirSeparadores_(String(v).toUpperCase());

  // Se quitan primero los CURP para que sus 13 primeros caracteres no se
  // confundan con un RFC de persona física.
  lpbExtraerCURPs_(texto).forEach(function (c) { texto = texto.split(c).join(' '); });

  var encontrados = [];

  function agregar(r) {
    if (!lpbRfcFecha_(r)) return;      // la fecha embebida debe existir de verdad
    var raiz = lpbRfcPartes_(r).raiz;
    for (var i = 0; i < encontrados.length; i++) {
      if (lpbRfcPartes_(encontrados[i]).raiz === raiz) return;   // ya está por su raíz
    }
    encontrados.push(r);
  }

  // Paso 1 — RFC completo con homoclave.
  var re1 = /\b([A-ZÑ&]{4}\d{6}[A-Z0-9]{3}|[A-ZÑ&]{3}\d{6}[A-Z0-9]{3})\b/g, m;
  while ((m = re1.exec(texto)) !== null) agregar(m[1]);

  // Paso 2 — RFC SIN HOMOCLAVE.
  //
  // Hallazgo sobre los 10,010 registros reales: 1,488 registros (78% de los
  // que aparecían "sin identificador") traían la forma AAAA999999, y 44 más
  // la forma AAA999999. Son la RAÍZ del RFC, capturada sin homoclave.
  //
  // Exigir la homoclave era doblemente equivocado: la raíz es justamente la
  // parte identificatoria — codifica nombre y fecha de nacimiento — mientras
  // que la homoclave es un relleno de control del SAT. Se estaban tirando
  // 1,532 registros por exigir la parte que no sirve para identificar.
  var re2 = /\b([A-ZÑ&]{4}\d{6}|[A-ZÑ&]{3}\d{6})\b/g;
  while ((m = re2.exec(texto)) !== null) agregar(m[1]);

  return encontrados;
}

/**
 * Extrae TODAS las fechas contenidas en un texto, en cualquier formato usual.
 * Incluye el formato narrativo "13 DE ENERO DE 1962", que aparece cuando el
 * oficio reporta varias fechas de nacimiento para la misma persona.
 * @param {*} v
 * @return {string[]}  ISO yyyy-mm-dd
 */
function lpbExtraerFechas_(v) {
  if (lpbEsNulo_(v)) return [];

  // Un objeto Date llega directo de Sheets sin pasar por texto.
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    var iso = lpbFechaISO_(v);
    return iso ? [iso] : [];
  }

  var texto = String(v).toUpperCase();
  var fechas = [];

  function agregar(a, mm, dd) {
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return;
    var d = new Date(a, mm - 1, dd);
    if (d.getMonth() !== mm - 1 || d.getDate() !== dd) return;
    var iso = a + '-' + ('0' + mm).slice(-2) + '-' + ('0' + dd).slice(-2);
    if (fechas.indexOf(iso) === -1) fechas.push(iso);
  }

  // dd/mm/aaaa  ·  dd-mm-aaaa
  var re1 = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/g, m;
  while ((m = re1.exec(texto)) !== null) {
    agregar(parseInt(m[3], 10), parseInt(m[2], 10), parseInt(m[1], 10));
  }
  // aaaa-mm-dd
  var re2 = /\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/g;
  while ((m = re2.exec(texto)) !== null) {
    agregar(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  }
  // "13 DE ENERO DE 1962"
  var re3 = /\b(\d{1,2})\s+DE\s+([A-ZÁÉÍÓÚ]+)\s+DE\s+(\d{4})\b/g;
  while ((m = re3.exec(texto)) !== null) {
    var mes = LPB_MESES[m[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '')];
    if (mes) agregar(parseInt(m[3], 10), mes, parseInt(m[1], 10));
  }

  // Año suelto. Detectado en 15 registros reales con solo "9999" capturado.
  // No sirve para confirmar identidad, pero sí para DESCARTARLA: si el año
  // difiere por décadas, es argumento en contra de la coincidencia.
  if (fechas.length === 0) {
    var re4 = /\b(1[89]\d{2}|20[0-2]\d)\b/g;
    while ((m = re4.exec(texto)) !== null) {
      var iso = m[1] + '-00-00';
      if (fechas.indexOf(iso) === -1) fechas.push(iso);
    }
  }
  return fechas;
}

/**
 * Sanea un registro completo.
 *
 * Lee las tres columnas de identificador como un solo costal y reparte cada
 * valor según lo que REALMENTE es. La columna de origen es irrelevante.
 *
 * @param {Array} fila  fila cruda de la hoja LPB
 * @return {Object}
 */
function lpbSanearRegistro_(fila) {
  var candidatos = [
    fila[LPB_COL.FECHA_NAC],
    fila[LPB_COL.RFC],
    fila[LPB_COL.CURP]
  ];

  var curps = [], rfcs = [], fechas = [], sobrante = [];

  candidatos.forEach(function (v) {
    if (lpbEsNulo_(v)) return;
    var c = lpbExtraerCURPs_(v);
    var r = lpbExtraerRFCs_(v);
    var f = lpbExtraerFechas_(v);

    c.forEach(function (x) { if (curps.indexOf(x) === -1) curps.push(x); });
    r.forEach(function (x) { if (rfcs.indexOf(x) === -1) rfcs.push(x); });
    f.forEach(function (x) { if (fechas.indexOf(x) === -1) fechas.push(x); });

    // Texto que no rindió ningún identificador: se conserva para mostrarlo,
    // nunca para comparar.
    if (c.length === 0 && r.length === 0 && f.length === 0) {
      sobrante.push(String(v).trim());
    }
  });

  // Si no se capturó fecha por separado, se recupera la que viene embebida
  // en el CURP o en el RFC. Como la columna de fecha de nacimiento casi nunca
  // se llena, ésta es la principal fuente del desempate por fecha.
  if (fechas.length === 0) {
    curps.forEach(function (c) {
      var f = lpbValidarCURP_(c).fecha;
      if (f && fechas.indexOf(f) === -1) fechas.push(f);
    });
  }
  if (fechas.length === 0) {
    rfcs.forEach(function (r) {
      var f = lpbRfcFecha_(r);
      if (f && fechas.indexOf(f) === -1) fechas.push(f);
    });
  }

  return {
    curps:    curps,
    rfcs:     rfcs,
    fechas:   fechas,
    sobrante: sobrante.join(' | '),
    // Con qué cuenta REALMENTE este registro. Determina si el analista puede
    // confirmar la coincidencia con algo más que el nombre.
    tieneCURP:  curps.length > 0,
    tieneRFC:   rfcs.length > 0,
    tieneFecha: fechas.length > 0,
    soloNombre: curps.length === 0 && rfcs.length === 0 && fechas.length === 0
  };
}

/**
 * Etiqueta legible de la fuerza probatoria de un registro.
 * Se muestra al analista junto al resultado.
 * @param {Object} san  salida de lpbSanearRegistro_
 * @return {string}
 */
function lpbEtiquetaIdentificadores_(san) {
  if (san.tieneCURP) return 'CURP disponible — identificación confirmable';
  if (san.tieneRFC)  return 'RFC disponible — identificación confirmable';
  if (san.tieneFecha) return 'Solo fecha — confirmación parcial';
  return 'SIN IDENTIFICADOR — la coincidencia se basa únicamente en el nombre';
}

/**
 * ============================================================================
 * LPB · Identificadores.gs
 * RFC, CURP y fecha de nacimiento — los desempates que el nombre no puede dar.
 * ----------------------------------------------------------------------------
 * Ningún algoritmo de comparación de cadenas puede distinguir a dos personas
 * que genuinamente se llaman igual: la información para separarlas nunca
 * estuvo en el nombre. Por eso el puntaje del nombre siempre se cruza con
 * una segunda característica identificatoria.
 *
 * Estos identificadores además tienen estructura verificable, lo que permite
 * detectar errores de captura EN EL MOMENTO en lugar de descubrirlos meses
 * después en una consulta que no encuentra a quien debía encontrar.
 * ============================================================================
 */

var LPB_ALFABETO_CURP = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
var LPB_ESTADOS_CURP = [
  'AS','BC','BS','CC','CL','CM','CS','CH','DF','DG','GT','GR','HG','JC','MC',
  'MN','MS','NT','NL','OC','PL','QT','QR','SP','SL','SR','TC','TS','TL','VZ',
  'YN','ZS','NE'
];

/**
 * Limpia un identificador: mayúsculas, sin espacios ni guiones.
 * @param {string} v
 * @return {string}
 */
function lpbLimpiarId_(v) {
  if (!v) return '';
  return String(v).toUpperCase().replace(/[^A-ZÑ0-9]/g, '');
}

/* ==========================================================================
 * RFC
 * ========================================================================== */

/**
 * Raíz del RFC: el identificador sin homoclave.
 *
 * Persona física : 4 letras + AAMMDD + 3 homoclave = 13  -> raíz = 10
 * Persona moral  : 3 letras + AAMMDD + 3 homoclave = 12  -> raíz = 9
 *
 * La raíz codifica nombre y fecha de nacimiento. Una coincidencia de raíz es
 * evidencia mucho más fuerte que cualquier puntaje de nombre, porque no
 * depende de cómo se escribió el nombre.
 *
 * @param {string} rfc
 * @return {{raiz: string, homoclave: string, tipo: string, valido: boolean}}
 */
function lpbRfcPartes_(rfc) {
  var r = lpbLimpiarId_(rfc);
  if (r.length === 13) {
    return { raiz: r.slice(0, 10), homoclave: r.slice(10), tipo: 'FISICA',
             valido: /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/.test(r) };
  }
  if (r.length === 12) {
    return { raiz: r.slice(0, 9), homoclave: r.slice(9), tipo: 'MORAL',
             valido: /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/.test(r) };
  }
  // RFC capturado sin homoclave — pasa igual, es utilizable
  if (r.length === 10) return { raiz: r, homoclave: '', tipo: 'FISICA', valido: /^[A-ZÑ&]{4}\d{6}$/.test(r) };
  if (r.length === 9)  return { raiz: r, homoclave: '', tipo: 'MORAL',  valido: /^[A-ZÑ&]{3}\d{6}$/.test(r) };
  return { raiz: r, homoclave: '', tipo: 'DESCONOCIDO', valido: false };
}

/**
 * Fecha embebida en el RFC.
 * @param {string} rfc
 * @return {string}  ISO yyyy-mm-dd, o '' si no se puede extraer
 */
function lpbRfcFecha_(rfc) {
  var p = lpbRfcPartes_(rfc);
  var m = p.raiz.match(/(\d{6})$/);
  if (!m) return '';
  return lpbFechaDesdeAAMMDD_(m[1], null);
}

/**
 * Compara dos RFC.
 * @param {string} a
 * @param {string} b
 * @return {{puntaje: number, tipo: string}}
 */
function lpbCompararRFC_(a, b) {
  var pa = lpbRfcPartes_(a), pb = lpbRfcPartes_(b);
  if (!pa.raiz || !pb.raiz) return { puntaje: 0, tipo: 'SIN_DATO' };

  var completoA = lpbLimpiarId_(a), completoB = lpbLimpiarId_(b);
  if (completoA === completoB && completoA.length >= 12) {
    return { puntaje: 100, tipo: 'RFC_COMPLETO_EXACTO' };
  }
  if (pa.raiz === pb.raiz) {
    return { puntaje: 98, tipo: 'RFC_RAIZ_EXACTA' };
  }
  // Tolerancia a un error de captura en la raíz
  if (pa.raiz.length === pb.raiz.length) {
    var dist = lpbLevenshtein_(pa.raiz, pb.raiz);
    if (dist === 1) return { puntaje: 85, tipo: 'RFC_RAIZ_1_DIFERENCIA' };
    if (dist === 2) return { puntaje: 70, tipo: 'RFC_RAIZ_2_DIFERENCIAS' };
  }
  return { puntaje: 0, tipo: 'RFC_DISTINTO' };
}

/* ==========================================================================
 * CURP
 * ========================================================================== */

/**
 * Dígito verificador oficial del CURP.
 * @param {string} curp17  primeros 17 caracteres
 * @return {number} 0-9
 */
function lpbCurpDigitoVerificador_(curp17) {
  var suma = 0;
  for (var i = 0; i < 17; i++) {
    var idx = LPB_ALFABETO_CURP.indexOf(curp17.charAt(i));
    if (idx === -1) return -1;
    suma += idx * (18 - i);
  }
  return (10 - (suma % 10)) % 10;
}

/**
 * Validación estructural completa del CURP.
 *
 * Esto es lo que permite cachar un error de transcripción en el momento de
 * la captura. Un CURP mal copiado casi siempre rompe su propia estructura:
 * la fecha embebida deja de ser válida, el estado no existe, o el dígito
 * verificador no cuadra.
 *
 * @param {string} curp
 * @return {{valido: boolean, errores: string[], fecha: string, sexo: string, estado: string}}
 */
function lpbValidarCURP_(curp) {
  var c = lpbLimpiarId_(curp);
  var errores = [];
  var res = { valido: false, errores: errores, fecha: '', sexo: '', estado: '' };

  if (c.length === 0) { errores.push('Vacío'); return res; }
  if (c.length !== 18) { errores.push('Longitud ' + c.length + ', se esperan 18'); return res; }
  if (!/^[A-ZÑ]{4}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-ZÑ]{3}[A-Z0-9]\d$/.test(c)) {
    errores.push('No cumple el patrón estructural del CURP');
  }

  var sexo = c.charAt(10);
  if (sexo !== 'H' && sexo !== 'M') errores.push('Carácter de sexo inválido: ' + sexo);
  res.sexo = (sexo === 'H') ? 'HOMBRE' : (sexo === 'M' ? 'MUJER' : '');

  var edo = c.substr(11, 2);
  if (LPB_ESTADOS_CURP.indexOf(edo) === -1) errores.push('Clave de entidad inexistente: ' + edo);
  res.estado = edo;

  var fecha = lpbFechaDesdeAAMMDD_(c.substr(4, 6), c.charAt(16));
  if (!fecha) errores.push('Fecha embebida inválida: ' + c.substr(4, 6));
  res.fecha = fecha;

  var dvEsperado = lpbCurpDigitoVerificador_(c.substr(0, 17));
  var dvReal = parseInt(c.charAt(17), 10);
  if (dvEsperado !== dvReal) {
    errores.push('Dígito verificador no cuadra (esperado ' + dvEsperado + ', capturado ' + dvReal + ')');
  }

  res.valido = errores.length === 0;
  return res;
}

/**
 * Compara dos CURP.
 * @param {string} a
 * @param {string} b
 * @return {{puntaje: number, tipo: string}}
 */
function lpbCompararCURP_(a, b) {
  var ca = lpbLimpiarId_(a), cb = lpbLimpiarId_(b);
  if (!ca || !cb) return { puntaje: 0, tipo: 'SIN_DATO' };
  if (ca === cb) return { puntaje: 100, tipo: 'CURP_EXACTO' };

  // Los primeros 16 caracteres son deterministas (nombre + fecha + sexo +
  // estado + consonantes). Si coinciden y solo difiere la homoclave, es
  // prácticamente la misma persona con un dato mal capturado.
  if (ca.length === 18 && cb.length === 18 && ca.substr(0, 16) === cb.substr(0, 16)) {
    return { puntaje: 95, tipo: 'CURP_RAIZ_EXACTA' };
  }
  if (ca.length === cb.length && lpbLevenshtein_(ca, cb) === 1) {
    return { puntaje: 82, tipo: 'CURP_1_DIFERENCIA' };
  }
  return { puntaje: 0, tipo: 'CURP_DISTINTO' };
}

/* ==========================================================================
 * Fechas
 * ========================================================================== */

/**
 * Convierte AAMMDD a ISO. El siglo se deduce del carácter de homoclave del
 * CURP: dígito = 1900s, letra = 2000s.
 * @param {string} aammdd
 * @param {?string} homoclave
 * @return {string} yyyy-mm-dd o ''
 */
function lpbFechaDesdeAAMMDD_(aammdd, homoclave) {
  if (!/^\d{6}$/.test(aammdd)) return '';
  var aa = parseInt(aammdd.substr(0, 2), 10);
  var mm = parseInt(aammdd.substr(2, 2), 10);
  var dd = parseInt(aammdd.substr(4, 2), 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';

  var siglo;
  if (homoclave && /[A-Z]/.test(homoclave)) siglo = 2000;
  else if (homoclave) siglo = 1900;
  else siglo = (aa > 25) ? 1900 : 2000;   // heurística cuando no hay homoclave

  var anio = siglo + aa;
  var d = new Date(anio, mm - 1, dd);
  if (d.getMonth() !== mm - 1 || d.getDate() !== dd) return '';   // 31 de febrero

  return anio + '-' + ('0' + mm).slice(-2) + '-' + ('0' + dd).slice(-2);
}

/**
 * Normaliza a ISO cualquier fecha razonable: objeto Date, dd/mm/aaaa,
 * aaaa-mm-dd, dd-mm-aa.
 * @param {*} v
 * @return {string} yyyy-mm-dd o ''
 */
function lpbFechaISO_(v) {
  if (!v && v !== 0) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return v.getFullYear() + '-' +
           ('0' + (v.getMonth() + 1)).slice(-2) + '-' +
           ('0' + v.getDate()).slice(-2);
  }
  var s = String(v).trim();
  var m;
  if ((m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/))) {
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }
  if ((m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/))) {
    var anio = m[3].length === 2 ? (parseInt(m[3], 10) > 25 ? '19' + m[3] : '20' + m[3]) : m[3];
    return anio + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }
  return '';
}

/**
 * Compara dos fechas de nacimiento.
 * @param {*} a
 * @param {*} b
 * @return {{estado: string, ajuste: number}}
 */
function lpbCompararFechas_(a, b) {
  var fa = lpbFechaISO_(a), fb = lpbFechaISO_(b);
  if (!fa || !fb) return { estado: 'SIN_DATO', ajuste: 0 };
  if (fa === fb) return { estado: 'IGUAL', ajuste: LPB_PARAMS.BONO_FECHA_IGUAL };

  // Día y mes invertidos es un error de captura frecuente, no una persona
  // distinta. Se trata como neutro, no como evidencia en contra.
  if (fa.substr(0, 4) === fb.substr(0, 4) &&
      fa.substr(5, 2) === fb.substr(8, 2) &&
      fa.substr(8, 2) === fb.substr(5, 2)) {
    return { estado: 'INVERTIDA_DIA_MES', ajuste: 0 };
  }
  return { estado: 'DISTINTA', ajuste: -LPB_PARAMS.CASTIGO_FECHA_DIST };
}

/**
 * ============================================================================
 * LPB · Normalizador.gs
 * Canonicalización de nombres de personas físicas y morales.
 * ----------------------------------------------------------------------------
 * REGLA CRÍTICA DE DISEÑO:
 * Estas funciones se usan EN AMBOS LADOS — al construir el índice y al recibir
 * la consulta. Si la normalización difiere entre ambos, el sistema falla en
 * silencio: no arroja error, simplemente deja de encontrar coincidencias.
 * Nunca duplicar esta lógica en otro módulo.
 * ============================================================================
 */

/** Partículas de bajo peso. No se eliminan (DE LA CRUZ ≠ CRUZ), solo pesan menos. */
var LPB_PARTICULAS = [
  'DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E', 'EL',
  'SAN', 'SANTA', 'SANTO', 'VAN', 'VON', 'DA', 'DOS', 'MC', 'MAC'
];

/**
 * Abreviaturas de uso común en captura mexicana.
 * Se expanden ANTES de tokenizar para que "MA. GPE." y "MARIA GUADALUPE"
 * produzcan los mismos tokens.
 */
var LPB_ABREVIATURAS = {
  'MA':    'MARIA',
  'MTA':   'MARTA',
  'GPE':   'GUADALUPE',
  'FCO':   'FRANCISCO',
  'FCA':   'FRANCISCA',
  'JN':    'JUAN',
  'JOSE M':'JOSE MARIA',
  'ANT':   'ANTONIO',
  'ANTO':  'ANTONIO',
  'MIG':   'MIGUEL',
  'MGL':   'MIGUEL',
  'RGO':   'RODRIGO',
  'GMO':   'GUILLERMO',
  'RBTO':  'ROBERTO',
  'RTO':   'ROBERTO',
  'JOSEFA':'JOSEFA',
  'CARLS': 'CARLOS',
  'SVDOR': 'SALVADOR',
  'ALEJ':  'ALEJANDRO',
  'FDO':   'FERNANDO',
  'EDO':   'EDUARDO',
  'RIC':   'RICARDO',
  'SGO':   'SANTIAGO',
  'XTIAN': 'CRISTIAN',
  'CRIS':  'CRISTINA',
  'CONCEP':'CONCEPCION',
  'ASUN':  'ASUNCION',
  'DOLS':  'DOLORES',
  'MERC':  'MERCEDES',
  'REM':   'REMEDIOS',
  'JUANA': 'JUANA'
};

/**
 * Sufijos societarios. Se separan del nombre para que no dominen el puntaje:
 * de otro modo dos empresas sin relación coincidirían al 70% solo por ser
 * ambas "S.A. DE C.V."
 */
var LPB_SUFIJOS_SOCIALES = [
  // Detectados sobre datos reales y ausentes en la primera versión:
  // "S.P.R. DE R.L. DE C.V." dejaba el residuo "DE RL DE CV" pegado al
  // núcleo, y "S.A.S." no se reconocía en absoluto.
  'SPR DE RL DE CV', 'SPR DE RL', 'SC DE RL DE CV', 'SAS DE CV',
  'SAPI DE CV', 'SAB DE CV', 'S DE RL DE CV', 'SA DE CV', 'SC DE RL',
  'SAS', 'SNC', 'SCS', 'SCA',
  'SOFOM ENR', 'SOFOM ER', 'SOFOM', 'SOFIPO', 'SOCAP',
  'SAPI', 'SAB', 'SA', 'SC', 'AC', 'IAP', 'SRL', 'SPR', 'SCL', 'ENR', 'ER',
  'SOCIEDAD ANONIMA DE CAPITAL VARIABLE',
  'SOCIEDAD ANONIMA',
  'SOCIEDAD CIVIL',
  'ASOCIACION CIVIL',
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  'DE CAPITAL VARIABLE',
  'EN NOMBRE COLECTIVO'
];

/**
 * Normalización base: mayúsculas, sin acentos, sin puntuación, sin dobles
 * espacios. La descomposición NFD convierte Ñ en N + tilde y el filtro de
 * marcas diacríticas se lleva la tilde — eso resuelve MUÑOZ/MUNOZ, que es
 * uno de los errores de captura más frecuentes.
 *
 * @param {string} texto
 * @return {string}
 */
function lpbNormalizarBase_(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // quita marcas diacríticas
    .replace(/[.,;:'"`´¨()\[\]{}\/\\*#@_]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reconstruye acrónimos que la eliminación de puntos dejó desarmados.
 *
 * "S.A.P.I. DE C.V." pierde los puntos y queda como "S A P I DE C V", que ya
 * no empata contra ningún sufijo societario conocido. Esta función vuelve a
 * pegar las corridas de dos o más letras sueltas: "SAPI DE CV".
 *
 * LIMITACIÓN CONOCIDA: un nombre con dos iniciales seguidas ("J J TORRES")
 * se pegaría como "JJ TORRES". Es un caso muy raro comparado con la
 * frecuencia de razones sociales abreviadas con puntos, pero conviene
 * revisarlo si aparecen registros así en la lista.
 *
 * @param {string} texto  ya normalizado
 * @return {string}
 */
function lpbCompactarAcronimos_(texto) {
  var tokens = texto.split(' ').filter(function (t) { return t.length > 0; });
  var salida = [];
  var corrida = [];

  function volcar() {
    if (corrida.length >= 2) salida.push(corrida.join(''));
    else if (corrida.length === 1) salida.push(corrida[0]);
    corrida = [];
  }

  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i].length === 1 && /[A-Z]/.test(tokens[i])) {
      corrida.push(tokens[i]);
    } else {
      volcar();
      salida.push(tokens[i]);
    }
  }
  volcar();
  return salida.join(' ');
}

/**
 * Expande abreviaturas token por token.
 * @param {string} texto  ya normalizado
 * @return {string}
 */
function lpbExpandirAbreviaturas_(texto) {
  var tokens = texto.split(' ');
  var salida = [];
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (LPB_ABREVIATURAS.hasOwnProperty(t)) {
      salida = salida.concat(LPB_ABREVIATURAS[t].split(' '));
    } else if (t === 'J' || t === 'JO') {
      salida.push('JOSE');
    } else {
      salida.push(t);
    }
  }
  return salida.join(' ');
}

/**
 * Separa el sufijo societario del núcleo de la razón social.
 * @param {string} texto  ya normalizado
 * @return {{nucleo: string, sufijo: string, esMoral: boolean}}
 */
function lpbSepararSufijoSocial_(texto) {
  var t = ' ' + texto + ' ';
  var encontrado = '';
  // Ordenar de más largo a más corto evita que "SA" se coma "SA DE CV".
  var sufijos = LPB_SUFIJOS_SOCIALES.slice().sort(function (a, b) {
    return b.length - a.length;
  });
  for (var i = 0; i < sufijos.length; i++) {
    var patron = ' ' + sufijos[i] + ' ';
    var pos = t.indexOf(patron);
    if (pos !== -1) {
      encontrado = sufijos[i];
      t = t.slice(0, pos) + ' ' + t.slice(pos + patron.length - 1);
      break;
    }
  }
  return {
    nucleo:  t.replace(/\s+/g, ' ').trim(),
    sufijo:  encontrado,
    esMoral: encontrado !== ''
  };
}

/**
 * Normalización completa. Punto de entrada único.
 *
 * @param {string} texto
 * @return {{
 *   original: string, normalizado: string, tokens: string[],
 *   pesos: number[], sufijo: string, esMoral: boolean
 * }}
 */
function lpbNormalizar_(texto) {
  var base = lpbCompactarAcronimos_(lpbNormalizarBase_(texto));
  var sep  = lpbSepararSufijoSocial_(base);
  var exp  = lpbExpandirAbreviaturas_(sep.nucleo);

  var tokens = exp.split(' ').filter(function (t) { return t.length > 0; });
  var pesos  = tokens.map(function (t) {
    if (LPB_PARTICULAS.indexOf(t) !== -1) return LPB_PARAMS.PESO_PARTICULA;
    if (t.length === 1)                   return LPB_PARAMS.PESO_INICIAL;
    return LPB_PARAMS.PESO_TOKEN;
  });

  return {
    original:    String(texto || ''),
    normalizado: exp,
    // Forma compacta: sin espacios. Resuelve las partículas pegadas, que son
    // un error de captura muy frecuente: "DELACRUZ" y "DE LA CRUZ" producen
    // exactamente la misma cadena compacta, aunque su tokenización difiera
    // por completo.
    compacto:    exp.replace(/ /g, ''),
    tokens:      tokens,
    pesos:       pesos,
    sufijo:      sep.sufijo,
    esMoral:     sep.esMoral
  };
}

/**
 * Extrae posibles alias del campo DATOS COMPLEMENTARIOS.
 *
 * ADVERTENCIA: los patrones aquí son una CONJETURA. No he visto el contenido
 * real de esa columna. Una vez que se revisen 20-30 registros reales hay que
 * ajustar esta función; mientras tanto puede estar dejando alias sin indexar,
 * que es precisamente el tipo de omisión que hace fallar un screening.
 *
 * @param {string} texto  contenido de DATOS COMPLEMENTARIOS
 * @return {string[]}  alias detectados, sin normalizar
 */
function lpbExtraerAlias_(texto) {
  if (!texto) return [];
  var t = String(texto);
  var alias = [];
  var patrones = [
    /\(?\s*(?:A\.?K\.?A\.?|ALIAS|CONOCIDO\s+COMO|TAMBIEN\s+CONOCIDO\s+COMO|APODO|SEUDONIMO)\s*:?\s*([^;()\n]+)/gi,
    /\(?\s*(?:NOMBRE\s+COMERCIAL|DENOMINACION\s+ANTERIOR|ANTES)\s*:?\s*([^;()\n]+)/gi
  ];
  for (var i = 0; i < patrones.length; i++) {
    var m;
    while ((m = patrones[i].exec(t)) !== null) {
      m[1].split(/\s*[,\/]\s*|\s+O\s+/).forEach(function (a) {
        var limpio = a.trim();
        if (limpio.length >= 3) alias.push(limpio);
      });
    }
  }
  return alias;
}

/**
 * Separa una celda que contiene VARIAS identidades en nombres individuales.
 *
 * HALLAZGO SOBRE DATOS REALES — la columna de nombre no siempre trae UNA
 * persona. Ejemplo textual de la lista (fila 36):
 *
 *   "MANUEL RODOLFO TRILLO HERNANDEZ y/o MANUEL GARZA ESPINOZA y/o
 *    JUAN HELU GARCIA y/o LADISLAO VAZQUEZ LOPEZ"
 *
 * Son cuatro identidades del mismo sujeto, cada una con su propio RFC en la
 * columna correspondiente ("TIHM590715 o GAEM600607 o ...").
 *
 * Sin separar, el normalizador producía UN nombre de 16 tokens. Buscar
 * cualquiera de las cuatro personas por su nombre daba 65 puntos — banda
 * AMPLIADA, por debajo del umbral de despliegue. La persona estaba en la
 * lista, con su nombre completo escrito, y el buscador NO la mostraba.
 *
 * GUARDA CONTRA FALSOS CORTES: la separación solo se acepta si TODOS los
 * fragmentos resultantes parecen nombres completos (2 a 8 tokens). Así una
 * razón social legítima como "ALFA Y GAMA, S.A. DE C.V." no se parte.
 *
 * @param {string} texto
 * @return {string[]}  siempre al menos un elemento
 */
function lpbSepararNombres_(texto) {
  var original = String(texto || '').trim();
  if (!original) return [];

  var separadores = [
    /\s+Y\s*\/\s*O\s+/gi,        // "y/o"
    /\s+AND\s*\/\s*OR\s+/gi,     // "and/or"
    /\s+ALIAS\s+/gi,
    /\s+A\.?K\.?A\.?\s+/gi,
    /\s+O\s+BIEN\s+/gi,
    /\s+\/\s+/g,                  // diagonal aislada entre espacios
    /\s+O\s+/gi                    // " o " suelto — el más riesgoso, va al final
  ];

  var mejor = [original];
  for (var i = 0; i < separadores.length; i++) {
    var partes = mejor.length > 1 ? mejor : [original];
    var nuevo = [];
    partes.forEach(function (p) {
      p.split(separadores[i]).forEach(function (x) {
        var t = x.trim();
        if (t) nuevo.push(t);
      });
    });
    if (nuevo.length > mejor.length && lpbFragmentosValidos_(nuevo)) mejor = nuevo;
  }
  return mejor;
}

/**
 * ¿Todos los fragmentos parecen nombres completos?
 * @param {string[]} fragmentos
 * @return {boolean}
 */
function lpbFragmentosValidos_(fragmentos) {
  if (fragmentos.length < 2) return false;
  for (var i = 0; i < fragmentos.length; i++) {
    var n = lpbNormalizar_(fragmentos[i]);
    if (n.tokens.length < 2 || n.tokens.length > 8) return false;
  }
  return true;
}

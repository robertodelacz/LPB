/**
 * ============================================================================
 * LPB · Indice.gs
 * Índice precalculado, prefiltro invertido, caché y búsqueda.
 * ----------------------------------------------------------------------------
 * PROBLEMA: 10,019 registros y creciendo. Comparar la consulta contra cada
 * uno haría ~180,000 evaluaciones de Jaro-Winkler por búsqueda. Apps Script
 * corta la ejecución a los 6 minutos; sería inviable.
 *
 * SOLUCIÓN EN TRES CAPAS:
 *   1. Índice precalculado  — los nombres de la lista no cambian entre
 *      consultas; se normalizan una vez, no en cada búsqueda.
 *   2. Prefiltro invertido  — de 10,019 se baja a unas decenas ANTES de
 *      correr el scoring caro.
 *   3. Caché               — el índice vive en memoria entre consultas.
 *
 * REGLA INVIOLABLE DEL PREFILTRO: puede dejar pasar candidatos de más, nunca
 * puede descartar una coincidencia real. Un falso positivo lo descarta el
 * analista; una detección perdida no la ve nadie. Por eso el índice invertido
 * registra prefijo Y sufijo de cada token: un error de captura en las
 * primeras letras se rescata por las últimas, y viceversa.
 * ============================================================================
 */

var LPB_CACHE_PREFIJO = 'lpb_idx_';
var LPB_CACHE_SEGUNDOS = 21600;   // 6 horas
var LPB_CACHE_TAM = 90000;        // bytes por fragmento (límite real: 100 KB)

/* ==========================================================================
 * Construcción del índice
 * ========================================================================== */

/**
 * Recorre la hoja LPB, sanea cada registro y escribe la hoja _INDICE.
 *
 * Debe ejecutarse al terminar cada captura. Si se agregan registros y no se
 * reindexa, esos registros son INVISIBLES para el buscador aunque estén en
 * la hoja: fallo silencioso, el peor tipo. Por eso el disparador automático
 * de Bitacora.gs, y por eso el sello de vigencia en la interfaz.
 *
 * GUION BAJO FINAL DELIBERADO: sin él, cualquiera con acceso a la página
 * podría dispararlo desde la consola con google.script.run y agotar la cuota
 * de ejecución del proyecto. Se invoca solo desde apiReindexar (que valida
 * permiso de ADMIN) y desde el disparador horario.
 *
 * @return {{registros: number, conCURP: number, conRFC: number, soloNombre: number}}
 */
function lpbConstruirIndice_() {
  var ss = lpbLibroLista_();
  var hoja = ss.getSheetByName(LPB_HOJAS.LISTA);
  if (!hoja) throw new Error('No existe la hoja ' + LPB_HOJAS.LISTA);

  var ultima = hoja.getLastRow();
  if (ultima < LPB_FILA_DATOS) throw new Error('La hoja no tiene datos.');

  var n = ultima - LPB_FILA_DATOS + 1;
  var datos = hoja.getRange(LPB_FILA_DATOS, 1, n, 13).getValues();

  var filas = [];
  var stats = { registros: 0, conCURP: 0, conRFC: 0, soloNombre: 0, multiIdentidad: 0 };

  for (var i = 0; i < datos.length; i++) {
    var fila = datos[i];
    var nombre = String(fila[LPB_COL.NOMBRE] || '').trim();
    if (!nombre) continue;

    // Una celda puede contener varias identidades separadas por "y/o".
    // Cada una se normaliza e indexa por separado.
    var nombres = lpbSepararNombres_(nombre);
    var norm = lpbNormalizar_(nombres[0]);
    var san  = lpbSanearRegistro_(fila);

    var alternos = nombres.slice(1).map(function (x) {
      return lpbNormalizar_(x).normalizado;
    });

    // El bucket y los tokens del índice invertido cubren TODAS las identidades:
    // si solo se indexara la primera, buscar la segunda no encontraría nada.
    var todosTokens = [], todosFon = [];
    nombres.forEach(function (x) {
      var nx = lpbNormalizar_(x);
      nx.tokens.forEach(function (t) {
        todosTokens.push(t);
        todosFon.push(lpbClavesFoneticas_(t)[0]);
      });
    });

    var foneticos = todosFon;

    filas.push([
      LPB_FILA_DATOS + i,          // A · fila original en LPB
      norm.normalizado,            // B · nombre principal normalizado
      todosTokens.join(' '),       // C · tokens de TODAS las identidades
      foneticos.join(' '),         // D · claves fonéticas de todas
      lpbBucket_(nombre),          // E · bucket de iniciales
      san.rfcs.join('|'),          // F · RFC saneados
      san.curps.join('|'),         // G · CURP saneados
      san.fechas.join('|'),        // H · fechas saneadas
      san.soloNombre ? 'SOLO_NOMBRE' : '',  // I · bandera de fuerza probatoria
      alternos.join('|')           // J · nombres alternos normalizados
    ]);
    if (alternos.length) stats.multiIdentidad++;

    stats.registros++;
    if (san.tieneCURP)  stats.conCURP++;
    if (san.tieneRFC)   stats.conRFC++;
    if (san.soloNombre) stats.soloNombre++;
  }

  // El índice se escribe en el libro del SISTEMA, no en el de la lista.
  //
  // Aquí estaba el error: la variable ss se abrió arriba como libro de la
  // LISTA para leer los registros, y se reutilizaba para crear el índice. El
  // resultado era que se escribía en el libro donde captura Cumplimiento y se
  // leía del libro de sistema, así que la búsqueda nunca encontraba el índice
  // recién construido.
  var ssIdx = lpbLibroSistema_();
  var idx = ssIdx.getSheetByName(LPB_HOJAS.INDICE);
  if (!idx) idx = ssIdx.insertSheet(LPB_HOJAS.INDICE);
  idx.clear();
  idx.getRange(1, 1, 1, 10).setValues([[
    'FILA', 'NOMBRE_NORM', 'TOKENS', 'FONETICO', 'BUCKET',
    'RFCS', 'CURPS', 'FECHAS', 'BANDERAS', 'NOMBRES_ALT'
  ]]);
  if (filas.length) idx.getRange(2, 1, filas.length, 10).setValues(filas);
  idx.hideSheet();

  lpbLimpiarCache_();

  // La fecha de corte se calcula AQUÍ, una vez por reindexado, en lugar de
  // recorrer las 10,010 filas de FECHA DE PUBLICACIÓN cada vez que alguien
  // entra al sistema. Ese recorrido era el grueso del tiempo de arranque.
  var corte = '';
  for (var f = 0; f < datos.length; f++) {
    if (!String(datos[f][LPB_COL.NOMBRE] || '').trim()) continue;
    var iso = lpbFechaISO_(datos[f][LPB_COL.FECHA_PUBLICACION]);
    if (iso && (!corte || iso > corte)) corte = iso;
  }

  PropertiesService.getScriptProperties().setProperties({
    'lpb_indice_fecha':     new Date().toISOString(),
    'lpb_indice_registros': String(stats.registros),
    'lpb_fecha_corte':      corte
  });

  return stats;
}

/* ==========================================================================
 * Carga y caché
 * ========================================================================== */

function lpbLimpiarCache_() {
  var cache = CacheService.getScriptCache();
  var meta = cache.get(LPB_CACHE_PREFIJO + 'meta');
  if (meta) {
    var claves = [];
    for (var i = 0; i < parseInt(meta, 10); i++) claves.push(LPB_CACHE_PREFIJO + i);
    claves.push(LPB_CACHE_PREFIJO + 'meta');
    cache.removeAll(claves);
  }
}

/**
 * Carga el índice: primero de caché, si no de la hoja _INDICE.
 * @return {{filas: Array, invertido: Object, porRFC: Object, porCURP: Object}}
 */
function lpbCargarIndice_() {
  var cache = CacheService.getScriptCache();
  var meta = cache.get(LPB_CACHE_PREFIJO + 'meta');
  var crudo = null;

  if (meta) {
    var partes = [], ok = true;
    for (var i = 0; i < parseInt(meta, 10); i++) {
      var p = cache.get(LPB_CACHE_PREFIJO + i);
      if (p === null) { ok = false; break; }
      partes.push(p);
    }
    if (ok) crudo = partes.join('');
  }

  var filas;
  if (crudo) {
    filas = JSON.parse(crudo);
  } else {
    var ss = lpbLibroSistema_();
    var idx = ss.getSheetByName(LPB_HOJAS.INDICE);
    if (!idx) throw new Error('Índice no construido. Ejecuta lpbConstruirIndice_().');
    var ultima = idx.getLastRow();
    if (ultima < 2) throw new Error('El índice está vacío.');
    filas = idx.getRange(2, 1, ultima - 1, 10).getValues();

    var serial = JSON.stringify(filas);
    var frags = [];
    for (var j = 0; j < serial.length; j += LPB_CACHE_TAM) {
      frags.push(serial.substring(j, j + LPB_CACHE_TAM));
    }
    var mapa = {};
    frags.forEach(function (f, k) { mapa[LPB_CACHE_PREFIJO + k] = f; });
    mapa[LPB_CACHE_PREFIJO + 'meta'] = String(frags.length);
    try { cache.putAll(mapa, LPB_CACHE_SEGUNDOS); } catch (e) { /* la caché es opcional */ }
  }

  return lpbConstruirEstructuras_(filas);
}

/**
 * Arma en memoria las estructuras de búsqueda rápida.
 * @param {Array} filas
 * @return {Object}
 */
function lpbConstruirEstructuras_(filas) {
  var invertido = {};   // fragmento de 3 letras -> [índices]
  var porRFC = {};
  var porCURP = {};

  function registrar(clave, i) {
    if (!clave || clave.length < 3) return;
    if (!invertido[clave]) invertido[clave] = [];
    var arr = invertido[clave];
    if (arr[arr.length - 1] !== i) arr.push(i);
  }

  for (var i = 0; i < filas.length; i++) {
    var f = filas[i];

    // Índice invertido sobre PREFIJO y SUFIJO de cada token, en su forma
    // fonética y en su forma literal. Cuatro entradas por token: un error de
    // captura al principio se rescata por el final, y al revés.
    String(f[3]).split(' ').forEach(function (fon) {
      if (fon.length >= 3) {
        registrar('P' + fon.substring(0, 3), i);
        registrar('S' + fon.substring(fon.length - 3), i);
      }
    });
    String(f[2]).split(' ').forEach(function (tok) {
      if (tok.length >= 3) {
        registrar('P' + tok.substring(0, 3), i);
        registrar('S' + tok.substring(tok.length - 3), i);
      } else if (tok.length > 0 && LPB_PARTICULAS.indexOf(tok) === -1) {
        // TOKEN CORTO (1-2 letras): el esquema de prefijo/sufijo de 3 letras
        // nunca lo registra, así que sin esto el registro es INVISIBLE para
        // cualquier consulta de ese token, por exacta que sea — no es que
        // puntúe bajo, es que nunca se evalúa.
        //
        // Caso real que lo destapó: apellidos de dos letras (comunes en
        // nombres chinos, coreanos y vietnamitas — LI, NG, WU, KO) y
        // acrónimos de dos letras en razones sociales (GN, TX, OP) nunca
        // producían un solo candidato en el prefiltro.
        //
        // Clave de coincidencia EXACTA ('EX' + token), simétrica entre esta
        // función y lpbPrefiltrar_: solo agrega candidatos a evaluar, nunca
        // cambia el puntaje de un registro que ya se encontraba por otra vía.
        registrar('EX' + tok, i);
      }
    });

    String(f[5]).split('|').forEach(function (r) {
      if (!r) return;
      var raiz = lpbRfcPartes_(r).raiz;
      if (!porRFC[raiz]) porRFC[raiz] = [];
      porRFC[raiz].push(i);
    });
    String(f[6]).split('|').forEach(function (c) {
      if (!c) return;
      if (!porCURP[c]) porCURP[c] = [];
      porCURP[c].push(i);
      var raiz = c.substring(0, 16);
      if (!porCURP[raiz]) porCURP[raiz] = [];
      porCURP[raiz].push(i);
    });
  }

  return { filas: filas, invertido: invertido, porRFC: porRFC, porCURP: porCURP };
}

/* ==========================================================================
 * Búsqueda
 * ========================================================================== */

/**
 * Selecciona candidatos sin correr el scoring caro.
 * @param {Object} indice
 * @param {Object} normConsulta
 * @return {number[]}
 */
function lpbPrefiltrar_(indice, normConsulta) {
  var vistos = {};
  var candidatos = [];

  function agregar(clave) {
    var arr = indice.invertido[clave];
    if (!arr) return;
    for (var k = 0; k < arr.length; k++) {
      if (!vistos[arr[k]]) { vistos[arr[k]] = true; candidatos.push(arr[k]); }
    }
  }

  normConsulta.tokens.forEach(function (tok) {
    if (LPB_PARTICULAS.indexOf(tok) !== -1) return;   // partículas no discriminan
    if (tok.length >= 3) {
      agregar('P' + tok.substring(0, 3));
      agregar('S' + tok.substring(tok.length - 3));
    } else if (tok.length > 0) {
      // Simétrico con lpbConstruirEstructuras_: un token corto del lado de
      // la consulta busca la misma clave de coincidencia exacta.
      agregar('EX' + tok);
    }
    lpbClavesFoneticas_(tok).forEach(function (fon) {
      if (fon.length >= 3) {
        agregar('P' + fon.substring(0, 3));
        agregar('S' + fon.substring(fon.length - 3));
      }
    });
  });

  return candidatos;
}

/**
 * Búsqueda principal.
 *
 * @param {string} texto  lo que capturó el usuario
 * @param {Object=} opciones  {minimo: number, maximo: number}
 * @return {{tipo: string, total: number, evaluados: number, resultados: Array}}
 */
function lpbBuscar_(texto, opciones) {
  opciones = opciones || {};
  var minimo = opciones.minimo !== undefined ? opciones.minimo : LPB_PARAMS.UMBRAL_AMPLIADA;
  var maximo = opciones.maximo !== undefined ? opciones.maximo : LPB_PARAMS.MAX_RESULTADOS;

  var indice = lpbCargarIndice_();
  var tipo = lpbTipoConsulta_(texto);

  var consulta = { nombre: '', rfc: '', curp: '', fechaNac: '' };
  var candidatos;

  if (tipo === 'CURP') {
    consulta.curp = lpbLimpiarId_(texto);
    candidatos = (indice.porCURP[consulta.curp] || [])
      .concat(indice.porCURP[consulta.curp.substring(0, 16)] || []);
  } else if (tipo === 'RFC') {
    consulta.rfc = lpbLimpiarId_(texto);
    candidatos = indice.porRFC[lpbRfcPartes_(consulta.rfc).raiz] || [];
  } else {
    consulta.nombre = texto;
    candidatos = lpbPrefiltrar_(indice, lpbNormalizar_(texto));
  }

  // Sin candidatos por identificador, se cae a búsqueda por nombre. Nunca se
  // devuelve vacío sin haber intentado la otra vía.
  if (candidatos.length === 0 && tipo !== 'NOMBRE') {
    consulta.nombre = texto;
    candidatos = lpbPrefiltrar_(indice, lpbNormalizar_(texto));
  }

  var vistos = {}, resultados = [];
  for (var k = 0; k < candidatos.length; k++) {
    var i = candidatos[k];
    if (vistos[i]) continue;
    vistos[i] = true;

    var f = indice.filas[i];
    var registro = {
      nombre:   String(f[1]),
      rfc:      String(f[5]).split('|')[0] || '',
      curp:     String(f[6]).split('|')[0] || '',
      fechaNac: String(f[7]).split('|')[0] || '',
      // Identidades adicionales de la misma fila. Se puntúan igual que el
      // nombre principal y se conserva la mejor.
      alias:    String(f[9] || '').split('|').filter(String)
    };

    // Cuando hay varios RFC o CURP se evalúan todos y se conserva el mejor:
    // un identificador secundario no puede quedar sin buscar.
    var mejor = lpbEvaluar_(consulta, registro);
    String(f[5]).split('|').slice(1).forEach(function (r) {
      var e = lpbEvaluar_(consulta, { nombre: registro.nombre, rfc: r, curp: '', fechaNac: registro.fechaNac });
      if (e.puntaje > mejor.puntaje) mejor = e;
    });
    String(f[6]).split('|').slice(1).forEach(function (c) {
      var e = lpbEvaluar_(consulta, { nombre: registro.nombre, rfc: '', curp: c, fechaNac: registro.fechaNac });
      if (e.puntaje > mejor.puntaje) mejor = e;
    });

    if (mejor.puntaje >= minimo) {
      resultados.push({
        filaLPB:    f[0],
        puntaje:    mejor.puntaje,
        banda:      mejor.banda,
        motivos:    mejor.motivos,
        soloNombre: String(f[8]) === 'SOLO_NOMBRE',
        evaluacion: mejor
      });
    }
  }

  resultados.sort(function (a, b) { return b.puntaje - a.puntaje; });

  return {
    tipo:       tipo,
    total:      resultados.length,
    evaluados:  Object.keys(vistos).length,
    resultados: resultados.slice(0, maximo)
  };
}

/**
 * Reconstruye el índice desde el editor.
 *
 * Existe porque lpbConstruirIndice_ lleva guion bajo final: eso la vuelve
 * privada y Apps Script no la lista en el desplegable de funciones. El guion
 * es deliberado —evita que cualquiera la dispare desde la consola del
 * navegador y agote la cuota— así que en lugar de quitarlo se agrega esta
 * envoltura para uso manual.
 */
function reindexar() {
  var s = lpbConstruirIndice_();
  var pct = (s.soloNombre / s.registros * 100).toFixed(1);

  Logger.log('Registros       : ' + s.registros);
  Logger.log('Con RFC         : ' + s.conRFC);
  Logger.log('Con CURP        : ' + s.conCURP);
  Logger.log('Solo nombre     : ' + s.soloNombre + '  (' + pct + '%)');
  Logger.log('Multi-identidad : ' + s.multiIdentidad);
  Logger.log('');

  var props = PropertiesService.getScriptProperties();
  Logger.log('Fecha de corte  : ' + props.getProperty('lpb_fecha_corte'));
  Logger.log('');

  var enLista   = lpbLibroLista_().getSheetByName(LPB_HOJAS.INDICE);
  var enSistema = lpbLibroSistema_().getSheetByName(LPB_HOJAS.INDICE);
  Logger.log('Índice en libro de la LISTA  : ' + (enLista ? 'SÍ — bórrelo, es residuo' : 'no, correcto'));
  Logger.log('Índice en libro del SISTEMA  : ' + (enSistema ? (enSistema.getLastRow() - 1) + ' registros' : 'NO EXISTE'));
}

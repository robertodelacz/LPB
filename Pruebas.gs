/**
 * ============================================================================
 * LPB · Pruebas.gs
 * Laboratorio de calibración. NO toca la lista real.
 * ----------------------------------------------------------------------------
 * Instalación:
 *   1. Crear un proyecto NUEVO de Apps Script sobre una hoja de trabajo
 *      separada (no sobre el libro de la LPB).
 *   2. Pegar los seis archivos .gs.
 *   3. Recargar la hoja. Aparece el menú "LPB · Calibración".
 *   4. Ejecutar "Sembrar casos de prueba" y luego "Ejecutar calibración".
 *
 * Las funciones LPB_* son funciones personalizadas: se escriben directo en
 * una celda, como =SUMA().
 * ============================================================================
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LPB · Calibración')
    .addItem('Sembrar casos de prueba', 'lpbSembrarCasos')
    .addItem('Ejecutar calibración', 'lpbEjecutarCalibracion')
    .addSeparator()
    .addItem('Barrido de umbrales', 'lpbBarridoUmbrales')
    .addToUi();
}

/* ==========================================================================
 * Funciones personalizadas — se usan directo en celdas
 * ========================================================================== */

/**
 * Puntaje de similitud entre dos nombres (0-100).
 * @param {string} a Texto buscado.
 * @param {string} b Texto en la lista.
 * @return {number}
 * @customfunction
 */
function LPB_SIMILITUD(a, b) {
  return lpbCompararNombres_(a, b).puntaje;
}

/**
 * Desglose completo de por qué dos nombres puntuaron así.
 * @param {string} a Texto buscado.
 * @param {string} b Texto en la lista.
 * @return {string}
 * @customfunction
 */
function LPB_EXPLICAR(a, b) {
  var ev = lpbEvaluar_({ nombre: a }, { nombre: b });
  return 'PUNTAJE: ' + ev.puntaje + '  ·  BANDA: ' + ev.banda + '\n' +
         lpbExplicarCoincidencia_(ev);
}

/**
 * Banda que corresponde a un puntaje.
 * @param {number} puntaje
 * @return {string}
 * @customfunction
 */
function LPB_BANDA(puntaje) {
  return lpbBanda_(Number(puntaje));
}

/**
 * Texto normalizado de un nombre.
 * @param {string} texto
 * @return {string}
 * @customfunction
 */
function LPB_NORMALIZAR(texto) {
  return lpbNormalizar_(texto).normalizado;
}

/**
 * Clave fonética de un nombre.
 * @param {string} texto
 * @return {string}
 * @customfunction
 */
function LPB_FONETICA(texto) {
  return lpbClaveFoneticaFrase_(texto);
}

/**
 * Raíz del RFC (sin homoclave).
 * @param {string} rfc
 * @return {string}
 * @customfunction
 */
function LPB_RFC_RAIZ(rfc) {
  return lpbRfcPartes_(rfc).raiz;
}

/**
 * Valida estructuralmente un CURP. Devuelve VÁLIDO o la lista de errores.
 * Útil como validación al momento de la captura.
 * @param {string} curp
 * @return {string}
 * @customfunction
 */
function LPB_VALIDA_CURP(curp) {
  var v = lpbValidarCURP_(curp);
  return v.valido ? 'VÁLIDO' : v.errores.join(' | ');
}

/**
 * Fecha de nacimiento embebida en el CURP.
 * @param {string} curp
 * @return {string}
 * @customfunction
 */
function LPB_CURP_FECHA(curp) {
  return lpbValidarCURP_(curp).fecha;
}

/* ==========================================================================
 * Casos de prueba
 * ========================================================================== */

/**
 * Casos sintéticos que reproducen los patrones reales de error en captura
 * mexicana. Los nombres son genéricos y no provienen de la LPB.
 *
 * ADVERTENCIA: estos casos son un punto de partida, no un sustituto de datos
 * reales. En cuanto haya errores de captura observados, agregarlos aquí —
 * valen mucho más que cualquier caso inventado.
 *
 * SOBRE LOS CASOS MARCADOS 'NO':
 * Están etiquetados con el criterio "¿es la misma persona?". Ése NO es el
 * criterio con el que debe juzgarse el motor. La pregunta correcta es
 * "¿debe verlo el analista?", y ahí la respuesta suele ser sí: AGUILAR y
 * AGUIRRE difieren en dos letras, y un error de captura pudo producir uno
 * a partir del otro.
 *
 * En consecuencia, los "falsos positivos" de este set NO son fallas del
 * motor. Son el costo deliberado de no perder detecciones. La métrica que
 * importa es NO DETECTADOS = 0; el conteo de candidatos solo importa si
 * crece tanto que el analista deja de revisarlos.
 *
 * Formato: [texto buscado, texto en la lista, ¿debe coincidir?, patrón]
 */
var LPB_CASOS_SEMILLA = [
  // --- Acentos y ñ ---------------------------------------------------------
  ['JOAQUIN GUZMAN LOERA',        'JOAQUÍN GUZMÁN LOERA',        'SI', 'acentos'],
  ['JOSE MUNOZ RIVERA',           'JOSÉ MUÑOZ RIVERA',           'SI', 'ñ/n'],
  ['MARIA NUNEZ PENA',            'MARÍA NÚÑEZ PEÑA',            'SI', 'ñ/n múltiple'],
  ['IBANEZ',                      'IBÁÑEZ',                      'SI', 'ñ/n'],

  // --- Letras que suenan igual --------------------------------------------
  ['GUSMAN',                      'GUZMÁN',                      'SI', 's/z'],
  ['ELISONDO',                    'ELIZONDO',                    'SI', 's/z'],
  ['VELASQUEZ',                   'VELÁZQUEZ',                   'SI', 's/z'],
  ['BARGAS',                      'VARGAS',                      'SI', 'b/v'],
  ['BALENZUELA',                  'VALENZUELA',                  'SI', 'b/v'],
  ['XIMENEZ',                     'JIMÉNEZ',                     'SI', 'x/j'],
  ['GIMENEZ',                     'JIMÉNEZ',                     'SI', 'g/j'],
  ['JAVIER',                      'XAVIER',                      'SI', 'j/x'],
  ['ERNANDEZ',                    'HERNÁNDEZ',                   'SI', 'h muda'],
  ['LLANEZ',                      'YÁÑEZ',                       'SI', 'll/y'],
  ['KESADA',                      'QUEZADA',                     'SI', 'qu/k + z/s'],
  ['ECHEBERRIA',                  'ECHEVERRÍA',                  'SI', 'b/v interna'],
  ['GERRERO',                     'GUERRERO',                    'SI', 'gue/ge'],

  // --- Errores de tecleo ---------------------------------------------------
  ['JOAQUINN GUZMAN',             'JOAQUÍN GUZMÁN LOERA',        'SI', 'letra de más'],
  ['JOAQIN GUZMAN LOERA',         'JOAQUÍN GUZMÁN LOERA',        'SI', 'letra de menos'],
  ['RODIRGO RUIZ GONZALEZ',       'RODRIGO RUIZ GONZÁLEZ',       'SI', 'transposición'],
  ['ALEJANDRO MARTIENZ SOLIS',    'ALEJANDRO MARTÍNEZ SOLÍS',    'SI', 'transposición'],
  ['GONSALES',                    'GONZÁLEZ',                    'SI', 'doble sustitución'],

  // --- Orden de apellidos --------------------------------------------------
  ['GUZMAN LOERA JOAQUIN',        'JOAQUÍN GUZMÁN LOERA',        'SI', 'orden invertido'],
  ['PEREZ LOPEZ JUAN CARLOS',     'JUAN CARLOS PÉREZ LÓPEZ',     'SI', 'orden invertido'],
  ['LOERA GUZMAN JOAQUIN',        'JOAQUÍN GUZMÁN LOERA',        'SI', 'apellidos permutados'],

  // --- Nombre incompleto ---------------------------------------------------
  ['JUAN PEREZ',                  'JUAN CARLOS PÉREZ LÓPEZ',     'SI', 'falta 2º nombre y materno'],
  ['JOAQUIN GUZMAN',              'JOAQUÍN GUZMÁN LOERA',        'SI', 'falta materno'],
  ['MARIA GONZALEZ HERNANDEZ',    'MARÍA GONZÁLEZ',              'SI', 'lista incompleta'],

  // --- Abreviaturas --------------------------------------------------------
  ['MA GUADALUPE RAMIREZ',        'MARÍA GUADALUPE RAMÍREZ',     'SI', 'MA -> MARIA'],
  ['MA. GPE. RAMIREZ SOTO',       'MARÍA GUADALUPE RAMÍREZ SOTO','SI', 'doble abreviatura'],
  ['J GUADALUPE TORRES',          'JOSÉ GUADALUPE TORRES',       'SI', 'J -> JOSE'],
  ['FCO JAVIER MENDOZA',          'FRANCISCO JAVIER MENDOZA',    'SI', 'FCO -> FRANCISCO'],

  // --- Partículas ----------------------------------------------------------
  ['ROBERTO DELACRUZ ROMERO',     'ROBERTO DE LA CRUZ ROMERO',   'SI', 'partícula pegada'],
  ['JUAN DELOS SANTOS',           'JUAN DE LOS SANTOS',          'SI', 'partícula pegada'],
  ['ANA DEL VALLE ORTIZ',         'ANA DELVALLE ORTIZ',          'SI', 'partícula separada'],

  // --- Personas morales ----------------------------------------------------
  ['COMERCIALIZADORA DEL NORTE SA DE CV',
   'COMERCIALIZADORA DEL NORTE, S.A. DE C.V.',                   'SI', 'sufijo con puntos'],
  ['GRUPO CONSTRUCTOR ALFA SAPI DE CV',
   'GRUPO CONSTRUCTOR ALFA, S.A.P.I. DE C.V.',                   'SI', 'sufijo SAPI'],
  ['INMOBILIARIA BETA',
   'INMOBILIARIA BETA, S. DE R.L. DE C.V.',                      'SI', 'sin sufijo en consulta'],
  ['SERVICIOS INTEGRALES GAMMA SC',
   'SERVICIOS INTEGRALES GAMA, S.C.',                            'SI', 'gamma/gama'],

  // --- NO deben coincidir: homónimos y apellidos comunes -------------------
  ['JUAN PEREZ HERNANDEZ',        'JUANA PÉREZ HERNÁNDEZ',       'NO', 'juan/juana'],
  ['JOSE LUIS RAMIREZ',           'JOSÉ MANUEL RAMÍREZ',         'NO', 'segundo nombre distinto'],
  ['CARLOS SANCHEZ LOPEZ',        'CARLOS SÁNCHEZ MÁRQUEZ',      'NO', 'materno distinto'],
  ['MARIA GARCIA',                'MARIO GARCÍA',                'NO', 'maria/mario'],
  ['LUIS ALBERTO TORRES',         'LUIS ROBERTO TORRES',         'NO', 'alberto/roberto'],
  ['ANTONIO RUIZ MORALES',        'ANTONIO CRUZ MORALES',        'NO', 'ruiz/cruz'],
  ['PEDRO JIMENEZ CASTRO',        'PEDRO GIMÉNEZ CASTAÑO',       'NO', 'castro/castaño'],
  ['ROSA MARTINEZ SILVA',         'ROSA MARTÍNEZ SALAS',         'NO', 'silva/salas'],
  ['FERNANDO OLIVA REYES',        'FERNANDA OLIVA REYES',        'NO', 'fernando/fernanda'],
  ['MIGUEL ANGEL SOTO',           'MIGUEL ÁNGEL SOSA',           'NO', 'soto/sosa'],
  ['LAURA VEGA DOMINGUEZ',        'LAURA VEGA RODRÍGUEZ',        'NO', 'materno distinto'],
  ['JORGE MENDEZ AGUILAR',        'JORGE MÉNDEZ AGUIRRE',        'NO', 'aguilar/aguirre'],
  ['SANDRA PALACIOS GIL',         'SANDRA PALACIOS GALVÁN',      'NO', 'gil/galván'],
  ['RAUL NAVARRO ESPINOZA',       'RAÚL NAVARRETE ESPINOZA',     'NO', 'navarro/navarrete'],
  ['DIANA CORTES PADILLA',        'DIANA CORTÉS PADRÓN',         'NO', 'padilla/padrón'],
  ['HECTOR SALAZAR VIDAL',        'HÉCTOR SALAZAR VILLA',        'NO', 'vidal/villa'],
  ['PATRICIA ROMERO LARA',        'PATRICIA ROMÁN LARA',         'NO', 'romero/román'],
  ['GERARDO IBARRA NIETO',        'GERARDO IBARRA PRIETO',       'NO', 'nieto/prieto'],
  ['CONSTRUCTORA DELTA SA DE CV', 'CONSTRUCTORA DELTHA SA DE CV','SI', 'delta/deltha'],
  ['GRUPO OMEGA SA DE CV',        'GRUPO OMEGA SERVICIOS SA DE CV','NO','razón social ampliada']
];

/**
 * Escribe los casos semilla en la hoja CASOS_PRUEBA.
 */
function lpbSembrarCasos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(LPB_HOJAS.CASOS_PRUEBA);
  if (!hoja) hoja = ss.insertSheet(LPB_HOJAS.CASOS_PRUEBA);
  hoja.clear();

  var encabezados = ['TEXTO BUSCADO', 'TEXTO EN LA LISTA', 'DEBE COINCIDIR',
                     'PATRÓN', 'PUNTAJE', 'BANDA', 'RESULTADO'];
  hoja.getRange(1, 1, 1, encabezados.length)
      .setValues([encabezados])
      .setFontWeight('bold')
      .setBackground('#364494')
      .setFontColor('#FFFFFF');

  hoja.getRange(2, 1, LPB_CASOS_SEMILLA.length, 4).setValues(LPB_CASOS_SEMILLA);
  hoja.setFrozenRows(1);
  hoja.autoResizeColumns(1, encabezados.length);

  SpreadsheetApp.getUi().alert(
    'Sembrados ' + LPB_CASOS_SEMILLA.length + ' casos.\n\n' +
    'Agrega tus propios casos abajo. Los errores de captura reales valen ' +
    'mucho más que los sintéticos.'
  );
}

/**
 * Corre todos los casos y marca aciertos y fallos.
 */
function lpbEjecutarCalibracion() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(LPB_HOJAS.CASOS_PRUEBA);
  if (!hoja) { SpreadsheetApp.getUi().alert('Primero siembra los casos.'); return; }

  var n = hoja.getLastRow() - 1;
  if (n < 1) { SpreadsheetApp.getUi().alert('No hay casos.'); return; }

  var datos = hoja.getRange(2, 1, n, 3).getValues();
  var salida = [], colores = [];
  var vp = 0, vn = 0, fp = 0, fn = 0;

  for (var i = 0; i < n; i++) {
    var buscado  = datos[i][0];
    var enLista  = datos[i][1];
    var esperado = String(datos[i][2]).toUpperCase().indexOf('S') === 0;
    if (!buscado || !enLista) { salida.push(['', '', '']); colores.push(['#FFFFFF']); continue; }

    var puntaje = lpbCompararNombres_(buscado, enLista).puntaje;
    var banda   = lpbBanda_(puntaje);
    var detecta = puntaje >= LPB_PARAMS.UMBRAL_REVISION;

    var veredicto, color;
    if (esperado && detecta)        { veredicto = 'OK · detectado';        color = '#E6F4EA'; vp++; }
    else if (!esperado && !detecta) { veredicto = 'OK · descartado';       color = '#E6F4EA'; vn++; }
    else if (esperado && !detecta)  { veredicto = 'FALLO · NO DETECTADO';  color = '#FCE8E6'; fn++; }
    else                            { veredicto = 'FALSO POSITIVO';        color = '#FEF7E0'; fp++; }

    salida.push([puntaje, banda, veredicto]);
    colores.push([color]);
  }

  hoja.getRange(2, 5, n, 3).setValues(salida);
  hoja.getRange(2, 7, n, 1).setBackgrounds(colores);

  var total = vp + vn + fp + fn;
  SpreadsheetApp.getUi().alert(
    'CALIBRACIÓN — umbral de detección: ' + LPB_PARAMS.UMBRAL_REVISION + '\n\n' +
    'Detectados correctamente : ' + vp + '\n' +
    'Descartados correctamente: ' + vn + '\n' +
    'NO DETECTADOS (grave)    : ' + fn + '\n' +
    'Falsos positivos         : ' + fp + '\n\n' +
    'Exactitud: ' + (total ? Math.round((vp + vn) / total * 100) : 0) + '%\n\n' +
    'Un no detectado es mucho más grave que un falso positivo: el falso ' +
    'positivo lo descarta el analista, el no detectado nadie lo ve.'
  );
}

/**
 * Prueba varios umbrales y reporta el desempeño de cada uno.
 * Ésta es la herramienta que decide el umbral definitivo, y su salida debe
 * conservarse como soporte documental del criterio adoptado.
 */
function lpbBarridoUmbrales() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(LPB_HOJAS.CASOS_PRUEBA);
  if (!hoja) { SpreadsheetApp.getUi().alert('Primero siembra los casos.'); return; }

  var n = hoja.getLastRow() - 1;
  var datos = hoja.getRange(2, 1, n, 3).getValues();

  var pares = [];
  for (var i = 0; i < n; i++) {
    if (!datos[i][0] || !datos[i][1]) continue;
    pares.push({
      puntaje:  lpbCompararNombres_(datos[i][0], datos[i][1]).puntaje,
      esperado: String(datos[i][2]).toUpperCase().indexOf('S') === 0
    });
  }

  var filas = [['UMBRAL', 'DETECTADOS', 'DESCARTADOS', 'NO DETECTADOS', 'FALSOS POSITIVOS', 'EXACTITUD %']];
  for (var u = 55; u <= 95; u += 5) {
    var vp = 0, vn = 0, fp = 0, fn = 0;
    pares.forEach(function (p) {
      var d = p.puntaje >= u;
      if (p.esperado && d) vp++;
      else if (!p.esperado && !d) vn++;
      else if (p.esperado && !d) fn++;
      else fp++;
    });
    filas.push([u, vp, vn, fn, fp, Math.round((vp + vn) / pares.length * 100)]);
  }

  var res = ss.getSheetByName('BARRIDO_UMBRALES') || ss.insertSheet('BARRIDO_UMBRALES');
  res.clear();
  res.getRange(1, 1, filas.length, 6).setValues(filas);
  res.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#FDB913');
  res.autoResizeColumns(1, 6);
  res.activate();
}

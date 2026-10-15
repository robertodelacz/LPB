/**
 * ============================================================================
 * LPB · Config.gs
 * Sistema de Consulta — Lista de Personas Bloqueadas
 * Financiera Cualli, S.A.P.I. de C.V., SOFOM, E.N.R.
 * ----------------------------------------------------------------------------
 * ENTREGA 1 de 4 — Motor de similitud (laboratorio de calibración)
 *
 * CLASIFICACIÓN: CONFIDENCIAL
 * Este sistema procesa la Lista de Personas Bloqueadas emitida por la SHCP.
 * Prohibida su divulgación a terceros y al titular de los datos (tipping-off).
 * ============================================================================
 */

/**
 * DOS LIBROS SEPARADOS
 * ----------------------------------------------------------------------------
 * LPB_ID_LISTA    Contiene la Lista de Personas Bloqueadas. El sistema SOLO
 *                 LEE de aquí; nunca escribe ni crea hojas.
 *
 * LPB_ID_SISTEMA  Contiene AUTORIZADOS, BITACORA, _INDICE y el histórico de
 *                 accesos. Todo lo que el sistema escribe vive aquí.
 *
 * Se separan por tres motivos:
 *
 *   1. Quien captura la lista no ve ni puede tocar la plomería del sistema.
 *   2. Compartir el libro de la lista deja de exponer la bitácora completa.
 *   3. Separación de funciones: quien captura no puede editar el registro de
 *      sus propias acciones, que es justo lo que la bitácora debe probar.
 */
var LPB_ID_LISTA   = '1cZsnZK1FoLUP7QNwTxUCnCfJvtdq_fT27ZvY6q3RqJo';
var LPB_ID_SISTEMA = '12gDQLpm_-iAPephZkfcBbaX2w2t6XvVk0-AR2X3pt8s';

/**
 * INTERRUPTOR DE NOTIFICACIONES POR CORREO.
 *
 *   false — nada sale por correo. Obligatorio mientras se hacen pruebas: las
 *           consultas de ensayo generan coincidencias reales y alertarían al
 *           Oficial de Cumplimiento por operaciones que no existen.
 *   true  — se envían las alertas. Así queda en producción.
 *
 * El registro en bitácora NUNCA se apaga con esto: el correo es una
 * notificación, la bitácora es evidencia.
 */
var LPB_CORREOS_ACTIVOS = false;

/**
 * BUZONES ADICIONALES QUE RECIBEN LAS ALERTAS.
 *
 * Direcciones institucionales que deben recibir los avisos aunque no
 * correspondan a un usuario del sistema. Se mantienen aparte de la hoja
 * AUTORIZADOS porque ahí solo van cuentas que pueden ENTRAR a consultar la
 * lista: un buzón de área no consulta, solo recibe.
 *
 * Mezclarlos daría acceso a la LPB a una dirección que varias personas pueden
 * abrir, y eso rompería la trazabilidad de quién consultó qué.
 *
 * Reciben los tres avisos: coincidencia confirmada, volumen inusual y
 * reportes de anomalía. Deje el arreglo vacío para desactivarlos.
 */
var LPB_BUZONES_ALERTA = [
  'oficialdecumplimiento@cualli.mx'
];

/**
 * Abre el libro de la LISTA. Solo lectura.
 * @return {Spreadsheet}
 */
function lpbLibroLista_() {
  return SpreadsheetApp.openById(LPB_ID_LISTA);
}

/**
 * Abre el libro del SISTEMA, donde se escribe todo.
 * @return {Spreadsheet}
 */
function lpbLibroSistema_() {
  return SpreadsheetApp.openById(LPB_ID_SISTEMA);
}

/**
 * VERIFICACIÓN DE CONFIGURACIÓN.
 * Ejecutar desde el editor antes de instalar o tras cambiar un identificador.
 *
 * Comprueba que cada libro sea el que se espera y que las hojas existan. Un
 * identificador equivocado no produce error inmediato: el sistema simplemente
 * lee o escribe donde no debe, y eso puede tardar días en notarse.
 */
function lpbVerificarConfiguracion() {
  Logger.log('=== LIBRO DE LA LISTA (solo lectura) ===');
  try {
    var l = lpbLibroLista_();
    Logger.log('  Nombre : ' + l.getName());
    Logger.log('  URL    : ' + l.getUrl());
    var hl = l.getSheetByName(LPB_HOJAS.LISTA);
    Logger.log('  Hoja "' + LPB_HOJAS.LISTA + '" : ' +
      (hl ? hl.getLastRow() + ' filas' : 'NO EXISTE'));
    ['AUTORIZADOS', 'BITACORA', 'INDICE'].forEach(function (k) {
      if (l.getSheetByName(LPB_HOJAS[k])) {
        Logger.log('  AVISO: existe "' + LPB_HOJAS[k] + '" en el libro de la lista. ' +
                   'Debería estar solo en el libro del sistema.');
      }
    });
  } catch (e) {
    Logger.log('  FALLÓ: ' + e.message);
  }

  Logger.log('');
  Logger.log('=== LIBRO DEL SISTEMA (lectura y escritura) ===');
  try {
    var t = lpbLibroSistema_();
    Logger.log('  Nombre : ' + t.getName());
    Logger.log('  URL    : ' + t.getUrl());
    ['AUTORIZADOS', 'BITACORA', 'INDICE', 'HISTORICO'].forEach(function (k) {
      var h = t.getSheetByName(LPB_HOJAS[k]);
      Logger.log('  ' + LPB_HOJAS[k] + ' : ' +
        (h ? h.getLastRow() + ' filas' : 'no existe todavía'));
    });
    if (t.getSheetByName(LPB_HOJAS.LISTA)) {
      Logger.log('  AVISO: el libro del sistema contiene una hoja "' + LPB_HOJAS.LISTA +
                 '". Bórrela: tener dos copias de la lista genera confusión ' +
                 'sobre cuál es la buena.');
    }
  } catch (e) {
    Logger.log('  FALLÓ: ' + e.message);
  }

  Logger.log('');
  Logger.log('=== OTROS PARÁMETROS ===');
  Logger.log('  Correos activos     : ' + LPB_CORREOS_ACTIVOS);
  Logger.log('  Umbral de despliegue: ' + LPB_PARAMS.UMBRAL_REVISION);
  Logger.log('  Inactividad (min)   : ' +
    (typeof LPB_INACTIVIDAD_MIN !== 'undefined' ? LPB_INACTIVIDAD_MIN : '(sin Sesiones.gs)'));

  if (LPB_ID_LISTA === LPB_ID_SISTEMA) {
    Logger.log('');
    Logger.log('  ATENCIÓN: los dos identificadores apuntan al mismo libro.');
  }
}

/** Nombres de hoja utilizados por el sistema. */
var LPB_HOJAS = {
  LISTA:        'LPB - NACIONALES',
  INDICE:       '_INDICE',
  PARAMETROS:   'PARAMETROS',
  AUTORIZADOS:  'AUTORIZADOS',
  HISTORICO:    'AUTORIZADOS_HISTORICO',
  BITACORA:     'BITACORA',
  CASOS_PRUEBA: 'CASOS_PRUEBA'
};

/** Fila donde viven los encabezados y fila donde arrancan los datos. */
var LPB_FILA_ENCABEZADOS = 3;
var LPB_FILA_DATOS       = 4;

/**
 * Mapa columna -> índice base 0, según los encabezados de la fila 3.
 * Si se reordenan columnas en el Sheet, ajustar SOLO aquí.
 */
var LPB_COL = {
  NOMBRE:            0,  // A · NOMBRE COMPLETO EN LISTA DE PERSONAS BLOQUEADAS
  ESTATUS:           1,  // B · ESTATUS EN LISTA
  FECHA_NAC:         2,  // C · FECHA NACIMIENTO/CONSTITUCION
  RFC:               3,  // D · RFC
  CURP:              4,  // E · CURP
  FECHA_PUBLICACION: 5,  // F · FECHA DE PUBLICACION DEL ACUERDO
  ACUERDO:           6,  // G · ACUERDO
  OFICIO_UIF:        7,  // H · NO OFICIO UIF
  OFICIO_SIARA:      8,  // I · NO OFICIO SIARA
  ANIO_LPB:          9,  // J · AÑO LPB
  LIGA_INCORPORA:   10,  // K · Liga a Oficio incorporación
  LIGA_ELIMINA:     11,  // L · Liga a Oficio Eliminación
  DATOS_COMP:       12   // M · DATOS COMPLEMENTARIOS
};

/**
 * Parámetros de calibración.
 *
 * IMPORTANTE — Estos valores son la configuración INICIAL. Deben ajustarse
 * contra la hoja CASOS_PRUEBA antes de liberar el sistema, y el criterio
 * resultante debe documentarse en el manual del sistema. Los umbrales son
 * un criterio normativo sujeto a revisión por CNBV, no una preferencia
 * técnica.
 *
 * En la entrega 3 estos valores se leen de la hoja PARAMETROS para que el
 * ajuste no requiera tocar código.
 */
var LPB_PARAMS = {

  // --- Bandas de coincidencia (puntaje 0-100) -------------------------------
  UMBRAL_CRITICA:   95,   // Escalamiento inmediato al Oficial de Cumplimiento
  UMBRAL_ALTA:      85,   // POSIBLE — dictaminación obligatoria
  //
  // UMBRAL_REVISION es el corte de despliegue: lo que queda debajo NO se
  // muestra por defecto, solo bajo "Ampliar búsqueda". Se subió de 70 a 80
  // para reducir ruido.
  //
  // Sustento: el barrido de umbrales sobre los casos de calibración mostró
  // que entre 65 y 85 no se pierde ninguna detección. Subir a 80 queda
  // dentro de ese rango seguro, y lo que sale de la vista por defecto sigue
  // disponible a un clic — nada se descarta en silencio.
  UMBRAL_REVISION:  80,   // REVISIÓN — se muestra con advertencia
  UMBRAL_AMPLIADA:  60,   // Solo visible bajo "Ampliar búsqueda"

  // --- Pesos de tokens -----------------------------------------------------
  PESO_TOKEN:       1.00, // Token normal (nombre o apellido)
  PESO_PARTICULA:   0.30, // DE, LA, DEL, LOS, Y, SAN...
  PESO_INICIAL:     0.40, // Token de una sola letra

  // --- Penalizaciones y bonos ----------------------------------------------
  PENALIZA_SOBRANTE:   0.07, // Por cada token sin pareja en la cadena más larga
  PENALIZA_MAX:        0.35, // Tope de penalización acumulada por sobrantes
  DESCUENTO_FONETICO:  0.97, // Coincidencia por sonido vale algo menos que por letra
  BONO_FECHA_IGUAL:    8,    // Fecha de nacimiento coincide
  CASTIGO_FECHA_DIST: 15,    // Fecha de nacimiento difiere claramente

  // --- Umbral mínimo para considerar que dos tokens son "el mismo" ----------
  //
  // Calibrado en dos pasos, cada uno a partir de un caso real de uso:
  //
  //   0.82 -> 0.85   "perla sanchez" traía SANCHEZ PEÑA TEODORO con 84.9,
  //                  porque PERLA y PEÑA puntuaban 82.7% entre sí.
  //   0.85 -> 0.90   "blanca esthela peña garcia" traía ARCA BLANCA SA DE CV
  //                  con 81.2, porque GARCIA y ARCA puntuaban 88.9%:
  //                  Jaro-Winkler premia que ARCA esté contenida en GARCIA.
  //
  // Medición sobre los 60 casos de calibración al pasar de 0.85 a 0.90:
  //   · Detecciones perdidas   0   (siguen las 40)
  //   · Candidatos de ruido    7 -> 6
  //   · ARCA BLANCA         81.2 -> 39.5
  //
  // Y sobre diez pares de error real de captura, ninguno se movió:
  //   PERLLA/PERLA 96.8   MONIKA/MONICA 97   ECHEBERRIA/ECHEVERRIA 97
  //   JOAQINN GUSMAN 90.2   RODIRGO 91.5   DELACRUZ/DE LA CRUZ 100
  //   MARIA GONZALEZ HERNANDEZ vs MARIA GONZALEZ 93 (registro incompleto)
  //
  // El margen es amplio: los errores de captura viven entre 90 y 100, y lo
  // que se filtra son palabras que solo comparten letras por casualidad.
  UMBRAL_TOKEN:     0.90,

  // --- Límites operativos (se aplican en la entrega 3) ---------------------
  // Bajado de 4 a 3. Caso real: "GIL" (apellido, 3 letras) no podía
  // buscarse solo contra "GIL GARCIA JOSE FERNANDO" — el prefiltro y el
  // cálculo ya funcionaban bien para 3 letras (puntaje 93), lo único que
  // bloqueaba era este candado sobre el texto que escribe el usuario.
  //
  // RUIDO ACEPTADO Y MEDIDO: palabras de exactamente 3 letras pueden
  // coincidir con otra palabra distinta que comparte el mismo inicio, por
  // ejemplo "GIL" contra "GILDA" (apellido vs nombre de pila) da 84.3 —
  // arriba del umbral de despliegue, sin relación real entre ambos. Es el
  // mismo tipo de ruido ya aceptado con la contención de prefijo/sufijo:
  // se descarta con el RFC o CURP, igual que cualquier otro candidato.
  MIN_CARACTERES:      3,
  MAX_RESULTADOS:     15,   // Tope de filas devueltas al cliente
  MAX_CONSULTAS_HORA: 60,   // Por usuario; al rebasar se alerta a Cumplimiento
  DIAS_ALERTA_VIGENCIA: 3,  // Días sin reconstruir el índice antes del aviso ámbar

  // Días sin INCORPORAR registros nuevos a la lista. Distinto de lo anterior:
  // mide el trabajo humano de capturar oficios, no el automático de indexar.
  // La UIF publica acuerdos con frecuencia irregular, pero dos semanas sin un
  // solo registro nuevo sugiere que la captura se detuvo, no que no hubo qué
  // capturar.
  DIAS_SIN_CAPTURA_AMBAR: 10,
  DIAS_SIN_CAPTURA_ROJO:  20
};

/** Etiquetas de banda (eje de similitud). */
var LPB_BANDAS = {
  CRITICA:  'CRÍTICA',
  ALTA:     'ALTA',
  REVISION: 'REVISIÓN',
  AMPLIADA: 'AMPLIADA',
  NULA:     'SIN COINCIDENCIA RELEVANTE'
};

/**
 * NIVELES DE COINCIDENCIA — el eje que ve el analista.
 *
 * La banda mide CUÁNTO SE PARECE. El nivel responde algo distinto y más
 * útil: CÓMO COINCIDIÓ. No es lo mismo un 100 porque el CURP es idéntico
 * que un 100 porque el nombre está escrito igual.
 *
 * El caso que lo destapó: "MANUEL GARZA ESPINOZA" devolvió dos registros,
 * ambos marcados CRÍTICA — uno por RFC (identificación real) y otro por
 * simple parecido ortográfico, sin ningún identificador que lo respaldara.
 * Pintarlos igual induce al error.
 */
var LPB_NIVELES = {
  CONFIRMADA: 'CONFIRMADA',   // CURP o RFC completo idénticos
  PROBABLE:   'PROBABLE',     // RFC raíz exacta, o nombre alto + fecha coincidente
  POSIBLE:    'POSIBLE',      // nombre alto SIN identificador que confirme
  REVISION:   'REVISIÓN',     // nombre medio
  AMPLIADA:   'AMPLIADA',     // lejano, plegado por defecto
  NULA:       'SIN COINCIDENCIA'
};

/** Texto que explica cada nivel al analista, en lenguaje llano. */
var LPB_NIVEL_TEXTO = {
  CONFIRMADA: 'El RFC o CURP del registro coincide con el de la consulta. Suspenda la operación y escale al Oficial de Cumplimiento.',
  PROBABLE:   'El RFC coincide de forma parcial. Confirme la identidad del cliente antes de resolver.',
  POSIBLE:    'El nombre coincide con un registro de la lista. Confirme la identidad del cliente con su RFC o CURP antes de resolver.',
  REVISION:   'Coincidencia parcial con un registro de la lista. Revise y documente el resultado aunque lo descarte.',
  AMPLIADA:   'Coincidencia lejana. Se muestra para constancia de que fue evaluada.',
  NULA:       'No se considera coincidencia relevante.'
};

/**
 * Determina el nivel a partir de la evaluación completa.
 *
 * @param {Object} ev  salida de lpbEvaluar_
 * @param {boolean} soloNombre  el registro carece de RFC y CURP
 * @return {string}
 */
function lpbNivel_(ev, soloNombre) {
  var m = ev.motivos || [];
  function tiene(x) { return m.indexOf(x) !== -1; }

  // CONFIRMADA — coincidió un identificador oficial completo.
  if (tiene('CURP_EXACTO') || tiene('CURP_RAIZ_EXACTA') ||
      tiene('RFC_COMPLETO_EXACTO')) {
    return LPB_NIVELES.CONFIRMADA;
  }

  // PROBABLE — evidencia fuerte que aún admite duda.
  if (tiene('RFC_RAIZ_EXACTA') || tiene('CURP_1_DIFERENCIA') ||
      tiene('RFC_RAIZ_1_DIFERENCIA')) {
    return LPB_NIVELES.PROBABLE;
  }
  // Nombre muy alto respaldado por fecha de nacimiento independiente.
  if (ev.puntaje >= LPB_PARAMS.UMBRAL_CRITICA && tiene('FECHA_NACIMIENTO_COINCIDE')) {
    return LPB_NIVELES.PROBABLE;
  }

  // POSIBLE — el nombre coincide, nada lo confirma.
  if (ev.puntaje >= LPB_PARAMS.UMBRAL_ALTA) return LPB_NIVELES.POSIBLE;
  if (ev.puntaje >= LPB_PARAMS.UMBRAL_REVISION) return LPB_NIVELES.REVISION;
  if (ev.puntaje >= LPB_PARAMS.UMBRAL_AMPLIADA) return LPB_NIVELES.AMPLIADA;
  return LPB_NIVELES.NULA;
}

/**
 * Devuelve la banda que corresponde a un puntaje.
 * @param {number} puntaje 0-100
 * @return {string}
 */
function lpbBanda_(puntaje) {
  if (puntaje >= LPB_PARAMS.UMBRAL_CRITICA)  return LPB_BANDAS.CRITICA;
  if (puntaje >= LPB_PARAMS.UMBRAL_ALTA)     return LPB_BANDAS.ALTA;
  if (puntaje >= LPB_PARAMS.UMBRAL_REVISION) return LPB_BANDAS.REVISION;
  if (puntaje >= LPB_PARAMS.UMBRAL_AMPLIADA) return LPB_BANDAS.AMPLIADA;
  return LPB_BANDAS.NULA;
}

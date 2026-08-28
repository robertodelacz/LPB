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

/** Identificador del libro que contiene la LPB. */
var LPB_SPREADSHEET_ID = '1cZsnZK1FoLUP7QNwTxUCnCfJvtdq_fT27ZvY6q3RqJo';

/** Nombres de hoja utilizados por el sistema. */
var LPB_HOJAS = {
  LISTA:        'LPB',
  INDICE:       '_INDICE',
  PARAMETROS:   'PARAMETROS',
  AUTORIZADOS:  'AUTORIZADOS',
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
  UMBRAL_ALTA:      85,   // Dictaminación obligatoria
  UMBRAL_REVISION:  70,   // Se muestra con advertencia
  UMBRAL_AMPLIADA:  60,   // Solo visible bajo "ampliar búsqueda"

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
  UMBRAL_TOKEN:     0.82,

  // --- Límites operativos (se aplican en la entrega 3) ---------------------
  MIN_CARACTERES:      4,   // Longitud mínima de consulta
  MAX_RESULTADOS:     15,   // Tope de filas devueltas al cliente
  MAX_CONSULTAS_HORA: 60,   // Por usuario; al rebasar se alerta a Cumplimiento
  DIAS_ALERTA_VIGENCIA: 3   // Días hábiles sin captura antes del banner ámbar
};

/** Etiquetas de banda. */
var LPB_BANDAS = {
  CRITICA:  'CRÍTICA',
  ALTA:     'ALTA',
  REVISION: 'REVISIÓN',
  AMPLIADA: 'AMPLIADA',
  NULA:     'SIN COINCIDENCIA RELEVANTE'
};

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

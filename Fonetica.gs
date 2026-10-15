/**
 * ============================================================================
 * LPB · Fonetica.gs
 * Codificación fonética adaptada al español de México.
 * ----------------------------------------------------------------------------
 * Por qué NO se usa Soundex: Soundex está afinado a la fonología del inglés.
 * En español falla justo en los pares que más importan (Z/S, B/V, J/G/X, LL/Y)
 * y además descarta vocales, lo que colapsa apellidos distintos.
 *
 * Este módulo NO descarta vocales. Hace una "reescritura fonética": convierte
 * el nombre a una ortografía canónica donde todo lo que suena igual se
 * escribe igual. La tolerancia a letras faltantes o sobrantes ya la aporta
 * Jaro-Winkler en Similitud.gs; duplicarla aquí solo generaría falsos
 * positivos.
 *
 * Ejemplos de lo que resuelve:
 *   GUZMAN / GUSMAN          -> GUSMAN
 *   JIMENEZ / XIMENEZ / GIMENEZ -> JIMENES
 *   ELIZONDO / ELISONDO      -> ELISONDO
 *   VARGAS / BARGAS          -> BARGAS
 *   YAÑEZ / LLANEZ           -> IANES
 *   ECHEVERRIA / ETXEBERRIA  -> ECHEBERIA
 *
 * Codificación DOBLE: la X del español es ambigua (Ximénez suena a J,
 * Xóchitl suena a S, éxito suena a KS). Por eso se devuelven hasta dos
 * claves por token y basta que UNA coincida.
 * ============================================================================
 */

/**
 * Genera las claves fonéticas de un token.
 * @param {string} token  ya normalizado (mayúsculas, sin acentos)
 * @return {string[]}  1 o 2 claves
 */
function lpbClavesFoneticas_(token) {
  if (!token) return [''];
  var t = String(token).toUpperCase();

  // La X se resuelve por rama: una clave la trata como J, otra como S.
  if (t.indexOf('X') !== -1) {
    var ramaJ = lpbReescribirFonetico_(t.replace(/X/g, 'J'));
    var ramaS = lpbReescribirFonetico_(t.replace(/X/g, 'S'));
    return ramaJ === ramaS ? [ramaJ] : [ramaJ, ramaS];
  }
  return [lpbReescribirFonetico_(t)];
}

/**
 * Reescritura fonética. El orden de las reglas importa: los dígrafos deben
 * procesarse antes que las letras sueltas que los componen.
 * @param {string} t
 * @return {string}
 */
function lpbReescribirFonetico_(t) {

  // --- 1. Dígrafos, antes que nada -----------------------------------------
  t = t.replace(/CH/g, '8');    // marcador temporal: 'ch' es un sonido propio
  t = t.replace(/LL/g, 'Y');    // yeísmo: LLANO = YANO
  t = t.replace(/RR/g, 'R');    // no distingue vibrante simple de múltiple
  t = t.replace(/QU/g, 'K');    // QUEZADA -> KESADA
  // La U de GUE/GUI es muda y la G es DURA. Se marca con '9' para que las
  // reglas de seseo posteriores no la conviertan en J: GUERRERO suena
  // /gerero/, no /jerero/. La pérdida de la U por error de captura la
  // absorbe Jaro-Winkler, no hace falta cubrirla aquí.
  t = t.replace(/GUE/g, '9E');  // GUERRERO -> GERERO
  t = t.replace(/GUI/g, '9I');  // GUILLERMO -> GIYERMO
  t = t.replace(/NV/g, 'NB');   // ENVIA / EMBIA

  // --- 2. H muda (pero no la de CH, ya protegida) --------------------------
  t = t.replace(/H/g, '');      // HERNANDEZ -> ERNANDES

  // --- 3. Consonantes que comparten sonido en México -----------------------
  t = t.replace(/CE/g, 'SE');   // seseo
  t = t.replace(/CI/g, 'SI');
  t = t.replace(/Z/g, 'S');     // GUZMAN -> GUSMAN
  t = t.replace(/C/g, 'K');     // el resto de las C suenan /k/
  t = t.replace(/Q/g, 'K');     // Q suelta (JOAQIN mal escrito) -> JOAKIN
  t = t.replace(/GE/g, 'JE');   // GERARDO -> JERARDO
  t = t.replace(/GI/g, 'JI');   // GIMENEZ -> JIMENES
  t = t.replace(/V/g, 'B');     // VARGAS -> BARGAS
  t = t.replace(/W/g, 'B');     // WENCESLAO -> BENSESLAO

  // --- 4. Vocales y semivocales -------------------------------------------
  t = t.replace(/Y$/g, 'I');    // GODOY -> GODOI
  t = t.replace(/Y(?![AEIOU])/g, 'I');
  t = t.replace(/U(?=[AEIOU])/g, 'U');

  // --- 5. Nasales ante labial ---------------------------------------------
  t = t.replace(/N(?=[BP])/g, 'M');  // SAN PEDRO / SAMPEDRO

  // --- 6. Restaurar marcadores --------------------------------------------
  t = t.replace(/8/g, 'CH');
  t = t.replace(/9/g, 'G');

  // --- 7. Colapsar letras dobles ------------------------------------------
  t = t.replace(/(.)\1+/g, '$1');

  return t;
}

/**
 * Clave fonética de una cadena completa (varios tokens).
 * Se usa solo para depuración y para el bucket del índice.
 * @param {string} texto
 * @return {string}
 */
function lpbClaveFoneticaFrase_(texto) {
  var norm = lpbNormalizar_(texto);
  return norm.tokens.map(function (t) {
    return lpbClavesFoneticas_(t)[0];
  }).join(' ');
}

/**
 * Bucket de prefiltro: primera letra de la clave fonética de cada token,
 * ordenada alfabéticamente. Permite descartar candidatos imposibles antes
 * de correr el scoring caro.
 *
 * "JOAQUIN GUZMAN LOERA" -> "G|J|L"
 * "GUSMAN JOAKIN"        -> "G|J"      (comparte G y J -> pasa el prefiltro)
 *
 * @param {string} texto
 * @return {string}
 */
function lpbBucket_(texto) {
  var norm = lpbNormalizar_(texto);
  var letras = {};
  norm.tokens.forEach(function (t) {
    if (LPB_PARTICULAS.indexOf(t) !== -1) return;  // partículas no aportan
    var clave = lpbClavesFoneticas_(t)[0];
    if (clave.length > 0) letras[clave.charAt(0)] = true;
  });
  return Object.keys(letras).sort().join('|');
}

/**
 * ¿Dos buckets comparten al menos una inicial fonética?
 * @param {string} bucketA
 * @param {string} bucketB
 * @return {boolean}
 */
function lpbBucketsCompatibles_(bucketA, bucketB) {
  if (!bucketA || !bucketB) return true;   // ante la duda, no descartar
  var a = bucketA.split('|');
  var b = bucketB.split('|');
  for (var i = 0; i < a.length; i++) {
    if (b.indexOf(a[i]) !== -1) return true;
  }
  return false;
}

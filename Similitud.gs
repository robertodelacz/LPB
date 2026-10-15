/**
 * ============================================================================
 * LPB · Similitud.gs
 * Comparación de cadenas y emparejamiento de tokens sin importar el orden.
 * ----------------------------------------------------------------------------
 * Por qué Jaro-Winkler y no Levenshtein para nombres de persona: la mayoría
 * de los errores de tipeo y de transcripción ocurren a la mitad o al final
 * de la palabra, no al principio. Jaro-Winkler premia el prefijo coincidente,
 * que es exactamente el comportamiento que se quiere aquí.
 *
 * Para razones sociales largas se usa Levenshtein normalizado, donde cada
 * carácter pesa igual.
 * ============================================================================
 */

/**
 * Distancia de Jaro.
 * @param {string} s1
 * @param {string} s2
 * @return {number} 0..1
 */
function lpbJaro_(s1, s2) {
  if (s1 === s2) return 1;
  var len1 = s1.length, len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  var ventana = Math.floor(Math.max(len1, len2) / 2) - 1;
  if (ventana < 0) ventana = 0;

  var m1 = new Array(len1).fill(false);
  var m2 = new Array(len2).fill(false);
  var coincidencias = 0;

  for (var i = 0; i < len1; i++) {
    var ini = Math.max(0, i - ventana);
    var fin = Math.min(i + ventana + 1, len2);
    for (var j = ini; j < fin; j++) {
      if (m2[j]) continue;
      if (s1.charAt(i) !== s2.charAt(j)) continue;
      m1[i] = true;
      m2[j] = true;
      coincidencias++;
      break;
    }
  }
  if (coincidencias === 0) return 0;

  // Transposiciones
  var k = 0, transp = 0;
  for (var x = 0; x < len1; x++) {
    if (!m1[x]) continue;
    while (!m2[k]) k++;
    if (s1.charAt(x) !== s2.charAt(k)) transp++;
    k++;
  }
  transp = transp / 2;

  return (coincidencias / len1 +
          coincidencias / len2 +
          (coincidencias - transp) / coincidencias) / 3;
}

/**
 * Jaro-Winkler.
 * @param {string} s1
 * @param {string} s2
 * @param {number=} p  factor de prefijo, default 0.1
 * @return {number} 0..1
 */
function lpbJaroWinkler_(s1, s2, p) {
  p = (p === undefined) ? 0.1 : p;
  var jaro = lpbJaro_(s1, s2);
  if (jaro < 0.7) return jaro;   // umbral estándar: no premiar prefijo si el
                                 // parecido base es pobre
  var prefijo = 0;
  var max = Math.min(4, Math.min(s1.length, s2.length));
  for (var i = 0; i < max; i++) {
    if (s1.charAt(i) === s2.charAt(i)) prefijo++;
    else break;
  }
  return jaro + prefijo * p * (1 - jaro);
}

/**
 * Distancia de Levenshtein.
 * @param {string} a
 * @param {string} b
 * @return {number}
 */
function lpbLevenshtein_(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  var prev = [];
  for (var j = 0; j <= b.length; j++) prev[j] = j;

  for (var i = 1; i <= a.length; i++) {
    var actual = [i];
    for (var k = 1; k <= b.length; k++) {
      var costo = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
      actual[k] = Math.min(actual[k - 1] + 1, prev[k] + 1, prev[k - 1] + costo);
    }
    prev = actual;
  }
  return prev[b.length];
}

/**
 * Levenshtein normalizado a 0..1.
 * @param {string} a
 * @param {string} b
 * @return {number}
 */
function lpbLevenshteinNorm_(a, b) {
  var max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - (lpbLevenshtein_(a, b) / max);
}

/**
 * Similitud entre dos tokens, combinando escritura y sonido.
 * Devuelve el mejor de los dos, con un pequeño descuento cuando la
 * coincidencia se logró solo por vía fonética.
 *
 * @param {string} a
 * @param {string} b
 * @return {{puntaje: number, via: string}}
 */
function lpbSimilitudToken_(a, b) {
  if (a === b) return { puntaje: 1, via: 'exacta' };

  // CONTENCIÓN: un token es, literalmente, el inicio o el final del otro.
  //
  // CASO QUE LO DESTAPÓ: buscar "FRUT" no encontraba a "ALFRUT SA DE CV".
  // "FRUT" es el final exacto de "ALFRUT" —no un error de captura, es el
  // mismo fragmento de palabra— pero Jaro-Winkler solo da 88.9% entre ambos,
  // bajo el 90% exigido tras la corrección anterior (la que resolvió
  // PERLA/PEÑA y GARCIA/ARCA). Buscar una raíz o fragmento de una razón
  // social es un patrón de búsqueda normal y legítimo en personas morales:
  // "ALFRUT", "DISTRICARNES" o "COMERCIALIZADORA RIVAS" se arman como
  // PREFIJO+RAÍZ o RAÍZ+SUFIJO, y el analista a menudo solo conoce o recuerda
  // el fragmento distintivo, no el nombre completo.
  //
  // Se restringe a PREFIJO o SUFIJO —no a cualquier posición— para no
  // premiar coincidencias de en medio de la palabra: "JUAN" aparece dentro
  // de "AJUANADO" por azar, sin relación real entre ambos nombres. Con la
  // restricción a inicio/final, ese caso queda en 0, como debe ser.
  //
  // RUIDO ACEPTADO Y DOCUMENTADO: nombres comunes de 4 letras que sí son
  // prefijo o sufijo real de otro nombre distinto —"ROSA" dentro de
  // "AMBROSA", "LUIS" dentro de "LUISBER"— sí activan esta regla y entran
  // como candidato POSIBLE (puntaje 81.7), aunque no sean la misma persona.
  // Es ruido adicional, no un riesgo de seguridad: el analista descarta con
  // el RFC o CURP, igual que con cualquier otro candidato. Se midió contra
  // los 60 casos de calibración sin ninguna detección perdida.
  var corto = a.length <= b.length ? a : b;
  var largo = a.length <= b.length ? b : a;
  var esPrefijo = largo.indexOf(corto) === 0;
  var esSufijo  = largo.lastIndexOf(corto) === largo.length - corto.length;
  var esContencion = corto.length >= 4 && (esPrefijo || esSufijo);

  var porLetra = lpbJaroWinkler_(a, b);

  var clavesA = lpbClavesFoneticas_(a);
  var clavesB = lpbClavesFoneticas_(b);
  var porSonido = 0;
  for (var i = 0; i < clavesA.length; i++) {
    for (var j = 0; j < clavesB.length; j++) {
      var s = (clavesA[i] === clavesB[j]) ? 1 : lpbJaroWinkler_(clavesA[i], clavesB[j]);
      if (s > porSonido) porSonido = s;
    }
  }
  porSonido = porSonido * LPB_PARAMS.DESCUENTO_FONETICO;

  if (esContencion && 0.95 > porSonido && 0.95 > porLetra) {
    return { puntaje: 0.95, via: 'contención' };
  }
  if (porSonido > porLetra) {
    return { puntaje: porSonido, via: 'fonética' };
  }
  return { puntaje: porLetra, via: porLetra >= 0.99 ? 'exacta' : 'tipográfica' };
}

/**
 * Emparejamiento de tokens INDEPENDIENTE DEL ORDEN.
 *
 * Éste es el corazón del motor. En la LPB el nombre viene como una sola
 * cadena y el orden varía: "PEREZ LOPEZ JUAN" y "JUAN PEREZ LOPEZ" son la
 * misma persona. Comparar las cadenas completas daría un puntaje bajísimo.
 *
 * Estrategia: se calcula la similitud de todos los pares posibles, se
 * ordenan de mayor a menor y se asignan de forma codiciosa. Con nombres de
 * hasta 6-8 tokens el resultado codicioso coincide con el óptimo en la
 * práctica, a una fracción del costo del algoritmo húngaro.
 *
 * @param {Object} normA  salida de lpbNormalizar_
 * @param {Object} normB  salida de lpbNormalizar_
 * @return {{puntaje: number, pares: Array, sobrantesA: string[], sobrantesB: string[]}}
 */
function lpbEmparejarTokens_(normA, normB) {
  var A = normA.tokens, B = normB.tokens;
  if (A.length === 0 || B.length === 0) {
    return { puntaje: 0, pares: [], sobrantesA: A, sobrantesB: B };
  }

  // Matriz de candidatos
  var candidatos = [];
  for (var i = 0; i < A.length; i++) {
    for (var j = 0; j < B.length; j++) {
      var sim = lpbSimilitudToken_(A[i], B[j]);
      if (sim.puntaje >= LPB_PARAMS.UMBRAL_TOKEN) {
        candidatos.push({ i: i, j: j, puntaje: sim.puntaje, via: sim.via });
      }
    }
  }
  candidatos.sort(function (x, y) { return y.puntaje - x.puntaje; });

  // Asignación codiciosa
  var usadosA = {}, usadosB = {}, pares = [];
  for (var c = 0; c < candidatos.length; c++) {
    var cand = candidatos[c];
    if (usadosA[cand.i] || usadosB[cand.j]) continue;
    usadosA[cand.i] = true;
    usadosB[cand.j] = true;
    pares.push({
      tokenA:  A[cand.i],
      tokenB:  B[cand.j],
      puntaje: cand.puntaje,
      via:     cand.via,
      peso:    Math.max(normA.pesos[cand.i], normB.pesos[cand.j])
    });
  }

  // Cobertura ponderada del conjunto MÁS CORTO.
  // Se usa el más corto porque "JUAN PEREZ" contra "JUAN CARLOS PEREZ LOPEZ"
  // debe puntuar alto: es un nombre incompleto, no un nombre distinto.
  var pesoTotalA = normA.pesos.reduce(function (s, p) { return s + p; }, 0);
  var pesoTotalB = normB.pesos.reduce(function (s, p) { return s + p; }, 0);
  var pesoBase   = Math.min(pesoTotalA, pesoTotalB);
  if (pesoBase === 0) return { puntaje: 0, pares: [], sobrantesA: A, sobrantesB: B };

  var pesoLogrado = pares.reduce(function (s, p) { return s + p.puntaje * p.peso; }, 0);
  var cobertura = Math.min(1, pesoLogrado / pesoBase);

  // Sobrantes en la cadena más larga: penalización moderada y con tope.
  var sobrantesA = A.filter(function (_, i) { return !usadosA[i]; });
  var sobrantesB = B.filter(function (_, j) { return !usadosB[j]; });
  var nSobrantesLargo = (A.length >= B.length) ? sobrantesA.length : sobrantesB.length;

  // TOPE AL NÚMERO DE SOBRANTES QUE SE PENALIZAN.
  //
  // CASO QUE LO DESTAPÓ: buscar "BEYRUTI" no encontraba a "RAUL MANUEL
  // BEYRUTI SÁNCHEZ" — el apellido coincidía al 100%, pero los otros tres
  // tokens del registro (nombre y materno) se contaban como sobrantes sin
  // relación con que la consulta solo traía una palabra. Puntaje: 79, un
  // punto bajo el umbral de despliegue. El sistema ocultaba una coincidencia
  // exacta de apellido por la forma en que se escribió la búsqueda, no por
  // ninguna diferencia real.
  //
  // El defecto era sistémico, no de este caso: CUALQUIER búsqueda de un
  // solo apellido contra un nombre completo mexicano (nombre + paterno +
  // materno = 3 o 4 tokens) caía en el mismo problema, porque el castigo
  // contaba TODOS los sobrantes del lado largo sin relación con cuántos
  // tokens trajo la consulta.
  //
  // El tope limita cuántos sobrantes pesan en el castigo al número de
  // tokens que trajo la consulta: nunca se penaliza por más contexto
  // faltante del que la propia consulta podía aportar.
  //
  // AJUSTE SOBRE LA PRIMERA VERSIÓN: el tope inicial tenía un piso de 2,
  // incluso para consultas de un solo token. Eso bastaba para un apellido
  // ESCRITO IGUAL al del registro ("BEYRUTI" exacto: 100% de coincidencia
  // por token, 86 con el tope). Pero cuando el apellido tiene un error de
  // captura o se escribe distinto —"beiru" contra "BEYRUTI", que empareja
  // por la vía fonética al 91.5%, no al 100%— el 14% de castigo (2
  // sobrantes) combinado con ese 91.5% imperfecto volvía a caer bajo 80:
  // 91.5% × 0.86 = 78.7. El propio tope de 2 seguía siendo demasiado
  // estricto para la mitad de los casos reales, los que no son un calco
  // exacto del nombre.
  //
  var tokensCortos  = Math.min(A.length, B.length);
  var topeSobrantes = tokensCortos;
  nSobrantesLargo   = Math.min(nSobrantesLargo, topeSobrantes);

  var castigo = Math.min(
    LPB_PARAMS.PENALIZA_MAX,
    nSobrantesLargo * LPB_PARAMS.PENALIZA_SOBRANTE
  );

  return {
    puntaje:    Math.max(0, cobertura * (1 - castigo)),
    pares:      pares,
    sobrantesA: sobrantesA,
    sobrantesB: sobrantesB
  };
}

/**
 * Similitud de nombres, punto de entrada del módulo.
 * @param {string} textoA
 * @param {string} textoB
 * @return {Object}  detalle completo
 */
function lpbCompararNombres_(textoA, textoB) {
  var normA = lpbNormalizar_(textoA);
  var normB = lpbNormalizar_(textoB);
  var empa  = lpbEmparejarTokens_(normA, normB);

  // Para personas morales largas, Levenshtein sobre la cadena completa suele
  // ser más estable que el emparejamiento por tokens. Se toma el mejor.
  var puntaje = empa.puntaje;
  var metodo  = 'tokens';

  // Forma compacta: cubre las partículas pegadas ("DELACRUZ" / "DE LA CRUZ"),
  // donde la tokenización difiere tanto que el emparejamiento fracasa aunque
  // se trate del mismo nombre escrito de dos maneras válidas.
  //
  // Se exige coincidencia CASI TOTAL (>= 0.90). Sin esa condición la forma
  // compacta se convierte en un comodín que sube el puntaje de cualquier par
  // de nombres de longitud parecida: "JOSE LUIS RAMIREZ" contra "JOSE MANUEL
  // RAMIREZ" da 0.70 en compacta, un número que no significa nada. La forma
  // compacta solo es evidencia cuando es prácticamente idéntica.
  var comp = lpbLevenshteinNorm_(normA.compacto, normB.compacto);
  if (comp >= 0.90 && comp > puntaje) { puntaje = comp; metodo = 'compacta'; }

  // Para razones sociales largas, Levenshtein sobre la cadena completa suele
  // ser más estable que el emparejamiento por tokens.
  if (normA.esMoral || normB.esMoral ||
      normA.tokens.length > 5 || normB.tokens.length > 5) {
    var lev = lpbLevenshteinNorm_(normA.normalizado, normB.normalizado);
    if (lev > puntaje) { puntaje = lev; metodo = 'levenshtein'; }
  }

  return {
    puntaje:     Math.round(puntaje * 1000) / 10,   // 0..100 con un decimal
    metodo:      metodo,
    normA:       normA,
    normB:       normB,
    pares:       empa.pares,
    sobrantesA:  empa.sobrantesA,
    sobrantesB:  empa.sobrantesB
  };
}

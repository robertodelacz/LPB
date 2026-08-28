/**
 * ============================================================================
 * LPB · Motor.gs
 * Orquestador. Único módulo que la WebApp conocerá.
 * ----------------------------------------------------------------------------
 * Todo lo demás (Normalizador, Fonetica, Similitud, Identificadores) es
 * intercambiable detrás de esta interfaz. Cuando se construya el barrido
 * masivo de cartera contra la LPB, le hablará a estas mismas funciones desde
 * el otro sentido, sin reescribir nada.
 * ============================================================================
 */

/**
 * Determina qué capturó el usuario.
 * @param {string} texto
 * @return {string}  'CURP' | 'RFC' | 'NOMBRE'
 */
function lpbTipoConsulta_(texto) {
  var t = lpbLimpiarId_(texto);
  if (/^[A-ZÑ]{4}\d{6}[HM][A-Z]{2}[A-ZÑ]{3}[A-Z0-9]\d$/.test(t)) return 'CURP';
  if (/^[A-ZÑ&]{3,4}\d{6}([A-Z0-9]{3})?$/.test(t))                return 'RFC';
  return 'NOMBRE';
}

/**
 * Evalúa una consulta contra UN registro de la lista.
 *
 * @param {Object} consulta  {nombre, rfc, curp, fechaNac}
 * @param {Object} registro  {nombre, rfc, curp, fechaNac, alias[]}
 * @return {Object}  {puntaje, banda, motivos[], detalle}
 */
function lpbEvaluar_(consulta, registro) {
  var motivos = [];
  var puntaje = 0;
  var detalle = {};

  // --- 1. Identificadores fuertes ------------------------------------------
  // Pesan más que el nombre porque no dependen de cómo se escribió.
  if (consulta.curp && registro.curp) {
    var c = lpbCompararCURP_(consulta.curp, registro.curp);
    if (c.puntaje > 0) {
      puntaje = Math.max(puntaje, c.puntaje);
      motivos.push(c.tipo);
      detalle.curp = c;
    }
  }
  if (consulta.rfc && registro.rfc) {
    var r = lpbCompararRFC_(consulta.rfc, registro.rfc);
    if (r.puntaje > 0) {
      puntaje = Math.max(puntaje, r.puntaje);
      motivos.push(r.tipo);
      detalle.rfc = r;
    }
  }

  // --- 2. Nombre, incluyendo alias -----------------------------------------
  var mejorNombre = null;
  if (consulta.nombre && registro.nombre) {
    mejorNombre = lpbCompararNombres_(consulta.nombre, registro.nombre);
    mejorNombre.contra = 'NOMBRE_EN_LISTA';
  }
  // Los alias del campo DATOS COMPLEMENTARIOS se puntúan igual que el nombre
  // principal. Un alias sin indexar es una coincidencia que nunca se detecta.
  if (consulta.nombre && registro.alias && registro.alias.length) {
    for (var i = 0; i < registro.alias.length; i++) {
      var cmp = lpbCompararNombres_(consulta.nombre, registro.alias[i]);
      if (!mejorNombre || cmp.puntaje > mejorNombre.puntaje) {
        cmp.contra = 'ALIAS: ' + registro.alias[i];
        mejorNombre = cmp;
      }
    }
  }
  if (mejorNombre) {
    detalle.nombre = mejorNombre;
    if (mejorNombre.puntaje > puntaje) {
      puntaje = mejorNombre.puntaje;
      motivos.push(mejorNombre.contra.indexOf('ALIAS') === 0
        ? 'COINCIDENCIA_POR_ALIAS' : 'COINCIDENCIA_POR_NOMBRE');
    }
  }

  // --- 3. Fecha de nacimiento como desempate -------------------------------
  // Sube o baja la banda cuando el nombre por sí solo no resuelve.
  var fechaConsulta = consulta.fechaNac;
  if (!fechaConsulta && consulta.curp) fechaConsulta = lpbValidarCURP_(consulta.curp).fecha;
  if (!fechaConsulta && consulta.rfc)  fechaConsulta = lpbRfcFecha_(consulta.rfc);

  var fechaRegistro = registro.fechaNac;
  if (!fechaRegistro && registro.curp) fechaRegistro = lpbValidarCURP_(registro.curp).fecha;
  if (!fechaRegistro && registro.rfc)  fechaRegistro = lpbRfcFecha_(registro.rfc);

  var f = lpbCompararFechas_(fechaConsulta, fechaRegistro);
  detalle.fecha = f;
  if (f.ajuste !== 0) {
    puntaje = puntaje + f.ajuste;
    motivos.push(f.ajuste > 0 ? 'FECHA_NACIMIENTO_COINCIDE' : 'FECHA_NACIMIENTO_DIFIERE');
  }

  puntaje = Math.max(0, Math.min(100, puntaje));
  puntaje = Math.round(puntaje * 10) / 10;

  return {
    puntaje: puntaje,
    banda:   lpbBanda_(puntaje),
    motivos: motivos,
    detalle: detalle
  };
}

/**
 * Redacta en lenguaje llano por qué se produjo la coincidencia.
 * El analista necesita esto para dictaminar; un número solo no basta.
 *
 * @param {Object} evaluacion  salida de lpbEvaluar_
 * @return {string}
 */
function lpbExplicarCoincidencia_(evaluacion) {
  var d = evaluacion.detalle;
  var lineas = [];

  if (d.curp && d.curp.puntaje > 0) {
    lineas.push('CURP: ' + lpbTextoMotivo_(d.curp.tipo));
  }
  if (d.rfc && d.rfc.puntaje > 0) {
    lineas.push('RFC: ' + lpbTextoMotivo_(d.rfc.tipo));
  }
  if (d.nombre) {
    var vias = {};
    d.nombre.pares.forEach(function (p) { vias[p.via] = true; });
    var listaVias = Object.keys(vias).join(', ') || 'sin pares';
    lineas.push('Nombre: ' + d.nombre.puntaje + '/100 contra ' + d.nombre.contra +
                ' (coincidencia ' + listaVias + ')');
    d.nombre.pares.forEach(function (p) {
      lineas.push('   · ' + p.tokenA + ' ↔ ' + p.tokenB +
                  '  ' + Math.round(p.puntaje * 100) + '%  [' + p.via + ']');
    });
    if (d.nombre.sobrantesA.length) {
      lineas.push('   · sin pareja en la consulta: ' + d.nombre.sobrantesA.join(', '));
    }
    if (d.nombre.sobrantesB.length) {
      lineas.push('   · sin pareja en la lista: ' + d.nombre.sobrantesB.join(', '));
    }
  }
  if (d.fecha && d.fecha.estado !== 'SIN_DATO') {
    lineas.push('Fecha de nacimiento: ' + lpbTextoMotivo_(d.fecha.estado));
  }
  return lineas.join('\n');
}

/**
 * Traduce códigos internos a lenguaje llano.
 * @param {string} codigo
 * @return {string}
 */
function lpbTextoMotivo_(codigo) {
  var mapa = {
    'RFC_COMPLETO_EXACTO':    'idéntico, incluida la homoclave',
    'RFC_RAIZ_EXACTA':        'idéntico sin homoclave — evidencia muy fuerte, la raíz codifica nombre y fecha de nacimiento',
    'RFC_RAIZ_1_DIFERENCIA':  'difiere en un carácter — posible error de captura',
    'RFC_RAIZ_2_DIFERENCIAS': 'difiere en dos caracteres',
    'RFC_DISTINTO':           'no coincide',
    'CURP_EXACTO':            'idéntico — identificación prácticamente definitiva',
    'CURP_RAIZ_EXACTA':       'idéntico salvo homoclave',
    'CURP_1_DIFERENCIA':      'difiere en un carácter — posible error de captura',
    'IGUAL':                  'coincide exactamente',
    'DISTINTA':               'difiere — argumento en contra de la coincidencia',
    'INVERTIDA_DIA_MES':      'día y mes invertidos — probable error de captura, se trata como neutro',
    'SIN_DATO':               'no disponible en uno de los dos lados'
  };
  return mapa[codigo] || codigo;
}

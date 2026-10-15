/**
 * ============================================================================
 * LPB · API.gs
 * Endpoints expuestos a la interfaz.
 * ----------------------------------------------------------------------------
 * ESTE ES EL ÚNICO ARCHIVO CON FUNCIONES INVOCABLES DESDE EL NAVEGADOR.
 *
 * Todo lo demás lleva guion bajo final y por lo tanto no puede llamarse con
 * google.script.run. Cada función de aquí valida permisos en su PRIMERA
 * línea — no basta con validar en doGet, porque nadie está obligado a pasar
 * por doGet para invocar las demás.
 *
 * Ninguna función devuelve la lista completa. Solo filas coincidentes, con
 * tope. El cliente nunca recibe el universo.
 * ============================================================================
 */

/**
 * Punto de entrada de la aplicación web.
 */
function doGet() {
  // Sin caché, igual que el resto.
  //
  // Se intentó permitirla aquí razonando que doGet solo decide qué pantalla
  // pintar. En la práctica produce un caso desconcertante: si se reactiva a un
  // usuario, la caché puede seguir viéndolo inactivo y mostrarle "Acceso
  // restringido" durante minutos, aunque la hoja ya diga que sí puede entrar.
  //
  // Pecar de restrictivo es menos grave que lo contrario, pero es igual de
  // confuso y no vale los milisegundos que ahorra: la hoja AUTORIZADOS tiene
  // una docena de filas y leerla es barato.
  var u = lpbUsuarioActual_(false);

  if (!u.ok) {
    return HtmlService.createTemplateFromFile('Denegado')
      .evaluate()
      .setTitle('Acceso restringido — LPB')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  var t = HtmlService.createTemplateFromFile('Interfaz');
  t.usuario = u;
  // URL real de la aplicación. Una app de Apps Script vive dentro de un marco
  // anidado, y location.reload() recarga ese marco interno —que apunta a un
  // recinto aislado— en lugar de la aplicación: el resultado es una pantalla
  // en blanco. Para reiniciar hay que navegar el marco superior a esta URL.
  t.appUrl = lpbUrlAplicacion_();
  // La ilustración de la cabecera se lee de Drive y se incrusta como data URI.
  // Así no depende de que el archivo esté compartido públicamente ni de un
  // servidor externo que pueda caer.
  t.imgAccesos = lpbImagenDrive_('1Cc9jp8pnfQTndYwyOjeQ5sBcV_nehjS7');
  return t.evaluate()
    .setTitle('Consulta LPB — Financiera Cualli')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    // DEFAULT impide que la página se embeba desde otros orígenes.
    // (XFrameOptionsMode solo admite DEFAULT y ALLOWALL; no existe DENY.)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * Diagnóstico de la imagen del encabezado.
 * Ejecutar desde el editor si la ilustración de Consulta no aparece.
 */
function probarImagenEncabezado() {
  lpbExigir_('usuarios');
  var id = '1Cc9jp8pnfQTndYwyOjeQ5sBcV_nehjS7';
  CacheService.getScriptCache().remove('lpb_img_' + id);
  Logger.log('Identificador: ' + id);
  try {
    var f = DriveApp.getFileById(id);
    var b = f.getBlob();
    Logger.log('  Archivo : ' + f.getName());
    Logger.log('  Tipo    : ' + b.getContentType());
    Logger.log('  Tamaño  : ' + b.getBytes().length + ' bytes');
    if (b.getBytes().length > 380000) {
      Logger.log('  RECHAZADO: supera el tope de 380 KB para incrustarse.');
      Logger.log('  Reduzca la imagen o suba una versión más ligera.');
      return;
    }
    var uri = lpbImagenDrive_(id);
    Logger.log('  Resultado: ' + (uri ? 'OK, ' + uri.length + ' caracteres' : 'VACÍO'));
  } catch (e) {
    Logger.log('  FALLÓ: ' + e.message);
    Logger.log('  Revise que el archivo exista y que su cuenta tenga acceso.');
  }
}

/**
 * URL pública de la aplicación web.
 * Devuelve cadena vacía si aún no está desplegada.
 * @return {string}
 */
function lpbUrlAplicacion_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}

/**
 * Incluye archivos HTML parciales.
 *
 * GUION BAJO FINAL: expuesta, esta función devolvería el código de cualquier
 * plantilla a quien la invocara desde la consola. Los scriptlets de
 * HtmlService corren del lado del servidor, así que pueden llamarla igual.
 *
 * @param {string} archivo
 * @return {string}
 */
function incluir_(archivo) {
  return HtmlService.createHtmlOutputFromFile(archivo).getContent();
}

/* ==========================================================================
 * Sesión
 * ========================================================================== */

/**
 * Datos de sesión y estado de la lista para el encabezado.
 * @return {Object}
 */
function apiSesion() {
  var u = lpbExigir_('buscar');
  var v = lpbEstadoVigencia_();
  return {
    usuario: {
      nombre: u.nombre, correo: u.correo, rol: u.rol,
      area: u.area, permisos: u.permisos
    },
    vigencia: {
      fechaCorte: v.fechaCorte,
      registros:  v.registros,
      semaforo:   v.semaforo,
      aviso:      v.aviso
    }
  };
}

/**
 * Precalienta la caché del índice.
 *
 * Se invoca desde el cliente al terminar de cargar la pantalla, mientras el
 * analista lee. No devuelve datos de la lista: solo confirma cuántos registros
 * quedaron disponibles, para poder diagnosticar si algo falla.
 *
 * @return {Object}
 */
function apiCalentarIndice() {
  lpbExigir_('buscar');
  try {
    var ix = lpbCargarIndice_();
    return { ok: true, registros: ix.filas.length };
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
}

/* ==========================================================================
 * Búsqueda
 * ========================================================================== */

/**
 * Busca en la LPB.
 *
 * @param {Object} params {texto, fechaNac, rfc, ampliada}
 * @return {Object}
 */
function apiBuscar(params) {
  var u = lpbExigir_('buscar');
  params = params || {};

  var texto = String(params.texto || '').trim();

  if (texto.length < LPB_PARAMS.MIN_CARACTERES) {
    throw new Error('Escriba al menos ' + LPB_PARAMS.MIN_CARACTERES +
      ' caracteres. Una consulta más corta no arroja resultados útiles.');
  }

  var limite = lpbVerificarLimite_(u);
  if (!limite.permitido) {
    throw new Error('Alcanzó el máximo de ' + LPB_PARAMS.MAX_CONSULTAS_HORA +
      ' consultas por hora. Se notificó al Oficial de Cumplimiento. ' +
      'Intente de nuevo más tarde.');
  }

  var t0 = new Date().getTime();
  var minimo = params.ampliada ? LPB_PARAMS.UMBRAL_AMPLIADA : LPB_PARAMS.UMBRAL_REVISION;

  var res = lpbBuscarConRefinamiento_(texto, {
    fechaNac:   params.fechaNac || '',
    rfc:        params.rfc || '',
    minimo:     minimo,
    verOficios: !!u.permisos.oficios
  });

  var ms = new Date().getTime() - t0;
  lpbRegistrarConsulta_(u, texto, res, ms);

  // Alerta solo en CONFIRMADA. Ver el comentario de diseño en Bitacora.gs:
  // alertar con coincidencias de nombre saturaría al Oficial y el control
  // moriría por desuso.
  if (res.resultados.length && res.resultados[0].nivel === LPB_NIVELES.CONFIRMADA) {
    lpbAlertarCoincidenciaConfirmada_(u, texto, res.resultados[0]);
  }

  var v = lpbEstadoVigencia_();

  return {
    consulta:      texto,
    tipo:          res.tipo,
    total:         res.total,
    mostrados:     res.resultados.length,
    ampliada:      !!params.ampliada,
    ms:            ms,
    fechaCorte:    v.fechaCorte,
    semaforo:      v.semaforo,
    avisoVigencia: v.aviso,
    consultasRestantes: limite.restantes,
    // Se devuelve el RFC aplicado para que la interfaz pueda mostrarlo: un
    // refinamiento invisible es un refinamiento que nadie audita.
    rfcAplicado:   String(params.rfc || '').trim().toUpperCase(),
    resultados:    res.resultados
  };
}

/**
 * Búsqueda con refinamiento opcional por fecha o RFC.
 * @param {string} texto
 * @param {Object} opciones
 * @return {Object}
 */
/**
 * Arma el cotejo campo por campo entre el cliente y el registro.
 *
 * Es la operación que el analista hace mentalmente: leer el RFC del registro,
 * leer el del cliente y buscar dónde difieren. Hacerlo a ojo, entre dos
 * cadenas de trece caracteres, es donde se cuela el error — sobre todo con la
 * homoclave, que son los tres últimos y los que más se parecen entre personas
 * distintas.
 *
 * Devuelve, por cada campo, el valor de cada lado y en qué posiciones difieren
 * para que la interfaz pueda resaltarlas.
 *
 * @param {Object} consulta  {rfc, curp} lo capturado en Refinar
 * @param {Object} d         datos saneados del registro
 * @return {?Array}  null si no hay nada que cotejar
 */
function lpbCotejo_(consulta, d) {
  var filas = [];

  function comparar(etiqueta, a, b, nota) {
    a = String(a || '').toUpperCase().trim();
    b = String(b || '').toUpperCase().trim();
    if (!a || !b) return;

    var dif = [];
    var n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) {
      if (a.charAt(i) !== b.charAt(i)) dif.push(i);
    }
    filas.push({
      campo:     etiqueta,
      cliente:   a,
      registro:  b,
      iguales:   dif.length === 0,
      difiere:   dif,
      nota:      nota || ''
    });
  }

  if (consulta.rfc && d.rfc) {
    comparar('RFC', consulta.rfc, d.rfc,
      consulta.rfc.substring(0, 10) === String(d.rfc).substring(0, 10) &&
      consulta.rfc !== d.rfc
        ? 'Coincide la raíz; difiere la homoclave. Puede ser el mismo RFC mal capturado.'
        : '');
  }
  if (consulta.curp && d.curp) {
    comparar('CURP', consulta.curp, d.curp);
  }

  return filas.length ? filas : null;
}

/**
 * ¿El registro fue ELIMINADO de la Lista de Personas Bloqueadas?
 *
 * Distinguirlo importa más que cualquier otro dato de la pantalla: un
 * registro eliminado significa que la UIF liberó a esa persona, y tratarlo
 * como bloqueado lleva a rechazar a un cliente que puede operar.
 *
 * LA REDACCIÓN NO ESTÁ NORMALIZADA. En los 10,139 registros hay 585 variantes
 * distintas de este campo, capturadas a mano durante años:
 *
 *     "Se elimina de la lista 01/06/2026"
 *     "Se elimino de lista 24/08/2023"        ← sin acento y en pasado
 *     "Se eliminó de la lista 15/04/2024"     ← con acento
 *     "Se elimina de listas 23/08/2023"       ← plural
 *     "Se elimina de la lista el dia 26/02/2026"
 *     "Eliminado"
 *     "Se elimina"
 *
 * Una versión anterior buscaba la palabra ELIMINA y fallaba con "elimino" y
 * con "eliminó": más de 170 registros ya liberados aparecían en rojo como si
 * siguieran bloqueados.
 *
 * Por eso se comparan acentos aparte y se busca la RAÍZ del verbo, no una
 * conjugación concreta.
 *
 * @param {string} estatus  texto tal como viene de la columna B
 * @return {boolean}
 */
function lpbEsEliminado_(estatus) {
  if (!estatus) return false;
  var t = String(estatus)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');   // ELIMINÓ -> ELIMINO

  // Raíces, no conjugaciones: ELIMIN cubre elimina, elimino, eliminó,
  // eliminado, eliminada y eliminación.
  return /ELIMIN|REANUD|LEVANT|LIBERA|DESBLOQUE|EXCLU|RETIR|\bBAJA\b/.test(t);
}

/**
 * Redacta la guía de dictaminación SEGÚN LO QUE EL REGISTRO REALMENTE TIENE.
 *
 * Un texto fijo no sirve aquí. Decirle al analista "confirme con el RFC" es
 * inútil cuando el registro de la lista no tiene RFC: la lista es la que
 * manda, y si ahí no está el dato, no hay nada contra qué comparar. En esos
 * casos hay que dirigirlo al identificador que sí exista — normalmente la
 * fecha de nacimiento o constitución — o advertirle que no hay ninguno.
 *
 * @param {string} nivel
 * @param {Object} d  datos visibles del registro
 * @return {string}
 */
function lpbGuiaDictaminacion_(nivel, d) {

  if (nivel === LPB_NIVELES.CONFIRMADA) {
    return 'El ' + (d.curp ? 'CURP' : 'RFC') + ' del cliente es idéntico al del registro. ' +
           'Suspenda la operación y escale al Oficial de Cumplimiento.';
  }

  if (nivel === LPB_NIVELES.PROBABLE) {
    return 'El RFC coincide en su raíz pero no en la homoclave. Solicite identificación ' +
           'oficial y constancia de situación fiscal antes de resolver. Si la duda ' +
           'persiste, escale al Oficial de Cumplimiento.';
  }

  var base = (nivel === LPB_NIVELES.POSIBLE)
    ? 'El nombre coincide con este registro. '
    : 'El nombre coincide parcialmente con este registro. ';

  if (d.curp) {
    return base + 'Capture el CURP del cliente en "Refinar" para confirmarlo o descartarlo. ' +
           'Si no puede obtenerlo, no resuelva: escale al Oficial de Cumplimiento.';
  }

  if (d.rfc) {
    return base + 'Capture el RFC del cliente en "Refinar" para confirmarlo o descartarlo. ' +
           'Si no puede obtenerlo, no resuelva: escale al Oficial de Cumplimiento.';
  }

  if (d.fechaNacimiento) {
    return base + 'Este registro no tiene RFC ni CURP. Compare la fecha de nacimiento o ' +
           'constitución del cliente contra la del registro: ' + d.fechaNacimiento + '. ' +
           'Si difiere, documente el descarte. Si coincide o no puede obtenerla, ' +
           'escale al Oficial de Cumplimiento.';
  }

  // Sin RFC, sin CURP y sin fecha: no hay nada contra qué contrastar. Decirle al
  // analista que "verifique por otros medios" sería devolverle el problema sin
  // instrucción; con estos datos NO PUEDE descartar por sí mismo, y la respuesta
  // correcta ante una coincidencia que no se puede descartar es escalar.
  return base + 'Este registro solo tiene el nombre: no hay RFC, CURP ni fecha contra ' +
         'qué contrastarlo desde el sistema. No lo descarte por su cuenta. ' +
         'Escale al Oficial de Cumplimiento con los datos del cliente.';
}


/**
 * Elimina el soporte documental cuando el usuario no tiene permiso.
 *
 * El recorte ocurre EN EL SERVIDOR, no ocultando elementos con CSS: si los
 * datos viajaran al navegador, bastaría abrir las herramientas de desarrollo
 * para leerlos. Lo que no se debe ver, no se envía.
 *
 * @param {Object} d
 * @param {boolean} puede
 * @return {Object}
 */
function lpbRecortarSegunPermiso_(d, puede) {
  if (!d) return d;
  if (puede) return d;
  return {
    nombre: d.nombre, estatus: d.estatus, eliminado: d.eliminado,
    fechaNacimiento: d.fechaNacimiento, rfc: d.rfc, curp: d.curp,
    sinRFC: d.sinRFC, sinCURP: d.sinCURP, soloFecha: d.soloFecha,
    sinIdentificador: d.sinIdentificador
  };
}

function lpbBuscarConRefinamiento_(texto, opciones) {
  var base = lpbBuscar_(texto, { minimo: opciones.minimo, maximo: 200 });
  var indice = lpbCargarIndice_();

  var consulta = {
    nombre:   lpbTipoConsulta_(texto) === 'NOMBRE' ? texto : '',
    rfc:      lpbTipoConsulta_(texto) === 'RFC' ? lpbLimpiarId_(texto) : lpbLimpiarId_(opciones.rfc),
    curp:     lpbTipoConsulta_(texto) === 'CURP' ? lpbLimpiarId_(texto) : '',
    fechaNac: opciones.fechaNac || ''
  };

  // Mapa fila -> registro del índice, construido UNA vez.
  // Antes se recorrían las 10,010 filas por cada resultado.
  var porFila = {};
  for (var k = 0; k < indice.filas.length; k++) {
    porFila[indice.filas[k][0]] = indice.filas[k];
  }

  // Se recortan los resultados ANTES de leer del Sheet: no tiene sentido
  // traer datos de registros que nunca se van a mostrar.
  var candidatos = base.resultados.slice(0, LPB_PARAMS.MAX_RESULTADOS * 2);

  // UNA sola lectura del Sheet para todas las filas necesarias, en lugar de
  // una llamada por resultado. Cada viaje a Google cuesta cientos de ms, y
  // ése era el verdadero cuello de botella.
  var datosPorFila = lpbLeerFilasLPB_(candidatos.map(function (x) { return x.filaLPB; }));

  var salida = [];
  for (var i = 0; i < candidatos.length; i++) {
    var r = candidatos[i];
    var f = porFila[r.filaLPB];
    if (!f) continue;

    var registro = {
      nombre:   String(f[1]),
      alias:    String(f[9] || '').split('|').filter(String),
      rfc:      String(f[5]).split('|')[0] || '',
      curp:     String(f[6]).split('|')[0] || '',
      fechaNac: String(f[7]).split('|')[0] || ''
    };

    // Se re-evalúa incorporando el refinamiento del analista.
    var ev = lpbEvaluar_(consulta, registro);
    if (ev.puntaje < r.puntaje) ev = r.evaluacion;

    var soloNombre = String(f[8]) === 'SOLO_NOMBRE';
    var nivel = lpbNivel_(ev, soloNombre);

    var vis = lpbRecortarSegunPermiso_(datosPorFila[r.filaLPB], opciones.verOficios);

    salida.push({
      filaLPB:     r.filaLPB,            // solo para bitácora, NO se muestra
      puntaje:     ev.puntaje,
      nivel:       nivel,
      nivelTexto:  lpbGuiaDictaminacion_(nivel, vis),
      motivos:     ev.motivos,
      explicacion: lpbExplicarCoincidencia_(ev),
      soloNombre:  soloNombre,
      identidades: 1 + registro.alias.length,
      datos:       vis,
      // Cotejo campo por campo contra lo capturado en Refinar. Se calcula en
      // el servidor porque ahí ya están los datos saneados del registro.
      cotejo:      lpbCotejo_({ rfc: opciones.rfc, curp: opciones.curp }, vis)
    });
  }

  salida.sort(function (a, b) {
    var orden = ['CONFIRMADA', 'PROBABLE', 'POSIBLE', 'REVISIÓN', 'AMPLIADA'];
    var d = orden.indexOf(a.nivel) - orden.indexOf(b.nivel);
    return d !== 0 ? d : b.puntaje - a.puntaje;
  });

  return {
    tipo: base.tipo,
    total: salida.length,
    evaluados: base.evaluados,
    resultados: salida.slice(0, LPB_PARAMS.MAX_RESULTADOS)
  };
}

/**
 * Lee del Sheet, en UN SOLO viaje, todas las filas que se van a mostrar.
 *
 * Antes se hacía una llamada a getRange().getValues() por cada resultado.
 * Con 15 resultados eran 15 viajes de ida y vuelta a Google, y ahí se iba
 * la mayor parte del tiempo de respuesta: el cómputo es rápido, la latencia
 * de red no.
 *
 * Se lee el bloque contiguo que abarca desde la fila mínima hasta la máxima
 * y se recorta en memoria. Traer filas de más es mucho más barato que hacer
 * varias llamadas.
 *
 * @param {number[]} filas
 * @return {Object}  filaLPB -> datos visibles
 */
function lpbLeerFilasLPB_(filas) {
  var salida = {};
  if (!filas.length) return salida;

  var min = Math.min.apply(null, filas);
  var max = Math.max.apply(null, filas);

  var ss = lpbLibroLista_();
  var hoja = ss.getSheetByName(LPB_HOJAS.LISTA);
  var bloque = hoja.getRange(min, 1, max - min + 1, 13).getValues();

  filas.forEach(function (n) {
    var f = bloque[n - min];
    if (f) salida[n] = lpbFormatearVisible_(f);
  });
  return salida;
}

/**
 * Campos que el analista SÍ debe ver de un registro coincidente.
 *
 * Se devuelve únicamente esta selección. La fila del índice y las columnas
 * internas nunca llegan al navegador.
 *
 * @param {Array} f  fila cruda de la hoja LPB
 * @return {Object}
 */
function lpbFormatearVisible_(f) {
  var estatus = String(f[LPB_COL.ESTATUS] || '').trim();
  var eliminado = lpbEsEliminado_(estatus);

  // Los identificadores se toman del SANEADOR, no de la columna cruda.
  //
  // Motivo: la columna de RFC contiene indistintamente RFC, CURP, fechas de
  // constitución o texto. Al mostrarla en crudo, una fecha aparecía como
  // "Sun Feb 14 1993 00:00:00 GMT-0600" — un objeto Date de JavaScript
  // volcado tal cual en la pantalla del analista.
  //
  // El saneador ya sabe clasificar cada valor. Aquí se aprovecha esa misma
  // lógica para que cada dato se muestre en el campo que le corresponde.
  var san = lpbSanearRegistro_(f);

  return {
    nombre:           String(f[LPB_COL.NOMBRE] || '').trim(),
    estatus:          estatus,
    // El estatus es lo primero que debe leerse: un ELIMINADO y un SUSPENDER
    // son respuestas opuestas. Si se lee de corrido, alguien bloquea a quien
    // ya fue liberado.
    eliminado:        eliminado,
    fechaNacimiento:  san.fechas.length
                        ? san.fechas.map(lpbFechaLegible_).join(' · ')
                        : lpbTextoFecha_(f[LPB_COL.FECHA_NAC]),
    rfc:              san.rfcs.join(' · '),
    curp:             san.curps.join(' · '),
    // Qué tiene REALMENTE el registro. La interfaz lo usa para explicar la
    // ausencia en lugar de dejar un hueco sin contexto.
    sinRFC:           san.rfcs.length === 0,
    sinCURP:          san.curps.length === 0,
    soloFecha:        san.rfcs.length === 0 && san.curps.length === 0 && san.fechas.length > 0,
    sinIdentificador: san.soloNombre,
    fechaPublicacion: lpbTextoFecha_(f[LPB_COL.FECHA_PUBLICACION]),
    acuerdo:          String(f[LPB_COL.ACUERDO] || '').trim(),
    oficioUIF:        String(f[LPB_COL.OFICIO_UIF] || '').trim(),
    oficioSIARA:      String(f[LPB_COL.OFICIO_SIARA] || '').trim(),
    anioLPB:          String(f[LPB_COL.ANIO_LPB] || '').trim(),
    ligaIncorpora:    String(f[LPB_COL.LIGA_INCORPORA] || '').trim(),
    ligaElimina:      String(f[LPB_COL.LIGA_ELIMINA] || '').trim(),
    datosComplementarios: String(f[LPB_COL.DATOS_COMP] || '').trim()
  };
}

/**
 * Convierte una fecha ISO interna a formato legible mexicano.
 * Las fechas con "-00-00" son años sueltos capturados sin mes ni día.
 * @param {string} iso
 * @return {string}
 */
function lpbFechaLegible_(iso) {
  if (!iso) return '';
  var p = String(iso).split('-');
  if (p.length !== 3) return String(iso);
  if (p[1] === '00') return p[0] + ' (solo año)';
  return p[2] + '/' + p[1] + '/' + p[0];
}

function lpbTextoFecha_(v) {
  if (!v && v !== 0) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  }
  return String(v).trim();
}

/* ==========================================================================
 * Evidencia exportable
 * ========================================================================== */

/**
 * Genera el PDF de evidencia de una consulta.
 *
 * Se construye en el servidor y se devuelve en base64 para que el navegador
 * lo descargue. Antes esto se resolvía con la impresión del navegador, que
 * dependía de la configuración de cada equipo y producía documentos
 * distintos según quién imprimiera. Un PDF generado en el servidor sale
 * siempre igual, que es lo que se necesita para integrar un expediente.
 *
 * La exportación se registra en bitácora: el documento sale del sistema y
 * sin ese registro no quedaría rastro de quién se llevó qué.
 *
 * @param {Object} resultado  el objeto devuelto por apiBuscar
 * @return {{nombreArchivo: string, base64: string}}
 */
function apiGenerarEvidencia(resultado) {
  var u = lpbExigir_('exportar');
  lpbRegistrarExportacion_(u, resultado.consulta, resultado.total);

  var tz = Session.getScriptTimeZone();
  var ahora = new Date();
  var html = lpbHtmlEvidencia_(resultado, u, Utilities.formatDate(ahora, tz, 'dd/MM/yyyy HH:mm'));

  var pdf = Utilities.newBlob(html, MimeType.HTML, 'evidencia.html')
                     .getAs(MimeType.PDF);

  return {
    nombreArchivo: 'Consulta-LPB-' + Utilities.formatDate(ahora, tz, 'yyyyMMdd-HHmmss') + '.pdf',
    base64: Utilities.base64Encode(pdf.getBytes())
  };
}

/**
 * Lee una imagen de Drive y la devuelve como data URI, con caché.
 *
 * Si el archivo no existe, no es accesible o pesa demasiado para incrustarse,
 * devuelve cadena vacía y la interfaz muestra su ilustración de respaldo. Una
 * imagen que no carga nunca debe dejar un hueco ni romper la pantalla.
 *
 * @param {string} id  identificador del archivo en Drive
 * @return {string}  data URI o cadena vacía
 */
function lpbImagenDrive_(id) {
  var cache = CacheService.getScriptCache();
  var clave = 'lpb_img_' + id;
  var guardado = cache.get(clave);
  if (guardado) return guardado;

  try {
    var archivo = DriveApp.getFileById(id);
    var blob = archivo.getBlob();
    var tipo = blob.getContentType() || '';
    if (tipo.indexOf('image/') !== 0) return '';

    var bytes = blob.getBytes();
    // 380 KB en binario: por encima de eso el data URI hace pesada la página.
    if (bytes.length > 380000) return '';

    var uri = 'data:' + tipo + ';base64,' + Utilities.base64Encode(bytes);
    if (uri.length < 95000) cache.put(clave, uri, 21600);
    return uri;
  } catch (e) {
    return '';
  }
}

/**
 * Identificador en Drive de un PNG del logotipo. Solo se usa como respaldo si
 * las propiedades del proyecto están vacías.
 */
var LPB_LOGO_DRIVE_ID = '';

/** Nombre base de las propiedades donde se guarda el logotipo por trozos. */
var LPB_LOGO_PROP = 'lpb_logo_b64_';

/**
 * FONDO DEL ENCABEZADO DEL PDF.
 *
 *   'claro'  — banda blanca. Correcto si el logotipo tiene arte oscuro o
 *              fondo blanco incorporado.
 *   'oscuro' — banda gris institucional. Necesario solo si el logotipo es
 *              blanco sobre transparente, porque en papel blanco se perdería.
 *
 * Si el logotipo no se ve en el PDF, cambie esta palabra y vuelva a generarlo.
 */
var LPB_PDF_ENCABEZADO = 'claro';

/**
 * GUARDA EL LOGOTIPO EN LAS PROPIEDADES DEL PROYECTO.
 *
 * Ejecutar UNA VEZ desde el editor. Después de eso la aplicación web ya no
 * necesita conectarse a internet para armar el PDF.
 *
 * MOTIVO: una aplicación web de Apps Script se despliega con los permisos
 * vigentes al momento de crear la versión. Cuando el código incorpora
 * UrlFetchApp después de ese despliegue, la app publicada sigue corriendo sin
 * permiso de conexión externa: la descarga falla en silencio y el documento
 * sale con el respaldo tipográfico, aunque desde el editor todo funcione.
 *
 * Guardar el logotipo elimina esa dependencia de raíz.
 */
function guardarLogoEnPropiedades() {
  lpbExigir_('usuarios');
  var r = UrlFetchApp.fetch('https://cualli.mx/wp-content/uploads/2022/07/cualli-bl@3x.png');
  var b = r.getBlob();
  var uri = 'data:' + (b.getContentType() || 'image/png') + ';base64,' +
            Utilities.base64Encode(b.getBytes());

  var props = PropertiesService.getScriptProperties();
  // Cada propiedad admite 9 KB; el data URI se parte en trozos de 8 KB.
  var trozo = 8000;
  var n = Math.ceil(uri.length / trozo);
  var mapa = { 'lpb_logo_partes': String(n) };
  for (var i = 0; i < n; i++) {
    mapa[LPB_LOGO_PROP + i] = uri.substring(i * trozo, (i + 1) * trozo);
  }
  props.setProperties(mapa);
  CacheService.getScriptCache().remove('lpb_logo2');

  Logger.log('Logotipo guardado: ' + uri.length + ' caracteres en ' + n + ' propiedades.');
  Logger.log('Genere un PDF para confirmar. No hace falta volver a ejecutar esta función.');
  return 'Logotipo guardado en ' + n + ' propiedades.';
}

/** Borra el logotipo guardado, para volver a descargarlo. */
function borrarLogoGuardado() {
  lpbExigir_('usuarios');
  var props = PropertiesService.getScriptProperties();
  var n = parseInt(props.getProperty('lpb_logo_partes') || '0', 10);
  for (var i = 0; i < n; i++) props.deleteProperty(LPB_LOGO_PROP + i);
  props.deleteProperty('lpb_logo_partes');
  CacheService.getScriptCache().remove('lpb_logo2');
  Logger.log('Logotipo borrado. Ejecute guardarLogoEnPropiedades para volver a cargarlo.');
}

/**
 * Logotipo institucional como data URI, para incrustar en el PDF.
 *
 * Orden de búsqueda:
 *   1. Propiedades del proyecto — no requiere permisos de red ni de Drive.
 *   2. Archivo de Drive, si LPB_LOGO_DRIVE_ID está configurado.
 *   3. Descarga por URL — solo funciona si la implementación tiene el permiso.
 *
 * Si las tres fallan devuelve cadena vacía y el documento usa el nombre en
 * tipografía sobre placa oscura, nunca un hueco.
 *
 * @return {string}
 */
function lpbLogoDataUri_() {
  var cache = CacheService.getScriptCache();
  var guardado = cache.get('lpb_logo2');
  if (guardado) return guardado;

  var uri = '';

  // 1. Propiedades del proyecto
  try {
    var props = PropertiesService.getScriptProperties();
    var n = parseInt(props.getProperty('lpb_logo_partes') || '0', 10);
    if (n > 0) {
      var partes = [];
      for (var i = 0; i < n; i++) partes.push(props.getProperty(LPB_LOGO_PROP + i) || '');
      var armado = partes.join('');
      if (armado.indexOf('data:image') === 0) uri = armado;
    }
  } catch (e) { uri = ''; }

  // 2. Drive
  if (!uri && LPB_LOGO_DRIVE_ID) {
    uri = lpbImagenDrive_(LPB_LOGO_DRIVE_ID);
  }

  // 3. Descarga por URL
  if (!uri) {
    try {
      var r = UrlFetchApp.fetch('https://cualli.mx/wp-content/uploads/2022/07/cualli-bl@3x.png',
                                { muteHttpExceptions: true, followRedirects: true });
      if (r.getResponseCode() === 200) {
        var b = r.getBlob();
        uri = 'data:' + (b.getContentType() || 'image/png') + ';base64,' +
              Utilities.base64Encode(b.getBytes());
      }
    } catch (e) { uri = ''; }
  }

  if (uri && uri.length < 95000) cache.put('lpb_logo2', uri, 21600);
  return uri;
}

/**
 * Diagnóstico del logotipo. Indica de dónde se obtuvo y si el HTML del
 * documento lo lleva incrustado.
 */
function probarLogoPdf() {
  lpbExigir_('usuarios');
  CacheService.getScriptCache().remove('lpb_logo2');
  var props = PropertiesService.getScriptProperties();
  var n = parseInt(props.getProperty('lpb_logo_partes') || '0', 10);

  Logger.log('Propiedades del proyecto : ' + (n > 0 ? n + ' trozos guardados' : 'vacías'));
  Logger.log('LPB_LOGO_DRIVE_ID        : ' + (LPB_LOGO_DRIVE_ID || '(sin configurar)'));

  var uri = lpbLogoDataUri_();
  Logger.log('lpbLogoDataUri_()        : ' + (uri ? uri.length + ' caracteres' : 'VACÍO'));
  Logger.log('');

  if (n === 0) {
    Logger.log('ACCIÓN: ejecute guardarLogoEnPropiedades una vez, y después');
    Logger.log('        Implementar > Gestionar implementaciones > Versión: Nueva.');
  } else {
    Logger.log('El logotipo está guardado. Si el PDF sigue sin mostrarlo,');
    Logger.log('falta redesplegar con versión nueva.');
  }
}

/**
 * Arma el HTML del documento de evidencia.
 *
 * Diseño pensado para expediente y comité: encabezado institucional con
 * logotipo, franja destacada con la fecha de corte de la lista —el dato que
 * da validez temporal al documento—, tabla de coincidencias legible en
 * blanco y negro, y leyenda legal al pie.
 *
 * @param {Object} r
 * @param {Object} u
 * @param {string} fechaHora
 * @return {string}
 */
function lpbHtmlEvidencia_(r, u, fechaHora) {
  function esc(t) {
    return String(t === null || t === undefined ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function fmt(iso) {
    if (!iso) return '—';
    var p = String(iso).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
  }

  var logo = lpbLogoDataUri_();
  var osc = (LPB_PDF_ENCABEZADO === 'oscuro');
  var res = r.resultados || [];

  var filas = res.map(function (x, i) {
    var d = x.datos || {};
    var nivel = String(x.nivel || '');
    return '<tr>' +
      '<td class="n">' + ('0' + (i + 1)).slice(-2) + '</td>' +
      '<td><span class="nom">' + esc(d.nombre) + '</span>' +
        '<span class="est">' + esc(d.estatus || 'Estatus no registrado en la lista') + '</span></td>' +
      '<td class="n"><span class="nv nv-' + esc(nivel.replace('Ó', 'O')) + '">' + esc(nivel) + '</span>' +
        '<span class="pt">' + x.puntaje + ' / 100</span></td>' +
      '<td class="m">' + esc(d.fechaNacimiento || '—') + '</td>' +
      '<td class="m">' + esc(d.rfc || '—') + '</td>' +
      '<td class="m">' + esc(d.curp || '—') + '</td>' +
    '</tr>';
  }).join('');

  if (!filas) {
    filas = '<tr><td colspan="6" class="vacio">Sin coincidencias para el criterio consultado ' +
            'en la Lista de Personas Bloqueadas a la fecha de corte indicada.</td></tr>';
  }

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    '@page{size:letter;margin:' + (osc ? '0 0 12mm' : '13mm 13mm 12mm') + '}' +
    '.hoja{padding:' + (osc ? '0 13mm' : '0') + '}' +
    /* print-color-adjust: sin esto el conversor descarta los fondos de color
       y las franjas salen en blanco. */
    'html,body{font-family:Helvetica,Arial,sans-serif;color:#15171C;font-size:9pt;margin:0;' +
      'line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +

    /* Encabezado. El fondo lo decide LPB_PDF_ENCABEZADO, arriba en este
       archivo: 'claro' para banda blanca, 'oscuro' para gris institucional
       cuando el logotipo sea blanco sobre transparente. */
    '.cab{display:table;width:100%;background:' + (osc ? '#515151' : '#FFFFFF') + ';' +
      'padding:' + (osc ? '16pt 18pt' : '14pt 0 12pt') + ';' +
      'border-bottom:3pt solid #FDB913;margin:0 0 4pt;box-sizing:border-box}' +
    '.cab-l{display:table-cell;vertical-align:middle;width:38%}' +
    /* PLACA OSCURA — el logotipo institucional es blanco sobre transparente.
       Sobre el fondo blanco del documento resulta invisible, por eso va dentro
       de una placa oscura. Es la misma solución del Simulador Accionario. */
    '.logo-caja{display:inline-block;vertical-align:middle;line-height:0}' +
    '.logo-caja img{display:inline-block;height:34pt;width:auto}' +
    '.logo-txt{display:inline-block;vertical-align:middle;font-weight:bold;font-size:17pt;' +
      'letter-spacing:-.4pt;line-height:1.1;color:' + (osc ? '#fff' : '#15171C') + '}' +
    '.logo-txt small{display:block;font-size:7pt;letter-spacing:2.6pt;color:#FDB913;font-weight:normal}' +
    '.cab-r{display:table-cell;vertical-align:middle;text-align:right}' +
    '.cab-r .doc{font-size:7pt;letter-spacing:1.6pt;font-weight:bold;text-transform:uppercase;' +
      'color:' + (osc ? '#FDB913' : '#8F6800') + '}' +
    '.cab-r h1{font-size:14.5pt;margin:3pt 0 2pt;letter-spacing:-.35pt;' +
      'color:' + (osc ? '#fff' : '#15171C') + '}' +
    '.cab-r .ent{font-size:7.5pt;margin:0;color:' + (osc ? 'rgba(255,255,255,.62)' : '#4C525E') + '}' +

    /* Vigencia de la lista: línea discreta bajo la razón social. Como dato
       tiene que estar —da validez temporal al documento— pero no compite con
       el resultado de la verificación, que es lo que se viene a leer. */
    '.cab-r .vig{font-size:7.5pt;color:#15171C;margin-top:4pt;font-weight:bold}' +
    '.cab-r .vig span{color:#4C525E;font-weight:normal}' +

    /* Datos de la consulta */
    '.meta{width:100%;border-collapse:collapse;margin-bottom:14pt;font-size:8.5pt}' +
    '.meta td{padding:4pt 0;vertical-align:top;border-bottom:.5pt solid #EDEFF3}' +
    '.meta tr:last-child td{border-bottom:0}' +
    '.meta .k{color:#6B7280;width:32%;text-transform:uppercase;font-size:7pt;letter-spacing:1pt;font-weight:bold}' +

    /* Tabla de resultados */
    '.tit{font-size:7pt;letter-spacing:1.6pt;text-transform:uppercase;color:#6B7280;' +
      'font-weight:bold;margin-bottom:6pt;border-bottom:.5pt solid #C7CCD6;padding-bottom:4pt}' +
    'table.res{width:100%;border-collapse:collapse;font-size:8.5pt}' +
    'table.res th{background:#15171C;color:#fff;text-align:left;padding:6pt 7pt;' +
      'font-size:6.5pt;text-transform:uppercase;letter-spacing:1pt}' +
    'table.res td{padding:7pt;border-bottom:.5pt solid #E2E6EC;vertical-align:top}' +
    'table.res tr:nth-child(even) td{background:#FAFBFC}' +
    '.n{text-align:center;white-space:nowrap}' +
    '.m{font-family:Courier,monospace;font-size:8pt;letter-spacing:.2pt}' +
    '.nom{display:block;font-weight:bold}' +
    '.est{display:block;color:#6B7280;font-size:7.5pt;margin-top:2pt}' +
    '.pt{display:block;font-family:Courier,monospace;font-size:7.5pt;color:#6B7280;margin-top:3pt}' +
    '.nv{display:inline-block;color:#fff;padding:2pt 6pt;font-size:6.5pt;letter-spacing:.8pt;font-weight:bold}' +
    '.nv-CONFIRMADA{background:#A11C12}.nv-PROBABLE{background:#B5601C}' +
    '.nv-POSIBLE{background:#B8850C}.nv-REVISION{background:#6B7280}.nv-AMPLIADA{background:#AAB1BC}' +
    '.vacio{text-align:center;color:#6B7280;padding:20pt;font-style:italic}' +

    /* Pie */
    '.legal{margin-top:16pt;padding:10pt 12pt;background:#FAFBFC;border-top:1.5pt solid #15171C;' +
      'font-size:6.8pt;color:#4C525E;line-height:1.65;text-align:justify}' +
    '.firma{margin-top:9pt;font-size:6.5pt;color:#98A0AC;letter-spacing:.6pt;text-align:center}' +
    '</style></head><body>' +

    (osc ? '' : '<div class="hoja">') +
    '<div class="cab">' +
      '<div class="cab-l">' +
        (logo ? '<span class="logo-caja"><img src="' + logo + '" alt="Financiera Cualli"></span>'
              : '<span class="logo-txt">CUALLI<small>FINANCIERA</small></span>') +
      '</div>' +
      '<div class="cab-r">' +
        '<div class="doc">Constancia de consulta</div>' +
        '<h1>Lista de Personas Bloqueadas</h1>' +
        '<p class="ent">Financiera Cualli, S.A.P.I. de C.V., SOFOM, E.N.R.</p>' +
        '<p class="vig"><span>Lista actualizada al</span> ' + fmt(r.fechaCorte) + '</p>' +
      '</div>' +
    '</div>' +

    (osc ? '<div class="hoja">' : '') +

    '<table class="meta">' +
      '<tr><td class="k">Criterio consultado</td><td><b>' + esc(r.consulta) + '</b></td></tr>' +
      '<tr><td class="k">Fecha y hora de la consulta</td><td>' + esc(fechaHora) + '</td></tr>' +
      '<tr><td class="k">Consultó</td><td>' + esc(u.nombre) + '<br>' +
        '<span style="color:#6B7280;font-size:8pt">' + esc(u.correo) + ' · ' + esc(u.area) + '</span></td></tr>' +
      '<tr><td class="k">Lista actualizada al</td><td>' + fmt(r.fechaCorte) +
        ' <span style="color:#6B7280;font-size:7.5pt">· acuerdo más reciente incorporado</span></td></tr>' +
      '<tr><td class="k">Coincidencias encontradas</td><td><b>' + (r.total || 0) + '</b></td></tr>' +
    '</table>' +

    '<div class="tit">Resultado de la verificación</div>' +
    '<table class="res"><thead><tr>' +
      '<th style="width:6%">#</th><th style="width:34%">Nombre y estatus en lista</th>' +
      '<th style="width:14%">Nivel</th><th style="width:14%">Fecha nac./const.</th>' +
      '<th style="width:16%">RFC</th><th style="width:16%">CURP</th>' +
    '</tr></thead><tbody>' + filas + '</tbody></table>' +

    '<div class="legal"><b>DOCUMENTO CONFIDENCIAL.</b> Prohibida su divulgación a terceros ' +
      'y al titular de los datos. Esta constancia no constituye dictamen ni certifica que la ' +
      'persona consultada no se encuentre bloqueada. La consulta que origina este documento ' +
      'quedó asentada en la bitácora de control interno del Oficial de Cumplimiento, con ' +
      'usuario, fecha y criterio de búsqueda.</div>' +

    '<div class="firma">Documento generado automáticamente el ' + esc(fechaHora) +
      ' · Oficial de Cumplimiento · Financiera Cualli</div>' +
    '</div>' +

    '</body></html>';
}

/* ==========================================================================
 * Reporte de anomalías
 * ========================================================================== */

/**
 * Envía un reporte de anomalía al Oficial de Cumplimiento.
 *
 * Va con copia a quien reporta, para que tenga constancia de su envío, y
 * queda asentado en bitácora aunque el correo esté apagado por ambiente.
 *
 * @param {Object} datos {tipo, consulta, detalle}
 * @return {Object}
 */
function apiReportarAnomalia(datos) {
  var u = lpbExigir_('buscar');
  datos = datos || {};

  var detalle = String(datos.detalle || '').trim();
  if (detalle.length < 15) {
    throw new Error('Describa la anomalía con al menos 15 caracteres. ' +
      'Un reporte sin detalle no se puede atender.');
  }

  var tipo = String(datos.tipo || 'OTRO');
  var consulta = String(datos.consulta || '').trim();

  lpbEscribirBitacora_([
    new Date(), u.correo, u.nombre, u.rol, 'REPORTE_ANOMALIA',
    consulta, tipo, 0, '', '', '', detalle
  ]);

  if (!LPB_CORREOS_ACTIVOS) {
    return { ok: true, mensaje: 'Reporte asentado en la bitácora. ' +
      'El envío por correo está desactivado en este ambiente.' };
  }

  var destino = lpbDestinatariosAlerta_();
  if (!destino.length) {
    return { ok: true, mensaje: 'Reporte asentado en la bitácora.' };
  }

  try {
    MailApp.sendEmail({
      to: destino.join(','),
      cc: u.correo,
      subject: '[LPB] Reporte de anomalía — ' + tipo,
      body: 'Se recibió un reporte de anomalía desde el módulo de consulta de la ' +
            'Lista de Personas Bloqueadas.\n\n' +
            'Reportó   : ' + u.nombre + ' (' + u.correo + '), ' + u.area + '\n' +
            'Fecha     : ' + Utilities.formatDate(new Date(),
                              Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') + '\n' +
            'Tipo      : ' + tipo + '\n' +
            'Consulta  : ' + (consulta || '(no indicada)') + '\n\n' +
            'Descripción:\n' + detalle + '\n\n' +
            'El reporte quedó asentado en la bitácora de control interno.\n\n' +
            'CONFIDENCIAL — prohibida su divulgación a terceros.\n' +
            '— Aviso automático. No responda a este correo.'
    });
  } catch (e) {
    return { ok: true, mensaje: 'Reporte asentado en la bitácora. ' +
      'No fue posible enviar el correo: ' + e.message };
  }

  return { ok: true, mensaje: 'Reporte enviado al Oficial de Cumplimiento ' +
    'y asentado en la bitácora. Recibirá copia en su correo.' };
}

/* ==========================================================================
 * Administración — solo ADMIN
 * ========================================================================== */

function apiListarUsuarios()                  { return lpbListarUsuarios(); }
function apiAltaUsuario(datos)                { return lpbAltaUsuario(datos); }
function apiBajaUsuario(correo, motivo)       { return lpbBajaUsuario(correo, motivo); }
function apiArchivarUsuario(correo, motivo)  { return lpbArchivarUsuario(correo, motivo); }
function apiCambiarRol(correo, rol, motivo)   { return lpbCambiarRol(correo, rol, motivo); }
function apiReactivarUsuario(correo, motivo)  { return lpbReactivarUsuario(correo, motivo); }

function apiReindexar() {
  var u = lpbExigir_('reindexar');
  var stats = lpbConstruirIndice_();
  lpbEscribirBitacora_([
    new Date(), u.correo, u.nombre, u.rol, 'REINDEXADO_MANUAL',
    '', '', stats.registros, '', '', '',
    'conRFC=' + stats.conRFC + ' soloNombre=' + stats.soloNombre
  ]);
  return stats;
}

/* ==========================================================================
 * Bitácora — ADMIN y AUDITOR
 * ========================================================================== */

function apiConsultarBitacora(filtros) { return lpbConsultarBitacora(filtros); }
function apiResumenActividad(dias)     { return lpbResumenActividad(dias); }
// apiAccionesBitacora vive en Bitacora.gs, junto al resto de la bitácora.

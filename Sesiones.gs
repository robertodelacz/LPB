/**
 * ============================================================================
 * LPB · Sesiones.gs
 * Control de sesiones activas, vencimiento por inactividad y cierre remoto.
 * ----------------------------------------------------------------------------
 * PROBLEMA QUE RESUELVE — un usuario autorizado deja su equipo abierto con
 * resultados de la Lista de Personas Bloqueadas en pantalla. Cualquiera que
 * pase puede leerlos, e incluso hacer consultas nuevas bajo su identidad.
 *
 * DOS CAPAS, y las dos hacen falta:
 *
 *   1. Bloqueo en el navegador. Cubre la pantalla y borra los resultados a la
 *      vista. Resuelve el equipo abandonado, que es el escenario real.
 *
 *   2. Vencimiento en el servidor. Registra la última actividad y rechaza toda
 *      operación posterior al plazo, aunque el navegador siga abierto.
 *
 * La primera sin la segunda es cosmética: bastaría manipular la página para
 * saltarse el bloqueo visual. La segunda es la que sostiene el control.
 *
 * Se apoya en PropertiesService y no en CacheService: una sesión debe
 * sobrevivir al reinicio del contexto, y una caché que se vacía sola
 * cerraría sesiones legítimas sin motivo.
 * ============================================================================
 */

/**
 * ¿La ejecución viene de un disparador programado y no de un usuario?
 *
 * Un disparador corre sin sesión activa, así que Session.getActiveUser()
 * devuelve cadena vacía. Distinguirlo permite exigir permisos a las llamadas
 * de usuario sin bloquear el mantenimiento automático.
 *
 * @return {boolean}
 */
function lpbEjecutadaPorDisparador_() {
  try {
    return !Session.getActiveUser().getEmail();
  } catch (e) {
    return true;
  }
}

/** Minutos de inactividad antes de cerrar la sesión. */
var LPB_INACTIVIDAD_MIN = 20;

/** Prefijos de las propiedades que guardan el estado de cada sesión. */
var LPB_SESION_PROP = 'lpb_ses_';    // lpb_ses_<correo>  ->  {inicio, ultima, id}
var LPB_CIERRE_PROP = 'lpb_cierre_'; // lpb_cierre_<correo> -> marca de cierre remoto

/**
 * Registra actividad del usuario y evalúa si la sesión sigue vigente.
 *
 * Se invoca desde lpbExigir_, es decir en CADA operación. Devuelve el estado
 * en lugar de lanzar, para que quien llama decida cómo responder.
 *
 * @param {string} correo
 * @return {{vigente: boolean, motivo: string, restanteSeg: number}}
 */
/**
 * Traduce el identificador del navegador a algo legible.
 *
 * LIMITACIÓN IMPORTANTE: este dato lo reporta el navegador del usuario, no el
 * servidor. Apps Script no expone el agente de usuario del lado del servidor,
 * así que la única vía es que el cliente lo envíe. Es útil para operación
 * —saber si alguien consulta desde su celular en la calle— pero NO es
 * evidencia: cualquiera con conocimientos técnicos puede alterarlo.
 *
 * @param {string} ua
 * @return {string}
 */
function lpbDescribirDispositivo_(ua) {
  ua = String(ua || '');
  if (!ua) return '';

  // Solo se distingue entre equipo fijo y móvil.
  //
  // Una versión anterior reportaba sistema operativo y navegador. Se recortó a
  // propósito: para el control operativo lo relevante es si alguien consulta
  // la lista desde un equipo de la empresa o desde su teléfono en la calle.
  // Saber además que usa Chrome sobre Windows no cambia ninguna decisión, y
  // acumular detalle del equipo de cada colaborador sin una finalidad clara
  // es recolectar más de lo necesario.
  return /Mobi|Android|iPhone|iPad|iPod|Tablet|Windows Phone/i.test(ua)
    ? 'Dispositivo móvil'
    : 'PC / Laptop';
}


/**
 * Registra el dispositivo desde el que se abrió la sesión.
 * Lo envía el cliente al arrancar.
 *
 * @param {string} ua
 */
function apiRegistrarDispositivo(ua) {
  var u = lpbExigir_('buscar');
  var props = PropertiesService.getScriptProperties();
  var crudo = props.getProperty(LPB_SESION_PROP + u.correo);
  if (!crudo) return { ok: false };

  try {
    var ses = JSON.parse(crudo);
    ses.disp = lpbDescribirDispositivo_(ua);
    props.setProperty(LPB_SESION_PROP + u.correo, JSON.stringify(ses));

    lpbEscribirBitacora_([
      new Date(), u.correo, u.nombre, u.rol, 'INICIO_SESION',
      '', '', 0, '', '', '', ses.disp
    ]);
  } catch (e) { return { ok: false }; }
  return { ok: true };
}

function lpbTocarSesion_(correo) {
  var props = PropertiesService.getScriptProperties();
  var ahora = new Date().getTime();
  var limite = LPB_INACTIVIDAD_MIN * 60000;

  // Cierre remoto ordenado por un administrador
  // Cierre remoto ordenado por un administrador. La marca se consume una sola
  // vez: si el usuario ya no estaba conectado, se aplica en su siguiente
  // entrada y ahí se descarta.
  var cierre = props.getProperty(LPB_CIERRE_PROP + correo);
  if (cierre) {
    props.deleteProperty(LPB_CIERRE_PROP + correo);
    props.deleteProperty(LPB_SESION_PROP + correo);
    return {
      vigente: false,
      motivo: 'Su sesión fue cerrada por el administrador del sistema. ' +
              'Recargue la página para iniciar una nueva.',
      restanteSeg: 0
    };
  }

  var crudo = props.getProperty(LPB_SESION_PROP + correo);
  var ses = null;
  if (crudo) { try { ses = JSON.parse(crudo); } catch (e) { ses = null; } }

  if (ses && (ahora - ses.ultima) > limite) {
    props.deleteProperty(LPB_SESION_PROP + correo);
    var inactivo = ahora - ses.ultima;

    // Una sesión abandonada hace horas o días no es un vencimiento que haya
    // que avisar: es un registro sin limpiar. Avisarlo produce el caso
    // absurdo de entrar de mañana y ver "su sesión venció tras 3,455 minutos
    // de inactividad", cuando lo único que pasó es que el usuario se fue a su
    // casa. Pasado el doble del plazo se descarta en silencio y se abre una
    // sesión nueva; dentro de ese margen sí se avisa, porque ahí el usuario
    // estaba trabajando y necesita saber por qué perdió lo que tenía.
    if (inactivo > limite * 2) {
      ses = null;   // se abre sesión nueva más abajo
    } else {
      var mins = Math.floor(inactivo / 60000);
      return {
        vigente: false,
        motivo: 'Su sesión se cerró tras ' + mins + ' minutos sin actividad. ' +
                'Recargue la página para continuar.',
        restanteSeg: 0
      };
    }
  }

  if (!ses) ses = { inicio: ahora, id: Utilities.getUuid().substring(0, 8) };
  ses.ultima = ahora;
  props.setProperty(LPB_SESION_PROP + correo, JSON.stringify(ses));

  return {
    vigente: true,
    motivo: '',
    restanteSeg: Math.round(limite / 1000)
  };
}

/**
 * Cierra la sesión del propio usuario, al salir o al vencer en el navegador.
 * @return {Object}
 */
function apiCerrarMiSesion() {
  var u = lpbUsuarioActual_(false);
  if (!u.ok) return { ok: true };
  PropertiesService.getScriptProperties().deleteProperty(LPB_SESION_PROP + u.correo);
  lpbEscribirBitacora_([
    new Date(), u.correo, u.nombre, u.rol, 'SESION_CERRADA',
    '', '', 0, '', '', '', 'Cierre por inactividad o salida del usuario'
  ]);
  return { ok: true };
}

/**
 * Latido de sesión. El navegador lo envía periódicamente para saber si la
 * sesión sigue viva, sin registrar actividad falsa: si el usuario no ha
 * tocado nada, el latido NO renueva el plazo.
 *
 * @return {{vigente: boolean, motivo: string, restanteSeg: number}}
 */
function apiLatidoSesion(huboActividad) {
  var u = lpbUsuarioActual_(false);
  if (!u.ok) return { vigente: false, motivo: u.motivo, restanteSeg: 0 };

  var props = PropertiesService.getScriptProperties();
  var ahora = new Date().getTime();
  var limite = LPB_INACTIVIDAD_MIN * 60000;

  var cierre = props.getProperty(LPB_CIERRE_PROP + u.correo);
  if (cierre) {
    props.deleteProperty(LPB_CIERRE_PROP + u.correo);
    props.deleteProperty(LPB_SESION_PROP + u.correo);
    lpbEscribirBitacora_([
      new Date(), u.correo, u.nombre, u.rol, 'SESION_CERRADA_REMOTO',
      '', '', 0, '', '', '', 'Cierre ordenado por ' + cierre
    ]);
    return {
      vigente: false,
      motivo: 'Su sesión fue cerrada por el administrador del sistema.',
      restanteSeg: 0
    };
  }

  var crudo = props.getProperty(LPB_SESION_PROP + u.correo);
  if (!crudo) return { vigente: false, motivo: 'Sesión no encontrada.', restanteSeg: 0 };

  var ses;
  try { ses = JSON.parse(crudo); }
  catch (e) { return { vigente: false, motivo: 'Sesión inválida.', restanteSeg: 0 }; }

  var transcurrido = ahora - ses.ultima;
  if (transcurrido > limite) {
    props.deleteProperty(LPB_SESION_PROP + u.correo);
    // Mismo criterio que en lpbTocarSesion_: una sesión abandonada hace mucho
    // no se reporta como vencimiento, se descarta.
    if (transcurrido > limite * 2) {
      return { vigente: true, motivo: '', restanteSeg: Math.round(limite / 1000) };
    }
    return {
      vigente: false,
      motivo: 'Su sesión se cerró por inactividad.',
      restanteSeg: 0
    };
  }

  // El latido renueva el plazo SOLO si el navegador detectó actividad real
  // del usuario desde el latido anterior.
  //
  // Antes nunca renovaba, con la idea de que una pestaña olvidada venciera
  // igual. Pero eso no distinguía entre una pestaña sola y alguien leyendo
  // resultados: quien pasaba quince minutos revisando una coincidencia sin
  // lanzar otra búsqueda perdía la sesión estando presente.
  //
  // Con la bandera, la pestaña olvidada sigue venciendo —no hay actividad que
  // reportar— y el usuario que está trabajando conserva su sesión.
  if (huboActividad) {
    ses.ultima = ahora;
    props.setProperty(LPB_SESION_PROP + u.correo, JSON.stringify(ses));
    transcurrido = 0;
  }

  return {
    vigente: true,
    motivo: '',
    restanteSeg: Math.round((limite - transcurrido) / 1000)
  };
}

/* ==========================================================================
 * Administración de sesiones — cualquier ADMIN
 * ========================================================================== */

/**
 * Lista las sesiones abiertas.
 * @return {Array}
 */
function apiListarSesiones() {
  lpbExigir_('usuarios');
  var props = PropertiesService.getScriptProperties();
  var todas = props.getProperties();
  var usuarios = lpbLeerAutorizados_(false);
  var ahora = new Date().getTime();
  var limite = LPB_INACTIVIDAD_MIN * 60000;
  var tz = Session.getScriptTimeZone();
  var salida = [];

  for (var clave in todas) {
    if (clave.indexOf(LPB_SESION_PROP) !== 0) continue;
    var correo = clave.substring(LPB_SESION_PROP.length);
    var ses;
    try { ses = JSON.parse(todas[clave]); } catch (e) { continue; }

    var inactivo = ahora - ses.ultima;
    if (inactivo > limite) continue;   // ya vencida, no se muestra

    var u = usuarios[correo] || {};
    salida.push({
      correo:   correo,
      nombre:   u.nombre || correo,
      area:     u.area || '',
      rol:      u.rol || '',
      inicio:   Utilities.formatDate(new Date(ses.inicio), tz, 'dd/MM/yyyy HH:mm'),
      disp:     ses.disp || '',
      ultima:   Utilities.formatDate(new Date(ses.ultima), tz, 'HH:mm'),
      inactivoMin: Math.floor(inactivo / 60000),
      restanteMin: Math.max(0, Math.ceil((limite - inactivo) / 60000))
    });
  }

  salida.sort(function (a, b) { return a.inactivoMin - b.inactivoMin; });
  return salida;
}

/**
 * Ordena el cierre remoto de una sesión.
 *
 * No la termina en el acto: deja una marca que se aplica en la siguiente
 * acción del usuario o en su próximo latido, a más tardar un minuto después.
 * El servidor no puede alcanzar un navegador ajeno, así que ésta es la vía.
 *
 * @param {string} correo
 * @param {string} motivo
 * @return {Object}
 */
function apiCerrarSesionRemota(correo, motivo) {
  var admin = lpbExigir_('usuarios');
  correo = String(correo || '').trim().toLowerCase();
  motivo = String(motivo || '').trim();

  if (!correo) throw new Error('Indique el correo de la sesión a cerrar.');
  if (!motivo) throw new Error('El motivo del cierre es obligatorio: queda en bitácora.');

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(LPB_SESION_PROP + correo)) {
    throw new Error('Esa cuenta no tiene una sesión abierta.');
  }

  props.setProperty(LPB_CIERRE_PROP + correo, admin.correo);

  lpbEscribirBitacora_([
    new Date(), admin.correo, admin.nombre, admin.rol, 'ADMIN_CIERRE_SESION',
    correo, '', 0, '', '', '', motivo
  ]);

  return {
    ok: true,
    mensaje: 'Cierre ordenado. Surtirá efecto en la siguiente acción del usuario, ' +
             'o en un minuto como máximo.'
  };
}

/**
 * INSTALA LA LIMPIEZA DIARIA DE SESIONES.
 * Ejecutar una vez desde el editor.
 *
 * Sin esta limpieza, las sesiones abandonadas quedan guardadas de un día para
 * otro y las propiedades del proyecto se acumulan sin límite.
 */
function lpbInstalarLimpiezaSesiones() {
  // Sin guion bajo final para que aparezca en el editor, así que es invocable
  // desde el cliente: cualquier usuario del dominio podría crear disparadores
  // en bucle. Se exige rol de administrador.
  lpbExigir_('usuarios');

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'lpbLimpiarSesionesVencidas') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('lpbLimpiarSesionesVencidas')
    .timeBased().everyDays(1).atHour(3).create();
  Logger.log('Limpieza diaria instalada: corre todos los días alrededor de las 3:00.');
  return 'Disparador instalado.';
}

/**
 * Limpia las propiedades que se acumulan con el uso diario.
 *
 * PropertiesService admite 500 KB en total. Tres familias de claves crecen
 * solas y ninguna se borraba:
 *
 *   lpb_ses_<correo>     sesión abierta; queda al cerrar el navegador
 *   lpb_uso_<correo>     marcas de consulta de la última hora; el control de
 *                        volumen las escribe pero nunca las retira
 *   lpb_cierre_<correo>  orden de cierre remoto no consumida, porque el
 *                        usuario ya no volvió a entrar
 *
 * Con doce usuarios el crecimiento es lento, pero es acumulativo y sin tope:
 * el día que se llene, TODA escritura de propiedades empieza a fallar, y eso
 * incluye la fecha de corte y el estado del índice.
 */
function lpbLimpiarSesionesVencidas() {
  // Invocable desde el cliente. Sin control, cualquiera podría ejecutarla en
  // bucle para cerrar sesiones ajenas. El disparador programado corre como
  // el dueño del proyecto, así que la restricción no le afecta.
  if (lpbEjecutadaPorDisparador_()) { /* el disparador pasa sin validar */ }
  else lpbExigir_('usuarios');

  var props = PropertiesService.getScriptProperties();
  var todas = props.getProperties();
  var ahora = new Date().getTime();
  var limite = LPB_INACTIVIDAD_MIN * 60000;
  var ses = 0, uso = 0, cierres = 0;

  for (var clave in todas) {

    // Sesiones vencidas
    if (clave.indexOf(LPB_SESION_PROP) === 0) {
      try {
        var s = JSON.parse(todas[clave]);
        if (ahora - s.ultima > limite) { props.deleteProperty(clave); ses++; }
      } catch (e) { props.deleteProperty(clave); ses++; }
      continue;
    }

    // Marcas de uso: solo importan las de la última hora
    if (clave.indexOf('lpb_uso_') === 0) {
      try {
        var marcas = JSON.parse(todas[clave]);
        var vivas = marcas.filter(function (t) { return ahora - t < 3600000; });
        if (!vivas.length) { props.deleteProperty(clave); uso++; }
        else if (vivas.length !== marcas.length) props.setProperty(clave, JSON.stringify(vivas));
      } catch (e) { props.deleteProperty(clave); uso++; }
      continue;
    }

    // Órdenes de cierre que nadie recogió
    if (clave.indexOf(LPB_CIERRE_PROP) === 0) {
      var correo = clave.substring(LPB_CIERRE_PROP.length);
      if (!todas[LPB_SESION_PROP + correo]) { props.deleteProperty(clave); cierres++; }
    }
  }

  var total = Object.keys(props.getProperties()).length;
  Logger.log('Sesiones vencidas  : ' + ses);
  Logger.log('Marcas de uso      : ' + uso);
  Logger.log('Cierres huérfanos  : ' + cierres);
  Logger.log('Propiedades activas: ' + total);
  return ses + uso + cierres;
}

/**
 * ============================================================================
 * LPB · Auth.gs
 * Autenticación, roles y control de acceso.
 * ----------------------------------------------------------------------------
 * PRINCIPIO CENTRAL — la validación vive al inicio de CADA función expuesta,
 * no solo en doGet.
 *
 * En Apps Script, toda función global de un archivo .gs queda invocable desde
 * el navegador con google.script.run. Un usuario que cargue la página puede
 * abrir la consola y escribir:
 *
 *     google.script.run.withSuccessHandler(console.log).loQueSea()
 *
 * sin pasar jamás por doGet. Si el control de acceso viviera únicamente ahí,
 * no protegería absolutamente nada.
 *
 * Por eso, además:
 *   · Toda función que toque la lista completa lleva guion bajo final
 *     (nombreFuncion_), lo que la vuelve NO invocable desde el cliente.
 *   · Las funciones expuestas devuelven solo filas coincidentes, nunca el
 *     universo.
 * ============================================================================
 */

var LPB_ROLES = {
  CONSULTA: 'CONSULTA',   // buscar y exportar
  ADMIN:    'ADMIN',      // + capturar, reindexar, administrar usuarios, bitácora
  AUDITOR:  'AUDITOR'     // + bitácora, SIN escritura (separación de funciones)
};

/** Permisos por rol. Un rol ausente no tiene ningún permiso. */
// 'oficios' controla el envío del soporte documental (acuerdo, oficios UIF y
// SIARA, ligas) al navegador.
//
// Está APAGADO PARA TODOS LOS ROLES por decisión operativa: ningún área
// requiere esos datos para dictaminar, y el número de oficio es información
// reservada. Con el permiso en false el servidor no los envía siquiera, así
// que no hay nada que ocultar en el cliente.
//
// Si más adelante Cumplimiento necesita verlos dentro del sistema, basta
// poner 'oficios: true' en el rol ADMIN: la interfaz ya sabe mostrarlos.
var LPB_PERMISOS = {
  CONSULTA: { buscar: true, exportar: true, bitacora: false, usuarios: false, reindexar: false, oficios: false },
  AUDITOR:  { buscar: true, exportar: true, bitacora: true,  usuarios: false, reindexar: false, oficios: false },
  ADMIN:    { buscar: true, exportar: true, bitacora: true,  usuarios: true,  reindexar: true,  oficios: false }
};

/**
 * Identifica al usuario de la sesión y resuelve su rol.
 *
 * NOTA DE DESPLIEGUE — el despliegue debe ser:
 *     Ejecutar como      : Yo (el propietario)
 *     Quién tiene acceso : Cualquier usuario de <dominio>
 *
 * Con esa combinación getActiveUser().getEmail() devuelve el correo de forma
 * confiable. Si se despliega como "cualquier usuario con cuenta de Google",
 * el correo puede llegar VACÍO para externos; por eso la cadena vacía se
 * rechaza explícitamente abajo en vez de dejarla caer en la comparación.
 *
 * @return {{ok: boolean, correo: string, nombre: string, rol: string,
 *            area: string, permisos: Object, motivo: string}}
 */
/** Memoria del usuario dentro de una misma ejecución del servidor. */
var LPB_USUARIO_MEMO = null;

/**
 * Identifica al usuario de la sesión y resuelve su rol.
 *
 * @param {boolean=} permitirCache  true solo donde una lectura ligeramente
 *        vieja es aceptable. En la ruta de búsqueda va siempre en false.
 */
function lpbUsuarioActual_(permitirCache) {
  // La memoria por ejecución solo aplica cuando se acepta caché: evita releer
  // la hoja dos veces durante una misma carga de página.
  if (permitirCache && LPB_USUARIO_MEMO) return LPB_USUARIO_MEMO;

  var correo = '';
  try {
    correo = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (e) {
    correo = '';
  }

  if (!correo) {
    return lpbAccesoDenegado_('', 'No fue posible identificar la cuenta. ' +
      'Inicie sesión con su correo institucional.');
  }

  var usuarios = lpbLeerAutorizados_(permitirCache);
  var u = usuarios[correo];

  if (!u) {
    lpbRegistrarAccesoDenegado_(correo, 'NO_AUTORIZADO');
    return lpbAccesoDenegado_(correo, 'Su cuenta no está autorizada para consultar ' +
      'la Lista de Personas Bloqueadas. Solicite el acceso al Oficial de Cumplimiento.');
  }
  if (!u.activo) {
    lpbRegistrarAccesoDenegado_(correo, 'INACTIVO');
    return lpbAccesoDenegado_(correo, 'Su acceso fue desactivado. ' +
      'Contacte al Oficial de Cumplimiento.');
  }
  if (!LPB_PERMISOS[u.rol]) {
    lpbRegistrarAccesoDenegado_(correo, 'ROL_INVALIDO:' + u.rol);
    return lpbAccesoDenegado_(correo, 'Su rol no está configurado correctamente.');
  }

  var resultado = {
    ok:       true,
    correo:   correo,
    nombre:   u.nombre,
    rol:      u.rol,
    area:     u.area,
    permisos: LPB_PERMISOS[u.rol],
    motivo:   ''
  };
  if (permitirCache) LPB_USUARIO_MEMO = resultado;
  return resultado;
}

function lpbAccesoDenegado_(correo, motivo) {
  return {
    ok: false, correo: correo, nombre: '', rol: '', area: '',
    permisos: { buscar: false, exportar: false, bitacora: false, usuarios: false, reindexar: false, oficios: false },
    motivo: motivo
  };
}

/**
 * Exige un permiso concreto. Lanza si no lo tiene.
 * Se invoca en la PRIMERA línea de cada función expuesta.
 *
 * @param {string} permiso  'buscar' | 'exportar' | 'bitacora' | 'usuarios' | 'reindexar'
 * @return {Object} usuario
 */
function lpbExigir_(permiso) {
  // Sin caché a propósito: cada operación verifica contra la hoja, de modo que
  // una baja surte efecto en la siguiente acción del usuario, no minutos
  // después. Ni siquiera recargar la página lo mantiene dentro.
  var u = lpbUsuarioActual_(false);
  if (!u.ok) throw new Error(u.motivo);
  if (!u.permisos[permiso]) {
    lpbRegistrarAccesoDenegado_(u.correo, 'SIN_PERMISO:' + permiso);
    throw new Error('Su rol (' + u.rol + ') no tiene permiso para esta operación.');
  }

  // Vencimiento por inactividad y cierre remoto. Va aquí, en la puerta común
  // de todas las operaciones, para que ninguna ruta pueda saltárselo.
  var ses = lpbTocarSesion_(u.correo);
  if (!ses.vigente) {
    lpbRegistrarAccesoDenegado_(u.correo, 'SESION_VENCIDA');
    throw new Error(ses.motivo);
  }

  return u;
}

/* ==========================================================================
 * Hoja AUTORIZADOS
 * ========================================================================== */

var LPB_COL_AUTH = {
  CORREO: 0, NOMBRE: 1, AREA: 2, ROL: 3, ACTIVO: 4,
  FECHA_ALTA: 5, FECHA_BAJA: 6, AUTORIZADO_POR: 7, ULTIMA_REVISION: 8, JUSTIFICACION: 9
};

/**
 * Lee la hoja AUTORIZADOS y devuelve un mapa por correo.
 * @return {Object}
 */
/**
 * Lee la hoja AUTORIZADOS.
 *
 * @param {boolean=} permitirCache  true solo para operaciones no sensibles.
 *
 * SOBRE LA CACHÉ — una copia en caché crea una ventana en la que alguien dado
 * de baja sigue entrando. Para una baja rutinaria eso da igual; para una baja
 * urgente por despido o incidente es justo lo que no se quiere, y es imposible
 * de justificar ante una revisión.
 *
 * Por eso las operaciones sensibles —buscar, exportar, administrar— leen
 * SIEMPRE la hoja. Cuesta unos cientos de milisegundos por consulta y a cambio
 * la revocación surte efecto de inmediato, sin ventana que explicar.
 *
 * @return {Object}
 */
function lpbLeerAutorizados_(permitirCache) {
  var cache = CacheService.getScriptCache();
  if (permitirCache) {
    var guardado = cache.get('lpb_autorizados');
    if (guardado) {
      try { return JSON.parse(guardado); } catch (e) { /* si falla, se relee */ }
    }
  }

  var ss = lpbLibroSistema_();
  var hoja = ss.getSheetByName(LPB_HOJAS.AUTORIZADOS);
  if (!hoja || hoja.getLastRow() < 2) return {};

  var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 10).getValues();
  var mapa = {};
  for (var i = 0; i < datos.length; i++) {
    var c = String(datos[i][LPB_COL_AUTH.CORREO] || '').trim().toLowerCase();
    if (!c) continue;
    var act = String(datos[i][LPB_COL_AUTH.ACTIVO] || '').trim().toUpperCase();
    mapa[c] = {
      correo: c,
      nombre: String(datos[i][LPB_COL_AUTH.NOMBRE] || '').trim(),
      area:   String(datos[i][LPB_COL_AUTH.AREA] || '').trim(),
      rol:    String(datos[i][LPB_COL_AUTH.ROL] || '').trim().toUpperCase(),
      activo: act === 'SÍ' || act === 'SI' || act === 'TRUE' || act === 'VERDADERO',
      fila:   i + 2
    };
  }

  // La caché SOLO se escribe si quien llamó la aceptó. Hoy ninguna ruta lo
  // hace: escribirla igual dejaba copias viejas que sobrevivían al cambio de
  // código y bloqueaban a usuarios ya reactivados. El mecanismo se conserva
  // por si en el futuro se agrega alguna ruta no sensible.
  if (permitirCache) {
    try { cache.put('lpb_autorizados', JSON.stringify(mapa), 300); } catch (e) { /* opcional */ }
  }
  return mapa;
}

/**
 * Purga la caché de accesos. Sin permisos: cualquiera puede ejecutarla y lo
 * único que provoca es que el sistema relea la hoja, que es el comportamiento
 * seguro. Se deja disponible para limpiar restos dejados por versiones
 * anteriores del código, que sí guardaban la lista en caché.
 */
function purgarCacheAccesos() {
  // Sin control, cualquiera podría forzar relecturas en bucle. El efecto es
  // menor —el sistema relee la hoja, que es el comportamiento seguro— pero no
  // hay motivo para dejarla abierta.
  lpbExigir_('usuarios');
  CacheService.getScriptCache().remove('lpb_autorizados');
  LPB_USUARIO_MEMO = null;
  Logger.log('Caché de accesos purgada. Los cambios en la hoja surten efecto de inmediato.');
  return 'Caché purgada.';
}

/**
 * CORTE INMEDIATO DE ACCESOS.
 *
 * Limpia toda copia en caché de la lista de accesos. Úselo cuando la baja se
 * haya hecho editando la hoja a mano en lugar de usar la interfaz: en ese caso
 * el sistema no se entera del cambio por sí solo.
 *
 * Las operaciones sensibles ya leen la hoja sin caché, así que esto es una
 * medida de refuerzo, no el control principal.
 */
function lpbCorteInmediatoAccesos() {
  lpbExigir_('usuarios');
  lpbInvalidarAutorizados_();
  lpbEscribirBitacora_([
    new Date(), Session.getActiveUser().getEmail(), '', 'ADMIN', 'ADMIN_CORTE_ACCESOS',
    '', '', 0, '', '', '', 'Purga manual de la caché de accesos'
  ]);
  return 'Caché de accesos purgada. Los cambios en la hoja surten efecto de inmediato.';
}

/** Invalida la caché de accesos tras un alta, baja o cambio de rol. */
function lpbInvalidarAutorizados_() {
  try { CacheService.getScriptCache().remove('lpb_autorizados'); } catch (e) {}
  LPB_USUARIO_MEMO = null;
}

/**
 * Crea la hoja AUTORIZADOS con la plantilla inicial.
 * Ejecutar UNA sola vez, manualmente, desde el editor.
 */
function lpbCrearHojaAutorizados() {
  var ss = lpbLibroSistema_();
  var hoja = ss.getSheetByName(LPB_HOJAS.AUTORIZADOS);
  if (hoja) throw new Error('La hoja ' + LPB_HOJAS.AUTORIZADOS + ' ya existe. ' +
    'Bórrala manualmente si quieres regenerarla.');

  hoja = ss.insertSheet(LPB_HOJAS.AUTORIZADOS);
  var hoy = new Date();

  var enc = ['CORREO', 'NOMBRE', 'AREA', 'ROL', 'ACTIVO', 'FECHA ALTA',
             'FECHA BAJA', 'AUTORIZADO POR', 'ULTIMA REVISION', 'JUSTIFICACION'];

  var filas = [
    ['veronicacastaneda@cualli.mx', 'Verónica Castañeda Sánchez', 'Cumplimiento',  'ADMIN',    'SÍ', hoy, '', '', '', 'Oficial de Cumplimiento — titular del sistema'],
    ['jesusmolina@cualli.mx',       'Jesús Omar Molina Guadarrama','Jurídico Corporativo','ADMIN','SÍ', hoy, '', '', '', 'Suplente designado del Oficial de Cumplimiento'],
    ['robertodelacruz@cualli.mx',   'Roberto De la Cruz Romero',  'Mesa de Control','ADMIN',   'SÍ', hoy, '', '', '', 'Administrador técnico del sistema'],
    ['evelincuriel@cualli.mx',      'Evelin Hedissa Curiel Castro','Contraloría',   'AUDITOR', 'SÍ', hoy, '', '', '', 'Contraloría — vigilancia de bitácora, sin escritura'],
    ['christiansanchez@cualli.mx',  'Christian Sánchez Contreras','Formalización',  'CONSULTA','SÍ', hoy, '', '', '', 'Dictaminación previa a formalización'],
    ['marianaguzman@cualli.mx',     'Mariana Guzmán Gómez',       'Formalización',  'CONSULTA','SÍ', hoy, '', '', '', 'Dictaminación previa a formalización'],
    ['miriamaguilar@cualli.mx',     'Miriam Ramírez Aguilar',     'Formalización',  'CONSULTA','SÍ', hoy, '', '', '', 'Coordinación de Formalización'],
    ['marianaramirez@cualli.mx',    'Mariana Ramírez Aguilar',    'Operaciones',    'CONSULTA','SÍ', hoy, '', '', '', 'Dirección de Operaciones'],
    ['rodrigoruiz@cualli.mx',       'Rodrigo Ruiz González',      'Dictaminación',  'CONSULTA','SÍ', hoy, '', '', '', 'Especialista de Dictaminación'],
    ['yalinavelez@cualli.mx',       'Yalina Vélez Hernández',     'Crédito',        'CONSULTA','SÍ', hoy, '', '', '', 'Especialista de Crédito'],
    ['jesusdosal@cualli.mx',        'Jesús Jair Dosal Copca',     'Crédito',        'CONSULTA','SÍ', hoy, '', '', '', 'Gerencia de Crédito'],
    ['robertoflores@cualli.mx',     'Roberto Flores Mendoza',     'Crédito',        'CONSULTA','SÍ', hoy, '', '', '', 'Coordinación de Crédito']
  ];

  hoja.getRange(1, 1, 1, enc.length).setValues([enc])
      .setFontWeight('bold').setBackground('#364494').setFontColor('#FFFFFF');
  hoja.getRange(2, 1, filas.length, enc.length).setValues(filas);
  hoja.setFrozenRows(1);
  hoja.autoResizeColumns(1, enc.length);

  return 'Hoja AUTORIZADOS creada con ' + filas.length + ' usuarios.';
}

/* ==========================================================================
 * Administración de usuarios — solo ADMIN, desde la interfaz
 * ========================================================================== */

/**
 * Da de alta un usuario.
 * @param {Object} datos {correo, nombre, area, rol, justificacion}
 * @return {Object}
 */
function lpbAltaUsuario(datos) {
  var admin = lpbExigir_('usuarios');

  var correo = String(datos.correo || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new Error('Correo inválido.');
  if (!LPB_PERMISOS[datos.rol]) throw new Error('Rol inválido: ' + datos.rol);
  if (!String(datos.justificacion || '').trim()) {
    throw new Error('La justificación es obligatoria. Es el sustento del acceso ante una revisión.');
  }

  var usuarios = lpbLeerAutorizados_(false);
  if (usuarios[correo]) throw new Error('Ese correo ya existe en la tabla. ' +
    'Use reactivación o cambio de rol.');

  // Si estuvo archivado, se avisa: reincorporar a alguien que salió de la
  // empresa merece una confirmación explícita, no pasar inadvertido.
  var previo = lpbBuscarEnHistorico_(correo);

  var ss = lpbLibroSistema_();
  var hoja = ss.getSheetByName(LPB_HOJAS.AUTORIZADOS);
  hoja.appendRow([correo, String(datos.nombre || '').trim(), String(datos.area || '').trim(),
                  datos.rol, 'SÍ', new Date(), '', admin.correo, '',
                  String(datos.justificacion).trim()]);

  lpbInvalidarAutorizados_();
  lpbRegistrarAdmin_(admin, previo ? 'REINCORPORACION' : 'ALTA', correo,
    'rol=' + datos.rol + ' · ' + datos.justificacion +
    (previo ? ' · reincorporación, baja previa el ' + previo.fecha : ''));

  return {
    ok: true,
    mensaje: previo
      ? 'Usuario reincorporado. Tuvo acceso hasta el ' + previo.fecha +
        ' (' + previo.motivo + ').'
      : 'Usuario dado de alta.'
  };
}

/**
 * DESACTIVA el acceso de un usuario.
 *
 * El registro permanece en la tabla, en estado inactivo y reactivable con un
 * clic. Es la operación para suspensiones temporales: vacaciones, licencia,
 * cambio de área.
 *
 * Para una salida definitiva se usa lpbArchivarUsuario, que sí retira el
 * registro de la tabla.
 *
 * @param {string} correo
 * @param {string} motivo
 * @return {Object}
 */
function lpbBajaUsuario(correo, motivo) {
  var admin = lpbExigir_('usuarios');
  correo = String(correo || '').trim().toLowerCase();

  if (correo === admin.correo) {
    throw new Error('No puede desactivar su propio acceso. ' +
      'Solicítelo a otro administrador para evitar quedarse sin administradores activos.');
  }
  if (!String(motivo || '').trim()) throw new Error('El motivo es obligatorio.');

  var usuarios = lpbLeerAutorizados_(false);
  var u = usuarios[correo];
  if (!u) throw new Error('No existe ese correo.');

  // Nunca dejar el sistema sin administradores.
  if (u.rol === LPB_ROLES.ADMIN) {
    var activos = 0;
    for (var c in usuarios) {
      if (usuarios[c].rol === LPB_ROLES.ADMIN && usuarios[c].activo) activos++;
    }
    if (activos <= 2) {
      throw new Error('No es posible: quedarían menos de dos administradores activos. ' +
        'Dé de alta un administrador antes de retirar a éste.');
    }
  }

  var ss = lpbLibroSistema_();
  var hoja = ss.getSheetByName(LPB_HOJAS.AUTORIZADOS);
  hoja.getRange(u.fila, LPB_COL_AUTH.ACTIVO + 1).setValue('NO');
  hoja.getRange(u.fila, LPB_COL_AUTH.FECHA_BAJA + 1).setValue(new Date());

  lpbInvalidarAutorizados_();
  lpbRegistrarAdmin_(admin, 'DESACTIVACION', correo, motivo);
  return { ok: true, mensaje: 'Acceso desactivado. El registro permanece en la tabla.' };
}

/**
 * ARCHIVA a un usuario: lo retira de la tabla de accesos.
 *
 * El registro NO se borra, se mueve a AUTORIZADOS_HISTORICO. La razón es de
 * auditoría: la bitácora guarda consultas hechas por esa persona, y si su
 * registro desapareciera quedarían correos sueltos sin nombre, área ni rol.
 * En una revisión donde pidan explicar quién consultó qué, eso es un cabo
 * suelto imposible de cerrar después.
 *
 * Es la operación para salidas definitivas de la empresa.
 *
 * @param {string} correo
 * @param {string} motivo
 * @return {Object}
 */
function lpbArchivarUsuario(correo, motivo) {
  var admin = lpbExigir_('usuarios');
  correo = String(correo || '').trim().toLowerCase();
  motivo = String(motivo || '').trim();

  if (correo === admin.correo) {
    throw new Error('No puede archivar su propio registro.');
  }
  if (!motivo) throw new Error('El motivo de la baja es obligatorio.');

  var usuarios = lpbLeerAutorizados_(false);
  var u = usuarios[correo];
  if (!u) throw new Error('No existe ese correo en la tabla de accesos.');

  // Nunca dejar el sistema sin administradores.
  if (u.rol === LPB_ROLES.ADMIN) {
    var activos = 0;
    for (var c in usuarios) {
      if (usuarios[c].rol === LPB_ROLES.ADMIN && usuarios[c].activo) activos++;
    }
    if (activos <= 2) {
      throw new Error('No es posible: quedarían menos de dos administradores activos. ' +
        'Dé de alta un administrador antes de retirar a éste.');
    }
  }

  var ss = lpbLibroSistema_();
  var hoja = ss.getSheetByName(LPB_HOJAS.AUTORIZADOS);
  var fila = hoja.getRange(u.fila, 1, 1, 10).getValues()[0];

  var hist = ss.getSheetByName(LPB_HOJAS.HISTORICO);
  if (!hist) {
    hist = ss.insertSheet(LPB_HOJAS.HISTORICO);
    hist.getRange(1, 1, 1, 13).setValues([[
      'CORREO', 'NOMBRE', 'AREA', 'ROL', 'ACTIVO', 'FECHA ALTA', 'FECHA BAJA',
      'AUTORIZADO POR', 'ULTIMA REVISION', 'JUSTIFICACION',
      'FECHA ARCHIVO', 'ARCHIVADO POR', 'MOTIVO DE BAJA'
    ]]).setFontWeight('bold').setBackground('#515151').setFontColor('#FFFFFF');
    hist.setFrozenRows(1);
    hist.hideSheet();
  }

  fila[4] = 'NO';
  fila[6] = fila[6] || new Date();
  hist.appendRow(fila.concat([new Date(), admin.correo, motivo]));
  hoja.deleteRow(u.fila);

  lpbInvalidarAutorizados_();
  lpbRegistrarAdmin_(admin, 'BAJA_DEFINITIVA', correo, motivo);
  return { ok: true, mensaje: 'Usuario archivado. Su historial se conserva para auditoría.' };
}

/**
 * Busca a un correo en el histórico de accesos.
 * Se usa al dar de alta, para avisar si esa persona ya tuvo acceso antes.
 *
 * @param {string} correo
 * @return {?Object}
 */
function lpbBuscarEnHistorico_(correo) {
  var ss = lpbLibroSistema_();
  var hist = ss.getSheetByName(LPB_HOJAS.HISTORICO);
  if (!hist || hist.getLastRow() < 2) return null;

  var d = hist.getRange(2, 1, hist.getLastRow() - 1, 13).getValues();
  var tz = Session.getScriptTimeZone();
  for (var i = d.length - 1; i >= 0; i--) {   // del más reciente hacia atrás
    if (String(d[i][0]).trim().toLowerCase() !== correo) continue;
    var f = d[i][10];
    return {
      nombre: String(d[i][1] || ''),
      area:   String(d[i][2] || ''),
      rol:    String(d[i][3] || ''),
      motivo: String(d[i][12] || ''),
      fecha:  (Object.prototype.toString.call(f) === '[object Date]' && !isNaN(f))
                ? Utilities.formatDate(f, tz, 'dd/MM/yyyy') : String(f || '')
    };
  }
  return null;
}

/**
 * Cambia el rol de un usuario.
 * @param {string} correo
 * @param {string} rolNuevo
 * @param {string} motivo
 * @return {Object}
 */
function lpbCambiarRol(correo, rolNuevo, motivo) {
  var admin = lpbExigir_('usuarios');
  correo = String(correo || '').trim().toLowerCase();

  if (!LPB_PERMISOS[rolNuevo]) throw new Error('Rol inválido: ' + rolNuevo);
  if (!String(motivo || '').trim()) throw new Error('El motivo del cambio es obligatorio.');
  if (correo === admin.correo && rolNuevo !== LPB_ROLES.ADMIN) {
    throw new Error('No puede retirarse a sí mismo el rol de administrador.');
  }

  var usuarios = lpbLeerAutorizados_(false);
  var u = usuarios[correo];
  if (!u) throw new Error('No existe ese correo.');

  var ss = lpbLibroSistema_();
  var hoja = ss.getSheetByName(LPB_HOJAS.AUTORIZADOS);
  hoja.getRange(u.fila, LPB_COL_AUTH.ROL + 1).setValue(rolNuevo);

  lpbInvalidarAutorizados_();
  lpbRegistrarAdmin_(admin, 'CAMBIO_ROL', correo, u.rol + ' -> ' + rolNuevo + ' · ' + motivo);
  return { ok: true, mensaje: 'Rol actualizado.' };
}

/**
 * Reactiva un usuario dado de baja.
 * @param {string} correo
 * @param {string} motivo
 * @return {Object}
 */
function lpbReactivarUsuario(correo, motivo) {
  var admin = lpbExigir_('usuarios');
  correo = String(correo || '').trim().toLowerCase();
  if (!String(motivo || '').trim()) throw new Error('El motivo es obligatorio.');

  var usuarios = lpbLeerAutorizados_(false);
  var u = usuarios[correo];
  if (!u) throw new Error('No existe ese correo.');

  var ss = lpbLibroSistema_();
  var hoja = ss.getSheetByName(LPB_HOJAS.AUTORIZADOS);
  hoja.getRange(u.fila, LPB_COL_AUTH.ACTIVO + 1).setValue('SÍ');
  hoja.getRange(u.fila, LPB_COL_AUTH.FECHA_BAJA + 1).setValue('');
  hoja.getRange(u.fila, LPB_COL_AUTH.AUTORIZADO_POR + 1).setValue(admin.correo);

  lpbInvalidarAutorizados_();
  lpbRegistrarAdmin_(admin, 'REACTIVACION', correo, motivo);
  return { ok: true, mensaje: 'Acceso reactivado.' };
}

/**
 * Lista de usuarios para el panel de administración.
 * @return {Array}
 */
function lpbListarUsuarios() {
  lpbExigir_('usuarios');
  var usuarios = lpbLeerAutorizados_(false);
  var salida = [];
  for (var c in usuarios) {
    salida.push({
      correo: usuarios[c].correo, nombre: usuarios[c].nombre,
      area: usuarios[c].area, rol: usuarios[c].rol, activo: usuarios[c].activo
    });
  }
  // Orden por rol descendente: los administradores primero. Es el criterio
  // útil para revisar accesos — lo que se audita es quién tiene privilegio,
  // no el orden alfabético.
  var peso = { ADMIN: 0, AUDITOR: 1, CONSULTA: 2 };
  salida.sort(function (a, b) {
    if (a.activo !== b.activo) return a.activo ? -1 : 1;
    var pa = peso[a.rol] === undefined ? 9 : peso[a.rol];
    var pb = peso[b.rol] === undefined ? 9 : peso[b.rol];
    if (pa !== pb) return pa - pb;
    return a.nombre.localeCompare(b.nombre);
  });
  return salida;
}

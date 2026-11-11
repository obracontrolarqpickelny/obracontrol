/**
 * ═══════════════════════════════════════════════════════════════════
 *  ObraControl Pro — Servidor de informes (Google Apps Script)
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Qué hace:
 *   - Recibe los informes que envían los colaboradores (con fotos).
 *   - Los guarda en TU Google Drive, ordenados por obra y colaborador.
 *   - Tu app los levanta sola, sin WhatsApp de por medio.
 *
 *  Instalación: ver INSTALAR_BACKEND.md
 *
 *  IMPORTANTE: cambiá SECRETO por una clave tuya antes de implementar.
 * ═══════════════════════════════════════════════════════════════════
 */

// ─── CONFIGURACIÓN ────────────────────────────────────────────────
var SECRETO = 'CAMBIAME-por-una-clave-larga-y-unica-1234';
var CARPETA_RAIZ = 'ObraControl_Datos';

// Tope de fotos que se devuelven juntas en una sola respuesta (bytes de base64).
// Por encima de esto la app las pide de a una para no trabarse.
var TOPE_RESPUESTA = 25 * 1024 * 1024; // las fotos ahora viajan en buena calidad

// ─── UTILIDADES DE CARPETAS ───────────────────────────────────────

/** Devuelve la subcarpeta `nombre` dentro de `padre`, creándola si no existe. */
function _carpeta(padre, nombre) {
  nombre = String(nombre || 'sin_nombre').replace(/[\/\\:*?"<>|]/g, '_').trim() || 'sin_nombre';
  var it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

/** Carpeta raíz del sistema, en la raíz de tu Drive. */
function _raiz() {
  // Si al pegar el script se borró la línea de CARPETA_RAIZ, se usa la de siempre
  // en vez de fallar ("CARPETA_RAIZ is not defined" rompía todos los envíos).
  var nombre = (typeof CARPETA_RAIZ !== 'undefined' && CARPETA_RAIZ) ? CARPETA_RAIZ : 'ObraControl_Datos';
  var it = DriveApp.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : DriveApp.createFolder(nombre);
}

/** Bandeja: acá viven los informes que la app todavía no incorporó. */
function _inbox() {
  return _carpeta(_raiz(), '_BANDEJA');
}

/**
 * Bandeja del colaborador: lo que el arquitecto le asigna (tareas, checklists,
 * avisos de carpeta). Antes esto viajaba SOLO dentro del link; si el arquitecto
 * asignaba algo después, el colaborador con el link viejo no veía nada.
 */
function _carpetaBandejaColab() {
  return _carpeta(_raiz(), '_BANDEJA_COLAB');
}

/** Carpeta navegable ObraControl_Datos/<obra>/<colaborador>/ */
function _carpetaColab(obraName, colabName) {
  var obra = _carpeta(_raiz(), obraName || 'Obra sin nombre');
  return _carpeta(obra, colabName || 'Colaborador');
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _archivoPorNombre(carpeta, nombre) {
  var it = carpeta.getFilesByName(nombre);
  return it.hasNext() ? it.next() : null;
}

// ─── RECEPCIÓN DE INFORMES (lo que manda el colaborador) ──────────

/**
 * El colaborador envía acá. Se usa Content-Type: text/plain a propósito:
 * evita el preflight CORS, que Apps Script no sabe responder.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return _json({ ok: false, error: 'Servidor ocupado, reintentá en unos segundos.' });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return _json({ ok: false, error: 'Sin datos en la petición.' });
    }

    var body = JSON.parse(e.postData.contents);

    // Buzón de DOT: tiene su propio permiso (no usa la clave de los colaboradores)
    if (String(body.accion || '').indexOf('dot_') === 0) return _dotPost(body);

    if (String(body.secreto || '') !== SECRETO) {
      return _json({ ok: false, error: 'Clave incorrecta.' });
    }

    // El arquitecto publica la bandeja de un colaborador (no es un informe).
    if (body.accion === 'bandeja') {
      var tk = String(body.token || '');
      if (!tk) return _json({ ok: false, error: 'Falta el colaborador.' });
      var carpBandeja = _carpetaBandejaColab();
      var nombreB = tk + '.json';
      var viejoB = _archivoPorNombre(carpBandeja, nombreB);
      if (viejoB) viejoB.setTrashed(true);
      carpBandeja.createFile(Utilities.newBlob(
        JSON.stringify({ token: tk, mensajes: body.mensajes || [], actualizado: new Date().toISOString() }),
        'application/json', nombreB
      ));
      return _json({ ok: true, guardados: (body.mensajes || []).length });
    }

    var payload = body.payload;
    if (!payload) return _json({ ok: false, error: 'Falta el informe.' });

    var id = String(payload.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    var obraName = payload.obraName || payload.obraId || 'Obra';
    var colabName = payload.ayudante || 'Colaborador';
    var ahora = new Date();

    // 1. Guardar el informe completo (con fotos base64 adentro) en la bandeja.
    //    La app lo consume tal cual: es exactamente el mismo formato que ya entiende.
    var inbox = _inbox();
    var nombreData = id + '.data.json';
    var viejo = _archivoPorNombre(inbox, nombreData);
    if (viejo) viejo.setTrashed(true); // reenvío del mismo informe → reemplazar

    inbox.createFile(Utilities.newBlob(
      JSON.stringify(payload), 'application/json', nombreData
    ));

    // 2. Guardar un resumen liviano aparte, para que listar sea rápido
    //    aunque el informe pese varios MB.
    var meta = {
      id: id,
      recibido: ahora.toISOString(),
      fecha: payload.fecha || ahora.toISOString(),
      obraId: payload.obraId || '',
      obraName: obraName,
      token: payload.token || '',
      ayudante: colabName,
      modo: payload.mode || 'informe',
      resumen: _resumir(payload)
    };
    var nombreMeta = id + '.meta.json';
    var viejoMeta = _archivoPorNombre(inbox, nombreMeta);
    if (viejoMeta) viejoMeta.setTrashed(true);
    inbox.createFile(Utilities.newBlob(
      JSON.stringify(meta), 'application/json', nombreMeta
    ));

    // 3. Copia navegable en Drive: las fotos como archivos de imagen reales,
    //    dentro de ObraControl_Datos/<obra>/<colaborador>/
    var guardadas = 0;
    try {
      guardadas = _archivarAdjuntos(payload, obraName, colabName, ahora, id);
    } catch (err) {
      // Si falla el archivado el informe YA está guardado. No se pierde nada.
      console.error('archivado: ' + err);
    }

    return _json({ ok: true, id: id, fotosGuardadas: guardadas, recibido: meta.recibido });

  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Texto corto describiendo el informe, para la lista. */
function _resumir(p) {
  var t = [];
  if (p.mode === 'visto') return 'Abrió el link (aceptó la invitación)';
  if (p.mode === 'carpeta') {
    t.push((p.archivos || []).length + ' archivo(s)');
    return t.join(' · ');
  }
  if (p.mensajeGeneral) t.push('Mensaje');
  if ((p.movimientos || []).length) t.push(p.movimientos.length + ' movim.');
  if ((p.tareas || []).length) t.push(p.tareas.length + ' tarea(s)');
  if ((p.materialesExistentes || []).length) t.push(p.materialesExistentes.length + ' material(es)');
  if ((p.materialesPedidos || []).length) t.push(p.materialesPedidos.length + ' a pedir');
  if ((p.materialesIngresados || []).length) t.push(p.materialesIngresados.length + ' recibido(s)');
  if (p.checklist && p.checklist.titulo) t.push('Checklist');
  return t.join(' · ') || 'Informe';
}

/**
 * Recorre el informe, encuentra las imágenes base64 y las guarda como
 * archivos de verdad en Drive, para que puedas navegarlas desde Drive.
 */
function _archivarAdjuntos(payload, obraName, colabName, fecha, id) {
  var destino = _carpetaColab(obraName, colabName);
  var sello = Utilities.formatDate(fecha, Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm');
  var n = 0;

  function guardar(dataUrl, etiqueta) {
    if (!dataUrl || typeof dataUrl !== 'string' || dataUrl.indexOf('data:') !== 0) return;
    var coma = dataUrl.indexOf(',');
    if (coma < 0) return;
    var cabecera = dataUrl.substring(5, coma);
    var mime = cabecera.split(';')[0] || 'image/jpeg';
    var ext = mime.indexOf('png') >= 0 ? 'png' : mime.indexOf('pdf') >= 0 ? 'pdf' : 'jpg';
    var bytes = Utilities.base64Decode(dataUrl.substring(coma + 1));
    var nombre = sello + '_' + String(etiqueta || 'foto').replace(/[^\w\sáéíóúñÁÉÍÓÚÑ-]/g, '').trim().slice(0, 40) + '.' + ext;
    destino.createFile(Utilities.newBlob(bytes, mime, nombre));
    n++;
  }

  // Carpeta compartida: lista de archivos sueltos
  (payload.archivos || []).forEach(function (f) {
    if (f && f.data) guardar(f.data, f.nombre || 'archivo');
  });

  // Fotos embebidas en cada sección del informe. Antes se guardaba sólo la
  // primera de tareas, movimientos y materiales; ahora todas, de todas las
  // secciones, y con el comentario de cada foto en el nombre del archivo.
  function fotosDe(x, etiqueta) {
    if (!x) return;
    var lista = (x.fotos && x.fotos.length) ? x.fotos : (x.foto ? [{ src: x.foto, nota: x.fotoNota || '' }] : []);
    lista.forEach(function (f, k) {
      if (!f) return;
      guardar(f.src || f.url, etiqueta + (lista.length > 1 ? '_' + (k + 1) : '') + (f.nota ? ' - ' + f.nota : ''));
    });
  }
  (payload.comentarios || []).forEach(function (c, i) { fotosDe(c, 'comentario_' + String(c.texto || i).slice(0, 20)); });
  (payload.tareas || []).forEach(function (t, i) { fotosDe(t, 'tarea_' + (t.titulo || i)); });
  (payload.movimientos || []).forEach(function (m, i) { fotosDe(m, 'movim_' + (m.concepto || i)); });
  (payload.materialesExistentes || []).forEach(function (m, i) { fotosDe(m, 'material_' + (m.nombre || i)); });
  (payload.materialesIngresados || []).forEach(function (m, i) { fotosDe(m, 'recibido_' + (m.nombre || i)); });
  if (payload.checklist) fotosDe(payload.checklist, 'checklist_' + (payload.checklist.titulo || ''));

  // Copia del informe en texto, para tener el respaldo legible junto a las fotos
  try {
    destino.createFile(Utilities.newBlob(
      JSON.stringify(payload, null, 2), 'application/json', sello + '_informe_' + id + '.json'
    ));
  } catch (err) {}

  return n;
}

// ─── CONSULTA (lo que hace tu app) ────────────────────────────────

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var accion = p.action || 'ping';

    if (String(accion).indexOf('dot_') === 0) return _dotGet(p);

    if (accion === 'ping') {
      // Chequeo de conexión: no expone nada si la clave está mal.
      if (String(p.secreto || '') !== SECRETO) {
        return _json({ ok: false, error: 'Clave incorrecta.' });
      }
      return _json({ ok: true, mensaje: 'Conectado', version: 3 });
    }

    if (String(p.secreto || '') !== SECRETO) {
      return _json({ ok: false, error: 'Clave incorrecta.' });
    }

    // El colaborador pide su bandeja (lo que el arquitecto le asignó).
    if (accion === 'bandeja') {
      var tkg = String(p.token || '');
      if (!tkg) return _json({ ok: false, error: 'Falta el colaborador.' });
      var fb = _archivoPorNombre(_carpetaBandejaColab(), tkg + '.json');
      if (!fb) return _json({ ok: true, mensajes: [] });
      try {
        var datos = JSON.parse(fb.getBlob().getDataAsString());
        return _json({ ok: true, mensajes: datos.mensajes || [], actualizado: datos.actualizado || '' });
      } catch (err) {
        return _json({ ok: true, mensajes: [] });
      }
    }

    // El colaborador baja un archivo de su biblioteca compartida (para armar un
    // ZIP con varios). Sólo se entrega si ese archivo figura en SU biblioteca
    // publicada: con la clave sola no se puede pedir cualquier archivo del Drive.
    if (accion === 'archivo') {
      var tka = String(p.token || ''), ida = String(p.id || '');
      if (!tka || !ida) return _json({ ok: false, error: 'Faltan datos.' });
      var fbA = _archivoPorNombre(_carpetaBandejaColab(), tka + '.json');
      if (!fbA) return _json({ ok: false, error: 'Sin biblioteca.' });
      var permitido = false;
      try {
        var datosA = JSON.parse(fbA.getBlob().getDataAsString());
        (datosA.mensajes || []).forEach(function (m) {
          (m.archivos || []).concat(m._archivos || []).forEach(function (a) { if (a && a.driveId === ida) permitido = true; });
        });
      } catch (err) {}
      if (!permitido) return _json({ ok: false, error: 'Ese archivo no está compartido con vos.' });
      var fileA = DriveApp.getFileById(ida);
      var blobA = fileA.getBlob();
      var b64A = Utilities.base64Encode(blobA.getBytes());
      if (b64A.length > TOPE_RESPUESTA) return _json({ ok: false, error: 'Archivo demasiado grande.', grande: true });
      return _json({ ok: true, nombre: fileA.getName(), mime: blobA.getContentType(), b64: b64A });
    }

    // Lista liviana de informes pendientes (sin fotos).
    if (accion === 'list') {
      var inbox = _inbox();
      var it = inbox.getFilesByType('application/json');
      var out = [];
      while (it.hasNext()) {
        var f = it.next();
        if (f.getName().indexOf('.meta.json') < 0) continue;
        try {
          out.push(JSON.parse(f.getBlob().getDataAsString()));
        } catch (err) {}
      }
      out.sort(function (a, b) { return String(a.recibido).localeCompare(String(b.recibido)); });
      return _json({ ok: true, informes: out });
    }

    // Un informe completo, con sus fotos adentro.
    if (accion === 'get') {
      var inbox2 = _inbox();
      var fd = _archivoPorNombre(inbox2, String(p.id || '') + '.data.json');
      if (!fd) return _json({ ok: false, error: 'Informe no encontrado.' });
      var texto = fd.getBlob().getDataAsString();
      if (texto.length > TOPE_RESPUESTA) {
        return _json({ ok: false, error: 'Informe demasiado grande.', grande: true });
      }
      return _json({ ok: true, payload: JSON.parse(texto) });
    }

    // Recuperar un informe ya incorporado, con sus fotos: se usa cuando en la app
    // las fotos quedaron como "no sincronizadas". Busca la copia que se guardó al
    // recibirlo (ObraControl_Datos/<obra>/<colaborador>/..._informe_<id>.json) y,
    // si no está, el original que quedó en la papelera de la bandeja.
    if (accion === 'recuperar') {
      var idR = String(p.id || '').replace(/["'\\]/g, '');
      if (!idR) return _json({ ok: false, error: 'Falta el id.' });
      var cand = DriveApp.searchFiles('title contains "_informe_' + idR + '.json" and trashed = false');
      var fR = cand.hasNext() ? cand.next() : null;
      if (!fR) {
        var cand2 = DriveApp.searchFiles('title = "' + idR + '.data.json"');
        fR = cand2.hasNext() ? cand2.next() : null;
      }
      if (!fR) return _json({ ok: false, error: 'No encontré la copia de ese informe.' });
      var txtR = fR.getBlob().getDataAsString();
      if (txtR.length > TOPE_RESPUESTA) return _json({ ok: false, error: 'Informe demasiado grande.', grande: true });
      return _json({ ok: true, payload: JSON.parse(txtR) });
    }

    // Marcar como incorporado: sale de la bandeja (la copia navegable queda).
    if (accion === 'ack') {
      var inbox3 = _inbox();
      var id3 = String(p.id || '');
      ['.data.json', '.meta.json'].forEach(function (suf) {
        var f = _archivoPorNombre(inbox3, id3 + suf);
        if (f) f.setTrashed(true);
      });
      return _json({ ok: true });
    }

    return _json({ ok: false, error: 'Acción desconocida: ' + accion });

  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

// ─── ZIP DE CADA OBRA: LO QUE LA APP NO PUEDE LEER ──────────────────────
// La app arma "<OBRA> - FOTOS Y ARCHIVOS.zip" en SISTEMA_GESTION_OBRAS, pero solo
// puede abrir los archivos que subió ella. En la descripción de ese ZIP deja la
// lista de los que no pudo. Este script, que sí tiene acceso a tu Drive, arma con
// ellos "<OBRA> - FOTOS Y ARCHIVOS 2.zip". Corre solo, una vez por hora.
// No es una dirección web: nadie de afuera puede llamarlo.
var CARPETA_SISTEMA = 'SISTEMA_GESTION_OBRAS';
var FIN_ZIP = ' - FOTOS Y ARCHIVOS.zip';
var FIN_ZIP2 = ' - FOTOS Y ARCHIVOS 2.zip';
var TOPE_ZIP2 = 45 * 1024 * 1024; // Google no comprime más de ~50 MB de una vez

/** Se ejecuta UNA vez desde el editor: deja programada la tarea de cada hora. */
function instalarRespaldoAutomatico() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'completarZips') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('completarZips').timeBased().everyHours(1).create();
  completarZips();
}

function completarZips() {
  try { _dotDrenarConLock(); } catch (err) {}
  var raices = DriveApp.getFoldersByName(CARPETA_SISTEMA);
  if (!raices.hasNext()) return;
  var obras = raices.next().getFolders(), props = PropertiesService.getScriptProperties(), inicio = Date.now();
  while (obras.hasNext() && Date.now() - inicio < 300000) {
    var obra = obras.next();
    try { _completarZipObra(obra, props); } catch (e) { console.warn('zip ' + obra.getName() + ': ' + e); }
  }
}

function _completarZipObra(obra, props) {
  var it = obra.getFiles(), zip = null, previo = null;
  while (it.hasNext()) {
    var f = it.next(), n = f.getName();
    if (n.slice(-FIN_ZIP.length) === FIN_ZIP) zip = f;
    else if (n.slice(-FIN_ZIP2.length) === FIN_ZIP2) previo = f;
  }
  if (!zip) return;
  var ids = [];
  try { ids = JSON.parse(zip.getDescription() || '{}').faltan || []; } catch (e) { return; }
  if (!ids.length) return;
  var nombre = zip.getName().slice(0, -FIN_ZIP.length) + FIN_ZIP2;
  if (previo && previo.getName() !== nombre) previo.setName(nombre); // la obra cambió de nombre
  var clave = 'z2_' + obra.getId();
  var firma = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, ids.slice().sort().join(',')));
  if (previo && props.getProperty(clave) === firma) return;
  var blobs = [], total = 0;
  ids.forEach(function (id) {
    try {
      var a = DriveApp.getFileById(id);
      if (a.isTrashed() || a.getMimeType() === 'application/vnd.google-apps.folder' || total + a.getSize() > TOPE_ZIP2) return;
      var padres = a.getParents(), carpeta = padres.hasNext() ? padres.next().getName() : 'Otros';
      var b = a.getBlob();
      b.setName(carpeta.replace(/[\/\\:*?"<>|]/g, '_') + '/' + id.slice(0, 6) + ' - ' + a.getName().replace(/[\/\\:*?"<>|]/g, '_'));
      blobs.push(b);
      total += a.getSize();
    } catch (e) { console.warn('no pude leer ' + id + ': ' + e); }
  });
  if (!blobs.length) return;
  obra.createFile(Utilities.zip(blobs, nombre));
  if (previo) previo.setTrashed(true); // reemplazado por el recién creado
  props.setProperty(clave, firma);
}

// ═══════════════════════════════════════════════════════════════
//  BUZÓN DE DOT
//  DOT lee los datos, carga, modifica, elimina y adjunta fotos, aunque la app
//  no esté abierta. El pedido queda guardado primero en el buzón y después se
//  aplica en ObraControl_datos.json con las mismas reglas de la app: control de
//  versión, marca de guardado (_revs), lápidas e historial con "Deshacer".
//  El permiso NO está en este código: es el archivo DOT_PERMISO.json que crea
//  la app (botón "Autorizar a DOT") en SISTEMA_GESTION_OBRAS. Anularlo en la
//  app corta el acceso enseguida.
// ═══════════════════════════════════════════════════════════════
var DOT_TABLAS = ['notas', 'economia', 'materiales', 'matIngresos', 'visitas', 'checklists', 'comentarios', 'alertas', 'documentos', 'enlaces'];
var DOT_MAX_OPS = 50;

function _dotSistema() {
  var it = DriveApp.getFoldersByName(CARPETA_SISTEMA);
  return it.hasNext() ? it.next() : null;
}
function _dotLeerJSON(f) {
  return JSON.parse(f.getBlob().getDataAsString().replace(/^\uFEFF/, ''));
}
function _dotClaveOk(k) {
  k = String(k || '');
  if (k.length < 32) return false;
  var c = CacheService.getScriptCache(), v = c.get('dot_permiso');
  if (v === null) {
    var s = _dotSistema(), f = s ? _archivoPorNombre(s, 'DOT_PERMISO.json') : null, per = null;
    try { per = f ? _dotLeerJSON(f) : null; } catch (err) {}
    v = (per && per.activo && per.clave) ? String(per.clave) : '-';
    c.put('dot_permiso', v, 20);
  }
  return v !== '-' && v === k;
}
function _dotBuzon() { return _carpeta(_raiz(), '_DOT_buzon'); }
function _dotArchivoDatos() {
  var s = _dotSistema(), it = s ? s.getFilesByName('ObraControl_datos.json') : null, f = null;
  while (it && it.hasNext()) { var x = it.next(); if (!f || x.getLastUpdated() > f.getLastUpdated()) f = x; }
  if (!f) throw new Error('No encuentro ObraControl_datos.json');
  return f;
}
function _dotDatos() { return _dotLeerJSON(_dotArchivoDatos()); }
function _dotLote(id) {
  var carp = _dotBuzon(), pre = ['P_', 'A_'];
  for (var i = 0; i < pre.length; i++) {
    var f = _archivoPorNombre(carp, pre[i] + id + '.json');
    if (f) return f;
  }
  return null;
}
function _dotGet(p) {
  if (!_dotClaveOk(p.dot)) return _json({ ok: false, error: 'Sin autorización.' });
  var a = p.action;
  if (a === 'dot_leer') {
    var d = _dotDatos();
    if (!p.obra) {
      return _json({ ok: true, tablas: DOT_TABLAS, obras: (d.projects || []).map(function (o) { return { id: o.id, nombre: o.name, cerrada: !!o.cerrada }; }) });
    }
    if (DOT_TABLAS.indexOf(p.tabla) < 0) return _json({ ok: false, error: 'Tabla no permitida.' });
    var regs = (d[p.tabla] || []).filter(function (r) { return r && r.projectId === p.obra; });
    return _json({ ok: true, obra: p.obra, tabla: p.tabla, datosDe: d.lastSync || '', registros: regs });
  }
  if (a === 'dot_estado') {
    var fe = _dotLote(String(p.lote || '').replace(/[^A-Za-z0-9_]/g, ''));
    if (!fe) return _json({ ok: false, error: 'No encuentro ese envío.' });
    var le = _dotLeerJSON(fe);
    return _json({ ok: true, lote: le.id, estado: le.estado, resultados: le.resultados || [] });
  }
  if (a === 'dot_cola') {
    // La app abierta solo da el empujón: lo que haya quedado pendiente se aplica acá
    return _json({ ok: true, lotes: [], aplicados: _dotDrenar() });
  }
  return _json({ ok: false, error: 'Acción desconocida.' });
}
function _dotPost(b) {
  if (!_dotClaveOk(b.dot)) return _json({ ok: false, error: 'Sin autorización.' });
  if (b.accion === 'dot_enviar') {
    var ops = b.ops;
    if (!Array.isArray(ops) || !ops.length) return _json({ ok: false, error: 'No hay operaciones.' });
    if (ops.length > DOT_MAX_OPS) return _json({ ok: false, error: 'Máximo ' + DOT_MAX_OPS + ' operaciones por envío.' });
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i] || {};
      if (['crear', 'modificar', 'eliminar', 'foto'].indexOf(o.op) < 0) return _json({ ok: false, error: 'Operación ' + (i + 1) + ': op inválida.' });
      if (DOT_TABLAS.indexOf(o.tabla) < 0) return _json({ ok: false, error: 'Operación ' + (i + 1) + ': tabla no permitida.' });
      if (o.op === 'crear' && !o.obra) return _json({ ok: false, error: 'Operación ' + (i + 1) + ': falta la obra.' });
      if (o.op !== 'crear' && !o.id) return _json({ ok: false, error: 'Operación ' + (i + 1) + ': falta el id.' });
      if (o.op === 'foto' && (!o.b64 || !/^image\//.test(String(o.mime || '')))) return _json({ ok: false, error: 'Operación ' + (i + 1) + ': falta la imagen.' });
    }
    var id = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    var lote = { id: id, creado: new Date().toISOString(), estado: 'pendiente', ops: ops };
    // Primero queda a salvo en el buzón; recién después se aplica
    var arch = _dotBuzon().createFile(Utilities.newBlob(JSON.stringify(lote), 'application/json', 'P_' + id + '.json'));
    try {
      var res = _dotAplicarLote(arch, lote);
      return _json({ ok: true, lote: id, estado: 'aplicado', resultados: res });
    } catch (err) {
      return _json({ ok: true, lote: id, estado: 'pendiente', aviso: 'Quedó guardado y se aplica solo en unos minutos. No lo reenvíes.', detalle: String(err && err.message || err) });
    }
  }
  if (b.accion === 'dot_resultado') {
    var f = _dotLote(String(b.lote || '').replace(/[^A-Za-z0-9_]/g, ''));
    if (!f) return _json({ ok: false, error: 'No encuentro ese envío.' });
    var l = _dotLeerJSON(f);
    l.estado = 'aplicado'; l.resultados = b.resultados || []; l.aplicado = new Date().toISOString();
    f.setContent(JSON.stringify(l));
    f.setName('A_' + l.id + '.json');
    return _json({ ok: true });
  }
  return _json({ ok: false, error: 'Acción desconocida.' });
}

// ─── Aplicar lo de DOT en los datos ───────────────────────────────
var DOT_FIJOS = ['id', 'projectId', 'tombstones', '_revs'];
var DOT_CARPETAS = { notas: '📝 Notas', economia: '💰 Economia', materiales: '🧱 Materiales', matIngresos: '🧱 Materiales', visitas: '📋 Visitas', checklists: '☑️ Checklist', documentos: '📁 Documentos', comentarios: '💬 Comentarios', alertas: '🔔 Alertas' };

function _dotAhora() { return new Date().toISOString(); }
function _dotHoy() { return Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd'); }
function _dotTitulo(r) { return String((r && (r.titulo || r.concepto || r.matNombre || r.name || r.title || r.text || r.texto || r.message)) || '').slice(0, 70); }
function _dotTieneBase64(o) {
  if (typeof o === 'string') return o.indexOf('data:') === 0;
  if (o && typeof o === 'object') return Object.keys(o).some(function (k) { return _dotTieneBase64(o[k]); });
  return false;
}
function _dotValidar(t, d) {
  if (t === 'economia') {
    if (!(parseFloat(d.monto) > 0)) return 'falta el monto';
    if (['ingreso', 'egreso'].indexOf(d.tipo) < 0) return 'tipo debe ser ingreso o egreso';
  }
  if (t === 'notas' && !d.texto && !d.titulo) return 'falta el texto';
  if (t === 'matIngresos' && !d.matNombre) return 'falta matNombre';
  if (t === 'materiales' && !d.name) return 'falta name';
  return '';
}
function _dotCarpetaObra(d, projectId, modulo) {
  var p = (d.projects || []).filter(function (x) { return x.id === projectId; })[0];
  if (!p || !p.driveFolderId) throw new Error('la obra no tiene carpeta en Drive');
  return _carpeta(DriveApp.getFolderById(p.driveFolderId), modulo);
}
// Sube la foto una sola vez: si hay que reintentar, se reusa la ya subida
function _dotSubirFoto(d, o) {
  var rec = (d[o.tabla] || []).filter(function (x) { return x.id === o.id; })[0];
  if (!rec || (o.tabla === 'economia' && rec.imagen && !o.reemplazar)) return false;
  var nombre = String(o.nombre || ('foto_' + Date.now() + '.jpg')).replace(/[\/\\:*?"<>|]/g, '_');
  var f = _dotCarpetaObra(d, rec.projectId, DOT_CARPETAS[o.tabla] || '🖼️ Imagenes')
    .createFile(Utilities.newBlob(Utilities.base64Decode(String(o.b64).replace(/^data:[^,]*,/, '')), o.mime, nombre));
  // Igual que las fotos que sube la app: el link de la miniatura tiene que verse siempre
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  o.driveId = f.getId();
  delete o.b64;
  return true;
}
function _dotOp(d, o, lote, i) {
  var opId = lote + '_' + i;
  if (!Array.isArray(d.dotLog)) d.dotLog = [];
  var ya = d.dotLog.filter(function (x) { return x.id === opId; })[0];
  if (ya) return { n: i + 1, ok: ya.ok, id: ya.regId, error: ya.error || undefined };
  var t = o.tabla, ahora = _dotAhora();
  var l = { id: opId, ts: ahora, updatedAt: ahora, op: o.op, tabla: t, lote: lote, obra: o.obra || '', ok: false };
  var falla = function (m) { l.error = m; l.titulo = _dotTitulo(o.datos) || String(o.id || ''); d.dotLog.push(l); return { n: i + 1, ok: false, error: m }; };
  if (DOT_TABLAS.indexOf(t) < 0) return falla('tabla no permitida');
  if (!Array.isArray(d[t])) d[t] = [];
  var dat = (o.datos && typeof o.datos === 'object') ? o.datos : {};
  if (_dotTieneBase64(dat)) return falla('las imágenes van con la opción de adjuntar foto');
  var limpios = {};
  Object.keys(dat).forEach(function (k) { if (DOT_FIJOS.indexOf(k) < 0) limpios[k] = dat[k]; });
  var rec;
  if (o.op === 'crear') {
    if (!(d.projects || []).some(function (p) { return p.id === o.obra; })) return falla('la obra no existe');
    var m = _dotValidar(t, dat);
    if (m) return falla(m);
    rec = Object.assign({}, limpios, { id: 'dot_' + opId, projectId: o.obra, cargadoPor: 'dot', date: dat.date || ahora, updatedAt: ahora });
    if (t === 'notas') { rec.fecha = rec.fecha || _dotHoy(); rec.tipo = rec.tipo || 'registro'; rec.cuaderno = rec.cuaderno || 'Libro de obra'; }
    if (t === 'economia') { rec.fecha = rec.fecha || _dotHoy(); rec.monto = parseFloat(rec.monto); }
    d[t].push(rec);
  } else {
    rec = d[t].filter(function (x) { return x.id === o.id; })[0];
    if (!rec) return falla('no encuentro ese registro');
    if (o.obra && rec.projectId !== o.obra) return falla('el registro es de otra obra');
    l.obra = rec.projectId;
    l.antes = JSON.parse(JSON.stringify(rec));
    if (o.op === 'modificar') {
      if (!Object.keys(limpios).length) return falla('no hay nada para modificar');
      Object.keys(limpios).forEach(function (k) { rec[k] = limpios[k]; });
      rec.updatedAt = ahora; rec.modificadoPor = 'dot';
    } else if (o.op === 'foto') {
      if (t === 'economia' && rec.imagen && !o.reemplazar) return falla('ya tiene comprobante: para cambiarlo marcá reemplazar');
      if (!o.driveId) return falla('no se pudo subir la imagen');
      var url = 'https://drive.google.com/thumbnail?id=' + o.driveId + '&sz=w800';
      if (t === 'economia') rec.imagen = url;
      else {
        if (!Array.isArray(rec.photos)) rec.photos = [];
        rec.photos.push({ id: 'dot' + o.driveId.slice(-10), url: url, driveId: o.driveId, caption: String(o.caption || ''), date: _dotHoy(), author: 'DOT', comments: [] });
      }
      rec.updatedAt = ahora; rec.modificadoPor = 'dot';
    } else if (o.op === 'eliminar') {
      // Queda una copia legible en la carpeta de eliminados de la obra
      try {
        _dotCarpetaObra(d, rec.projectId, '🗑️ Eliminado en la app').createFile(Utilities.newBlob(JSON.stringify({ tabla: t, eliminadoPor: 'DOT', fecha: ahora, registro: rec }, null, 2), 'application/json', t + ' - ' + rec.id + '.json'));
      } catch (err) {}
      if (!Array.isArray(d.tombstones)) d.tombstones = [];
      if (!d.tombstones.some(function (x) { return x.id === rec.id; })) d.tombstones.push({ id: rec.id, tbl: t, ts: ahora });
      d[t] = d[t].filter(function (x) { return x.id !== rec.id; });
    } else return falla('operación inválida');
  }
  l.ok = true; l.regId = rec.id; l.titulo = _dotTitulo(rec);
  d.dotLog.push(l);
  if (d.dotLog.length > 400) d.dotLog = d.dotLog.slice(-400);
  return { n: i + 1, ok: true, id: rec.id };
}
/** Hay que llamarla con el LockService tomado. */
function _dotAplicarLote(archivo, l) {
  var f = _dotArchivoDatos(), res = null;
  for (var intento = 1; intento <= 4; intento++) {
    var version = f.getLastUpdated().getTime();
    var d = _dotLeerJSON(f);
    var hizoFoto = false;
    l.ops.forEach(function (o) { if (o.op === 'foto' && !o.driveId && o.b64 && _dotSubirFoto(d, o)) hizoFoto = true; });
    if (hizoFoto) archivo.setContent(JSON.stringify(l));
    res = l.ops.map(function (o, i) { return _dotOp(d, o, l.id, i); });
    // Si un equipo guardó mientras tanto, se vuelve a leer en lugar de pisarlo
    if (f.getLastUpdated().getTime() !== version) { Utilities.sleep(1500); continue; }
    var marca = 'rdot' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    d._revs = (Array.isArray(d._revs) ? d._revs : []).concat([marca]).slice(-100);
    d.lastSync = _dotAhora();
    f.setContent(JSON.stringify(d, null, 2));
    // Se confirma que nadie escribió encima, igual que hace la app
    Utilities.sleep(5000);
    var v = _dotLeerJSON(f);
    if ((Array.isArray(v._revs) ? v._revs : []).indexOf(marca) < 0) continue;
    l.estado = 'aplicado'; l.resultados = res; l.aplicado = _dotAhora();
    l.ops.forEach(function (o) { delete o.b64; });
    archivo.setContent(JSON.stringify(l));
    archivo.setName('A_' + l.id + '.json');
    return res;
  }
  throw new Error('Los datos estaban ocupados');
}
function _dotDrenar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 0;
  try { return _dotDrenarConLock(); } finally { lock.releaseLock(); }
}
function _dotDrenarConLock() {
  var ahora = Date.now(), files = _dotBuzon().getFiles(), lista = [], n = 0;
  while (files.hasNext()) {
    var f = files.next(), nom = f.getName();
    if (nom.indexOf('P_') === 0) lista.push(f);
    else if (nom.indexOf('A_') === 0 && ahora - f.getLastUpdated().getTime() > 30 * 864e5) f.setTrashed(true);
  }
  lista.sort(function (x, y) { return x.getName() < y.getName() ? -1 : 1; });
  for (var i = 0; i < lista.length && Date.now() - ahora < 20000; i++) {
    try { _dotAplicarLote(lista[i], _dotLeerJSON(lista[i])); n++; } catch (err) { break; }
  }
  return n;
}

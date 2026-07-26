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
var TOPE_RESPUESTA = 6 * 1024 * 1024;

// ─── UTILIDADES DE CARPETAS ───────────────────────────────────────

/** Devuelve la subcarpeta `nombre` dentro de `padre`, creándola si no existe. */
function _carpeta(padre, nombre) {
  nombre = String(nombre || 'sin_nombre').replace(/[\/\\:*?"<>|]/g, '_').trim() || 'sin_nombre';
  var it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

/** Carpeta raíz del sistema, en la raíz de tu Drive. */
function _raiz() {
  var it = DriveApp.getFoldersByName(CARPETA_RAIZ);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA_RAIZ);
}

/** Bandeja: acá viven los informes que la app todavía no incorporó. */
function _inbox() {
  return _carpeta(_raiz(), '_BANDEJA');
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

    if (String(body.secreto || '') !== SECRETO) {
      return _json({ ok: false, error: 'Clave incorrecta.' });
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

  // Fotos embebidas en cada sección del informe
  (payload.tareas || []).forEach(function (t, i) { guardar(t.foto, 'tarea_' + (t.titulo || i)); });
  (payload.movimientos || []).forEach(function (m, i) { guardar(m.foto, 'movim_' + (m.concepto || i)); });
  (payload.materialesExistentes || []).forEach(function (m, i) { guardar(m.foto, 'material_' + (m.nombre || i)); });
  if (payload.checklist) guardar(payload.checklist.foto, 'checklist_' + (payload.checklist.titulo || ''));

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

    if (accion === 'ping') {
      // Chequeo de conexión: no expone nada si la clave está mal.
      if (String(p.secreto || '') !== SECRETO) {
        return _json({ ok: false, error: 'Clave incorrecta.' });
      }
      return _json({ ok: true, mensaje: 'Conectado', version: 1 });
    }

    if (String(p.secreto || '') !== SECRETO) {
      return _json({ ok: false, error: 'Clave incorrecta.' });
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

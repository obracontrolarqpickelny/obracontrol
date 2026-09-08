/**
 * ═══════════════════════════════════════════════════════════════════
 *  ObraGestión — respaldo en Drive (Google Apps Script)
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Mismo criterio que ObraControl: una carpeta por obra, navegable desde
 *  Drive, con los datos que usa la app más copias legibles para abrir a mano.
 *
 *  ObraGestion_Datos/
 *    └── Ampliacion Femenia Ruiz/
 *          ├── datos.json          ← lo que lee y escribe la app
 *          ├── info.json           ← ficha corta (nombre real, fecha, totales)
 *          ├── plan_de_obra.csv    ← ítems, cantidades, cuadrillas y fechas
 *          └── materiales.csv      ← recursos con precios
 *
 *  Las obras viejas quedaron como archivos sueltos "<obra>.json" en la raíz.
 *  Se siguen leyendo, y la primera vez que se guarda una de ellas se mueve
 *  sola a su carpeta. No hay que migrar nada a mano.
 * ═══════════════════════════════════════════════════════════════════
 */

var SECRETO = 'obragestion_drive_2024';
var CARPETA = 'ObraGestion_Datos';

// ─── CARPETAS ──────────────────────────────────────────────────────

/** Nombre usable como carpeta o archivo en Drive. Conserva acentos. */
function _limpio(n) {
  return String(n || 'sin_nombre').replace(/[\/\\:*?"<>|]/g, '_').trim() || 'sin_nombre';
}

/**
 * Saneado de la versión anterior, que reemplazaba TODO lo que no fuera
 * alfanumérico —acentos incluidos— por "_": "Ampliación" quedaba "Ampliaci_n".
 * Se conserva sólo para poder encontrar los archivos ya guardados con ese criterio.
 * Sin esto, al actualizar el script las obras existentes aparecerían vacías.
 */
function _limpioViejo(n) {
  return String(n || 'sin_nombre').replace(/[^a-zA-Z0-9\s\_-]/g, '_').trim() || 'sin_nombre';
}

/** Carpeta raíz del sistema, en la raíz de tu Drive. */
function _raiz() {
  var it = DriveApp.getFoldersByName(CARPETA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA);
}

/** ObraGestion_Datos/<obra>/ — se crea si no existe. */
function _carpetaObra(obraName) {
  var raiz = _raiz(), nom = _limpio(obraName);
  var it = raiz.getFoldersByName(nom);
  return it.hasNext() ? it.next() : raiz.createFolder(nom);
}

function _archivo(carpeta, nombre) {
  var it = carpeta.getFilesByName(nombre);
  return it.hasNext() ? it.next() : null;
}

/** Reemplaza el archivo si ya estaba, para no acumular versiones. */
function _escribir(carpeta, nombre, contenido, mime) {
  var viejo = _archivo(carpeta, nombre);
  if (viejo) viejo.setTrashed(true);
  return carpeta.createFile(Utilities.newBlob(contenido, mime || 'application/json', nombre));
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── COPIAS LEGIBLES ───────────────────────────────────────────────

function _csv(filas) {
  return filas.map(function (f) {
    return f.map(function (c) {
      c = (c === null || c === undefined) ? '' : String(c);
      return /[",;\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
    }).join(';');
  }).join('\n');
}

/** plan_de_obra.csv — un renglón por ítem, con su rubro y su cuadrilla. */
function _csvPlan(d) {
  var rubros = d.rubros || [], grupos = d.grupos || [];
  var filas = [['#', 'Grupo', 'Rubro', 'Ítem', 'Unidad', 'Cantidad',
                'Hs oficial/u', 'Hs ayudante/u', 'Oficiales', 'Ayudantes', 'Predecesoras', 'Obs']];
  (d.tareas || []).forEach(function (t) {
    var r = null, g = null;
    for (var i = 0; i < rubros.length; i++) if (rubros[i].id === t.rubroId) r = rubros[i];
    if (r) for (var j = 0; j < grupos.length; j++) if (grupos[j].id === r.grupo) g = grupos[j];
    filas.push([t.id, g ? g.nombre : '', r ? r.nombre : '', t.item, t.und, t.qty,
                t.hsOf, t.hsAy, t.nOf, t.nAy, t.pred || '', t.obs || '']);
  });
  return _csv(filas);
}

/** materiales.csv — recursos por ítem, con precio e incremento. */
function _csvMateriales(d) {
  var filas = [['Ítem', 'Material', 'Unidad', 'Cantidad', 'Precio unitario', 'Total', '% incremento']];
  (d.rec || []).forEach(function (r) {
    var q = +r.qty || 0, pu = +r.pu || 0;
    var incr = (r.incr === undefined || r.incr === null || r.incr === '') ? '' : r.incr;
    filas.push([r.item, r.rec, r.und, q, pu, q * pu, incr]);
  });
  return _csv(filas);
}

/** Ficha corta. La lista de obras la lee de acá y no del JSON completo. */
function _info(d) {
  return {
    proyecto: d.proyecto || '',
    actualizado: new Date().toISOString(),
    items: (d.tareas || []).length,
    materiales: (d.rec || []).length,
    inicio: (d.cfg && d.cfg.fechaInicio) || ''
  };
}

// ─── GUARDAR ───────────────────────────────────────────────────────

function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (err) {
    return _json({ ok: false, error: 'Servidor ocupado.' });
  }
  try {
    var body = JSON.parse(e.postData.contents);
    if (String(body.secreto || '') !== SECRETO)
      return _json({ ok: false, error: 'Clave incorrecta.' });

    var d = body.data || {};
    var obraName = String(body.obraName || d.proyecto || 'sin_nombre');
    var carpeta = _carpetaObra(obraName);

    _escribir(carpeta, 'datos.json', JSON.stringify(d));
    _escribir(carpeta, 'info.json', JSON.stringify(_info(d)));
    // Si algo falla al armar los CSV, el respaldo real ya quedó guardado arriba
    try {
      _escribir(carpeta, 'plan_de_obra.csv', _csvPlan(d), 'text/csv');
      _escribir(carpeta, 'materiales.csv', _csvMateriales(d), 'text/csv');
    } catch (err) { console.error('csv: ' + err); }

    /* Migración: el archivo suelto de la versión anterior ya está representado por
       la carpeta, así que se descarta. Se prueban los dos criterios de nombre
       porque el saneado cambió (antes "Ampliaci_n", ahora "Ampliación"). */
    var raiz = _raiz();
    [_limpio(obraName), _limpioViejo(obraName)].forEach(function (n) {
      var suelto = _archivo(raiz, n + '.json');
      if (suelto) suelto.setTrashed(true);
    });

    return _json({ ok: true, guardado: carpeta.getName(), fecha: new Date().toISOString() });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ─── LEER ──────────────────────────────────────────────────────────

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var accion = p.action || 'ping';
    if (String(p.secreto || '') !== SECRETO)
      return _json({ ok: false, error: 'Clave incorrecta.' });

    if (accion === 'ping')
      return _json({ ok: true, mensaje: 'ObraGestion Drive API activa', version: 2 });

    if (accion === 'load') {
      var raiz = _raiz();
      // Se prueban los dos criterios de nombre: el actual y el de la versión anterior
      var nombres = [_limpio(p.obra), _limpioViejo(p.obra)];
      // 1) Carpeta nueva
      for (var i = 0; i < nombres.length; i++) {
        var it = raiz.getFoldersByName(nombres[i]);
        if (it.hasNext()) {
          var f = _archivo(it.next(), 'datos.json');
          if (f) return _json({ ok: true, data: JSON.parse(f.getBlob().getDataAsString()) });
        }
      }
      // 2) Archivo suelto de antes
      for (var j = 0; j < nombres.length; j++) {
        var viejo = _archivo(raiz, nombres[j] + '.json');
        if (viejo) return _json({ ok: true, data: JSON.parse(viejo.getBlob().getDataAsString()) });
      }
      return _json({ ok: false, error: 'Obra no encontrada.' });
    }

    if (accion === 'list') {
      var raiz2 = _raiz(), obras = [], vistos = {};
      // Carpetas: se devuelve el nombre REAL del proyecto, que está en info.json.
      // Así la app no muestra "Galp_n Corradi" sino "Galpón Corradi".
      var carpetas = raiz2.getFolders();
      while (carpetas.hasNext()) {
        var c = carpetas.next(), nombre = c.getName();
        try {
          var inf = _archivo(c, 'info.json');
          if (inf) {
            var i = JSON.parse(inf.getBlob().getDataAsString());
            if (i && i.proyecto) nombre = i.proyecto;
          }
        } catch (err) {}
        if (!vistos[nombre]) { vistos[nombre] = 1; obras.push(nombre); }
      }
      // Archivos sueltos que todavía no se volvieron a guardar
      var arch = raiz2.getFilesByType('application/json');
      while (arch.hasNext()) {
        var n = arch.next().getName().replace(/\.json$/i, '');
        if (!vistos[n]) { vistos[n] = 1; obras.push(n); }
      }
      return _json({ ok: true, obras: obras });
    }

    return _json({ ok: false, error: 'Acción desconocida: ' + accion });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

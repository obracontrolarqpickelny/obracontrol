const DB_NOMBRE = 'oc_compartidas';

function abrirDB() {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB_NOMBRE, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('cola', { keyPath: 'id' });
      r.result.createObjectStore('meta');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}

async function recibirCompartido(request) {
  const base = new URL('./', self.location.href).href;
  try {
    const datos = await request.formData();
    const archivos = datos.getAll('archivos').filter((f) => f && f.size);
    if (!archivos.length) return Response.redirect(base + '?compartido=vacio', 303);
    const lote = Date.now().toString(36);
    const db = await abrirDB();
    await new Promise((ok, no) => {
      const tx = db.transaction('cola', 'readwrite');
      archivos.forEach((f, i) => {
        tx.objectStore('cola').put({
          id: lote + '_' + i,
          lote,
          orden: i,
          archivo: f,
          nombre: f.name || '',
          tipo: f.type || '',
          tam: f.size,
          recibido: Date.now(),
          pid: null,
          fecha: null,
          hora: null,
        });
      });
      tx.oncomplete = ok;
      tx.onerror = () => no(tx.error);
      tx.onabort = () => no(tx.error);
    });
    db.close();
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    ventanas.forEach((c) => c.postMessage({ tipo: 'oc-compartido', lote }));
    return Response.redirect(base + '?compartido=' + lote, 303);
  } catch (e) {
    return Response.redirect(base + '?compartido=error', 303);
  }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (!url.pathname.endsWith('/compartir')) return;
  if (e.request.method === 'POST') e.respondWith(recibirCompartido(e.request));
  else e.respondWith(Response.redirect(new URL('./', self.location.href).href, 303));
});

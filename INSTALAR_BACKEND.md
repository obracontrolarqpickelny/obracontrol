# Instalar el servidor de informes

Con esto los informes y las fotos te llegan solos, sin depender de WhatsApp.
Todo se guarda en **tu** Google Drive. Es gratis y se hace una sola vez.

Tiempo estimado: 10 minutos.

---

## Paso 1 — Crear el proyecto

1. Entrá a **https://script.google.com** con la misma cuenta de Google donde querés que se guarden los informes.
2. Tocá **Nuevo proyecto**.
3. Borrá todo el código que aparece (el `function myFunction() {}`).
4. Abrí el archivo `apps_script.gs` de esta carpeta, copiá **todo** su contenido y pegalo ahí.
5. Arriba a la izquierda, ponele un nombre al proyecto: `ObraControl Servidor`.

## Paso 2 — Poner tu clave secreta

En la línea 20 del código vas a ver:

```javascript
var SECRETO = 'CAMBIAME-por-una-clave-larga-y-unica-1234';
```

Cambiá ese texto por una clave tuya. Que sea larga y difícil de adivinar, por ejemplo:

```javascript
var SECRETO = 'obra-pickelny-7f3k9x2m-clave-2026';
```

**Anotala**, la vas a necesitar en el paso 5.

Guardá con el ícono del disquete (o `Ctrl+S`).

## Paso 3 — Publicar

1. Arriba a la derecha, botón azul **Implementar** → **Nueva implementación**.
2. Al lado de "Seleccionar tipo" tocá el engranaje ⚙️ y elegí **Aplicación web**.
3. Completá así:
   - **Descripción**: `v1`
   - **Ejecutar como**: **Yo** (tu email) ← importante
   - **Quién tiene acceso**: **Cualquier persona** ← importante
4. Tocá **Implementar**.

> ⚠️ "Cualquier persona" suena riesgoso pero no lo es: sin la clave secreta el servidor rechaza todo. Es necesario porque los colaboradores no tienen cuenta de Google en la app.

## Paso 4 — Autorizar

La primera vez Google te va a pedir permiso:

1. **Autorizar acceso** → elegí tu cuenta.
2. Va a aparecer una pantalla que dice *"Google no verificó esta aplicación"*. Es normal: la app la hiciste vos.
3. Tocá **Configuración avanzada** (abajo a la izquierda).
4. Tocá **Ir a ObraControl Servidor (no seguro)**.
5. **Permitir**.

Al terminar te muestra una **URL de la aplicación web** parecida a:

```
https://script.google.com/macros/s/AKfycbx...largo.../exec
```

**Copiala.** Tiene que terminar en `/exec`.

## Paso 5 — Cargarla en la app

1. Abrí ObraControl → **Configuración**.
2. Buscá el recuadro verde **🚀 Servidor propio**.
3. Pegá la **URL** en el primer campo.
4. Escribí la **clave secreta** del paso 2 en el segundo campo.
5. Tocá **🔌 Probar conexión**. Tiene que decir *"✓ Servidor conectado correctamente"*.

Si dice error, revisá que la URL termine en `/exec` y que el acceso sea "Cualquier persona".

## Paso 6 — Reenviar los links a los colaboradores

Los links viejos no tienen los datos del servidor. Entrá a **Colaboradores** y volvé a compartirle el link a cada uno (botón de compartir 📤). El link nuevo ya viaja con todo lo necesario.

**Listo.** A partir de ahora, cuando un colaborador toca "Enviar todo":

- El informe y las fotos van directo a tu Drive.
- Te aparecen en la Bandeja cuando abrís la app (se revisa sola cada 3 minutos, y también podés tocar 📥 Buscar informes).
- WhatsApp queda como un botón opcional de aviso, no como requisito.

---

## Cómo queda organizado tu Drive

```
ObraControl_Datos/
├── _BANDEJA/                    ← informes que la app todavía no incorporó
└── casa Pickelny Garcia/        ← una carpeta por obra
    └── Juan/                    ← una por colaborador
        ├── 2026-07-25_1430_tarea_Revisar revoque.jpg
        ├── 2026-07-25_1430_movim_Compra cemento.jpg
        └── 2026-07-25_1430_informe_abc123.json
```

Las fotos quedan como imágenes de verdad, navegables desde Drive. Cuando incorporás un informe en la app, sale de `_BANDEJA` pero la copia de la obra queda para siempre.

---

## Preguntas

**¿Cuesta algo?** No. Apps Script es gratis. El límite diario es muchísimo más alto de lo que una obra genera.

**¿Y si el colaborador no tiene internet en el momento?** El envío falla y la app le avisa; el informe le queda guardado en su pestaña Historial para reenviarlo cuando tenga señal. También se abre WhatsApp como respaldo automático.

**¿Puedo seguir usando WhatsApp?** Sí. Después de enviar aparece un botón "Avisarle por WhatsApp (opcional)". Ya no es obligatorio.

**¿Y si cambio la clave secreta?** Tenés que cambiarla en los dos lados: en el script (y volver a implementar) y en Configuración. Y reenviar los links a los colaboradores.

**Si edito el script después, ¿tengo que hacer algo?** Sí: **Implementar → Administrar implementaciones → ✏️ editar → Versión: Nueva versión → Implementar**. Si creás una implementación nueva desde cero te da otra URL distinta.

# ObraGestión v4 — guía para trabajar en este repo

`obragestion_proasistente.html` es ObraGestión v4: una app de una sola página
(React + Babel in-browser, **sin build**) que vive en la raíz de este repo.

Se publica por GitHub Pages, así que **un `git push` a `main` alcanza para desplegar**.

Trabajamos en **español rioplatense**.

## Cómo editar

Editá siempre el archivo **en el lugar**. No generes copias con sufijos de versión
(`_v2`, `_final`, `_nuevo`): el historial de git es el control de versiones.

---

## Invariantes que hay que respetar

### 1. El marcador `__SNAP__`

```js
const __SNAP__=/* @SNAP */null/* /@SNAP */;
```

Es lo que permite "Guardar HTML" con los datos de la obra embebidos: al guardar,
el `null` se reemplaza por el JSON de la obra; al importar un HTML guardado, se
extrae de ahí.

**No toques el marcador ni cambies su formato.** Hay tres lugares que dependen del
texto exacto `/* @SNAP */ … /* /@SNAP */`: la declaración, la regex del importador
y la regex del generador de HTML. Si cambia el formato, "Guardar HTML" tira
`Marcador @SNAP no encontrado en el script.` y los HTML ya guardados dejan de
poder importarse.

### 2. Modelo de datos: grupos → rubros → tareas

- Las tareas se **renumeran 1..N por orden del array** (`renumberTareas`).
- Las predecesoras (`pred`) son esos números, como string separado por comas
  (`"1,3"`), no ids estables.
- Los materiales de `rec` se vinculan a la tarea **por nombre de ítem** (`r.item`),
  no por id. Si renombrás un ítem, hay que actualizar los `rec` que lo referencian.
- `moItems` y `matIncr` están **indexados por id de tarea**, así que al agregar,
  borrar o reordenar tareas tienen que remapearse junto con ellas.

⚠️ **Ojo:** `renumberTareas(arr, moItems)` remapea únicamente `moItems`; devuelve
`{tareas, moItems}`. **`matIncr` no lo remapea nadie** — ninguno de los ocho
llamadores lo hace. Si agregás lógica que renumere tareas, remapeá `matIncr` a
mano con el mismo criterio, o los porcentajes de incremento quedan pegados al ítem
equivocado.

### 3. Estado que persiste: hay que agregarlo en los cuatro lados

El sync a Drive manda el objeto entero de la obra. Si sumás estado nuevo que deba
persistir, agregalo en **todos** estos lugares o se pierde en algún camino:

| # | Dónde | Qué es |
|---|---|---|
| 1 | `const data={...}` del `useEffect` de auto-save | guardado local + Drive |
| 2 | `const data={...}` de `exportarJSON` | exportar JSON |
| 3 | Restore del `.then(d=>{...})` de `_driveLoad` | carga inicial con `?obra=X` |
| 4 | Restore del importador (`JSON.parse(raw)`) | importar `.json` y `.html` |

Claves que hoy se persisten:

```js
{tareas, rec, grupos, rubros, cfg, proyecto, cuadGrupos, cuadRubros,
 moItems, matIncr, prof, imprevistos, notaPDF, aiChat}
```

`aiChat` se recorta a los últimos 40 mensajes (`.slice(-40)`) para no inflar el JSON.

Nota: el restore del importador **no** restaura `notaPDF`, aunque el de Drive sí.
Si tocás esa zona, conviene emparejarlos.

### 4. `AsistenteChat`: `rec` y `grab` son cosas distintas

Dentro de `AsistenteChat`:

- **`rec`** = el array de materiales que llega por props (el mismo `rec` global).
- **`grab`** = el estado booleano de grabación por voz (`const [grab,setGrab]`).

No los mezcles. En particular, no uses `rec` para nada de grabación aunque el
nombre sugiera "recording".

---

## Antes de commitear

**Verificá que el JSX compila.** No hay build: un error de sintaxis rompe la app
entera y queda la pantalla en blanco, sin ningún mensaje al usuario.

Una forma rápida es transformar el bloque `<script type="text/babel">` con el
propio Babel que ya carga la página:

```js
// en la consola del navegador, con la página abierta
const src = document.querySelector('script[type="text/babel"]').textContent;
try { Babel.transform(src, {presets:['react']}); console.log('OK'); }
catch (e) { console.error(e.message); }
```

Si además tocaste cálculos, conviene abrir la app y mirar el resultado real, no
sólo que compile.

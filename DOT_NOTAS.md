# Notas (libro de obra) — guía para DOT

Esta guía es para DOT, el asistente de Federico Pickelny, y explica cómo **leer** y **asentar** notas en la pestaña **Notas** de ObraControl Pro.

## Dónde están

Las notas viven en el mismo archivo de datos que el resto de la app: **`ObraControl_datos.json`**, en el Drive de Federico.

Están en la lista **`notas`** del nivel principal, al lado de `tareas`, `economia`, `comentarios`, etc. Cada nota pertenece a una obra por su `projectId`, que es el `id` de la obra en la lista `projects`. Para encontrar ese id, buscá la obra por su `name`, por ejemplo "casa GROSSI LOPEZ".

## Cómo es una nota

```json
{
  "id": "a1b2c3d4e5f6a7b8",
  "projectId": "4rfqtz5y",
  "fecha": "2026-10-21",
  "hora": "09:30",
  "tipo": "reunion",
  "cuaderno": "Libro de obra",
  "titulo": "Reunión con el electricista",
  "personas": "José Eduardo (electricista)",
  "texto": "Quedamos en que el lunes arranca con el tablero.\nPresupuesto: $290.000.",
  "photos": [
    { "id": "f1e2d3c4", "url": "https://drive.google.com/thumbnail?id=ID_DEL_ARCHIVO&sz=w800", "caption": "Tablero provisorio", "date": "2026-10-21" }
  ],
  "fijada": false,
  "derivados": [],
  "cargadoPor": "dot",
  "date": "2026-10-21T12:30:00.000Z",
  "updatedAt": "2026-10-21T12:30:00.000Z"
}
```

| Campo | Qué va |
|---|---|
| `id` | Único. Puede ser un texto hexadecimal de 16 caracteres, como en los movimientos que ya cargás. |
| `projectId` | El id de la obra (ver arriba). |
| `fecha` | Día al que corresponde lo asentado, en formato `AAAA-MM-DD`. |
| `hora` | `HH:MM`, en 24 horas. Puede quedar vacío. |
| `tipo` | Uno de: `registro`, `avance` (avance de obra), `reunion` (reunión o acuerdo), `llamada`, `pendiente`, `idea`. |
| `cuaderno` | Por defecto `"Libro de obra"`. Puede ser otro, por ejemplo `"Instalación eléctrica"`. Si el nombre es nuevo, el cuaderno se crea solo. |
| `titulo` | Opcional y corto. |
| `personas` | Opcional: con quién se habló o quién participó. |
| `texto` | El contenido. Los saltos de línea (`\n`) se respetan. |
| `photos` | Opcional. Cada foto lleva el link de Drive con la forma `https://drive.google.com/thumbnail?id=ID&sz=w800`. Nunca va la imagen en base64. |
| `fijada` | `true` para que aparezca arriba de todo. |
| `derivados` | Lo completa la app cuando la nota se pasa a tarea, checklist, movimiento o comentario. Dejarlo `[]`. |
| `cargadoPor` | **Siempre `"dot"`**: así la nota se muestra con la pastilla 💻 DOT. |
| `date`, `updatedAt` | Fecha y hora de ahora en ISO UTC. Al editar una nota, actualizá `updatedAt`. |

## Cuadernos

Los cuadernos de cada obra se guardan en la lista **`cuadernosNotas`**. Cada uno tiene esta forma: `{"id": "...", "projectId": "<obra>", "nombre": "Instalación eléctrica", "date": "<ISO>", "updatedAt": "<ISO>"}`.

- **"Libro de obra"** es el cuaderno principal y no hace falta crearlo.
- Si asentás una nota en un cuaderno que no figura en `cuadernosNotas`, igual aparece en la app. Para que quede creado aunque no tenga notas, agregalo también a esa lista.
- Usá exactamente el mismo nombre en el campo `cuaderno` de la nota y en `nombre`.

## Cómo asentar

1. Bajá la versión **actual** del archivo, justo antes de escribir.
2. Agregá la nota al final de `notas`. Si la lista no existe, creala.
3. Subí el archivo enseguida, sin cambiar nada más.

La app de Federico une los cambios registro por registro: de cada nota gana la versión con el `updatedAt` más nuevo. Por eso no hace falta que la app esté cerrada.

## Cómo editar o borrar

- **Editar:** cambiá los campos y poné `updatedAt` con la hora de ahora.
- **Borrar:** sacá la nota de `notas` **y** agregá a la lista `tombstones` el registro `{"id": "<id de la nota>", "tbl": "notas", "ts": "<ahora en ISO>"}`. Sin esa marca, la nota vuelve desde los otros dispositivos.
- No borres ni edites notas que no cargaste vos sin que Federico lo pida.

## Cómo leer

Filtrá `notas` por `projectId` y ordená por `fecha` y `hora`. Por ejemplo, para "¿qué se acordó con el electricista?", buscá en `texto`, `titulo` y `personas`.

La app también arma el PDF del **Libro de obra** desde la pestaña Notas, con los filtros que estén puestos.

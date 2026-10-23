# Gepetta Studio — Arquitectura

Estudio de animación cuadro a cuadro (stop-motion + dibujo), pensado para el taller
de animación para chicos y adolescentes: **amigable pero poderoso**. La UI está en
español; el código en inglés.

## Principios

1. **Una sola app web.** Todo el editor es una app React + TypeScript que corre en
   cualquier Chromium. Electron la empaqueta para Mac y Windows y le agrega lo
   nativo (sistema de archivos, cámaras réflex, escáner, ffmpeg). La versión online
   futura es la misma app con el hardware degradado a lo que permite el navegador.
2. **Las imágenes nunca se modifican.** Toda foto/imagen importada se guarda como
   *asset* inmutable identificado por su hash (SHA-256). Las ediciones son
   operaciones que referencian assets, nunca píxeles sueltos.
3. **El documento es su historial.** El estado de una película se obtiene
   reproduciendo una lista de operaciones (*event sourcing*). Esto habilita el
   historial tipo Fusion 360: desactivar, borrar o **editar parámetros** de
   cualquier paso pasado y recalcular todo lo posterior.
4. **Progresivo.** La UI muestra lo esencial; lo avanzado (ajustes finos de cámara,
   promediado de fotos, historial paramétrico) está a un clic, no en la cara.

## Estructura del repo

```
packages/core     Modelo de dominio puro TS (sin DOM): película, cuadros, capas,
                  operaciones, historial/replay, timing, geometría.
apps/studio       App React (Vite). Corre sola en el navegador (`pnpm dev:web`)
                  o dentro de Electron.
apps/desktop      Electron: proceso main + preload. Expone `window.gepetta`
                  (archivos, diálogos; luego cámaras nativas, ffmpeg).
apps/phone        (futuro) PWA cámara-remota para celulares vía QR + WebRTC.
docs/             Este documento, roadmap y decisiones.
```

## Modelo de datos (packages/core)

- **El tiempo es una grilla fija**: la celda n se ve de n/fps a (n+1)/fps. No se
  "insertan momentos"; la grilla se alarga (`film.setLength`) o crece sola al poner
  imágenes más allá del final.
- **Película** (`FilmState`): nombre, fps (12 por defecto, por película),
  resolución, `length` (celdas), `tracks` y `clips`.
- **Track** (`Track`): una fila de celdas. La película es la combinación de los
  tracks de abajo hacia arriba, cada uno con visibilidad, opacidad, transformación y
  "sale en la exportación" (los de referencia, como un video para rotoscopia, se ven
  al animar pero no se exportan). Siempre existe el de **Fotos**.
- **Clip** (`Clip`): una imagen puesta en un track desde la celda `start`, que dura
  `length` celdas, con visibilidad, opacidad y transformación propias (más adelante
  afines/homografía/TPS de `CasitaDesign/src/lib/calibration.ts`). En un track los
  clips no se superponen: **poner o mover una imagen pisa lo que haya** (recorta,
  parte o quita), y la parte cortada recibe un id derivado del corte para que el
  replay dé siempre lo mismo.
- **Herramientas**: cada cámara (y después pincel, sello, etc.) "pinta" en su
  celda destino (`track` + `cell`); la foto dura `captureStep` celdas ("en unos",
  "en dos"…) y el destino avanza. Puede haber **varias cámaras abiertas a la vez**
  (`Rig` en `state/camera.ts`), cada una con su destino; la "elegida" maneja los
  paneles. El destino **no es el cursor**: se elige a propósito tocando la cámara
  (modo `picking`, la línea de tiempo solo elige esa celda hasta que se toca una o
  Esc); el cursor la acompaña al avanzar solo si estaba mirándola. El botón grande
  (y la barra espaciadora) saca con todas las cámaras **habilitadas** a la vez
  (`captureAll`). La pantalla grande muestra siempre el
  resultado de la celda del cursor: cada cámara que apunta ahí se dibuja en vivo en
  su track, con la transparencia y posición del track (no hay modo "cámara" aparte).
  Cada cámara también graba video: una imagen por celda a la velocidad de la
  película, desde su vista en vivo, que se pone de una vez al detenerla.
- `stackAt(film, cell)` arma lo que se ve en una celda; en vivo, la cámara ocupa el
  lugar del track del cursor (`splitAtTrack`). El papel de cebolla muestra las
  imágenes anteriores de ese track. La línea de tiempo muestra la regla, el
  resultado combinado y una fila por track; se seleccionan varias imágenes (clic con
  ⇧/⌘ o rectángulo) y se arrastran entre celdas y tracks. Tocar el resultado
  selecciona **columnas** (las celdas de todos los tracks ahí): se arrastran enteras
  (`cells.move` corta las imágenes que salen de la columna) o se vacían
  (`cells.clear`); ahí se aplicarán los efectos generales.
- **Películas de antes de la grilla** (cuadros en fila con `hold`): al abrirlas se
  reproduce su historial viejo (`legacy/`), se convierte a clips y queda como `base`
  del historial nuevo; el historial viejo se guarda intacto en el archivo (`legacy`).
- **MediaRef**: `{ original, proxy, thumb, width, height }`. Cada importación
  genera un proxy (≤1920 px) para edición/reproducción fluida y una miniatura.
  La exportación usa el original.

### Operaciones e historial

Cada cambio es una `Op` serializable (`clip.place`, `clip.move`, `clip.update`,
`clip.remove`, `track.*`, `film.*`). Las operaciones referencian imágenes y tracks
**por id**, así siguen siendo válidas si se quita un paso anterior.

`History = { entries: HistoryEntry[], cursor }`. El estado es
`replay(entries[0..cursor] habilitadas)`.

- **Deshacer/Rehacer** = mover el cursor (como la barra de tiempo de Fusion).
- **Nueva operación con cursor atrás** = se inserta en el cursor (no se pierde
  el futuro: queda después, como en Fusion).
- **Deshacer selectivo** = desactivar o borrar una entrada.
- **Paramétrico** = editar los parámetros de una entrada y recalcular.
- Una operación que ya no aplica (p. ej. su imagen fue borrada) queda
  marcada con error en el historial y se saltea — igual que los pasos en rojo de
  Fusion.

Como las operaciones no contienen píxeles, recalcular miles de pasos es barato.
Las imágenes nunca se modifican: cada imagen (`Clip`) lleva encima lo que se le
hace, y todo se puede cambiar después.

- **Ajustes (`look`)**: recorte, ajuste "entera/llenar", espejo, modo de mezcla y
  efectos de color, además de `transform` y `opacity`. `drawStack` y
  `pictureMatrix` (render/frame.ts) los aplican igual en la pantalla, las
  miniaturas, la exportación, las manijas y el pincel.
- **Trazos (`strokes`)**: las herramientas de `state/paint.ts` (pinceles, borrar,
  teñir, formas, rellenar, sello de clonar) guardan cada trazo como un `Stroke`
  (puntos con ancho y presión en píxeles de la imagen, color, fuerza…) con
  `stroke.add`; se eligen (clic con «Mover», o en la lista del detalle), se
  cambian (`stroke.update`), se ocultan o se borran (`stroke.remove`). El relleno
  y el sello guardan además sus píxeles como asset (`layer`), porque dependen de
  lo que había debajo. `render/strokes.ts` dibuja un trazo igual mientras se pinta
  y al rearmar la imagen; `media/composed.ts` guarda las imágenes ya compuestas
  (con sus trazos) en tamaño proxy y miniatura; al exportar se componen en
  tamaño original. Un dibujo en una celda vacía es una imagen transparente del
  tamaño de la película con sus trazos.
- **Cámaras como herramientas**: cada cámara tiene sus ajustes de toma (`Shot`:
  posición, tamaño, giro, transparencia y `look`), que se ven en vivo y se copian
  a cada foto o cuadro grabado; se recuerdan por cámara.

Las imágenes hechas juntas forman una **secuencia** (`Clip.seq`): un video
grabado o importado, las fotos que una cámara saca seguidas (hasta que se le
elige otra celda), imágenes importadas juntas, copias. Su panel cambia todas a
la vez (`relayOps`, `interpolateOps` en core; las manijas mueven toda la
secuencia con `sequenceMoved`).

Una película puede ser un **loop** (`settings.loop`, op `film.setLoop`): después
de la última celda viene la primera. La reproducción no termina, el papel de
cebolla de las primeras celdas muestra las últimas (`previousClips`, `wrapCell`)
y la línea de tiempo es un tambor: muestra la película una sola vez, girada
(`rot`: la celda que se ve primero); desplazarse de costado o arrastrar la regla
la gira, y al reproducir gira bajo la línea, que queda en el medio. Arrastrar la
marca ↻ (donde vuelve a empezar) cambia el largo del loop (`setLoopLength`: al
acortar se corta lo que queda afuera).

## Almacenamiento

Interfaz `StorageBackend` con dos implementaciones:

- **Escritorio (Electron):** cada película es una carpeta
  `~/Documents/Gepetta Studio/<nombre>.gepetta/` con `film.json` (historial) y
  `assets/<hash>.<ext>`. Fácil de respaldar, copiar y abrir a mano.
- **Navegador:** IndexedDB con la misma forma (para desarrollo y para la versión
  online, que luego sumará sincronización con la nube y colaboración — el modelo
  de operaciones es la base natural para eso).

## Captura

Toda cámara es una `CameraSource` (`apps/studio/src/capture/types.ts`): vista en
vivo, ajustes (`CameraControl` de `packages/protocol`, igual para todas) y
`capture()`. El editor no sabe de qué tipo de cámara se trata.

| Fuente | Cómo | Dónde |
|---|---|---|
| Webcams | `getUserMedia` + `getCapabilities()` (foco, balance de blancos, exposición, zoom… lo que exponga el driver). Opción de promediar N cuadros | `capture/webcam.ts` |
| Celulares | Servidor LAN en Electron + página web del celular (`apps/phone`) | `capture/phone.ts`, `apps/desktop/src/remote/` |
| Réflex / mirrorless | gphoto2 en el proceso main (Mac; Windows con gphoto2 de MSYS2 + driver WinUSB vía Zadig). Driver intercambiable: el SDK de Canon (EDSDK) se suma como otro `DslrDriver` | `capture/dslr.ts`, `apps/desktop/src/dslr/` |
| Escáner | ImageCaptureCore (Mac) / WIA-TWAIN (Windows) | más adelante |

### Celular

El escritorio levanta, solo cuando se pide ("Conectar celular"), un servidor en la
red local con dos puertos:

- **HTTP :8790** — la página a la que apunta el QR. Ofrece el modo **Foto simple**
  (usa la app de cámara del teléfono con todos sus controles manuales; funciona sin
  configurar nada) y ayuda para el modo en vivo. Sirve también `/ca.crt`.
- **HTTPS :8791** — modo **En vivo**: el navegador solo da acceso a la cámara en
  páginas seguras, así que el escritorio crea una autoridad certificante local
  ("Gepetta Studio Local CA", guardada en la carpeta de datos de la app) y emite un
  certificado para sus IPs de la red. En Android alcanza con "Avanzado → Continuar";
  en iPhone hay que instalar el certificado una vez.

Todas las conexiones llevan el token del QR. Los mensajes van por WebSocket en
binario (`packages/protocol/src/remote.ts`): cabecera JSON + JPEG sin base64.
El celular manda vista previa (640 px, ~10 cps, con control de congestión),
ajustes y fotos en resolución completa (`ImageCapture.takePhoto` en Android); el
escritorio pide fotos, cambia ajustes y manda el cuadro anterior para el papel de
cebolla en la pantalla del celular. Una app nativa futura habla el mismo protocolo.

### Réflex (gphoto2)

Una sola cosa por vez: la vista en vivo (`--capture-movie`, MJPEG por stdout) se
pausa para disparar o cambiar ajustes y se retoma sola. El disparo baja JPEG y
RAW; el RAW se guarda intacto junto a la foto (`MediaRef.raw`) y, si la cámara
solo hace RAW, se usa la vista previa JPEG que trae adentro. En Mac el sistema
puede tomar la cámara por USB: el botón "Liberar cámara" lo resuelve.

### Foco, lupa y datos de cada toma (réflex)

- **Foco:** el motor del lente se mueve en pasos finos (`manualfocusdrive=Near 2/Far 2`).
  El driver cuenta la posición desde "∞ Cero" (llevar el lente al tope de infinito),
  pero **la cuenta es aproximada**. Medido en la 500D con EF-S 18-55:
  - la cámara descarta comandos que llegan con el motor en marcha (90 pasos sin pausa ≈ 6);
  - el avance de cada paso depende del ritmo (80 pasos a 80, 120 o 200 ms terminan en
    lugares distintos) y un paso "lejos" ≈ 1,5 pasos "cerca";
  - la misma secuencia exacta sí se repite.
  Por eso los pasos van con ritmo fijo (60 ms) y el cero con 250 ms entre comandos.
  El autofoco por contraste propio (`autofocus.ts`) existe pero no se usa hasta tener
  un posicionamiento confiable; "Enfocar" usa el autofoco de la cámara.
- **Distancias:** la cámara no informa la distancia en vivo, pero cada JPEG trae la
  distancia de foco (Canon FileInfo, cerca–lejos en cm). Las fotos de la película
  tomadas con posición conocida se convierten en referencias del deslizador; entre
  ellas se interpola en dioptrías.
- **Lupa:** `eoszoom` 5×/10× y `eoszoomposition` (solo funciona con la lupa ya activa;
  la cámara no informa ni el nivel ni la posición, así que el driver los recuerda).
  El autofoco de Live mode enfoca dentro de ese recuadro: "tocar para enfocar" lo
  mueve al punto y dispara el autofoco.
- **Datos de la toma:** `MediaRef.capture` guarda EXIF (`packages/core/src/exif.ts`:
  cámara, lente, focal, diafragma, velocidad, ISO, balance de blancos, distancia de
  foco, fecha) más lo que sabe la app (fuente, posición de foco y su origen).

## Reproducción y exportación

- **Versiones publicadas** (`Release`, en el archivo de la película): al exportar se
  puede publicar una versión (número sugerido nueva/revisión, título, notas). Guarda
  la fecha, el paso del historial, las opciones de exportación, el archivo (y en
  escritorio su ruta, para avisar si ya no está y mostrarlo) y una **foto de la
  película** (`FilmState` como asset JSON) para volver a exportarla aunque después
  cambie. Los assets nunca se borran, así que las imágenes siguen disponibles.

- Reproductor por celdas; reproducir todo, los últimos N segundos o en loop.
- Exportar el resultado, un track solo, o cada track por separado.
- Exportación de video con WebCodecs (librería `mediabunny`): MP4 (H.264), WebM
  (VP9). Luego ffmpeg (Electron) para ProRes, GIF, secuencias PNG, etc.
- **Juguetes ópticos** (botón «Juguetes»): flipbook, zootropo y fenakitoscopio.
  La geometría, en mm sobre la hoja, es pura y con tests (`packages/core/src/toys.ts`:
  imposición del flipbook, tira de π·d en pedazos con pestañas, ranuras y base del
  zootropo, dibujos en el anillo y contorno con ranuras del disco, escritores de SVG
  y DXF). `apps/studio/src/export/toys.ts` dibuja cada hoja con un «Painter» en mm
  que escribe PDF (jsPDF, tamaño real, A4/Carta) o SVG; los cuadros salen de
  `export/frames.ts` (`renderCells`, el mismo dibujo que el video). Cada hoja trae
  instrucciones y una raya de 5 cm para comprobar que se imprimió al 100 %.
  Pendiente: STL del disco (lo tiene `~/Repos/amariskoper`).

## Reutilización de proyectos existentes

| Origen | Qué | Destino |
|---|---|---|
| `CasitaDesign/src/lib/calibration.ts` | similitud, afín, homografía, TPS por puntos de control | `core/geometry` (alineación de capas) |
| `CasitaDesign/src/components/vectorize/DeformedCanvas.tsx` | warp por malla de triángulos en Canvas2D | renderer de capas deformadas |
| `amariskoper/js/{geom,disc,animate}.mjs`, `js/export/*` | disco, ranuras, curvas, SVG/DXF/STL | `core/devices/phenakistoscope` |
| `zootropo/make_strips.py` | tiras de zootropo A4 300 DPI | `core/devices/zoetrope` |

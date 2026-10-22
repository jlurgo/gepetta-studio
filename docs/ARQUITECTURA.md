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

- **Película** (`FilmState`): nombre, fps (12 por defecto, configurable por
  película), resolución, lista ordenada de cuadros.
- **Cuadro** (`Frame`): id estable, `hold` (cuántos tiempos dura: 1 = "en unos",
  2 = "en dos"…) y capas.
- **Capa** (`Layer`): por ahora capa de imagen (referencia a `MediaRef`), con
  visibilidad, opacidad y transformación (traslación, rotación, escala; más adelante
  matrices afines/homografía/TPS portadas de `CasitaDesign/src/lib/calibration.ts`).
- **Tracks** (`Track`): la película es la combinación de sus tracks, de abajo hacia
  arriba, cada uno con visibilidad, opacidad, transformación y "sale en la
  exportación". Un track tiene una celda por cuadro (`cells`: el de **Fotos**, capas
  de dibujo o recortes), una imagen fija, o una secuencia (cuadros de video con su
  fps) que avanza con el tiempo de la película, retenciones incluidas; estos dos
  abarcan un tramo `from`/`to` por id de cuadro. Las celdas son las `layers` de cada
  cuadro, con su `track`. `frameStack(film, frame, tick)` arma lo que se dibuja; en
  vivo la cámara ocupa el lugar del track de fotos. La línea de tiempo muestra el
  resultado arriba y un renglón por track debajo.
- **MediaRef**: `{ original, proxy, thumb, width, height }`. Cada importación
  genera un proxy (≤1920 px) para edición/reproducción fluida y una miniatura.
  La exportación usa el original.

### Operaciones e historial

Cada cambio es una `Op` serializable (`frame.insert`, `frame.delete`,
`frame.duplicate`, `frame.setHold`, `frame.move`, `film.setFps`, …). Las
operaciones referencian cuadros **por id, nunca por índice** (`afterFrameId`), así
siguen siendo válidas si se quita un paso anterior.

`History = { entries: HistoryEntry[], cursor }`. El estado es
`replay(entries[0..cursor] habilitadas)`.

- **Deshacer/Rehacer** = mover el cursor (como la barra de tiempo de Fusion).
- **Nueva operación con cursor atrás** = se inserta en el cursor (no se pierde
  el futuro: queda después, como en Fusion).
- **Deshacer selectivo** = desactivar o borrar una entrada.
- **Paramétrico** = editar los parámetros de una entrada y recalcular.
- Una operación que ya no aplica (p. ej. su cuadro ancla fue borrado) queda
  marcada con error en el historial y se saltea — igual que los pasos en rojo de
  Fusion.

Como las operaciones no contienen píxeles, recalcular miles de pasos es barato.
Cuando lleguen las ediciones de dibujo, cada trazo será una operación vectorial y
las capas raster pintadas se guardarán como assets (con *snapshots* cacheados para
no re-renderizar desde cero).

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

- Reproductor con timing por `hold`; reproducir todo, los últimos N segundos o en
  loop.
- Exportación de video con WebCodecs (librería `mediabunny`): MP4 (H.264), WebM
  (VP9). Luego ffmpeg (Electron) para ProRes, GIF, secuencias PNG, etc.
- Dispositivos: zootropo (port de `~/Repos/zootropo`), fenakitoscopio (port de
  `~/Repos/amariskoper`: geometría del disco, ranuras, export SVG/DXF/STL, más
  distribución configurable de cuadros e impresión en papel), flipbook.

## Reutilización de proyectos existentes

| Origen | Qué | Destino |
|---|---|---|
| `CasitaDesign/src/lib/calibration.ts` | similitud, afín, homografía, TPS por puntos de control | `core/geometry` (alineación de capas) |
| `CasitaDesign/src/components/vectorize/DeformedCanvas.tsx` | warp por malla de triángulos en Canvas2D | renderer de capas deformadas |
| `amariskoper/js/{geom,disc,animate}.mjs`, `js/export/*` | disco, ranuras, curvas, SVG/DXF/STL | `core/devices/phenakistoscope` |
| `zootropo/make_strips.py` | tiras de zootropo A4 300 DPI | `core/devices/zoetrope` |

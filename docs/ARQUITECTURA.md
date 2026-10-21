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
- **Capas de película** (futuro): capas que abarcan un rango de cuadros (fondo fijo,
  "vidrio" de animación), además de las capas propias de cada cuadro.
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

Interfaz `CameraSource` (`listControls`, `setControl`, vista en vivo, `capture`):

| Fuente | Cómo | Estado |
|---|---|---|
| Webcams | `getUserMedia` + `MediaStreamTrack.getCapabilities()` (foco, balance de blancos, exposición, zoom… lo que exponga el driver) | MVP |
| Canon EOS / réflex | Canon EDSDK (gratis con registro de desarrollador) vía módulo nativo en Electron; alternativa gphoto2 (Mac). Live view + disparo + RAW | Fase 2 |
| Celulares | PWA abierta por QR, video/foto vía WebRTC; luego app nativa con el mismo protocolo | Fase 2 |
| Escáner | ImageCaptureCore (Mac) / WIA-TWAIN (Windows) | Más adelante |

Opciones de captura: promediar N fotos (menos ruido), papel de cebolla sobre la
vista en vivo.

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

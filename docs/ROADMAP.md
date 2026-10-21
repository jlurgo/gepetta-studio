# Roadmap

## Fase 1 — MVP: captura + línea de tiempo  ← en curso
- [x] Repo, monorepo pnpm, Electron + React + TS + Vite
- [x] Core: modelo de película, operaciones, historial con replay (paramétrico desde el día 1)
- [x] Biblioteca de películas (crear, abrir, borrar); fps y resolución por película
- [x] Captura con webcam: elegir cámara y resolución, controles según capacidades (falta probar con cámara real)
- [x] Promediado de N fotos (opción discreta, falta probar con cámara real)
- [x] Papel de cebolla (cuadros anteriores, cantidad y opacidad)
- [x] Línea de tiempo: insertar, borrar, duplicar, mover, extender (hold)
- [x] Importar imágenes y frames de video en cualquier posición
- [x] Reproducir todo / últimos segundos / loop
- [x] Panel de historial: deshacer/rehacer, desactivar, borrar, editar parámetros
- [x] Exportar MP4 / WebM con resolución elegible
- [ ] Probar la app de escritorio (Electron) en Mac y Windows
- [ ] Probar con el taller y ajustar la UI

## Fase 2 — Cámaras pro y celular
- Canon EOS (EDSDK): live view, foco, balance de blancos, ISO, obturador, RAW
- PWA para celular (QR + WebRTC)
- Controles UVC nativos para webcams en Mac/Windows

## Fase 3 — Editor de cuadros
- Capas por cuadro y capas de película (rangos)
- Transformar capas: mover, rotar, escalar; alinear por puntos de control
  (afín/homografía/TPS de CasitaDesign); deformación trapezoidal
- Dibujo vectorial con presión (tableta), herramientas raster/foto
- Sello de clonar entre cuadros (elegir cuadro origen)
- Guías y grillas: regla de tercios, grilla, perspectiva 1/2/3 puntos
- Importar SVG/PDF/raster como capas

## Fase 4 — Loops y dispositivos
- Modo loop: visualización circular, ping-pong, herramientas para caminatas
- Zootropo: simulación de tambor + export imprimible
- Fenakitoscopio: distribución configurable en el círculo, ranuras, simulación,
  impresión en papel + SVG/DXF/STL
- Flipbook: imposición en hojas para imprimir y encuadernar

## Fase 5 — Audio, exportaciones avanzadas y online
- Pistas de música y efectos (biblioteca local + fuentes online)
- ffmpeg: ProRes, GIF, PNG, etc.
- Deploy online, cuentas, nube, colaboración
- Escáner

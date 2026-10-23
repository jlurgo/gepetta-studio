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

## Fase 2 — Cámaras pro y celular  ← en curso
- [x] Fuentes de cámara intercambiables (webcam / celular / réflex) con ajustes genéricos
- [x] Réflex vía gphoto2 (Mac): vista en vivo, ISO, diafragma, velocidad, balance de blancos, formato, foco manual/automático, disparo JPEG + RAW. Probado con Canon EOS 500D / Rebel T1i
- [x] Celular: página web por QR, modo en vivo (HTTPS con certificado local) y modo foto simple; vista previa, disparo remoto o desde el teléfono, ajustes, papel de cebolla en el teléfono. Probado con celular simulado
- [ ] Probar con celulares reales (iPhone con certificado instalado, Android)
- [x] Réflex en Windows vía gphoto2 de MSYS2 + WinUSB (Zadig) (falta probar en una PC real)
- [ ] Empaquetar gphoto2 dentro del instalador de Windows (hoy hace falta MSYS2)
- [ ] Canon EDSDK (registro trabado: el portal de Canon USA tiene el enlace roto)
- [ ] Empaquetar gphoto2 dentro de la app de Mac (hoy hace falta `brew install gphoto2`)
- [ ] Controles UVC nativos para webcams en Mac
- [ ] App nativa de celular (mismo protocolo) para foco/ISO manual en iPhone

## Fase 3 — Editor de cuadros
- [x] Línea de tiempo en grilla fija: tracks como filas de celdas, imágenes que se ponen, mueven (también en grupo y entre tracks) y alargan; resultado combinado arriba
- [x] Exportar el resultado, un track solo o cada track por separado
- [x] Publicaciones versionadas al exportar (número, título, notas) y vista de Versiones: fecha, archivo y si sigue existiendo, mostrarlo, volver a exportar una versión vieja; marcadas en el historial
- [x] Varias cámaras a la vez, cada una con su track y celda destino; en vivo con la transparencia de su track; grabar video con cada una
- [x] Barra de herramientas en la pantalla grande: mover, pincel y borrador (pintan en la celda del cursor; presión del lápiz)
- [ ] Más herramientas: sello de clonar, relleno, cuentagotas, selección
- [x] Transformar capas: mover, rotar, escalar con manijas
- Alinear capas por puntos de control
  (afín/homografía/TPS de CasitaDesign); deformación trapezoidal
- Dibujo vectorial con presión (tableta), herramientas raster/foto
- Sello de clonar entre cuadros (elegir cuadro origen)
- [x] Guías y grillas: tercios, grilla, centro, márgenes seguros, perspectiva 1/2/3 puntos (puntos arrastrables)
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

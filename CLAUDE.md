# Gepetta Studio — notas para Claude

Estudio de animación cuadro a cuadro (stop-motion + dibujo) para el taller de
chicos y adolescentes Gepetta. App de escritorio (Electron, Mac y Windows) +
página para el celular como cámara. **La interfaz está en castellano
rioplatense** (vos, tocá, elegí…); el código y los comentarios, en inglés.

- Arquitectura: `docs/ARQUITECTURA.md`. Qué está hecho y qué falta: `docs/ROADMAP.md`.
- Monorepo pnpm: `packages/core` (TS puro, vitest: modelo, operaciones,
  historial), `packages/protocol`, `apps/studio` (React 19 + Vite + zustand v5),
  `apps/desktop` (Electron: archivos, réflex por gphoto2, celular, actualizaciones),
  `apps/phone` (página del celular).
- `pnpm install`, `pnpm dev` (app de escritorio con recarga), `pnpm test`,
  `pnpm typecheck`. Instalador de Windows: `pnpm --filter @gepetta/desktop dist:win`;
  publicar una versión (y que las PCs instaladas se actualicen solas):
  `release:win` con `GH_TOKEN`, después de subir `version` en `apps/desktop/package.json`.

## Cómo trabajar acá

- Commits chicos, en castellano, uno por cambio, y push a `main` (repo
  jlurgo/gepetta-studio). Tests y typecheck antes de cada commit.
- zustand v5: un selector nunca devuelve un objeto o lista nueva (cuelga la app).
- Probar cambios de interfaz de verdad (Chrome headless con CDP, o la app), no
  solo compilar; deshacer lo que se pruebe sobre películas de prueba.
- **No tocar las películas del usuario** («Aleli», «Aleli2» en
  `Documentos/Gepetta Studio`), ni manejar la app que el usuario tenga abierta,
  ni tomar sus cámaras sin preguntar.

## Pendiente: cámara Canon en Windows (2026-10-23)

El soporte de réflex en Windows **nunca se probó en una PC real**. Cómo está armado:

- `apps/desktop/src/dslr/gphoto2.ts`: busca `gphoto2.exe` en el PATH y en
  `C:\msys64\ucrt64\bin` (MSYS2 UCRT64, instalado con
  `pacman -S mingw-w64-ucrt-x86_64-gphoto2`). Le pasa `CAMLIBS`/`IOLIBS`
  apuntando a `..\lib\libgphoto2\<versión>` y `..\lib\libgphoto2_port\<versión>`
  porque libgphoto2 trae rutas de MSYS2 que Windows no entiende, y antepone
  esas carpetas al PATH para las DLL.
- El driver USB de la cámara tiene que ser **WinUSB** (Zadig); si no, gphoto2 no
  la ve. Los mensajes de error se clasifican en `gphoto2-parse.ts`
  (`classifyGphotoError`, con un mensaje propio para «ocupada» en Windows).
- Vista en vivo, foto, enfoque (autofoco por pasos, `autofocus.ts`) y
  reconexión cuando la cámara se duerme: `gphoto2.ts` e `ipc.ts`; en la app,
  `apps/studio/src/capture/dslr.ts` y `state/camera.ts`.
- Instrucciones para el usuario: `LEEME - Instalación en Windows.txt` (junto al
  instalador).

Para depurar en esa PC: correr a mano en «MSYS2 UCRT64»
`gphoto2 --auto-detect`, `gphoto2 --summary`, `gphoto2 --capture-image-and-download`
y comparar con lo que hace la app (abrir las herramientas de desarrollo de la
ventana con Ctrl+Shift+I y mirar la consola: los errores de cámara se registran
como `[gepetta] camera`).

El usuario pidió (2026-10-23) hacer en la PC con Windows: el cambio de driver
desde la app (abajo) y empaquetar gphoto2 en el instalador para no depender de
MSYS2 (ver `docs/ROADMAP.md`, Fase 2).

### Pendiente: cambiar el driver de la cámara desde la app

El usuario quiere pasar la Canon del driver original de Windows (MTP: se ve en
el Explorador) a WinUSB (para gphoto2) y volver, sin Zadig a mano. Lo averiguado:

- **Volver al original** se puede con lo que trae Windows: buscar el dispositivo
  (`Get-PnpDevice` con `VID_04A9`, Canon), ver qué paquete de driver tiene
  (`pnputil /enum-devices /connected /drivers`), borrar el que instaló Zadig/libwdi
  (`pnputil /delete-driver oemNN.inf /uninstall /force`) y `pnputil /scan-devices`:
  Windows le vuelve a poner el suyo. Requiere administrador.
- **Pasar a WinUSB** sin la ventana de Zadig: `wdi-simple` de libwdi
  (github.com/pbatard/libwdi, `examples/wdi-simple.c`) hace lo mismo por línea de
  comandos: `wdi-simple -v 0x04A9 -p 0x<PID> -t 0 -n "Canon (Gepetta)"` (t 0 = WinUSB).
  libwdi no publica ese .exe compilado (solo Zadig): hay que compilarlo en Windows.
- Alternativa a probar: **UsbDk** (daynix) deja que libusb use el dispositivo sin
  reemplazar el driver; no se sabe si el libusb de gphoto2 en MSYS2 lo usa.
- Idea de interfaz: en el panel de la cámara (solo en Windows) «Driver: Original
  / Gepetta», que corra el cambio con permiso de administrador (aviso de UAC) y
  diga en qué estado está.

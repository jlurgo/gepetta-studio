# Gepetta Studio

Estudio de animación stop-motion y cuadro a cuadro para Mac y Windows (Electron),
que también corre en el navegador.

## Requisitos
- Node 22+ y pnpm 10 (`corepack enable`)

## Comandos
```sh
pnpm install
pnpm dev        # app de escritorio (Electron + Vite)
pnpm dev:web    # solo en el navegador: http://127.0.0.1:5173
pnpm test       # tests del núcleo
pnpm typecheck
pnpm dist       # instalador (.dmg en Mac, .exe en Windows) en apps/desktop/release
```

### Cámaras
- **Webcams:** se detectan solas.
- **Réflex (Mac):** instalá gphoto2 una vez con `brew install gphoto2`, conectá la
  cámara por USB y tocá "Buscar cámaras conectadas". Si dice que la cámara está
  tomada, usá "Liberar cámara".
- **Celular:** panel de cámara → "Conectar celular" → escaneá el QR (misma WiFi).
  *Foto simple* funciona en cualquier teléfono. *En vivo* en Android pide
  "Avanzado → Continuar" la primera vez; en iPhone hay que instalar el certificado
  (la página del celular explica los pasos).

### Windows
- **Instalador:** `pnpm --filter @gepetta/desktop dist:win`
  (se puede generar desde la Mac) → `apps/desktop/release/Gepetta Studio Setup <versión>.exe`.
  No está firmado: Windows muestra "Windows protegió su PC" → "Más información" →
  "Ejecutar de todas formas".
- **Desarrollo en Windows:** instalar Node 22+, Git y pnpm (`corepack enable`), clonar el
  repo y correr `pnpm install` y `pnpm dev`, igual que en Mac.
- La primera vez que se conecta un celular, el Firewall de Windows pregunta si permitir
  la conexión: hay que aceptar en "Redes privadas".
- Webcams y celulares funcionan igual que en Mac.
- **Cámaras réflex (gphoto2), una sola vez por PC** — sin probar todavía en una PC real:
  1. Instalar MSYS2 desde https://www.msys2.org (carpeta por defecto `C:\msys64`).
  2. Abrir **"MSYS2 UCRT64"** desde el menú Inicio y escribir
     `pacman -S mingw-w64-ucrt-x86_64-gphoto2` (aceptar con Enter).
  3. Enchufar y prender la cámara. Bajar **Zadig** de https://zadig.akeo.ie, abrirlo,
     menú *Options → List All Devices*, elegir la cámara (ej. "Canon Digital Camera"),
     elegir **WinUSB** a la derecha y tocar *Replace Driver*.
     Ojo: después de esto el Explorador de Windows ya no muestra las fotos de la
     cámara. Para volver atrás: Administrador de dispositivos → la cámara →
     *Desinstalar el dispositivo* (marcando "eliminar el controlador") y reenchufar.
  4. Abrir Gepetta → "Buscar cámaras conectadas".

En escritorio las películas se guardan en `Documentos/Gepetta Studio/`; en el
navegador, en IndexedDB.

## Atajos
| Tecla | Acción |
|---|---|
| Espacio | Sacar foto |
| Enter | Reproducir / parar |
| P | Reproducir los últimos segundos |
| ← → | Cuadro anterior / siguiente |
| ⌥← ⌥→ | Mover el cuadro |
| D | Repetir cuadro |
| + / − | Alargar / acortar el cuadro |
| Supr | Borrar cuadro |
| O | Papel de cebolla |
| L | Loop |
| C | Ver la cámara |
| ⌘Z / ⇧⌘Z | Deshacer / rehacer |

Ver [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) y [docs/ROADMAP.md](docs/ROADMAP.md).

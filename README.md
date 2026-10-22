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

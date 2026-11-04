import { useEffect, useState } from "react";
import type { YouTubeVideo } from "../native";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";

const isLink = (text: string) => /^https?:\/\//i.test(text.trim());
const isYouTube = (text: string) => /(?:youtube\.com|youtu\.be)\//i.test(text);

const time = (s: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");
const mb = (bytes: number) => `${(bytes / 1024 ** 2).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;

/**
 * A video from the internet: a link to a video file is downloaded and goes
 * on to be imported (frame by frame, or in a track to trace over); words or
 * a YouTube link look for videos on YouTube, to watch them in the browser.
 */
export function WebVideoDialog({ onVideo, onClose }: { onVideo(file: File, mode: "frames" | "track"): void; onClose(): void }) {
  const native = window.gepetta;
  // The window is newer than the app's main part until the app opens again.
  const outdated = !!native && (!native.video || !native.youtube);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"frames" | "track">("frames");
  const [busy, setBusy] = useState<{ received: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<YouTubeVideo[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => (outdated ? undefined : native?.video.onProgress((received, total) => setBusy({ received, total }))), [native, outdated]);

  async function go() {
    if (!native || outdated || !text.trim()) return;
    setError(null);
    if (isLink(text) && !isYouTube(text)) {
      setResults(null);
      setBusy({ received: 0, total: 0 });
      try {
        const got = await native.video.download(text.trim());
        onVideo(new File([got.data], got.name, { type: got.mime }), mode);
      } catch (e) {
        setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
      } finally {
        setBusy(null);
      }
      return;
    }
    setSearching(true);
    try {
      setResults(await native.youtube.search(text.trim()));
    } catch (e) {
      console.error("[gepetta] youtube search", e);
      setError("No se pudo buscar en YouTube: fijate que haya internet.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <Dialog title="Video de internet" onClose={onClose}>
      {!native || outdated ? (
        <p className="hint">{native ? "La app se actualizó: cerrala y volvé a abrirla para usar esto." : "Esto anda en la app de escritorio."}</p>
      ) : (
        <div className="web-video">
          <p className="hint">
            Pegá el link de un archivo de video (.mp4, .webm, .mov… o un archivo de Google Drive compartido) y se baja y se importa. Con palabras o un link de YouTube, buscás en
            YouTube para verlo en el navegador: de YouTube la app no puede bajarlo (si es tuyo o tenés permiso, bajalo y elegí el archivo).
          </p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void go();
            }}
          >
            <input className="grow" autoFocus placeholder="https://… o qué buscar" value={text} onChange={(e) => setText(e.target.value)} disabled={!!busy} />
            <button className="btn primary" disabled={!text.trim() || !!busy || searching}>
              {isLink(text) && !isYouTube(text) ? "Bajar e importar" : searching ? "Buscando…" : "Buscar"}
            </button>
          </form>
          {isLink(text) && !isYouTube(text) && (
            <div className="segmented">
              <button type="button" className={mode === "frames" ? "active" : ""} onClick={() => setMode("frames")}>
                Cuadro por cuadro, desde la celda elegida
              </button>
              <button type="button" className={mode === "track" ? "active" : ""} onClick={() => setMode("track")}>
                En un track nuevo, para calcar
              </button>
            </div>
          )}
          {busy && (
            <div className="web-progress">
              <span>Bajando… {mb(busy.received)}{busy.total ? ` de ${mb(busy.total)}` : ""}</span>
              {busy.total > 0 && <progress value={busy.received} max={busy.total} />}
            </div>
          )}
          {error && <p className="panel-error">{error}</p>}
          {results && (
            <ul className="yt-results">
              {results.length === 0 && <li className="hint">No se encontró nada.</li>}
              {results.map((v) => (
                <li key={v.id}>
                  {v.thumb ? <img src={v.thumb} alt="" /> : <span className="yt-thumb" />}
                  <div className="yt-info">
                    <strong title={v.title}>{v.title}</strong>
                    <small>
                      {v.channel}
                      {v.duration ? ` · ${time(v.duration)}` : ""}
                    </small>
                  </div>
                  <button className="btn small" onClick={() => void native.youtube.open(v.id)} title="Abrirlo en el navegador">
                    <Icon name="play" size={12} /> Ver en YouTube
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">Después de bajarlo elegís desde qué segundo hasta cuál importar y cuántos cuadros por segundo sacarle.</p>
        </div>
      )}
      <div className="row end">
        <button className="btn" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Dialog>
  );
}

import { useState } from "react";
import type { YouTubeVideo } from "../native";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { downloadToLibrary } from "../state/library";

const isLink = (text: string) => /^https?:\/\//i.test(text.trim());
const isYouTube = (text: string) => /(?:youtube\.com|youtu\.be)\//i.test(text);
const directLink = (text: string) => isLink(text) && !isYouTube(text);

const time = (s: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");

/** A name for a web video from its link, before it is downloaded. */
function nameFromUrl(link: string): string {
  try {
    const last = decodeURIComponent(new URL(link).pathname.split("/").pop() ?? "");
    return /\.\w{2,4}$/.test(last) ? last : "video de internet";
  } catch {
    return "video de internet";
  }
}

/**
 * Videos from the internet into the library, whole: the link of a video file,
 * or words or a YouTube link to look for videos on YouTube, each one to watch
 * in the browser or to download (whoever downloads it has to have the right
 * to use the video). Downloads go on after the dialog is closed.
 */
export function WebVideoDialog({ onClose }: { onClose(): void }) {
  const native = window.gepetta;
  // The window is newer than the app's main part until the app opens again.
  const outdated = !!native && (!native.video || !native.youtube.download);
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<YouTubeVideo[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function go() {
    if (!native || outdated || !text.trim()) return;
    setError(null);
    if (directLink(text)) {
      downloadToLibrary({ kind: "web", url: text.trim(), name: nameFromUrl(text.trim()) });
      onClose();
      return;
    }
    setResults(null);
    setSearching(true);
    try {
      setResults(await native.youtube.search(text.trim()));
    } catch (e) {
      console.error("[gepetta] youtube search", e);
      setError("No se pudo buscar en YouTube: fijate que haya internet. (Si acabás de actualizar la app, cerrala y volvé a abrirla.)");
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
            Pegá el link de un archivo de video (.mp4, .webm, .mov… o un archivo de Google Drive compartido), o buscá en YouTube con palabras o un link. El video se baja entero a
            la biblioteca; desde ahí elegís qué tramo poner en la película, todas las veces que quieras. Bajá solo videos que sean tuyos o que tengas permiso de usar.
          </p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void go();
            }}
          >
            <input className="grow" autoFocus placeholder="https://… o qué buscar" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn primary" disabled={!text.trim() || searching}>
              {directLink(text) ? "Bajar a la biblioteca" : searching ? "Buscando…" : "Buscar"}
            </button>
          </form>
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
                  <div className="yt-actions">
                    <button className="btn small ghost" onClick={() => void native.youtube.open(v.id)} title="Abrirlo en el navegador">
                      <Icon name="play" size={12} /> Ver en YouTube
                    </button>
                    <button
                      className="btn small primary"
                      disabled={asked.has(v.id)}
                      onClick={() => {
                        downloadToLibrary({ kind: "youtube", id: v.id, name: v.title });
                        setAsked(new Set(asked).add(v.id));
                      }}
                      title="Bajarlo entero a la biblioteca"
                    >
                      {asked.has(v.id) ? (
                        <>
                          <Icon name="check" size={12} /> Bajando a la biblioteca
                        </>
                      ) : (
                        <>
                          <Icon name="import" size={12} /> Bajar a la biblioteca
                        </>
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
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

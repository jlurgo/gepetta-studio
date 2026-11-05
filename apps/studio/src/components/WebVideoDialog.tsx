import { useEffect, useRef, useState } from "react";
import { loadVideo } from "../media/video";
import type { YouTubeVideo } from "../native";
import { downloadToLibrary } from "../state/library";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { RangeBar, lengthText } from "./VideoImportDialog";

const isLink = (text: string) => /^https?:\/\//i.test(text.trim());
const isYouTube = (text: string) => /(?:youtube\.com|youtu\.be)\//i.test(text);
const directLink = (text: string) => isLink(text) && !isYouTube(text);

/** 75 → "1:15"; 3725 → "1:02:05". */
const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const mm = String(Math.floor((t % 3600) / 60));
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
};

/** "1:15" or "1:02:05" or "75" → seconds; null when it is not a time. */
function parseClock(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

/** A name for a web video from its link, before it is downloaded. */
function nameFromUrl(link: string): string {
  try {
    const last = decodeURIComponent(new URL(link).pathname.split("/").pop() ?? "");
    return /\.\w{2,4}$/.test(last) ? last.replace(/\.\w{2,4}$/, "") : "video de internet";
  } catch {
    return "video de internet";
  }
}

/** A time typed as minutes:seconds (or hours:minutes:seconds). */
function ClockInput({ value, max, onChange }: { value: number; max: number; onChange(t: number): void }) {
  const [text, setText] = useState(clock(value));
  useEffect(() => setText(clock(value)), [value]);
  const commit = () => {
    const t = parseClock(text);
    if (t === null) setText(clock(value));
    else onChange(Math.max(0, Math.min(max, t)));
  };
  return (
    <input
      className="clock-input"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        e.stopPropagation();
      }}
      title="minutos:segundos"
    />
  );
}

type Source = { kind: "web"; url: string; name: string } | { kind: "youtube"; video: YouTubeVideo };

/** The longest stretch picked at first: long videos rarely are wanted whole. */
const FIRST_STRETCH = 60;

/** The message of a failed call to the app's desktop part, without Electron's prefix. */
const message = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/**
 * Choosing what stretch of an internet video to download (a long one does
 * not have to come whole), watching it: a link to a video file streams as is;
 * of a YouTube video a small picture without sound is watched.
 */
function StretchPicker({ source, onBack, onDone }: { source: Source; onBack(): void; onDone(): void }) {
  const native = window.gepetta!;
  const youtube = source.kind === "youtube" ? source.video : null;
  const [duration, setDuration] = useState<number | null>(youtube?.duration || null);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(youtube?.duration ? Math.min(youtube.duration, FIRST_STRETCH) : 0);
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Whether the video can be watched here (YouTube's takes a moment to come). */
  const [preview, setPreview] = useState<"loading" | "ready" | "failed">("loading");
  const previewRef = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const name = youtube ? youtube.title : (source as { name: string }).name;
  // Both came in the same update of the app's desktop part.
  const canCut = !!native.video.downloadSection && !!native.youtube.preview;

  useEffect(() => {
    let disposed = false;
    let loaded: Awaited<ReturnType<typeof loadVideo>> | null = null;
    // The video streams to watch it; only the stretch chosen is downloaded.
    const link = source.kind === "web" ? Promise.resolve(source.url) : native.youtube.preview ? native.youtube.preview(source.video.id) : Promise.reject(new Error(""));
    link
      .then((url) => loadVideo(url))
      .then(
        (v) => {
          if (disposed) return v.dispose();
          loaded = v;
          video.current = v.video;
          v.video.controls = true;
          v.video.ontimeupdate = () => setCurrent(v.video.currentTime);
          v.video.onseeked = () => setCurrent(v.video.currentTime);
          previewRef.current?.appendChild(v.video);
          setPreview("ready");
          if (Number.isFinite(v.info.duration)) {
            setDuration(v.info.duration);
            if (!youtube?.duration) setTo(Math.min(v.info.duration, FIRST_STRETCH));
          }
        },
        (e) => {
          if (disposed) return;
          setPreview("failed");
          if (source.kind === "web") setError(`${message(e)} Igual podés probar bajarlo entero.`);
          else console.error("[gepetta] youtube preview", e);
        },
      );
    return () => {
      disposed = true;
      loaded?.dispose();
      loaded?.video.remove();
    };
  }, [source, native, youtube]);

  const seek = (t: number) => {
    if (!video.current) return;
    video.current.currentTime = t;
    setCurrent(t);
  };
  const length = Math.max(0, to - from);
  const ok = duration !== null && length > 0;

  function download(section?: { from: number; to: number }) {
    if (youtube) downloadToLibrary({ kind: "youtube", id: youtube.id, name: youtube.title }, section);
    else downloadToLibrary(source as { kind: "web"; url: string; name: string }, section);
    onDone();
  }

  return (
    <div className="web-video">
      <p className="stretch-title">
        <strong title={name}>{name}</strong>
        {duration ? <small> · dura {clock(duration)}</small> : null}
      </p>
      <div className={`video-preview${preview === "ready" ? "" : " waiting"}`} ref={previewRef}>
        {youtube && preview !== "ready" && (
          <div className="stretch-yt">
            {youtube.thumb ? <img src={youtube.thumb} alt="" /> : <span className="yt-thumb" />}
            <div>
              <p className="hint">{preview === "loading" ? "Abriendo el video para verlo…" : "No se pudo ver el video acá; podés mirarlo en YouTube."}</p>
              <button className="btn small ghost" onClick={() => void native.youtube.open(youtube.id, from)} title="Verlo en el navegador, desde el inicio del tramo">
                <Icon name="play" size={12} /> Ver en YouTube desde {clock(from)}
              </button>
            </div>
          </div>
        )}
      </div>
      {error && <p className="panel-error">{error}</p>}
      {duration !== null && canCut && (
        <>
          <RangeBar
            duration={duration}
            from={from}
            to={Math.min(to, duration)}
            current={current}
            step={1}
            onChange={(f, t) => {
              setFrom(f);
              setTo(t);
            }}
            onSeek={seek}
          />
          <div className="row stretch-times">
            <label className="control">
              <span>Desde</span>
              <ClockInput
                value={from}
                max={duration}
                onChange={(t) => {
                  // Starting after the end moves the end along, keeping how long it was.
                  if (t >= to) setTo(Math.min(duration, t + Math.max(1, to - from)));
                  setFrom(Math.min(t, duration - 1));
                  seek(t);
                }}
              />
            </label>
            <label className="control">
              <span>Hasta</span>
              <ClockInput
                value={Math.min(to, duration)}
                max={duration}
                onChange={(t) => {
                  setTo(Math.max(t, from));
                  seek(t);
                }}
              />
            </label>
            <span className="stretch-length">
              Elegiste <strong>{lengthText(length)}</strong>
            </span>
            {preview === "ready" && (
              <span className="stretch-marks">
                <button className="btn small" onClick={() => video.current && setFrom(Math.min(Math.floor(video.current.currentTime), to))} title="El inicio del tramo, donde está el video">
                  Inicio aquí
                </button>
                <button className="btn small" onClick={() => video.current && setTo(Math.max(Math.ceil(video.current.currentTime), from))} title="El fin del tramo, donde está el video">
                  Fin aquí
                </button>
              </span>
            )}
          </div>
          <p className="hint">Arrastrá las puntas para cambiar cuánto dura, o el tramo entero para moverlo; tocá la barra para ver ese momento. Se baja solo el tramo a la biblioteca.</p>
        </>
      )}
      {!canCut && <p className="hint">La app se actualizó: cerrala y volvé a abrirla para poder ver el video acá y bajar solo un tramo.</p>}
      <div className="row end">
        <button className="btn ghost" onClick={onBack}>
          <Icon name="back" size={12} /> Volver
        </button>
        <button className="btn" onClick={() => download()} title="Todo el video, aunque sea largo">
          Bajar entero
        </button>
        {canCut && (
          <button className="btn primary" disabled={!ok} onClick={() => download({ from, to: Math.min(to, duration ?? to) })}>
            <Icon name="import" size={12} /> Bajar este tramo ({lengthText(length)})
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Videos from the internet into the library: the link of a video file, or
 * words or a YouTube link to look for videos on YouTube (whoever downloads
 * it has to have the right to use the video). Before downloading, the
 * stretch wanted is chosen (or all of it). Downloads go on after the dialog
 * is closed.
 */
export function WebVideoDialog({ onClose }: { onClose(): void }) {
  const native = window.gepetta;
  // The window is newer than the app's main part until the app opens again.
  const outdated = !!native && (!native.video || !native.youtube.download);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<YouTubeVideo[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState<Source | null>(null);

  async function go() {
    if (!native || outdated || !text.trim()) return;
    setError(null);
    if (directLink(text)) {
      setPicking({ kind: "web", url: text.trim(), name: nameFromUrl(text.trim()) });
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
      ) : picking ? (
        <StretchPicker source={picking} onBack={() => setPicking(null)} onDone={onClose} />
      ) : (
        <div className="web-video">
          <p className="hint">
            Pegá el link de un archivo de video (.mp4, .webm, .mov… o un archivo de Google Drive compartido), o buscá en YouTube con palabras o un link. Antes de bajarlo elegís
            qué tramo querés (o el video entero), y va a la biblioteca. Bajá solo videos que sean tuyos o que tengas permiso de usar.
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
              {directLink(text) ? "Ver y elegir el tramo" : searching ? "Buscando…" : "Buscar"}
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
                      {v.duration ? ` · ${clock(v.duration)}` : ""}
                    </small>
                  </div>
                  <div className="yt-actions">
                    <button className="btn small ghost" onClick={() => void native.youtube.open(v.id)} title="Abrirlo en el navegador">
                      <Icon name="play" size={12} /> Ver en YouTube
                    </button>
                    <button className="btn small primary" onClick={() => setPicking({ kind: "youtube", video: v })} title="Elegir qué tramo bajar a la biblioteca (o bajarlo entero)">
                      <Icon name="import" size={12} /> Bajar…
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!picking && (
        <div className="row end">
          <button className="btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
      )}
    </Dialog>
  );
}

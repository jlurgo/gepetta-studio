import { useEffect, useMemo, useRef, useState } from "react";
import { ANIMATION_DRAG, ANIMATIONS, type EffectAnimation } from "../media/animations";
import { SFX_DRAG, type SfxCategory, type SfxSound, previewSfx, sfxCatalog } from "../media/sfx";
import { addToLibrary, animationToLibrary } from "../state/library";
import { Icon } from "./Icon";

/** Lower case, without accents: what a search compares. */
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The category of the sound collection that is music (the «Música» collection); the rest are effects. */
const MUSIC = "musica";

async function sfxToLibrary(name: string, file: string) {
  const blob = await fetch(`sfx/${file}`).then((r) => r.blob());
  await addToLibrary([new File([blob], `${name}.ogg`, { type: "audio/ogg" })], "Sonidos de Gepetta");
}

/**
 * Sounds that come with the app (effects, or music): touching one plays it
 * (each time another take, when it has several); «+» adds the take last heard
 * to the library, and dragging it to the timeline puts it in the film.
 */
export function SoundCollection({ music = false }: { music?: boolean }) {
  const [all, setAll] = useState<SfxCategory[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  /** The take last heard of each sound. */
  const [takes, setTakes] = useState<Record<string, number>>({});

  useEffect(() => {
    sfxCatalog().then(setAll, (e) => {
      console.error("[gepetta] sound effects", e);
      setFailed(true);
    });
  }, []);

  const categories = useMemo(() => all?.filter((c) => (c.id === MUSIC) === music) ?? null, [all, music]);
  const current = categories?.find((c) => c.id === category) ?? categories?.[0];

  const shown = useMemo(() => {
    if (!categories) return [];
    const q = plain(query.trim());
    if (!q) return current ? [current] : [];
    return categories
      .map((c) => ({ ...c, sounds: c.sounds.filter((s) => plain(s.name).includes(q) || plain(c.name).includes(q)) }))
      .filter((c) => c.sounds.length);
  }, [categories, current, query]);

  const keyOf = (c: SfxCategory, s: SfxSound) => `${c.id}/${s.name}`;
  const takeOf = (c: SfxCategory, s: SfxSound) => s.files[takes[keyOf(c, s)] ?? 0]!;

  function listen(c: SfxCategory, s: SfxSound) {
    const key = keyOf(c, s);
    // The first touch plays the first take; each one after, the next.
    const i = key in takes ? (takes[key]! + 1) % s.files.length : 0;
    setTakes({ ...takes, [key]: i });
    void previewSfx(s.files[i]!).catch((e) => console.error("[gepetta] sound effect", e));
  }

  return (
    <div className="effects">
      {!music && <input className="fx-search" type="search" placeholder="Buscar (puerta, pasos, boing…)" value={query} onChange={(e) => setQuery(e.target.value)} />}
      {!query.trim() && categories && categories.length > 1 && (
        <div className="fx-cats">
          {categories.map((c) => (
            <button key={c.id} className={`fx-cat${c.id === current?.id ? " active" : ""}`} onClick={() => setCategory(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      {failed && <p className="hint">No se pudieron leer los sonidos.</p>}
      {shown.map((c) => (
        <div key={c.id} className="fx-group">
          {query.trim() && <h4>{c.name}</h4>}
          <ul className="fx-list">
            {c.sounds.map((s) => {
              const take = takes[keyOf(c, s)];
              return (
                <li
                  key={s.name}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(SFX_DRAG, JSON.stringify({ name: s.name, file: takeOf(c, s) }));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <button className="fx-play" onClick={() => listen(c, s)} title={s.files.length > 1 ? "Escucharlo (cada vez suena otra toma)" : "Escucharlo"}>
                    <Icon name="play" size={12} />
                    <span>{s.name}</span>
                    {s.files.length > 1 && <small>{take === undefined ? s.files.length : `${take + 1}/${s.files.length}`}</small>}
                  </button>
                  <button
                    className="icon-btn fx-add"
                    onClick={() => void sfxToLibrary(s.name, takeOf(c, s)).catch((e) => console.error("[gepetta] sound effect", e))}
                    title="Agregarlo a tus recursos (la última toma que escuchaste)"
                  >
                    <Icon name="plus" size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <p className="hint">
        Tocá uno para escucharlo{music ? "" : "; si tiene varias tomas, cada vez suena otra"}. Arrastralo a la línea de tiempo, o con <b>+</b> agregalo a tus recursos. Son sonidos libres (CC0) de Kenney,
        OpenGameArt y BigSoundBank.
      </p>
    </div>
  );
}

/** A small moving picture of an animation, over a dark checkerboard; it plays while the pointer is on it. */
function AnimationPreview({ anim }: { anim: EffectAnimation }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const draw = (t: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      anim.draw(ctx, canvas.width, canvas.height, t);
    };
    if (!playing) {
      draw(anim.loop ? 0.3 : 0.25);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      draw((((now - start) / 1000) % anim.seconds) / anim.seconds);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anim, playing]);
  return <canvas ref={ref} width={160} height={90} onPointerEnter={() => setPlaying(true)} onPointerLeave={() => setPlaying(false)} />;
}

/**
 * Effect animations that come with the app, drawn on a see-through
 * background: dragged to the timeline they go on a new track over the one
 * they are dropped on; «+» adds them to the library.
 */
export function AnimationCollection() {
  return (
    <div className="anim-collection">
      <ul className="lib-grid">
        {ANIMATIONS.map((a) => (
          <li
            key={a.id}
            className="lib-tile anim"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(ANIMATION_DRAG, a.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
            title={`${a.name}: ${a.seconds} s${a.loop ? ", se puede repetir" : ""}. Arrastrala a la línea de tiempo.`}
          >
            <AnimationPreview anim={a} />
            <span className="lib-name">{a.name}</span>
            <button className="icon-btn lib-add" onClick={() => void animationToLibrary(a)} title="Agregarla a tus recursos">
              <Icon name="plus" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">Pasá el mouse por encima para verlas. Arrastrá una a la línea de tiempo: va en un track nuevo arriba del que la soltás, una imagen por celda, con el fondo transparente.</p>
    </div>
  );
}

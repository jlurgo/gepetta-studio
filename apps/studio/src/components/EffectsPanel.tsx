import { useEffect, useMemo, useState } from "react";
import { SFX_DRAG, type SfxCategory, type SfxSound, insertSfx, previewSfx, sfxCatalog } from "../media/sfx";
import { useSound } from "../state/sound";
import { Icon } from "./Icon";

/** Lower case, without accents: what a search compares. */
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * The sound effects that come with the app: touching one plays it (each time
 * another take, when it has several); «+» or dragging it to the timeline puts
 * the take last heard in the film.
 */
export function EffectsPanel() {
  const [categories, setCategories] = useState<SfxCategory[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  /** The take last heard of each sound. */
  const [takes, setTakes] = useState<Record<string, number>>({});

  useEffect(() => {
    sfxCatalog().then(
      (c) => {
        setCategories(c);
        setCategory((now) => now || c[0]?.id || "");
      },
      (e) => {
        console.error("[gepetta] sound effects", e);
        setFailed(true);
      },
    );
  }, []);

  const shown = useMemo(() => {
    if (!categories) return [];
    const q = plain(query.trim());
    if (!q) return categories.filter((c) => c.id === category);
    return categories
      .map((c) => ({ ...c, sounds: c.sounds.filter((s) => plain(s.name).includes(q) || plain(c.name).includes(q)) }))
      .filter((c) => c.sounds.length);
  }, [categories, category, query]);

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
    <aside className="side-panel history effects">
      <div className="row spread">
        <h3>Efectos de sonido</h3>
        <button className="icon-btn" onClick={() => useSound.getState().setEffects(false)} title="Cerrar">
          <Icon name="close" size={18} />
        </button>
      </div>
      <input className="fx-search" type="search" placeholder="Buscar (puerta, pasos, boing…)" value={query} onChange={(e) => setQuery(e.target.value)} />
      {!query.trim() && categories && (
        <div className="fx-cats">
          {categories.map((c) => (
            <button key={c.id} className={`fx-cat${c.id === category ? " active" : ""}`} onClick={() => setCategory(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      {failed && <p className="hint">No se pudieron leer los efectos.</p>}
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
                    onClick={() => void insertSfx(s.name, takeOf(c, s)).catch((e) => console.error("[gepetta] sound effect", e))}
                    title="Ponerlo en la celda del cursor (la última toma que escuchaste)"
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
        Tocá un efecto para escucharlo; si tiene varias tomas, cada vez suena otra. Con <b>+</b> va a la celda del cursor, o arrastralo a la línea de tiempo. Son sonidos libres (CC0) de Kenney, OpenGameArt y BigSoundBank.
      </p>
    </aside>
  );
}

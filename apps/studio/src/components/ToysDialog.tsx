import {
  type DiscOptions,
  type Orientation,
  PAPERS,
  type PaperId,
  type ZoetropeOptions,
  everyNth,
  exportedCells,
  flipbookLayout,
  maxFlipbookPicture,
  pageSize,
  printableArea,
  slitEffect,
  zoetropeDefaultHeight,
  zoetropeLayout,
} from "@gepetta/core";
import { useEffect, useMemo, useState } from "react";
import {
  discDxf,
  discFramePixels,
  discPdf,
  discSvg,
  flipbookPdf,
  frameBitmaps,
  printFrames,
  printPixels,
  zoetropePdf,
  zoetropeSvg,
} from "../export/toys";
import { runTask, useBusy } from "../state/busy";
import { useEditor } from "../state/editor";
import { saveBlob } from "../storage";
import { Dialog } from "./Dialog";
import { DiscPreview, FlipbookPreview, ZoetropePreview } from "./ToyPreviews";
import "./toys.css";

type Toy = "flipbook" | "zoetrope" | "disc";

const TOYS: { id: Toy; label: string }[] = [
  { id: "flipbook", label: "Flipbook" },
  { id: "zoetrope", label: "Zootropo" },
  { id: "disc", label: "Fenakitoscopio" },
];

/** More than this and each picture of a zoetrope or a disc gets too thin to see. */
const MANY = 24;
const FLIPBOOK_SIZES = [
  { width: 50, label: "Chico (5 cm)" },
  { width: 70, label: "Mediano (7 cm)" },
  { width: 90, label: "Grande (9 cm)" },
  { width: 120, label: "Muy grande (12 cm)" },
];

/** A number field in mm that only reports sensible values. */
function MmInput({ value, onChange, min, max, step = 1 }: { value: number; onChange(v: number): void; min: number; max: number; step?: number }) {
  const [text, setText] = useState(String(Math.round(value * 10) / 10));
  useEffect(() => setText(String(Math.round(value * 10) / 10)), [value]);
  return (
    <span className="mm-input">
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(v) && v >= min && v <= max) onChange(v);
        }}
        onBlur={() => setText(String(Math.round(value * 10) / 10))}
      />
      mm
    </span>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: readonly { id: NoInfer<T>; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? "active" : ""} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Optical toys made from the film, to print and put together: a flipbook,
 * a zoetrope strip and a phenakistoscope disc, each with a preview that
 * plays it as the real one would.
 */
export function ToysDialog({ onClose }: { onClose(): void }) {
  const film = useEditor((s) => s.film)!;
  const filmId = useEditor((s) => s.filmId)!;
  const title = film.settings.name;
  const aspect = film.settings.width / film.settings.height;
  const [toy, setToy] = useState<Toy>("flipbook");
  const [step, setStep] = useState(1);
  const [paper, setPaper] = useState<PaperId>("a4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const page = useMemo(() => pageSize(paper, orientation), [paper, orientation]);

  const all = useMemo(() => exportedCells(film), [film]);
  const cells = useMemo(() => everyNth(all, step), [all, step]);
  const n = cells.length;

  // Flipbook.
  const [pictureWidth, setPictureWidth] = useState(70);
  const [cover, setCover] = useState(true);
  const [flipFps, setFlipFps] = useState(film.settings.fps);
  const binding = 15;
  const flip = useMemo(() => flipbookLayout({ page, frames: n, pictureWidth, aspect, binding, cover }), [page, n, pictureWidth, aspect, cover]);

  // Zoetrope.
  const [diameter, setDiameter] = useState(150);
  const [stripHeight, setStripHeight] = useState<number | null>(null);
  const [rpm, setRpm] = useState(60);
  const [stripOnly, setStripOnly] = useState(false);
  const pictureHeight = Math.max(10, Math.min(100, stripHeight ?? zoetropeDefaultHeight(n, diameter, aspect)));
  const zoe: ZoetropeOptions = {
    page,
    frames: n,
    diameter,
    pictureHeight,
    slitHeight: Math.max(15, Math.min(40, Math.round(pictureHeight * 0.8))),
    slitWidth: 3,
    tab: 10,
    stripOnly,
  };
  const zoeLayout = zoetropeLayout(zoe);

  // Phenakistoscope.
  const area = printableArea(page);
  const maxDisc = Math.floor(Math.min(area.width, area.height));
  const [discD, setDiscD] = useState(180);
  const D = Math.min(discD, maxDisc);
  const [outer, setOuter] = useState(72);
  const [inner, setInner] = useState(30);
  const [slitsMode, setSlitsMode] = useState<"same" | "plus" | "minus">("same");
  const [mirror, setMirror] = useState(true);
  const [hole, setHole] = useState(6);
  const ro = Math.min(outer, D / 2 - 8);
  const ri = Math.min(inner, ro - 5);
  const disc: DiscOptions = useMemo(
    () => ({
      frames: n,
      slits: Math.max(2, slitsMode === "same" ? n : slitsMode === "plus" ? n + 1 : n - 1),
      diameter: D,
      innerRadius: Math.max(hole / 2 + 2, ri),
      outerRadius: ro,
      aspect,
      slitWidth: 3,
      hole,
    }),
    [n, slitsMode, D, ri, ro, aspect, hole],
  );

  // Pictures for the previews, from the proxies.
  const [preview, setPreview] = useState<ImageBitmap[]>([]);
  useEffect(() => {
    let alive = true;
    const height = 180;
    frameBitmaps(filmId, film, cells, { width: height * aspect, height }, "proxy").then(
      (frames) => {
        if (alive)
          setPreview((old) => {
            old.forEach((b) => b.close());
            return frames;
          });
        else frames.forEach((b) => b.close());
      },
      (e) => console.error("[gepetta] toys preview", e),
    );
    return () => {
      alive = false;
    };
  }, [filmId, film, cells, aspect]);

  async function save(blob: Blob | undefined, name: string) {
    if (!blob) return;
    const saved = await saveBlob(blob, name);
    if (saved) useBusy.getState().notify(`Guardado: ${saved}`);
  }

  async function exportFlipbook() {
    const px = printPixels(film, flip.leafWidth - binding);
    const blob = await runTask("Armando el flipbook", n, async (progress) => {
      const images = await printFrames(filmId, film, cells, px.width, px.height, progress);
      return flipbookPdf(flip, page, images, title);
    });
    await save(blob, `${title} - flipbook.pdf`);
  }

  async function exportZoetrope(format: "pdf" | "svg") {
    const cell = Math.min(zoeLayout.pitch, pictureHeight * aspect);
    const px = printPixels(film, cell);
    const blob = await runTask("Armando el zootropo", n, async (progress) => {
      const images = await printFrames(filmId, film, cells, px.width, px.height, progress);
      return format === "pdf" ? zoetropePdf(zoe, images, aspect, title) : zoetropeSvg(zoe, images, aspect, title);
    });
    await save(blob, `${title} - zootropo.${format}`);
  }

  async function exportDisc(format: "pdf" | "svg" | "dxf") {
    if (format === "dxf") return save(discDxf(disc), `${title} - fenakitoscopio (corte).dxf`);
    const blob = await runTask("Armando el fenakitoscopio", n, async (progress) => {
      const frames = await frameBitmaps(filmId, film, cells, discFramePixels(disc, film), "original", progress);
      return format === "pdf" ? discPdf(disc, page, frames, mirror, title) : discSvg(disc, frames, mirror, title);
    });
    await save(blob, `${title} - fenakitoscopio.${format}`);
  }

  const steps = [1, 2, 3, 4, 6].filter((s) => s === 1 || Math.ceil(all.length / s) >= 2);
  const tooMany = toy !== "flipbook" && n > MANY;
  const effect = slitEffect(disc.frames, disc.slits);

  return (
    <Dialog title="Juguetes ópticos" onClose={onClose}>
      <div className="toys">
        <div className="toys-tabs">
          <Segmented value={toy} options={TOYS} onChange={setToy} />
        </div>
        <div className="toys-body">
          <div className="toys-controls">
            <label className="control">
              <span>Cuadros</span>
              <select value={step} onChange={(e) => setStep(Number(e.target.value))}>
                {steps.map((s) => (
                  <option key={s} value={s}>
                    {s === 1 ? `Todos (${all.length})` : `Uno de cada ${s} (${Math.ceil(all.length / s)})`}
                  </option>
                ))}
              </select>
            </label>
            {tooMany && (
              <p className="panel-error">
                {n} cuadros son muchos: cada dibujo queda muy finito.{" "}
                <button className="btn" onClick={() => setStep(Math.ceil(all.length / MANY))}>
                  Usar uno de cada {Math.ceil(all.length / MANY)}
                </button>
              </p>
            )}
            <div className="control">
              <span>Hoja</span>
              <div className="row">
                <Segmented
                  value={paper}
                  options={(Object.keys(PAPERS) as PaperId[]).map((id) => ({ id, label: PAPERS[id].label }))}
                  onChange={setPaper}
                />
                {toy !== "disc" && (
                  <Segmented
                    value={orientation}
                    options={[
                      { id: "portrait", label: "Parada" },
                      { id: "landscape", label: "Acostada" },
                    ]}
                    onChange={setOrientation}
                  />
                )}
              </div>
            </div>

            {toy === "flipbook" && (
              <>
                <label className="control">
                  <span>Tamaño de cada dibujo</span>
                  <select value={pictureWidth} onChange={(e) => setPictureWidth(Number(e.target.value))}>
                    {FLIPBOOK_SIZES.filter((s) => s.width <= maxFlipbookPicture(page, aspect, binding) + 0.5).map((s) => (
                      <option key={s.width} value={s.width}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="control toggle">
                  <input type="checkbox" checked={cover} onChange={(e) => setCover(e.target.checked)} />
                  <span>Con tapa (el nombre de la película arriba de todo)</span>
                </label>
                <p className="hint">
                  {flip.perPage} por hoja · {flip.pages.length} {flip.pages.length === 1 ? "hoja" : "hojas"} · cada hojita{" "}
                  {Math.round(flip.leafWidth)}×{Math.round(flip.leafHeight)} mm, con una franja gris a la izquierda para abrochar
                </p>
                <label className="control">
                  <span>Velocidad de la vista previa: {flipFps} hojas/s</span>
                  <input type="range" min={2} max={30} value={flipFps} onChange={(e) => setFlipFps(Number(e.target.value))} />
                </label>
                <div className="row end">
                  <button className="btn primary" disabled={!n} onClick={() => void exportFlipbook()}>
                    Guardar PDF
                  </button>
                </div>
              </>
            )}

            {toy === "zoetrope" && (
              <>
                <div className="control">
                  <span>Diámetro del tambor</span>
                  <div className="row">
                    <MmInput value={diameter} onChange={setDiameter} min={60} max={400} />
                    <button
                      className="btn ghost"
                      title="El tambor de 12 ranuras del taller: 105,6 cm de vuelta"
                      onClick={() => {
                        setDiameter(1056 / Math.PI);
                        setStripOnly(true);
                      }}
                    >
                      Tambor del taller
                    </button>
                  </div>
                </div>
                <label className="control toggle">
                  <input type="checkbox" checked={stripOnly} onChange={(e) => setStripOnly(e.target.checked)} />
                  <span>Ya tengo el tambor: solo la tira de dibujos</span>
                </label>
                <div className="control">
                  <span>Alto de la tira de dibujos</span>
                  <div className="row">
                    <MmInput value={pictureHeight} onChange={setStripHeight} min={10} max={100} />
                    {stripHeight !== null && (
                      <button className="btn ghost" onClick={() => setStripHeight(null)}>
                        Automático
                      </button>
                    )}
                  </div>
                </div>
                <p className="hint">
                  Tira de {Math.round(zoeLayout.circumference)} mm (π × {Math.round(diameter * 10) / 10} mm) en {zoeLayout.pieces.length}{" "}
                  {zoeLayout.pieces.length === 1 ? "pedazo" : "pedazos con pestañas para pegar"} · un dibujo cada{" "}
                  {zoeLayout.pitch.toFixed(1)} mm · {stripOnly ? `para un tambor de ${n} ranuras` : `${n} ranuras`} · {zoeLayout.pages.length}{" "}
                  {zoeLayout.pages.length === 1 ? "hoja" : "hojas"}
                  {!stripOnly && !zoeLayout.baseFits && " · la base no entra en la hoja: recortala de cartón"}
                </p>
                <label className="control">
                  <span>
                    Velocidad de la vista previa: {rpm} vueltas por minuto ({((rpm / 60) * n).toFixed(1)} cuadros/s)
                  </span>
                  <input type="range" min={10} max={150} value={rpm} onChange={(e) => setRpm(Number(e.target.value))} />
                </label>
                <div className="row end">
                  <button className="btn" disabled={!n} onClick={() => void exportZoetrope("svg")} title="Las dos tiras enteras, sin cortar en pedazos (para plotter o láser)">
                    SVG
                  </button>
                  <button className="btn primary" disabled={!n} onClick={() => void exportZoetrope("pdf")}>
                    Guardar PDF
                  </button>
                </div>
              </>
            )}

            {toy === "disc" && (
              <>
                <div className="control">
                  <span>Diámetro del disco (hasta {maxDisc} mm en esta hoja)</span>
                  <MmInput value={D} onChange={setDiscD} min={80} max={maxDisc} />
                </div>
                <div className="control">
                  <span>Anillo de los dibujos: desde el centro</span>
                  <div className="row">
                    <MmInput value={disc.innerRadius} onChange={setInner} min={5} max={ro - 5} />
                    hasta
                    <MmInput value={ro} onChange={setOuter} min={ri + 5} max={D / 2 - 8} />
                  </div>
                </div>
                <div className="control">
                  <span>Ranuras</span>
                  <Segmented
                    value={slitsMode}
                    options={[
                      { id: "same", label: `${n} (igual)` },
                      { id: "plus", label: `${n + 1} (una más)` },
                      { id: "minus", label: `${Math.max(2, n - 1)} (una menos)` },
                    ]}
                    onChange={setSlitsMode}
                  />
                  <small>
                    {effect === "still"
                      ? "Tantas ranuras como dibujos: la animación se mueve sin cambiar de lugar."
                      : effect === "backwards"
                        ? "Una ranura más: además, los dibujos van dando la vuelta despacio para atrás (contra el giro del disco)."
                        : "Una ranura menos: además, los dibujos van dando la vuelta despacio para adelante (con el giro del disco)."}
                  </small>
                </div>
                <div className="control">
                  <span>Agujero del centro</span>
                  <MmInput value={hole} onChange={setHole} min={2} max={20} />
                </div>
                <label className="control toggle">
                  <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
                  <span>Dibujos espejados, para que en el espejo se vean derechos</span>
                </label>
                <label className="control">
                  <span>
                    Velocidad de la vista previa: {rpm} vueltas por minuto ({((rpm / 60) * disc.slits).toFixed(1)} ranuras/s)
                  </span>
                  <input type="range" min={10} max={150} value={rpm} onChange={(e) => setRpm(Number(e.target.value))} />
                </label>
                <div className="row end">
                  <button className="btn" disabled={!n} onClick={() => void exportDisc("dxf")} title="Solo el contorno, las ranuras y el agujero: para cortar con láser">
                    DXF
                  </button>
                  <button className="btn" disabled={!n} onClick={() => void exportDisc("svg")}>
                    SVG
                  </button>
                  <button className="btn primary" disabled={!n} onClick={() => void exportDisc("pdf")}>
                    Guardar PDF
                  </button>
                </div>
              </>
            )}
            <p className="hint">
              Imprimí al 100 % (tamaño real), sin «ajustar a la página». En cada hoja hay una raya de 5 cm para comprobarlo. Línea llena:
              cortar; punteada: doblar.
            </p>
          </div>
          <div className="toys-preview">
            {preview.length !== n ? (
              <p className="hint">Preparando los cuadros…</p>
            ) : toy === "flipbook" ? (
              <FlipbookPreview frames={preview} aspect={aspect} fps={flipFps} />
            ) : toy === "zoetrope" ? (
              <ZoetropePreview frames={preview} aspect={aspect} rpm={rpm} />
            ) : (
              <DiscPreview frames={preview} disc={disc} mirror={mirror} rpm={rpm} />
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

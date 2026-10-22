import { type Clip, formatDistance, formatExposure } from "@gepetta/core";

/** What is known about how a picture was taken. */
export function FrameInfo({ clip }: { clip: Clip }) {
  const media = clip.media;
  const c = media?.capture;
  const rows: [string, string | undefined][] = c
    ? [
        ["Cámara", c.source ?? c.model],
        ["Lente", c.lens],
        ["Distancia focal", c.focalLength ? `${Math.round(c.focalLength)} mm` : undefined],
        ["Diafragma", c.aperture ? `f/${c.aperture}` : undefined],
        ["Velocidad", c.exposureTime ? formatExposure(c.exposureTime) : undefined],
        ["ISO", c.iso?.toString()],
        ["Balance de blancos", c.whiteBalance === "Auto" ? "Automático" : c.whiteBalance],
        [
          "Distancia de foco",
          c.focusDistance
            ? c.focusDistance.near === c.focusDistance.far
              ? formatDistance(c.focusDistance.near)
              : `${formatDistance(c.focusDistance.near)} – ${formatDistance(c.focusDistance.far)}`
            : undefined,
        ],
        [
          "Posición de foco",
          c.focusPosition !== undefined
            ? `${c.focusPosition} ${c.focusOrigin === "infinity" ? "desde ∞" : "desde el autofoco"}`
            : undefined,
        ],
        ["Tomada", c.takenAt?.replace("T", " ")],
      ]
    : [];
  const shown = rows.filter((r): r is [string, string] => Boolean(r[1]));
  return (
    <section className="panel-section frame-info">
      <h4>Datos de la foto</h4>
      {media && (
        <p className="hint">
          {media.width}×{media.height}
          {media.raw ? " · con RAW" : ""}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="hint">Esta imagen no trae datos de la toma.</p>
      ) : (
        <dl>
          {shown.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

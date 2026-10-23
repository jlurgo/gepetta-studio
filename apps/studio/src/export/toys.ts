import {
  type DiscOptions,
  type FilmState,
  type FlipbookLayout,
  PAGE_HEADER,
  PAGE_MARGIN,
  type PageSize,
  type Rect,
  ZOETROPE_BORDER,
  ZOETROPE_TEETH,
  type ZoetropeItem,
  type ZoetropeLayout,
  type ZoetropeOptions,
  discOutline,
  discPictures,
  dxf,
  fitRect,
  polar,
  printableArea,
  svgPolygon,
  zoetropeLayout,
} from "@gepetta/core";
import { jsPDF } from "jspdf";
import { renderCells } from "./frames";

/**
 * Printable optical toys: every page is drawn once through a small Painter
 * in mm, which writes either a PDF (jsPDF, one page per sheet, real size) or
 * an SVG. Solid lines are cut, dashed ones folded.
 */

/** Pixels per mm of the pictures put on paper (about 200 dpi). */
export const PRINT_PX_PER_MM = 8;
const PT = 25.4 / 72;

/** A frame ready to go on paper: a JPEG, shared by held cells. */
export interface ToyImage {
  key: string;
  url: string;
}

type Line = "cut" | "fold" | "guide";
interface Style {
  line?: Line;
  fill?: string;
}
interface TextStyle {
  size: number;
  bold?: boolean;
  align?: "left" | "center" | "right";
  color?: string;
}

interface Painter {
  page: PageSize;
  image(img: ToyImage, r: Rect): void;
  polygon(points: readonly [number, number][], style: Style, closed?: boolean): void;
  circle(cx: number, cy: number, r: number, style: Style): void;
  text(text: string, x: number, y: number, style: TextStyle): void;
}

const LINES: Record<Line, { width: number; color: string; dash?: number[] }> = {
  cut: { width: 0.3, color: "#000000" },
  fold: { width: 0.25, color: "#555555", dash: [2, 1.5] },
  guide: { width: 0.15, color: "#bbbbbb" },
};

function rectPoints(r: Rect): [number, number][] {
  return [
    [r.x, r.y],
    [r.x + r.width, r.y],
    [r.x + r.width, r.y + r.height],
    [r.x, r.y + r.height],
  ];
}

class PdfPainter implements Painter {
  readonly doc: jsPDF;
  private pages = 0;
  constructor(readonly page: PageSize) {
    this.doc = new jsPDF({ unit: "mm", format: [page.width, page.height], orientation: page.width > page.height ? "landscape" : "portrait" });
  }
  newPage() {
    if (this.pages++) this.doc.addPage([this.page.width, this.page.height], this.page.width > this.page.height ? "landscape" : "portrait");
  }
  private style(s: Style): string | null {
    const d = this.doc;
    if (s.fill) d.setFillColor(s.fill);
    if (s.line) {
      const l = LINES[s.line];
      d.setLineWidth(l.width);
      d.setDrawColor(l.color);
      d.setLineDashPattern(l.dash ?? [], 0);
    }
    return s.fill && s.line ? "FD" : s.fill ? "F" : "S";
  }
  image(img: ToyImage, r: Rect) {
    this.doc.addImage(img.url, "JPEG", r.x, r.y, r.width, r.height, img.key, "FAST");
  }
  polygon(points: readonly [number, number][], style: Style, closed = true) {
    const d = this.doc;
    const op = this.style(style);
    d.moveTo(points[0]![0], points[0]![1]);
    for (const [x, y] of points.slice(1)) d.lineTo(x, y);
    if (closed) d.close();
    if (op === "FD") d.fillStroke();
    else if (op === "F") d.fill();
    else d.stroke();
  }
  circle(cx: number, cy: number, r: number, style: Style) {
    this.doc.circle(cx, cy, r, this.style(style));
  }
  text(text: string, x: number, y: number, s: TextStyle) {
    const d = this.doc;
    d.setFont("helvetica", s.bold ? "bold" : "normal");
    d.setFontSize(s.size);
    d.setTextColor(s.color ?? "#000000");
    d.text(text, x, y, { align: s.align ?? "left", baseline: "middle" });
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

class SvgPainter implements Painter {
  private parts: string[] = [];
  constructor(readonly page: PageSize) {}
  private attrs(s: Style): string {
    const l = s.line && LINES[s.line];
    return [
      `fill="${s.fill ?? "none"}"`,
      l ? `stroke="${l.color}" stroke-width="${l.width}"${l.dash ? ` stroke-dasharray="${l.dash.join(" ")}"` : ""}` : `stroke="none"`,
    ].join(" ");
  }
  image(img: ToyImage, r: Rect) {
    this.parts.push(`<image x="${r.x.toFixed(3)}" y="${r.y.toFixed(3)}" width="${r.width.toFixed(3)}" height="${r.height.toFixed(3)}" preserveAspectRatio="none" href="${img.url}"/>`);
  }
  polygon(points: readonly [number, number][], style: Style, closed = true) {
    const d = svgPolygon(points);
    this.parts.push(`<path d="${closed ? d : d.slice(0, -2)}" ${this.attrs(style)}/>`);
  }
  circle(cx: number, cy: number, r: number, style: Style) {
    this.parts.push(`<circle cx="${cx.toFixed(3)}" cy="${cy.toFixed(3)}" r="${r.toFixed(3)}" ${this.attrs(style)}/>`);
  }
  text(text: string, x: number, y: number, s: TextStyle) {
    const anchor = s.align === "center" ? "middle" : s.align === "right" ? "end" : "start";
    this.parts.push(
      `<text x="${x.toFixed(3)}" y="${y.toFixed(3)}" font-family="Helvetica, Arial, sans-serif" font-size="${(s.size * PT).toFixed(3)}"${s.bold ? ' font-weight="bold"' : ""} fill="${s.color ?? "#000"}" text-anchor="${anchor}" dominant-baseline="middle">${esc(text)}</text>`,
    );
  }
  toBlob(): Blob {
    const { width, height } = this.page;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width.toFixed(3)}mm" height="${height.toFixed(3)}mm" viewBox="0 0 ${width.toFixed(3)} ${height.toFixed(3)}">
<rect width="100%" height="100%" fill="#fff"/>
${this.parts.join("\n")}
</svg>
`;
    return new Blob([svg], { type: "image/svg+xml" });
  }
}

/** Splits a text into lines of about `width` mm at that size. */
function wrap(text: string, width: number, size: number): string[] {
  const perLine = Math.max(10, Math.floor(width / (size * PT * 0.5)));
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && (line + " " + word).length > perLine) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Title and how to put it together at the top; at the bottom, a 5 cm bar
 * to check it was printed at real size, and the page number.
 */
function frame(p: Painter, title: string, howTo: string, pageNo: number, pages: number) {
  const { width, height } = p.page;
  const m = PAGE_MARGIN;
  p.text(title, m, m + 2.5, { size: 11, bold: true });
  wrap(howTo, width - 2 * m, 7)
    .slice(0, 3)
    .forEach((line, i) => p.text(line, m, m + 6 + i * 2.7, { size: 7, color: "#333333" }));
  const y = height - m + 3;
  p.polygon(
    [
      [m, y - 1.2],
      [m, y],
      [m + 50, y],
      [m + 50, y - 1.2],
    ],
    { line: "cut" },
    false,
  );
  p.text("5 cm: medila para ver que imprimiste al 100 % (tamaño real, sin ajustar a la página)", m + 53, y - 0.4, { size: 6, color: "#555555" });
  if (pages > 1) p.text(`Hoja ${pageNo} de ${pages}`, width - m, y - 0.4, { size: 6, color: "#555555", align: "right" });
}

/** Short crop marks outside a rectangle's corners and along its inner lines. */
function cropMarks(p: Painter, grid: Rect, xs: number[], ys: number[]) {
  const gap = 1.5;
  const len = 5;
  for (const x of xs) {
    p.polygon([[x, grid.y - gap - len], [x, grid.y - gap]], { line: "cut" }, false);
    p.polygon([[x, grid.y + grid.height + gap], [x, grid.y + grid.height + gap + len]], { line: "cut" }, false);
  }
  for (const y of ys) {
    p.polygon([[grid.x - gap - len, y], [grid.x - gap, y]], { line: "cut" }, false);
    p.polygon([[grid.x + grid.width + gap, y], [grid.x + grid.width + gap + len, y]], { line: "cut" }, false);
  }
}

// --------------------------------------------------------------- frames

/**
 * The cells drawn at that size in pixels, as JPEGs for paper: a held
 * picture is the same image (and goes once into the PDF).
 */
export async function printFrames(
  filmId: string,
  film: FilmState,
  cells: readonly number[],
  width: number,
  height: number,
  progress: (done: number) => void,
): Promise<ToyImage[]> {
  const out: ToyImage[] = [];
  let last: ToyImage | null = null;
  const size = { width: Math.max(8, Math.round(width)), height: Math.max(8, Math.round(height)) };
  for await (const { canvas, index, changed } of renderCells(filmId, film, { ...size, cells })) {
    if (changed || !last) last = { key: `f${index}`, url: canvas.toDataURL("image/jpeg", 0.9) };
    out.push(last);
    progress(index + 1);
  }
  return out;
}

/**
 * The cells drawn at that size, as bitmaps (a held picture is the same one):
 * from the originals for paper, from the proxies for a preview on screen.
 */
export async function frameBitmaps(
  filmId: string,
  film: FilmState,
  cells: readonly number[],
  size: { width: number; height: number },
  res: "original" | "proxy",
  progress: (done: number) => void = () => undefined,
): Promise<ImageBitmap[]> {
  const out: ImageBitmap[] = [];
  let last: ImageBitmap | null = null;
  const px = { width: Math.max(8, Math.round(size.width)), height: Math.max(8, Math.round(size.height)) };
  for await (const { canvas, index, changed } of renderCells(filmId, film, { ...px, cells, res })) {
    if (changed || !last) last = await createImageBitmap(canvas);
    out.push(last);
    progress(index + 1);
  }
  return out;
}

/** Pixel size for a picture `mm` wide on paper, never bigger than the film. */
export function printPixels(film: FilmState, mmWide: number): { width: number; height: number } {
  const { width, height } = film.settings;
  const w = Math.min(width, mmWide * PRINT_PX_PER_MM);
  return { width: w, height: (w * height) / width };
}

// ------------------------------------------------------------ flipbook

const FLIPBOOK_HOWTO =
  "Recortá por las líneas. Apilá las hojitas en orden (la tapa arriba, después la 1, la 2, la 3…), emparejá el lado gris y abrochalo o pegalo con cinta bien firme. Doblá un poco las puntas y hojeá con el pulgar.";

export function flipbookPdf(layout: FlipbookLayout, page: PageSize, images: readonly ToyImage[], title: string): Blob {
  const p = new PdfPainter(page);
  const { grid, cols, rows, leafWidth, leafHeight } = layout;
  layout.pages.forEach((leaves, i) => {
    p.newPage();
    frame(p, `${title} — flipbook`, FLIPBOOK_HOWTO, i + 1, layout.pages.length);
    for (const l of leaves) {
      p.polygon(rectPoints(l.binding), { fill: "#e6e6e6" });
      if (l.frame === "cover") {
        p.polygon(rectPoints(l.picture), { fill: "#ffffff" });
        p.text(title, l.picture.x + l.picture.width / 2, l.picture.y + l.picture.height / 2 - 2, {
          size: Math.min(20, Math.max(9, l.picture.width / 6)),
          bold: true,
          align: "center",
        });
        p.text("Gepetta Studio", l.picture.x + l.picture.width / 2, l.picture.y + l.picture.height - 4, { size: 7, align: "center", color: "#777777" });
        p.text("TAPA", l.binding.x + l.binding.width / 2, l.binding.y + 4, { size: 6, bold: true, align: "center", color: "#555555" });
      } else {
        p.image(images[l.frame]!, l.picture);
        p.text(String(l.frame + 1), l.binding.x + l.binding.width / 2, l.binding.y + 4, { size: 8, bold: true, align: "center", color: "#333333" });
      }
      // Where the staples go.
      p.polygon([[l.binding.x + l.binding.width / 2, l.binding.y + l.binding.height * 0.3], [l.binding.x + l.binding.width / 2, l.binding.y + l.binding.height * 0.7]], { line: "fold" }, false);
    }
    // Cut lines: across the whole grid, and marks outside it.
    const used = Math.ceil(leaves.length / cols);
    const area = { ...grid, height: Math.min(rows, used) * leafHeight };
    const xs = Array.from({ length: cols + 1 }, (_, c) => grid.x + c * leafWidth);
    const ys = Array.from({ length: Math.min(rows, used) + 1 }, (_, r) => grid.y + r * leafHeight);
    for (const x of xs) p.polygon([[x, area.y], [x, area.y + area.height]], { line: "guide" }, false);
    for (const y of ys) p.polygon([[area.x, y], [area.x + area.width, y]], { line: "guide" }, false);
    cropMarks(p, area, xs, ys);
  });
  return p.doc.output("blob");
}

// ------------------------------------------------------------ zoetrope

function zoetropeHowTo(o: ZoetropeOptions) {
  if (o.stripOnly)
    return `Recortá por la línea llena. Pegá la pestaña de cada parte debajo del comienzo de la siguiente (la de la última cierra la vuelta: ${Math.round(Math.PI * o.diameter)} mm). Poné la tira adentro del tambor, abajo de las ranuras, hacelo girar en contra del reloj (visto desde arriba) y mirá por las ranuras.`;
  return `Recortá por la línea llena (también las ranuras) y doblá por la punteada. Uní la pared con sus pestañas en un tubo de ${Math.round(o.diameter)} mm de diámetro, ranuras arriba, y pegá los dientes a la base. La tira de dibujos va por dentro, abajo de las ranuras. Hacelo girar en contra del reloj (visto desde arriba) y mirá por las ranuras.`;
}

/** Glue tab on the right end of a strip, x0 being where the strip ends. */
function tabPoints(x0: number, y: number, h: number, tab: number): [number, number][] {
  const inset = Math.min(3, h / 4);
  return [
    [x0, y],
    [x0 + tab, y + inset],
    [x0 + tab, y + h - inset],
    [x0, y + h],
  ];
}

function drawZoetropeItem(p: Painter, item: ZoetropeItem, o: ZoetropeOptions, l: ZoetropeLayout, images: readonly ToyImage[], aspect: number) {
  const parts = l.pieces.length;
  if (item.kind === "base") {
    p.circle(item.cx, item.cy, item.r, { line: "cut" });
    p.circle(item.cx, item.cy, 0.8, { fill: "#000000" });
    p.text("Base del tambor: pegale los dientes de la pared", item.cx, item.cy + 6, { size: 7, align: "center", color: "#555555" });
    return;
  }
  const { x, y, height, piece } = item;
  const end = x + piece.length;
  if (item.kind === "pictures") {
    for (let i = 0; i < piece.count; i++) {
      const cell = { x: x + i * l.pitch, y, width: l.pitch, height };
      p.image(images[piece.from + i]!, fitRect(cell, aspect));
      if (i) p.polygon([[cell.x, y], [cell.x, y + height]], { line: "guide" }, false);
    }
    p.polygon(tabPoints(end, y, height, o.tab), { fill: "#eeeeee" });
    p.polygon([[end, y + height], [x, y + height], [x, y], [end, y], ...tabPoints(end, y, height, o.tab).slice(1)], { line: "cut" });
    p.polygon([[end, y], [end, y + height]], { line: "fold" }, false);
    p.text(
      `Tira de dibujos${parts > 1 ? ` · parte ${item.index + 1} de ${parts}` : ""} · cuadros ${piece.from + 1} a ${piece.from + piece.count}`,
      x,
      y + height + 2.6,
      { size: 6.5, color: "#555555" },
    );
    return;
  }
  // The wall: slits on top, room for the pictures, teeth for the base underneath.
  const bottom = y + height;
  const teeth: [number, number][] = [];
  const tw = 10;
  const gap = 2;
  for (let a = end; a - tw >= x - 1e-9; a -= tw + gap) {
    teeth.push([a, bottom], [a - 1.5, bottom + ZOETROPE_TEETH], [a - tw + 1.5, bottom + ZOETROPE_TEETH], [a - tw, bottom]);
  }
  const tab = tabPoints(end, y, height, o.tab);
  p.polygon(tab, { fill: "#eeeeee" });
  p.polygon([[x, y], [end, y], ...tab.slice(1), ...teeth, [x, bottom]], { line: "cut" });
  p.polygon([[end, y], [end, bottom]], { line: "fold" }, false);
  p.polygon([[x, bottom], [end, bottom]], { line: "fold" }, false);
  const slitTop = y + ZOETROPE_BORDER;
  for (let i = 0; i < piece.count; i++) {
    const cx = x + (i + 0.5) * l.pitch;
    p.polygon(rectPoints({ x: cx - o.slitWidth / 2, y: slitTop, width: o.slitWidth, height: o.slitHeight }), { line: "cut", fill: "#444444" });
  }
  const pics = { x, y: slitTop + o.slitHeight + ZOETROPE_BORDER, width: piece.length, height: o.pictureHeight };
  p.polygon(rectPoints(pics), { line: "guide" });
  p.text("del otro lado (adentro) va la tira de dibujos", x + piece.length / 2, pics.y + pics.height / 2, { size: 7, align: "center", color: "#aaaaaa" });
  p.text(`Pared${parts > 1 ? ` · parte ${item.index + 1} de ${parts}` : ""}`, end + 1, bottom + ZOETROPE_TEETH + 2.6, { size: 6.5, color: "#555555", align: "right" });
}

function drawZoetrope(p: Painter & { newPage?(): void }, o: ZoetropeOptions, images: readonly ToyImage[], aspect: number, title: string) {
  const l = zoetropeLayout(o);
  const howTo = zoetropeHowTo(o) + (l.baseFits ? "" : ` La base no entra en la hoja: recortá un círculo de cartón de ${Math.round(o.diameter)} mm.`);
  l.pages.forEach((items, i) => {
    p.newPage?.();
    frame(p, `${title} — zootropo`, howTo, i + 1, l.pages.length);
    for (const item of items) drawZoetropeItem(p, item, o, l, images, aspect);
  });
}

export function zoetropePdf(o: ZoetropeOptions, images: readonly ToyImage[], aspect: number, title: string): Blob {
  const p = new PdfPainter(o.page);
  drawZoetrope(p, o, images, aspect, title);
  return p.doc.output("blob");
}

/** Both strips in one piece each (no splitting), on one long page: for a plotter or a laser. */
export function zoetropeSvg(o: ZoetropeOptions, images: readonly ToyImage[], aspect: number, title: string): Blob {
  const width = Math.PI * o.diameter + o.tab + 2 * PAGE_MARGIN + 1;
  const wall = ZOETROPE_BORDER * 3 + o.slitHeight + o.pictureHeight + ZOETROPE_TEETH;
  // Room for everything on one page: both strips, their labels, the base.
  const height = 2 * PAGE_MARGIN + PAGE_HEADER + o.pictureHeight + (o.stripOnly ? 20 : wall + o.diameter + 40);
  const page = { width, height };
  const p = new SvgPainter(page);
  drawZoetrope(p, { ...o, page }, images, aspect, title);
  return p.toBlob();
}

// ------------------------------------------------------- phenakistoscope

const DISC_HOWTO =
  "Pegá la hoja sobre cartón fino y recortá por la línea llena: el borde con las ranuras y el agujero del centro. Pinchalo con un lápiz o un clavo, ponete frente a un espejo con los dibujos hacia el espejo, hacelo girar para el lado de la flecha y mirá por las ranuras.";

/** How many pixels per mm the disc is painted at for paper. */
const DISC_PX_PER_MM = 10;

/**
 * Paints the face of the disc (white, the pictures around the ring, the
 * arrow to spin it) centred on (0, 0) of `ctx`, at `scale` px per mm. The
 * pictures can be mirrored so they look right in the mirror.
 */
export function paintDisc(
  ctx: CanvasRenderingContext2D,
  o: DiscOptions,
  frames: readonly CanvasImageSource[],
  scale: number,
  mirror: boolean,
  numbers = true,
) {
  ctx.save();
  ctx.scale(scale, scale);
  // The disc as it is cut: notched rim, hole in the middle.
  ctx.beginPath();
  discOutline(o, 1).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.moveTo(o.hole / 2, 0);
  ctx.arc(0, 0, o.hole / 2, 0, 2 * Math.PI, true);
  ctx.fillStyle = "#fff";
  ctx.fill("evenodd");
  ctx.lineWidth = 0.2;
  ctx.strokeStyle = "#ddd";
  for (const r of [o.innerRadius, o.outerRadius]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    ctx.stroke();
  }
  discPictures(o).forEach((pic, i) => {
    const img = frames[i];
    if (!img) return;
    ctx.save();
    ctx.rotate(pic.angle);
    // Standing on r0, its top towards the rim.
    ctx.translate(0, -pic.r0 - pic.height / 2);
    if (mirror) ctx.scale(-1, 1);
    ctx.drawImage(img, -pic.width / 2, -pic.height / 2, pic.width, pic.height);
    ctx.restore();
    if (numbers) {
      const [nx, ny] = polar(pic.r0 - 2.5, pic.angle);
      ctx.fillStyle = "#999";
      ctx.font = `bold 2.6px Helvetica, Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), nx, ny);
    }
  });
  // Spin anticlockwise (seen from the printed side): an arrow inside the ring.
  const ar = Math.max(o.hole / 2 + 4, o.innerRadius * 0.65);
  ctx.strokeStyle = "#ff7a45";
  ctx.fillStyle = "#ff7a45";
  ctx.lineWidth = Math.max(0.6, ar / 18);
  const from = 0.6;
  const to = -1.4;
  ctx.beginPath();
  for (let k = 0; k <= 24; k++) {
    const [x, y] = polar(ar, from + ((to - from) * k) / 24);
    if (k) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.stroke();
  const head = ar * 0.22;
  const tip = polar(ar, to - head / ar * 1.6);
  const [ox, oy] = polar(ar + head, to);
  const [ix, iy] = polar(ar - head, to);
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(ox, oy);
  ctx.lineTo(ix, iy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The disc as a JPEG (white around it), `size` mm square, for paper. */
function discImage(o: DiscOptions, frames: readonly CanvasImageSource[], mirror: boolean): ToyImage {
  const px = Math.round(o.diameter * DISC_PX_PER_MM);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, px, px);
  ctx.translate(px / 2, px / 2);
  ctx.imageSmoothingQuality = "high";
  paintDisc(ctx, o, frames, DISC_PX_PER_MM, mirror);
  return { key: "disc", url: canvas.toDataURL("image/jpeg", 0.92) };
}

function drawDisc(p: Painter, o: DiscOptions, image: ToyImage, cx: number, cy: number, title: string) {
  const R = o.diameter / 2;
  frame(p, `${title} — fenakitoscopio`, DISC_HOWTO, 1, 1);
  p.image(image, { x: cx - R, y: cy - R, width: o.diameter, height: o.diameter });
  p.polygon(
    discOutline(o, 0.5).map(([x, y]) => [x + cx, y + cy] as [number, number]),
    { line: "cut" },
  );
  p.circle(cx, cy, o.hole / 2, { line: "cut" });
  p.text(`${o.frames} dibujos · ${o.slits} ranuras · ${Math.round(o.diameter)} mm`, cx, cy + R + 3, { size: 6.5, align: "center", color: "#555555" });
}

/** Pixel size of the frames painted on the disc for paper. */
export function discFramePixels(o: DiscOptions, film: FilmState): { width: number; height: number } {
  const pic = discPictures(o)[0];
  const { width, height } = film.settings;
  const w = Math.max(8, Math.min(width, (pic?.width ?? 10) * DISC_PX_PER_MM));
  return { width: Math.round(w), height: Math.round((w * height) / width) };
}

export function discPdf(o: DiscOptions, page: PageSize, frames: readonly CanvasImageSource[], mirror: boolean, title: string): Blob {
  const p = new PdfPainter(page);
  p.newPage();
  const area = printableArea(page);
  drawDisc(p, o, discImage(o, frames, mirror), area.x + area.width / 2, area.y + area.height / 2, title);
  return p.doc.output("blob");
}

export function discSvg(o: DiscOptions, frames: readonly CanvasImageSource[], mirror: boolean, title: string): Blob {
  const page = { width: Math.max(150, o.diameter + 2 * PAGE_MARGIN), height: o.diameter + 2 * PAGE_MARGIN + PAGE_HEADER + 12 };
  const p = new SvgPainter(page);
  drawDisc(p, o, discImage(o, frames, mirror), page.width / 2, PAGE_MARGIN + PAGE_HEADER + o.diameter / 2, title);
  return p.toBlob();
}

/** Only what gets cut: the outline with its slits and the centre hole, centred on (0, 0). */
export function discDxf(o: DiscOptions): Blob {
  return new Blob([dxf([discOutline(o, 0.5)], [{ cx: 0, cy: 0, r: o.hole / 2 }])], { type: "application/dxf" });
}

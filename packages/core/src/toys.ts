/**
 * Optical toys printed from a film: flipbook, zoetrope and phenakistoscope.
 * Pure layout in millimetres on the page (x to the right, y down, origin at
 * the page's top-left corner), so that printed at 100 % every length is real.
 * Drawing the pictures and writing the files is up to the UI.
 */

export interface PageSize {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PaperId = "a4" | "letter";
export type Orientation = "portrait" | "landscape";

/** Paper sizes in mm, standing up. */
export const PAPERS: Record<PaperId, PageSize & { label: string }> = {
  a4: { label: "A4", width: 210, height: 297 },
  letter: { label: "Carta", width: 215.9, height: 279.4 },
};

/** Most printers can't print closer than this to the edge. */
export const PAGE_MARGIN = 10;
/** Room at the top of every page for its title and how to put it together. */
export const PAGE_HEADER = 15;

export function pageSize(paper: PaperId, orientation: Orientation): PageSize {
  const p = PAPERS[paper];
  return orientation === "portrait" ? { width: p.width, height: p.height } : { width: p.height, height: p.width };
}

/** The part of the page there is to lay things out on: inside the margins, under the header. */
export function printableArea(page: PageSize): Rect {
  return {
    x: PAGE_MARGIN,
    y: PAGE_MARGIN + PAGE_HEADER,
    width: page.width - 2 * PAGE_MARGIN,
    height: page.height - 2 * PAGE_MARGIN - PAGE_HEADER,
  };
}

/** One of every `step` items, starting with the first (a lighter animation for a toy). */
export function everyNth<T>(items: readonly T[], step: number): T[] {
  const s = Math.max(1, Math.floor(step));
  return items.filter((_, i) => i % s === 0);
}

/** The biggest `aspect` (width / height) rectangle that fits in a box, centred in it. */
export function fitRect(box: Rect, aspect: number): Rect {
  const width = Math.min(box.width, box.height * aspect);
  const height = width / aspect;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

// ---------------------------------------------------------------- flipbook

export interface FlipbookOptions {
  page: PageSize;
  /** Number of pictures. */
  frames: number;
  /** Width of each picture, in mm. */
  pictureWidth: number;
  /** Film width / height. */
  aspect: number;
  /** Strip on the left of each leaf, to staple or glue the pile together. */
  binding: number;
  /** A first leaf with the title, on top of the pile. */
  cover: boolean;
}

export interface FlipbookLeaf {
  /** The whole leaf, binding strip included: what gets cut out. */
  leaf: Rect;
  binding: Rect;
  picture: Rect;
  /** Index of the picture, or "cover". */
  frame: number | "cover";
}

export interface FlipbookLayout {
  cols: number;
  rows: number;
  perPage: number;
  leafWidth: number;
  leafHeight: number;
  /** The leaves on each page; together they cover the grid's rectangle. */
  pages: FlipbookLeaf[][];
  /** The grid on each page (the same on all of them), for the cut lines. */
  grid: Rect;
}

/** The widest picture a flipbook leaf can have on that page. */
export function maxFlipbookPicture(page: PageSize, aspect: number, binding: number): number {
  const area = printableArea(page);
  return Math.max(0, Math.min(area.width - binding, area.height * aspect));
}

/**
 * Leaves packed edge to edge in a grid centred on the page, so every cut is
 * one straight line across it. Leaf order runs along rows, page after page.
 */
export function flipbookLayout(o: FlipbookOptions): FlipbookLayout {
  const area = printableArea(o.page);
  const pictureWidth = Math.min(o.pictureWidth, maxFlipbookPicture(o.page, o.aspect, o.binding));
  const leafWidth = o.binding + pictureWidth;
  const leafHeight = pictureWidth / o.aspect;
  const cols = Math.max(1, Math.floor(area.width / leafWidth + 1e-9));
  const rows = Math.max(1, Math.floor(area.height / leafHeight + 1e-9));
  const perPage = cols * rows;
  const grid = {
    x: area.x + (area.width - cols * leafWidth) / 2,
    y: area.y + (area.height - rows * leafHeight) / 2,
    width: cols * leafWidth,
    height: rows * leafHeight,
  };
  const order: (number | "cover")[] = [...(o.cover ? ["cover" as const] : []), ...Array.from({ length: o.frames }, (_, i) => i)];
  const pages: FlipbookLeaf[][] = [];
  order.forEach((frame, i) => {
    const slot = i % perPage;
    if (slot === 0) pages.push([]);
    const x = grid.x + (slot % cols) * leafWidth;
    const y = grid.y + Math.floor(slot / cols) * leafHeight;
    pages[pages.length - 1]!.push({
      leaf: { x, y, width: leafWidth, height: leafHeight },
      binding: { x, y, width: o.binding, height: leafHeight },
      picture: { x: x + o.binding, y, width: pictureWidth, height: leafHeight },
      frame,
    });
  });
  return { cols, rows, perPage, leafWidth, leafHeight, pages, grid };
}

// ---------------------------------------------------------------- zoetrope

export interface ZoetropeOptions {
  page: PageSize;
  frames: number;
  /** Inside diameter of the drum. */
  diameter: number;
  /** Height of the picture strip. */
  pictureHeight: number;
  /** Height of each slit in the wall. */
  slitHeight: number;
  slitWidth: number;
  /** Glue tab at the end of each piece. */
  tab: number;
  /** Only the picture strip, for a drum there already is. */
  stripOnly?: boolean;
}

/** Wall of the drum, top to bottom: border, slits, gap, the pictures' height, border; then teeth folded onto the base. */
export const ZOETROPE_BORDER = 5;
export const ZOETROPE_TEETH = 8;
/** Room under each strip for its label. */
const STRIP_LABEL = 5;
const STRIP_GAP = 4;

export interface ZoetropePiece {
  /** First picture on this piece, and how many. */
  from: number;
  count: number;
  /** Length without the glue tab. */
  length: number;
}

export type ZoetropeItem =
  | { kind: "pictures"; x: number; y: number; height: number; piece: ZoetropePiece; index: number }
  | { kind: "wall"; x: number; y: number; height: number; piece: ZoetropePiece; index: number }
  | { kind: "base"; cx: number; cy: number; r: number };

export interface ZoetropeLayout {
  /** Length of the strip around the drum: π·d. */
  circumference: number;
  /** Distance from one picture (and one slit) to the next. */
  pitch: number;
  /** Height of the wall strip, teeth not included. */
  wallHeight: number;
  pieces: ZoetropePiece[];
  pages: ZoetropeItem[][];
  /** The base disc fits on a page (else: cut it from cardboard by hand). */
  baseFits: boolean;
}

/** Height of the picture strip so pictures keep the film's shape, edge to edge. */
export function zoetropeDefaultHeight(frames: number, diameter: number, aspect: number): number {
  return Math.round((Math.PI * diameter) / Math.max(1, frames) / aspect);
}

/** Where the slits go along a strip of `count` cells: in the middle of each. */
export function slitCenters(count: number, pitch: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 0.5) * pitch);
}

/**
 * The strip of pictures and the slotted wall, both π·d long, cut into as few
 * pieces as fit across the page (always between two pictures, so no picture
 * or slit is split), each with a glue tab for the next one; the last piece's
 * tab closes the ring. Pieces are stacked down the pages, then the base.
 */
export function zoetropeLayout(o: ZoetropeOptions): ZoetropeLayout {
  const area = printableArea(o.page);
  const frames = Math.max(1, o.frames);
  const circumference = Math.PI * o.diameter;
  const pitch = circumference / frames;
  const perPiece = Math.max(1, Math.floor((area.width - o.tab) / pitch + 1e-9));
  const count = Math.ceil(frames / perPiece);
  const even = Math.ceil(frames / count);
  const pieces: ZoetropePiece[] = [];
  for (let from = 0; from < frames; from += even) {
    const n = Math.min(even, frames - from);
    pieces.push({ from, count: n, length: n * pitch });
  }
  const wallHeight = ZOETROPE_BORDER * 3 + o.slitHeight + o.pictureHeight;

  const pages: ZoetropeItem[][] = [[]];
  let y = area.y;
  const place = (height: number, make: (x: number, y: number) => ZoetropeItem) => {
    if (y + height > area.y + area.height + 1e-9 && pages[pages.length - 1]!.length) {
      pages.push([]);
      y = area.y;
    }
    pages[pages.length - 1]!.push(make(area.x, y));
    y += height + STRIP_LABEL + STRIP_GAP;
  };
  pieces.forEach((piece, index) => place(o.pictureHeight, (x, y) => ({ kind: "pictures", x, y, height: o.pictureHeight, piece, index })));
  if (o.stripOnly) return { circumference, pitch, wallHeight, pieces, pages, baseFits: true };
  pieces.forEach((piece, index) =>
    place(wallHeight + ZOETROPE_TEETH, (x, y) => ({ kind: "wall", x, y, height: wallHeight, piece, index })),
  );
  const baseFits = o.diameter <= Math.min(area.width, area.height);
  if (baseFits) {
    const r = o.diameter / 2;
    if (y + o.diameter > area.y + area.height) {
      pages.push([]);
      y = area.y;
    }
    pages[pages.length - 1]!.push({ kind: "base", cx: area.x + area.width / 2, cy: y + r, r });
  }
  return { circumference, pitch, wallHeight, pieces, pages, baseFits };
}

// --------------------------------------------------------- phenakistoscope

export interface DiscOptions {
  frames: number;
  slits: number;
  /** Diameter of the whole disc. */
  diameter: number;
  /** The picture ring, from the centre. */
  innerRadius: number;
  outerRadius: number;
  /** Film width / height. */
  aspect: number;
  slitWidth: number;
  /** Diameter of the hole in the middle, for the axle (a pencil, a nail). */
  hole: number;
}

/** Room left between the picture ring and the bottom of the slits. */
export const DISC_SLIT_GAP = 3;

/**
 * Where each picture sits on the disc: `angle` is clockwise from 12 o'clock
 * (pictures run clockwise, so the disc turns anticlockwise seen from the
 * printed side); the picture stands on radius `r0` with its top outwards.
 */
export interface DiscPicture {
  angle: number;
  r0: number;
  width: number;
  height: number;
}

/**
 * The biggest picture of that shape that fits in one N-th of the ring
 * without touching its neighbours: its inner corners must stay inside the
 * slice and its outer corners inside the outer circle.
 */
export function fitDiscPicture(frames: number, inner: number, outer: number, aspect: number): Omit<DiscPicture, "angle"> {
  const half = Math.PI / Math.max(2, frames);
  // Leave a sliver between neighbours.
  const tan = Math.tan(half) * 0.94;
  const fits = (h: number) => {
    const w = h * aspect;
    const r0 = Math.max(inner, w / 2 / tan);
    return Math.hypot(r0 + h, w / 2) <= outer ? r0 : null;
  };
  let lo = 0;
  let hi = Math.max(0, outer - inner);
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid) !== null) lo = mid;
    else hi = mid;
  }
  const r0 = fits(lo) ?? inner;
  // Centre it across the ring when there is room to spare.
  const spare = outer - Math.hypot(r0 + lo, (lo * aspect) / 2);
  return { r0: r0 + Math.max(0, spare) / 2, width: lo * aspect, height: lo };
}

export function discPictures(o: DiscOptions): DiscPicture[] {
  const fit = fitDiscPicture(o.frames, o.innerRadius, o.outerRadius, o.aspect);
  return Array.from({ length: o.frames }, (_, i) => ({ angle: (i * 2 * Math.PI) / o.frames, ...fit }));
}

/** Angle of each slit, clockwise from 12 o'clock: half a step off the first picture. */
export function discSlitAngles(slits: number): number[] {
  return Array.from({ length: slits }, (_, j) => ((j + 0.5) * 2 * Math.PI) / slits);
}

/** A point at `r` from the centre, `angle` clockwise from 12 o'clock (y down). */
export function polar(r: number, angle: number): [number, number] {
  return [r * Math.sin(angle), -r * Math.cos(angle)];
}

/**
 * The disc's cut outline, centred on (0, 0), y down: the rim with a straight
 * slot cut in from it for each slit, down to just above the picture ring.
 * Arcs are approximated with segments no longer than `step` mm.
 */
export function discOutline(o: DiscOptions, step = 1): [number, number][] {
  const R = o.diameter / 2;
  const hw = o.slitWidth / 2;
  const bottom = Math.min(R - 1, o.outerRadius + DISC_SLIT_GAP);
  const angles = discSlitAngles(o.slits);
  const delta = Math.asin(Math.min(1, hw / R));
  const points: [number, number][] = [];
  const along = (phi: number, radial: number, side: number): [number, number] => {
    const [ux, uy] = polar(1, phi);
    // Clockwise tangent: (cos, sin).
    return [ux * radial + Math.cos(phi) * side, uy * radial + Math.sin(phi) * side];
  };
  angles.forEach((phi, j) => {
    points.push(along(phi, Math.sqrt(R * R - hw * hw), -hw), along(phi, bottom, -hw), along(phi, bottom, hw), along(phi, Math.sqrt(R * R - hw * hw), hw));
    const from = phi + delta;
    const to = (angles[j + 1] ?? angles[0]! + 2 * Math.PI) - delta;
    const n = Math.max(1, Math.ceil(((to - from) * R) / step));
    for (let k = 1; k < n; k++) points.push(polar(R, from + ((to - from) * k) / n));
  });
  return points;
}

/** What the slits do to the animation, for the hint next to the choice. */
export function slitEffect(frames: number, slits: number): "still" | "backwards" | "forwards" {
  return slits === frames ? "still" : slits > frames ? "backwards" : "forwards";
}

// ------------------------------------------------------------ cut files

/** An SVG path through the points (closed), in mm. */
export function svgPolygon(points: readonly [number, number][], dx = 0, dy = 0): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${(x + dx).toFixed(3)} ${(y + dy).toFixed(3)}`).join(" ") + " Z";
}

/**
 * A DXF (R12, the one every laser cutter program reads) with closed
 * polylines and circles, in mm. Points come y down and go out y up.
 */
export function dxf(polylines: readonly (readonly [number, number][])[], circles: readonly { cx: number; cy: number; r: number }[]): string {
  const out: (string | number)[] = [0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1009", 9, "$INSUNITS", 70, 4, 0, "ENDSEC"];
  out.push(0, "SECTION", 2, "ENTITIES");
  const n = (v: number) => (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6);
  for (const line of polylines) {
    out.push(0, "POLYLINE", 8, "CORTE", 66, 1, 70, 1, 10, n(0), 20, n(0), 30, n(0));
    for (const [x, y] of line) out.push(0, "VERTEX", 8, "CORTE", 10, n(x), 20, n(-y), 30, n(0));
    out.push(0, "SEQEND", 8, "CORTE");
  }
  for (const c of circles) out.push(0, "CIRCLE", 8, "CORTE", 10, n(c.cx), 20, n(-c.cy), 30, n(0), 40, n(c.r));
  out.push(0, "ENDSEC", 0, "EOF");
  return out.join("\n") + "\n";
}

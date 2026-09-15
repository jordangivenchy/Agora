/* The call gallery's arrangement, one piece of logic for the website and
   the phone app (mobile/src/roomTiles.tsx imports this file). Discord's
   way: everyone gets a window of one shape — 16:9 on the site, square on
   the app — as big as the space allows.

   - A shared screen takes a block of at least two windows, the block
     closest to a screen's own 16:9: two squares side by side on the app,
     two by two on the site (two 16:9 windows side by side would squeeze
     a screen into a letterbox). A second screen takes one window when a
     window already has a screen's shape. A screen on its own fills the
     width at 16:9.
   - The grid tries one to four columns, fills the rows in order (a
     screen's block at the first place it fits, the next windows around
     it) and keeps the column count that gives the biggest windows —
     preferring more columns when two come within 5%, so seven people
     read as three, three and one rather than a tall stack of pairs.
   - A thin column is a list, not a call: when the biggest windows leave
     more than 30% of the width empty and more columns keep them at least
     80% as big, the grid takes the columns (four people on a phone read
     as two by two, not a stack of four).
   - A short last row sits centred.
   - A cap, when given, keeps a nearly empty stage from blowing one person
     up to the whole space: the app never draws a window bigger than its
     two-column size, so one person is a card, not the screen. A screen
     on its own is content and is never capped. */

export type GridKind = "camera" | "screen";
export interface GridCell { index: number; x: number; y: number; w: number; h: number }
export interface GridPlan {
  cols: number;
  /** A person's window: its width (its height is width / ratio). */
  size: number;
  width: number;
  height: number;
  cells: GridCell[];
}

const MAX_COLS = 4;
/** Within this fraction of the biggest windows, more columns win. */
const TIE = 0.05;
/** A grid narrower than this share of the width is a thin column... */
const THIN = 0.7;
/** ...and gives way to more columns whose windows are at least this big by comparison. */
const WIDER_KEEPS = 0.8;
const SCREEN = 16 / 9;

interface Span { c: number; r: number }

const off = (shape: number) => Math.abs(Math.log(shape / SCREEN));

/** The block a screen takes among people: at least two windows, the shape closest to a screen's. */
export function screenBlock(ratio: number): Span {
  const options: Span[] = [{ c: 2, r: 1 }, { c: 1, r: 2 }, { c: 2, r: 2 }];
  let best = options[0];
  for (const o of options.slice(1)) {
    const d = off((o.c * ratio) / o.r) - off((best.c * ratio) / best.r);
    if (d < -1e-9 || (Math.abs(d) <= 1e-9 && o.c * o.r < best.c * best.r)) best = o;
  }
  return best;
}

/** How many of the gallery's places a number of screens take among people, by the same rule as the grid. */
export function screenPlaces(screens: number, ratio: number): number {
  if (screens <= 0) return 0;
  const block = screenBlock(ratio);
  return block.c * block.r + (screens - 1) * (off(ratio) < 0.2 ? 1 : block.c * block.r);
}

function spansFor(kinds: GridKind[], ratio: number): Span[] {
  const block = screenBlock(ratio);
  const windowIsScreenShaped = off(ratio) < 0.2;
  let screens = 0;
  return kinds.map((k) => {
    if (k !== "screen" || kinds.length === 1) return { c: 1, r: 1 };
    screens++;
    return screens > 1 && windowIsScreenShaped ? { c: 1, r: 1 } : block;
  });
}

/* First fit, row by row: each item at the first place its block fits. One column holds one window per row. */
function pack(spans: Span[], cols: number): { at: { col: number; row: number }[]; rows: number } {
  const taken: boolean[][] = [];
  const fits = (col: number, row: number, s: Span) => {
    for (let r = row; r < row + s.r; r++) for (let c = col; c < col + s.c; c++) if (c >= cols || taken[r]?.[c]) return false;
    return true;
  };
  const at = spans.map((raw) => {
    const s = cols === 1 ? { c: 1, r: 1 } : raw;
    for (let row = 0; ; row++) {
      for (let col = 0; col + s.c <= cols; col++) {
        if (!fits(col, row, s)) continue;
        for (let r = row; r < row + s.r; r++) {
          taken[r] ??= [];
          for (let c = col; c < col + s.c; c++) taken[r][c] = true;
        }
        return { col, row };
      }
    }
  });
  return { at, rows: taken.length };
}

export function planGrid(kinds: GridKind[], width: number, height: number, gap: number, ratio = 1, maxSize = Infinity): GridPlan {
  if (!kinds.length || width <= 0 || height <= 0) return { cols: 1, size: 0, width: 0, height: 0, cells: [] };
  const spans = spansFor(kinds, ratio);
  /* A screen among people always gets its block, so never fewer columns than the block. */
  const minCols = kinds.includes("screen") && kinds.length > 1 ? screenBlock(ratio).c : 1;
  const maxCols = Math.min(MAX_COLS, Math.max(minCols, kinds.reduce((n, _, i) => n + spans[i].c * spans[i].r, 0)));

  type Choice = { cols: number; size: number; at: { col: number; row: number }[]; rows: number; factors: number[] };
  let best: Choice | null = null;
  const all: Choice[] = [];
  for (let cols = minCols; cols <= maxCols; cols++) {
    const { at, rows } = pack(spans, cols);
    /* Row heights as a fraction of a window's width: a person's row is 1/ratio; a lone-column screen row is 9/16. */
    const factors = Array.from({ length: rows }, () => 1 / ratio);
    if (cols === 1) at.forEach((p, i) => { if (kinds[i] === "screen") factors[p.row] = 9 / 16; });
    const units = factors.reduce((a, b) => a + b, 0);
    const lone = kinds.length === 1 && kinds[0] === "screen";
    const size = Math.min((width - gap * (cols - 1)) / cols, (height - gap * (rows - 1)) / units, lone ? Infinity : maxSize);
    all.push({ cols, size, at, rows, factors });
    if (!best || size > best.size * (1 + TIE) || (size >= best.size * (1 - TIE) && cols > best.cols && rows < best.rows)) {
      best = { cols, size, at, rows, factors };
    }
  }
  const blockWidth = (c: Choice) => c.size * c.cols + gap * (c.cols - 1);
  if (blockWidth(best!) < width * THIN) {
    const wider = all.find((c) => c.cols > best!.cols && c.size >= best!.size * WIDER_KEEPS);
    if (wider) best = wider;
  }

  const { cols, at, rows, factors } = best!;
  const size = Math.floor(best!.size);
  const rowH = factors.map((f) => Math.round(size * f));
  const rowTop: number[] = [];
  let acc = 0;
  for (let r = 0; r < rows; r++) { rowTop[r] = acc; acc += rowH[r] + gap; }
  const blockH = acc - gap;
  const blockW = size * cols + gap * (cols - 1);
  const left = Math.round((width - blockW) / 2);
  const top = Math.round((height - blockH) / 2);
  const cells: GridCell[] = at.map((p, i) => {
    const s = cols === 1 ? { c: 1, r: 1 } : spans[i];
    const h = rowH.slice(p.row, p.row + s.r).reduce((a, b) => a + b, 0) + gap * (s.r - 1);
    return { index: i, x: left + p.col * (size + gap), y: top + rowTop[p.row], w: size * s.c + gap * (s.c - 1), h };
  });

  /* A short last row, holding only its own windows, sits centred. */
  const last = rows - 1;
  const lastRow = cells.filter((cell) => at[cell.index].row === last);
  const spill = cells.some((cell) => at[cell.index].row < last && at[cell.index].row + (cols === 1 ? 1 : spans[cell.index].r) - 1 >= last);
  const used = lastRow.reduce((n, cell) => n + (cols === 1 ? 1 : spans[cell.index].c), 0);
  if (!spill && used < cols && lastRow.length) {
    const w = lastRow.reduce((n, cell) => n + cell.w, 0) + gap * (lastRow.length - 1);
    let x = Math.round((width - w) / 2);
    for (const cell of lastRow.sort((a, b) => a.x - b.x)) { cell.x = x; x += cell.w + gap; }
  }
  return { cols, size, width: blockW, height: blockH, cells };
}

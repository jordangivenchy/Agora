/* The gallery's arrangement, the way Discord lays out a call: every camera
   is a square window, a shared screen takes the room of two windows side
   by side, and the windows are as big as the space allows. For each count
   the grid tries one to four columns, packs the pictures into rows in
   order (a screen needs two free places in its row), and keeps the column
   count that gives the biggest windows — preferring more columns when two
   come within a few percent, so seven people read as three, three and one
   rather than a tall stack of pairs. A short last row sits centred. A
   screen on its own runs the full width at 16:9. Past nine places the
   last window is "+N" (gallerySlots.ts decides who is in view). */

export type GridKind = "camera" | "screen";
export interface GridCell { index: number; x: number; y: number; w: number; h: number }
export interface GridPlan { cols: number; size: number; width: number; height: number; cells: GridCell[] }

const MAX_COLS = 4;
/** Within this fraction of the biggest windows, more columns win. */
const TIE = 0.05;

/* Rows of indexes; a screen needs two free places in its row once there are two columns. */
function pack(kinds: GridKind[], cols: number): number[][] {
  const rows: number[][] = [];
  let used = cols;
  kinds.forEach((k, i) => {
    const span = k === "screen" && cols >= 2 ? 2 : 1;
    if (used + span > cols) { rows.push([]); used = 0; }
    rows[rows.length - 1].push(i);
    used += span;
  });
  return rows;
}

/* A one-column screen row is 16:9 of the width; every other row is one window tall. */
const rowUnits = (row: number[], kinds: GridKind[], cols: number) => (cols === 1 && kinds[row[0]] === "screen" ? 9 / 16 : 1);

function choose(kinds: GridKind[], width: number, height: number, gap: number): { cols: number; size: number; rows: number[][] } {
  let best: { cols: number; size: number; rows: number[][] } | null = null;
  /* A screen among cameras always reads as two windows wide. */
  const minCols = kinds.includes("screen") && kinds.length > 1 ? 2 : 1;
  for (let cols = minCols; cols <= Math.min(MAX_COLS, Math.max(minCols, kinds.length * 2)); cols++) {
    const rows = pack(kinds, cols);
    const units = rows.reduce((sum, row) => sum + rowUnits(row, kinds, cols), 0);
    const size = Math.min((width - gap * (cols - 1)) / cols, (height - gap * (rows.length - 1)) / units);
    if (!best || size > best.size * (1 + TIE) || (size >= best.size * (1 - TIE) && cols > best.cols && rows.length < best.rows.length)) {
      best = { cols, size, rows };
    }
  }
  return best!;
}

export function planGrid(kinds: GridKind[], width: number, height: number, gap: number): GridPlan {
  if (!kinds.length || width <= 0 || height <= 0) return { cols: 1, size: 0, width: 0, height: 0, cells: [] };
  const { cols, size: fit, rows } = choose(kinds, width, height, gap);
  const size = Math.floor(fit);
  const rowH = (row: number[]) => Math.round(size * rowUnits(row, kinds, cols));
  const itemW = (i: number) => (kinds[i] === "screen" && cols >= 2 ? size * 2 + gap : size);
  const blockH = rows.reduce((sum, row) => sum + rowH(row), 0) + gap * (rows.length - 1);
  const cells: GridCell[] = [];
  let y = Math.round((height - blockH) / 2);
  for (const row of rows) {
    const h = rowH(row);
    const w = row.reduce((sum, i) => sum + itemW(i), 0) + gap * (row.length - 1);
    let x = Math.round((width - w) / 2);
    for (const i of row) {
      cells.push({ index: i, x, y, w: itemW(i), h });
      x += itemW(i) + gap;
    }
    y += h + gap;
  }
  return { cols, size, width: size * cols + gap * (cols - 1), height: blockH, cells };
}

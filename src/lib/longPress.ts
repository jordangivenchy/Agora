/* Press-and-hold (iMessage-style) for touch and pen, as a controller you
   share across many targets — one instance per list, handlers spread on
   each item with its own payload. Mouse pointers are ignored (desktop
   uses click). A press that fires marks the gesture so the click the
   browser synthesises afterwards can be swallowed with `consumeClick()`. */

export interface LongPressOptions {
  /** Hold time before it fires. */
  ms?: number;
  /** Finger drift that cancels the press (px). */
  tolerance?: number;
}

export interface LongPressController<T> {
  onPointerDown: (e: React.PointerEvent, payload: T) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  /** Last pointer type seen on a down event ("mouse" | "touch" | "pen"). */
  lastPointerType: () => string;
  /** True once, right after a press fired — use it to ignore the click. */
  consumeClick: () => boolean;
}

export function createLongPress<T>(
  onFire: (payload: T, target: HTMLElement) => void,
  { ms = 420, tolerance = 10 }: LongPressOptions = {},
): LongPressController<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  let fired = false;
  let pointerType = "mouse";

  const clear = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    start = null;
  };

  return {
    onPointerDown(e, payload) {
      pointerType = e.pointerType || "mouse";
      if (pointerType === "mouse") return;
      const target = e.currentTarget as HTMLElement;
      clear();
      fired = false;
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        onFire(payload, target);
      }, ms);
    },
    onPointerMove(e) {
      if (!timer || !start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > tolerance) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    lastPointerType: () => pointerType,
    consumeClick() {
      const was = fired;
      fired = false;
      return was;
    },
  };
}

/* Keeping screens fresh without costing frames. Measured on a Release
   build, every return to a screen (a tab, a back swipe) refetched its data
   and rebuilt its whole list with it, 30–60 ms of JavaScript at a time,
   while the transition was still moving; most of the time the data had
   not changed at all. So: a screen reloads when you come back only after
   the transition has had its moment, not again within a few seconds, and
   data that comes back the same never re-renders anything. */
import { useCallback, useEffect, useRef } from "react";
import { useFocusEffect, useNavigation } from "expo-router";
import { withProgress } from "./progress";

/** Long enough for a back swipe or a push to finish before a reload's work lands. */
const AFTER_TRANSITION_MS = 360;
/** Coming straight back (tab hopping) doesn't fetch again. */
const FRESH_MS = 5_000;

/** Loads on the first focus at once, then on each later focus once the transition is done.
    The yellow bar belongs to the first load, the one with an empty screen
    behind it: coming back to a tab that already has its list is a refresh
    under something you can read, and a bar there says "wait" when there is
    nothing to wait for. */
export function useFocusRefresh(load: () => Promise<unknown>, { progress = true }: { progress?: boolean } = {}) {
  const last = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const run = (first: boolean) => {
        last.current = Date.now();
        const p = load();
        if (progress && first) void withProgress(p);
        else void p;
      };
      if (!last.current) {
        run(true);
        return;
      }
      if (Date.now() - last.current < FRESH_MS) return;
      const timer = setTimeout(() => run(false), AFTER_TRANSITION_MS);
      return () => clearTimeout(timer);
    }, [load, progress]),
  );
}

/** A state updater that keeps the current value when the new one holds the same data, so React skips the render.
    For plain data — arrays and objects from the server; a Map or Set always stringifies to "{}". */
export function same<T>(next: T): <S>(cur: S) => S | T {
  return (cur) => (Object.is(cur, next) || JSON.stringify(cur) === JSON.stringify(next) ? cur : next);
}

type TransitionEvents = { addListener(type: "transitionEnd", listener: (e: { data?: { closing?: boolean } }) => void): () => void };

/** Waits until this screen has finished sliding in (at once if it has): a
    list committed any earlier is mounted mid-slide, and the slide stutters. */
export function useScreenOpened(): () => Promise<void> {
  const navigation = useNavigation() as unknown as TransitionEvents;
  const done = useRef(false);
  const waiting = useRef<(() => void)[]>([]);
  useEffect(() => {
    const finish = () => {
      if (done.current) return;
      done.current = true;
      waiting.current.splice(0).forEach((resolve) => resolve());
    };
    const unsubscribe = navigation.addListener("transitionEnd", (e) => { if (!e.data?.closing) finish(); });
    /* A screen that opens without a transition (the first screen, some deep links). */
    const fallback = setTimeout(finish, 700);
    return () => { unsubscribe(); clearTimeout(fallback); };
  }, [navigation]);
  return useCallback(() => (done.current ? Promise.resolve() : new Promise<void>((resolve) => waiting.current.push(resolve))), []);
}

/* How the app's sheets and cards come and go. The scrim fades in place
   while the panel moves — a bottom sheet rises, a card settles in from a
   touch below at a touch smaller (the site's modalIn / modalPanelIn,
   0.2s and 0.25s) — and closing plays it back before the modal goes. A
   plain `Modal animationType="slide"` slid the scrim up with the panel,
   a dark wall climbing the screen. Panels sharing one modal trade places
   with CardSwitch, the scrim staying put. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Keyboard, Modal, Pressable, StyleSheet, useWindowDimensions } from "react-native";

const PANEL_IN = Easing.bezier(0.25, 0.46, 0.45, 0.94);

/** A sheet from the bottom, or a card over the middle (its own layout inside). */
type Kind = "bottom" | "card";

/* Where a panel is for `t`, 0 (away) to 1 (in place). Either kind has the
   whole screen to lay itself out in: a bottom sheet sits at its foot and
   rises from below the edge, whatever its height, and one that makes room
   for the keyboard can measure itself against the screen. */
function motion(kind: Kind, t: Animated.Value, height: number) {
  return kind === "bottom"
    ? { justifyContent: "flex-end" as const, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }] }
    : { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] };
}

/* A sheet giving up its place to the next (CardSwitch) dissolves where
   it stands, a touch lower, while the other rises in front of it. Sinking
   the whole way as the other climbed was a lot of movement for one tap,
   and left the bare scrim between them. */
function sheetGoing(t: Animated.Value) {
  return { justifyContent: "flex-end" as const, opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] };
}

/** The modal stays mounted through its exit; `t` runs 0 (gone) to 1 (on screen). */
function usePresence(open: boolean, kind: Kind, onGone?: () => void) {
  const [mounted, setMounted] = useState(open);
  const t = useRef(new Animated.Value(0)).current;
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  /* On screen (its onShow has fired) and not yet gone. */
  const shown = useRef(false);
  /* A keyboard already up as this opened belongs to the page beneath. */
  const keyboardBefore = useRef(false);
  useEffect(() => {
    if (open) {
      if (!mounted) keyboardBefore.current = Keyboard.isVisible();
      setMounted(true);
      /* Opened again while it was still leaving: back from where it is. */
      if (shown.current) Animated.timing(t, { toValue: 1, duration: 250, easing: PANEL_IN, useNativeDriver: true }).start();
      return;
    }
    if (!mounted) return;
    /* A keyboard a bottom sheet raised goes down with it, not once the
       modal has gone (when it would drop out all at once). A card keeps
       its keyboard while it fades: without it the card would be laid out
       afresh, larger, in the middle of leaving. */
    if (kind === "bottom" && !keyboardBefore.current) Keyboard.dismiss();
    const anim = Animated.timing(t, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true });
    anim.start(({ finished }) => {
      if (!finished) return;
      shown.current = false;
      setMounted(false);
      goneRef.current?.();
    });
    return () => anim.stop();
  }, [open, mounted, kind, t]);
  /* In once the modal is on screen: a native-driven animation started in
     the same moment its view mounts never drew on iOS (toast.tsx). */
  const enter = () => {
    shown.current = true;
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 250, easing: PANEL_IN, useNativeDriver: true }).start();
  };
  return { mounted, t, enter };
}

export function SheetModal({ open, onClose, kind = "bottom", children, onGone, scrim = "rgba(0,0,0,0.55)" }: {
  open: boolean;
  onClose: () => void;
  kind?: Kind;
  children: ReactNode;
  /** After the exit has played. */
  onGone?: () => void;
  scrim?: string;
}) {
  const { mounted, t, enter } = usePresence(open, kind, onGone);
  const { height } = useWindowDimensions();
  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onShow={enter} onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: scrim, opacity: t }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, motion(kind, t, height)]}>
        {children}
      </Animated.View>
    </Modal>
  );
}

/* Panels that share one modal trade places the site's way (GlobalActions
   switchCreate — Discussion | Community): the scrim stays put while the
   one going plays modalPanelOut (0.16s) and the one coming plays
   modalPanelIn (0.25s) — cards settling out and in; a bottom sheet
   dissolving as the next rises in front of it. The first comes in with
   the modal itself. */
export function CardSwitch<K extends string>({ current, render, kind = "card" }: { current: K; render: (key: K) => ReactNode; kind?: Kind }) {
  const [cards, setCards] = useState(() => [{ key: current, id: 0, leaving: false }]);
  const nextId = useRef(1);
  useEffect(() => {
    setCards((cs) => {
      const top = cs[cs.length - 1];
      if (top && top.key === current && !top.leaving) return cs;
      return [...cs.map((c) => ({ ...c, leaving: true })), { key: current, id: nextId.current++, leaving: false }];
    });
  }, [current]);
  return (
    <>
      {cards.map((c) => (
        <SwitchedCard key={c.id} kind={kind} entering={c.id > 0} leaving={c.leaving} onLeft={() => setCards((cs) => cs.filter((x) => x.id !== c.id))}>
          {render(c.key)}
        </SwitchedCard>
      ))}
    </>
  );
}

function SwitchedCard({ kind, entering, leaving, onLeft, children }: { kind: Kind; entering: boolean; leaving: boolean; onLeft: () => void; children: ReactNode }) {
  const { height } = useWindowDimensions();
  const t = useRef(new Animated.Value(entering ? 0 : 1)).current;
  const leftRef = useRef(onLeft);
  leftRef.current = onLeft;
  useEffect(() => {
    if (!entering) return;
    /* A frame after mounting, for the same reason as the modal's onShow. */
    const frame = requestAnimationFrame(() => Animated.timing(t, { toValue: 1, duration: 250, easing: PANEL_IN, useNativeDriver: true }).start());
    return () => cancelAnimationFrame(frame);
  }, [entering, t]);
  useEffect(() => {
    if (!leaving) return;
    /* On the same frame as the one coming in starts. Begun a frame
       sooner, its exit was played to nobody: what arrives can hold the
       phone up as it mounts (a text field taking the keyboard, the first
       time most of all), and this one's 0.16s were over when the screen
       next drew — it simply vanished. */
    const frame = requestAnimationFrame(() => {
      t.stopAnimation();
      Animated.timing(t, { toValue: 0, duration: 160, easing: Easing.ease, useNativeDriver: true }).start(({ finished }) => { if (finished) leftRef.current(); });
    });
    return () => cancelAnimationFrame(frame);
  }, [leaving, t]);
  return (
    <Animated.View pointerEvents={leaving ? "none" : "box-none"} style={[StyleSheet.absoluteFill, kind === "bottom" && leaving ? sheetGoing(t) : motion(kind, t, height)]}>
      {children}
    </Animated.View>
  );
}

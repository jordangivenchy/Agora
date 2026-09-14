/* How the app's sheets and cards come and go. The scrim fades in place
   while the panel moves — a bottom sheet rises, a card settles in from a
   touch below at a touch smaller (the site's modalIn / modalPanelIn,
   0.2s and 0.25s) — and closing plays it back before the modal goes. A
   plain `Modal animationType="slide"` slid the scrim up with the panel,
   a dark wall climbing the screen. Cards sharing one modal trade places
   with CardSwitch, the scrim staying put. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";

const PANEL_IN = Easing.bezier(0.25, 0.46, 0.45, 0.94);

/** The modal stays mounted through its exit; `t` runs 0 (gone) to 1 (on screen). */
function usePresence(open: boolean, onGone?: () => void) {
  const [mounted, setMounted] = useState(open);
  const t = useRef(new Animated.Value(0)).current;
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  /* On screen (its onShow has fired) and not yet gone. */
  const shown = useRef(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      /* Opened again while it was still leaving: back from where it is. */
      if (shown.current) Animated.timing(t, { toValue: 1, duration: 250, easing: PANEL_IN, useNativeDriver: true }).start();
      return;
    }
    if (!mounted) return;
    const anim = Animated.timing(t, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true });
    anim.start(({ finished }) => {
      if (!finished) return;
      shown.current = false;
      setMounted(false);
      goneRef.current?.();
    });
    return () => anim.stop();
  }, [open, mounted, t]);
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
  /** A sheet from the bottom, or a card over the middle (its own layout inside). */
  kind?: "bottom" | "card";
  children: ReactNode;
  /** After the exit has played. */
  onGone?: () => void;
  scrim?: string;
}) {
  const { mounted, t, enter } = usePresence(open, onGone);
  const { height } = useWindowDimensions();
  /* A bottom sheet rises from below the screen's edge, whatever its height. */
  const panel: StyleProp<ViewStyle> = kind === "bottom"
    ? { position: "absolute", left: 0, right: 0, bottom: 0, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }] }
    : { flex: 1, opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] };
  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onShow={enter} onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: scrim, opacity: t }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View pointerEvents="box-none" style={panel as never}>
        {children}
      </Animated.View>
    </Modal>
  );
}

/* Cards that share one modal trade places the site's way (GlobalActions
   switchCreate — Discussion | Community): the scrim stays put while the
   card going plays modalPanelOut (0.16s) and the one coming plays
   modalPanelIn (0.25s). The first card comes in with the modal itself. */
export function CardSwitch<K extends string>({ current, render }: { current: K; render: (key: K) => ReactNode }) {
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
        <SwitchedCard key={c.id} entering={c.id > 0} leaving={c.leaving} onLeft={() => setCards((cs) => cs.filter((x) => x.id !== c.id))}>
          {render(c.key)}
        </SwitchedCard>
      ))}
    </>
  );
}

function SwitchedCard({ entering, leaving, onLeft, children }: { entering: boolean; leaving: boolean; onLeft: () => void; children: ReactNode }) {
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
    t.stopAnimation();
    Animated.timing(t, { toValue: 0, duration: 160, easing: Easing.ease, useNativeDriver: true }).start(({ finished }) => { if (finished) leftRef.current(); });
  }, [leaving, t]);
  return (
    <Animated.View
      pointerEvents={leaving ? "none" : "box-none"}
      style={[StyleSheet.absoluteFill, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] }]}
    >
      {children}
    </Animated.View>
  );
}

/* A focused field kept in sight inside a card's scrolling body. The create
   cards give up height to the keyboard (KeyboardAvoidingView), so a field
   lower in the body — a community's description or rules — could end up
   below the part still showing while you typed into it. Once the keyboard
   is up and the card has settled, the body scrolls just far enough to show
   the field with a little room around it. */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { Keyboard, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView, type TextInput } from "react-native";

const ROOM = 16;

export function useRevealField(scrollRef: RefObject<ScrollView | null>) {
  const offset = useRef(0);
  const field = useRef<RefObject<TextInput | null> | null>(null);

  const reveal = useCallback(() => {
    const body = scrollRef.current?.getNativeScrollRef();
    const input = field.current?.current;
    if (!body || !input) return;
    body.measureInWindow((_bx, by, _bw, bh) => {
      input.measureInWindow((_x, y, _w, h) => {
        const below = y + h + ROOM - (by + bh);
        const above = by + ROOM - y;
        if (below > 0) scrollRef.current?.scrollTo({ y: offset.current + below, animated: true });
        else if (above > 0) scrollRef.current?.scrollTo({ y: Math.max(0, offset.current - above), animated: true });
      });
    });
  }, [scrollRef]);

  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", reveal);
    return () => sub.remove();
  }, [reveal]);

  return {
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = e.nativeEvent.contentOffset.y; },
    /** A field's focus: shown now if the keyboard is already up, else once it is. */
    focused: (ref: RefObject<TextInput | null>) => {
      field.current = ref;
      if (Keyboard.isVisible()) requestAnimationFrame(reveal);
    },
    blurred: (ref: RefObject<TextInput | null>) => {
      if (field.current === ref) field.current = null;
    },
  };
}

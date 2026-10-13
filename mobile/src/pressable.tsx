/* The app's Pressable: React Native's, with a light tap under the finger
   on every press that does something (haptics.ts). Every screen imports
   this one, never React Native's own, so nothing pressed is silent.

   The tap comes with the press itself, not with the finger landing: a
   finger that lands on a row and then scrolls has pressed nothing. A
   press that gives its own firmer answer (the mic) gets only that one.
   `quiet` is for a surface that only swallows touches, like the body of
   a sheet, so that a touch on it doesn't close the sheet. */
import { forwardRef } from "react";
import { Pressable as NativePressable, type GestureResponderEvent, type PressableProps as NativePressableProps, type View } from "react-native";
import { pressed } from "./haptics";

export type PressableProps = NativePressableProps & {
  /** No tap: this only swallows touches. */
  quiet?: boolean;
};

type Handler = ((event: GestureResponderEvent) => void) | null | undefined;

export const Pressable = forwardRef<View, PressableProps>(function Pressable({ quiet, onPress, onLongPress, ...rest }, ref) {
  const felt = (handler: Handler): Handler =>
    handler && !quiet
      ? (event) => pressed(handler, event)
      : handler;
  return <NativePressable ref={ref} {...rest} onPress={felt(onPress)} onLongPress={felt(onLongPress)} />;
});

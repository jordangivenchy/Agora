/* Liquid Glass, where the app floats over its own content.

   iOS 26 draws a system material — real refraction of what is behind
   it, light on its rim, a tint — for the layer that sits over content:
   bars, toolbars, floating buttons, controls over a picture. The rule
   for using it is the same as Apple's: glass for what floats, never
   for the content itself, never glass on glass, and the brand's yellow
   actions stay solid (a tinted glass yellow goes olive over dark
   content, and the ink on it loses its contrast).

   One component: <Glass fallback="#0e0e11" style={…}>. On iOS 26 it is
   a GlassView (expo-glass-effect); anywhere else — older iOS, Android,
   a beta without the API — it is the plain View the app had, in the
   solid colour given, so nothing looks worse anywhere. Callers pass
   layout in `style` and the surface's colour in `fallback`: a
   backgroundColor in `style` would paint over the glass. */
import type { ReactNode } from "react";
import { Platform, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";

/* Decided once: the platform doesn't change under a running app. Both
   checks, because some iOS 26 betas report the component without the
   API behind it, and crash. */
export const glassAvailable: boolean = Platform.OS === "ios" && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

export interface GlassProps extends ViewProps {
  /** The solid colour this surface has where there is no glass. */
  fallback: string;
  /** Extra style for the fallback only — a hairline border the glass
      doesn't need, since it has a rim of its own. */
  fallbackStyle?: StyleProp<ViewStyle>;
  /** "clear" is for over a picture or video and wants a dimming layer
      under the words; "regular" (the default) carries its own. */
  clear?: boolean;
  /** A colour laid into the glass — used sparingly. */
  tint?: string;
  /** Responds to a press with the material's own bounce. */
  interactive?: boolean;
  /** The app is dark; glass over a bright photo would go light on its
      own ("auto") and flip its icons dark — a jolt on the one screen
      everyone opens first. Dark unless a surface says otherwise. */
  scheme?: "auto" | "light" | "dark";
  children?: ReactNode;
}

export function Glass({ fallback, fallbackStyle, clear = false, tint, interactive = false, scheme = "dark", style, children, ...rest }: GlassProps) {
  if (!glassAvailable) {
    return (
      <View style={[style, { backgroundColor: fallback }, fallbackStyle]} {...rest}>
        {children}
      </View>
    );
  }
  return (
    <GlassView style={style} glassEffectStyle={clear ? "clear" : "regular"} tintColor={tint} isInteractive={interactive} colorScheme={scheme} {...rest}>
      {children}
    </GlassView>
  );
}

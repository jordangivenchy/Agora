/* The website's two faces, bundled with the app. */
import { useFonts } from "expo-font";
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold, DMSans_800ExtraBold } from "@expo-google-fonts/dm-sans";
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";

/* True once the faces are in, or if they never will be: a system font
   beats a blank screen. */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold, DMSans_800ExtraBold,
    SpaceGrotesk_500Medium, SpaceGrotesk_700Bold,
  });
  return loaded || !!error;
}

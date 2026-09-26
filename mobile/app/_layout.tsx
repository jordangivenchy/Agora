import { useEffect, useState } from "react";
import { View } from "react-native";
import { DarkTheme, Stack, ThemeProvider, type Theme } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider, useSession } from "../src/session";
import { CallProvider } from "../src/callSession";
import { CallHost } from "../src/callHost";
import { CreateProvider } from "../src/create";
import { UserMenuProvider } from "../src/userMenu";
import { PostActionsProvider } from "../src/postActions";
import { ToastHost } from "../src/toast";
import { LightboxHost } from "../src/lightbox";
import { BootSplash } from "../src/boot";
import { loadReduceMotion, setReduceMotion } from "../src/motion";
import { ensurePresence } from "../src/presence";
import { useCall } from "../src/callSession";
import { supabase } from "../src/supabase";
import { colors } from "../src/theme";
import { useAppFonts } from "../src/fonts";
import * as ScreenOrientation from "expo-screen-orientation";
import * as SystemUI from "expo-system-ui";

/* Dark behind every screen. iOS 26 slides a page in and out with
   rounded corners, which shows what lies behind the pages — and the
   native stack paints that in the navigation theme's background, which,
   with no theme given, was React Navigation's light grey. It showed at
   the corners, and beside a page's Back button as it slid in, and the
   glass button, which takes its look from what is behind it, flashed
   white. The theme's background is now the pages' own colour, so the
   corners never show at all. */
const NAV_THEME: Theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, text: colors.text, border: colors.border },
};

/* And black under all of it: app.json's backgroundColor for the window
   and the root view, which only took effect once expo-system-ui was in
   the app (its Info.plist key, RCTRootViewBackgroundColor). The module
   starts when first used, so it is used here, in the root file, as its
   docs say. */
SystemUI.setBackgroundColorAsync("#000000").catch(() => undefined);

/* The opening: the sky until the fonts and the session are in. Reduce
   motion applies from storage at once, then from the account. */
function Boot({ fontsReady, screenIn }: { fontsReady: boolean; screenIn: boolean }) {
  const { ready, session } = useSession();
  const { active } = useCall();
  useEffect(() => { void loadReduceMotion(); }, []);
  useEffect(() => { ensurePresence(session?.user.id ?? null, active?.roomId ?? null); }, [session?.user.id, active?.roomId]);
  useEffect(() => {
    const id = session?.user.id;
    if (!id) return;
    let on = true;
    void supabase.from("user_settings").select("reduce_motion").eq("user_id", id).maybeSingle().then(({ data }) => {
      if (on) setReduceMotion(!!(data as { reduce_motion?: boolean } | null)?.reduce_motion);
    });
    return () => { on = false; };
  }, [session?.user.id]);
  return <BootSplash ready={fontsReady && ready} screenIn={screenIn} />;
}

export default function RootLayout() {
  const fontsReady = useAppFonts();
  /* The app is a portrait app; only a replay's full screen turns, and it
     puts this back when it closes (app/replay/[id].tsx). */
  useEffect(() => { void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined); }, []);
  /* The navigator is laid out: the opening may show its sky (boot.tsx). */
  const [screenIn, setScreenIn] = useState(false);
  return (
    <SessionProvider>
      <CallProvider>
        <CallHost>
          <CreateProvider>
            <UserMenuProvider>
              <PostActionsProvider>
              <View style={{ flex: 1, backgroundColor: "#000" }}>
                <StatusBar style="light" />
                {fontsReady && (
                  <View style={{ flex: 1 }} onLayout={() => setScreenIn(true)}>
                  <ThemeProvider value={NAV_THEME}>
                  <Stack
                    screenOptions={{
                      headerStyle: { backgroundColor: colors.bg },
                      headerTintColor: colors.text,
                      headerTitleStyle: { fontFamily: "SpaceGrotesk_700Bold", fontSize: 17 },
                      headerShadowVisible: false,
                      contentStyle: { backgroundColor: colors.bg },
                    }}
                  >
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen name="beta" options={{ headerShown: false }} />
                    <Stack.Screen name="sign-in" options={{ headerShown: false }} />
                    <Stack.Screen name="auth" options={{ headerShown: false }} />
                    <Stack.Screen name="welcome" options={{ headerShown: false }} />
                    <Stack.Screen name="forgot-password" options={{ title: "", headerBackTitle: "Back" }} />
                    <Stack.Screen name="room/[id]" options={{ headerShown: false, gestureEnabled: false }} />
                    <Stack.Screen name="you" options={{ headerShown: false }} />
                    <Stack.Screen name="u/[username]" options={{ headerShown: false }} />
                    <Stack.Screen name="people" options={{ title: "People", headerBackTitle: "Back" }} />
                    <Stack.Screen name="friends" options={{ title: "Friends", headerBackTitle: "Back" }} />
                    <Stack.Screen name="settings/index" options={{ title: "Settings", headerBackTitle: "Back" }} />
                    <Stack.Screen name="settings/[section]" options={{ title: "Settings", headerBackTitle: "Back" }} />
                    <Stack.Screen name="edit-profile" options={{ title: "Edit profile", headerBackTitle: "Back" }} />
                    <Stack.Screen name="mod" options={{ title: "Moderation", headerBackTitle: "Back" }} />
                    <Stack.Screen name="search" options={{ title: "Search", headerBackTitle: "Back" }} />
                    <Stack.Screen name="notifications" options={{ title: "Notifications", headerBackTitle: "Back" }} />
                    <Stack.Screen name="messages/index" options={{ title: "Messages", headerBackTitle: "Back" }} />
                    <Stack.Screen name="messages/[username]" options={{ headerShown: false }} />
                    <Stack.Screen name="messages/g/[id]" options={{ headerShown: false }} />
                    <Stack.Screen name="clips/index" options={{ title: "Clips", headerBackTitle: "Back" }} />
                    <Stack.Screen name="clips/[id]" options={{ headerShown: false }} />
                    <Stack.Screen name="replay/[id]" options={{ headerShown: false }} />
                    <Stack.Screen name="c/[id]" options={{ headerShown: false }} />
                    <Stack.Screen name="c/mod/[id]" options={{ title: "Mod tools", headerBackTitle: "Back" }} />
                    <Stack.Screen name="posts/[id]" options={{ title: "Thread", headerBackTitle: "Back" }} />
                    <Stack.Screen name="dev/stage" options={{ title: "Stage (design)" }} />
                  </Stack>
                  </ThemeProvider>
                  </View>
                )}
                <ToastHost />
                <LightboxHost />
                <Boot fontsReady={fontsReady} screenIn={screenIn} />
              </View>
              </PostActionsProvider>
            </UserMenuProvider>
          </CreateProvider>
        </CallHost>
      </CallProvider>
    </SessionProvider>
  );
}

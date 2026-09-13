import { useEffect } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider, useSession } from "../src/session";
import { CallProvider } from "../src/callSession";
import { CallHost } from "../src/callHost";
import { CreateProvider } from "../src/create";
import { UserMenuProvider } from "../src/userMenu";
import { ToastHost } from "../src/toast";
import { BootSplash } from "../src/boot";
import { loadReduceMotion, setReduceMotion } from "../src/motion";
import { supabase } from "../src/supabase";
import { colors } from "../src/theme";
import { useAppFonts } from "../src/fonts";

/* The opening: the sky until the fonts and the session are in. Reduce
   motion applies from storage at once, then from the account. */
function Boot({ fontsReady }: { fontsReady: boolean }) {
  const { ready, session } = useSession();
  useEffect(() => { void loadReduceMotion(); }, []);
  useEffect(() => {
    const id = session?.user.id;
    if (!id) return;
    let on = true;
    void supabase.from("user_settings").select("reduce_motion").eq("user_id", id).maybeSingle().then(({ data }) => {
      if (on) setReduceMotion(!!(data as { reduce_motion?: boolean } | null)?.reduce_motion);
    });
    return () => { on = false; };
  }, [session?.user.id]);
  return <BootSplash ready={fontsReady && ready} />;
}

export default function RootLayout() {
  const fontsReady = useAppFonts();
  return (
    <SessionProvider>
      <CallProvider>
        <CallHost>
          <CreateProvider>
            <UserMenuProvider>
              <View style={{ flex: 1, backgroundColor: "#000" }}>
                <StatusBar style="light" />
                {fontsReady && (
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
                    <Stack.Screen name="room/[id]" options={{ title: "Room", headerBackTitle: "Back" }} />
                    <Stack.Screen name="you" options={{ headerShown: false }} />
                    <Stack.Screen name="u/[username]" options={{ headerShown: false }} />
                    <Stack.Screen name="people" options={{ title: "People", headerBackTitle: "Back" }} />
                    <Stack.Screen name="friends" options={{ title: "Friends", headerBackTitle: "Back" }} />
                    <Stack.Screen name="settings/index" options={{ title: "Settings", headerBackTitle: "Back" }} />
                    <Stack.Screen name="settings/[section]" options={{ title: "Settings", headerBackTitle: "Back" }} />
                    <Stack.Screen name="edit-profile" options={{ title: "Edit profile", headerBackTitle: "Back" }} />
                    <Stack.Screen name="mod" options={{ title: "Moderation", headerBackTitle: "Back" }} />
                    <Stack.Screen name="replay/[id]" options={{ headerShown: false }} />
                    <Stack.Screen name="c/[id]" options={{ headerShown: false }} />
                    <Stack.Screen name="posts/[id]" options={{ title: "Thread", headerBackTitle: "Back" }} />
                    <Stack.Screen name="dev/stage" options={{ title: "Stage (design)" }} />
                  </Stack>
                )}
                <ToastHost />
                <Boot fontsReady={fontsReady} />
              </View>
            </UserMenuProvider>
          </CreateProvider>
        </CallHost>
      </CallProvider>
    </SessionProvider>
  );
}

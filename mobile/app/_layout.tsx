import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "../src/session";
import { CallProvider } from "../src/callSession";
import { CallHost } from "../src/callHost";
import { CreateProvider } from "../src/create";
import { colors } from "../src/theme";
import { useAppFonts } from "../src/fonts";

export default function RootLayout() {
  const fontsReady = useAppFonts();
  if (!fontsReady) return null;
  return (
    <SessionProvider>
      <CallProvider>
        <CallHost>
          <CreateProvider>
          <StatusBar style="light" />
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
            <Stack.Screen name="room/[id]" options={{ title: "Room", headerBackTitle: "Back" }} />
            <Stack.Screen name="you" options={{ headerShown: false }} />
            <Stack.Screen name="u/[username]" options={{ headerShown: false }} />
            <Stack.Screen name="friends" options={{ title: "Friends", headerBackTitle: "Back" }} />
            <Stack.Screen name="replay/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="c/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="posts/[id]" options={{ title: "Thread", headerBackTitle: "Back" }} />
        <Stack.Screen name="dev/stage" options={{ title: "Stage (design)" }} />
          </Stack>
          </CreateProvider>
        </CallHost>
      </CallProvider>
    </SessionProvider>
  );
}

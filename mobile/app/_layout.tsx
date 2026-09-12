import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "../src/session";
import { CallProvider } from "../src/callSession";
import { CallHost } from "../src/callHost";
import { colors } from "../src/theme";

export default function RootLayout() {
  return (
    <SessionProvider>
      <CallProvider>
        <CallHost>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
              headerTitleStyle: { fontWeight: "700" },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="beta" options={{ headerShown: false }} />
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
            <Stack.Screen name="auth" options={{ headerShown: false }} />
            <Stack.Screen name="room/[id]" options={{ title: "Room", headerBackTitle: "Back" }} />
        <Stack.Screen name="dev/stage" options={{ title: "Stage (design)" }} />
          </Stack>
        </CallHost>
      </CallProvider>
    </SessionProvider>
  );
}

/* The site's top bar on a phone: the wordmark, search, and you, with
   the yellow loading bar along its bottom edge (progress.tsx). */
import { useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "./session";
import { useMe } from "./me";
import { Dropdown } from "./dropdown";
import { useUnread, watchUnread } from "./notifications";
import { useDmUnread, watchDmUnread } from "./messages";
import { ProgressBar } from "./progress";
import { colors, fonts } from "./theme";

const LOGO_RATIO = 2039 / 274;

export function HomeHeader() {
  const insets = useSafeAreaInsets();
  const { session, signOut } = useSession();
  const me = useMe();
  const [menu, setMenu] = useState(false);
  const unread = useUnread();
  const dms = useDmUnread();
  useEffect(() => { watchUnread(session?.user.id ?? null); }, [session?.user.id]);
  useEffect(() => { watchDmUnread(session?.user.id ?? null); }, [session?.user.id]);
  const initial = (me?.display_name || me?.username || "?").trim().charAt(0).toUpperCase();
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: colors.bg }}>
      <View style={{ height: 60, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 10 }}>
        <Pressable onPress={() => router.navigate("/")} hitSlop={8}>
          <Image source={require("../assets/logo.png")} style={{ height: 24, width: 24 * LOGO_RATIO }} resizeMode="contain" accessibilityLabel="AgoraSphere" />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => router.push("/search")}
          accessibilityLabel="Search"
          style={({ pressed }) => ({
            width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center",
            backgroundColor: pressed ? colors.surface2 : colors.surface, borderWidth: 1, borderColor: colors.border,
          })}
        >
          <Ionicons name="search-outline" size={18} color={colors.text} />
        </Pressable>
        {session && (
          /* Messages live here, next to the bell, because that is where a
             phone keeps them. They used to be three taps down: the
             avatar, then your profile, then a row on it. */
          <Pressable
            onPress={() => router.push("/messages")}
            accessibilityLabel={dms > 0 ? `Messages (${dms} waiting)` : "Messages"}
            style={({ pressed }) => ({
              width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center",
              backgroundColor: pressed ? colors.surface2 : colors.surface, borderWidth: 1, borderColor: dms > 0 ? "#6b5a2a" : colors.border,
            })}
          >
            <Ionicons name="chatbubble-outline" size={18} color={dms > 0 ? colors.gold : colors.text} />
            {dms > 0 && (
              <View style={{ position: "absolute", top: -3, right: -3, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 10 }}>{dms > 9 ? "9+" : dms}</Text>
              </View>
            )}
          </Pressable>
        )}
        {session && (
          <Pressable
            onPress={() => router.push("/notifications")}
            accessibilityLabel={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
            style={({ pressed }) => ({
              width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center",
              backgroundColor: pressed ? colors.surface2 : colors.surface, borderWidth: 1, borderColor: unread > 0 ? "#6b5a2a" : colors.border,
            })}
          >
            <Ionicons name="notifications-outline" size={18} color={unread > 0 ? colors.gold : colors.text} />
            {unread > 0 && (
              <View style={{ position: "absolute", top: -3, right: -3, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 10 }}>{unread > 9 ? "9+" : unread}</Text>
              </View>
            )}
          </Pressable>
        )}
        {session ? (
          <Pressable onPress={() => setMenu(true)} accessibilityLabel="You" hitSlop={6}>
            <View style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: colors.yellow, padding: 1.5 }}>
              {me?.avatar_url ? (
                <Image source={{ uri: me.avatar_url }} style={{ flex: 1, borderRadius: 15 }} />
              ) : (
                <View style={{ flex: 1, borderRadius: 15, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: 13 }}>{initial}</Text>
                </View>
              )}
            </View>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => router.push("/sign-in")}
            style={({ pressed }) => ({ height: 36, paddingHorizontal: 16, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? "#2f6fd6" : colors.blue })}
          >
            <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 14 }}>Sign in</Text>
          </Pressable>
        )}
      </View>
      <ProgressBar />
      {/* The site's avatar menu, dropping from under the avatar. */}
      <Dropdown
        open={menu}
        onClose={() => setMenu(false)}
        top={insets.top + 57}
        name={me?.display_name || me?.username || "You"}
        sub={me?.username ? `@${me.username}` : undefined}
        items={[
          { label: "Profile", icon: "person-outline", onPress: () => router.push("/you") },
          { label: "Messages", icon: "chatbubble-outline", onPress: () => router.push("/messages") },
          { label: "Settings", icon: "settings-outline", onPress: () => router.push("/settings") },
          { label: "Friends", icon: "people-outline", onPress: () => router.push("/friends") },
          { label: "Log out", icon: "log-out-outline", danger: true, dividerAbove: true, onPress: () => void signOut().then(() => router.replace("/sign-in")) },
        ]}
      />
    </View>
  );
}

/* You: the account, and out. */
import { useEffect, useState } from "react";
import { Image, Linking, Text, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { SITE } from "../../src/api";
import { colors } from "../../src/theme";
import { Button, Note, Screen } from "../../src/ui";

interface Me {
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export default function You() {
  const { session, signOut } = useSession();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    const id = session?.user.id;
    if (!id) return;
    let alive = true;
    void supabase.from("users").select("username, display_name, avatar_url").eq("id", id).maybeSingle().then(({ data }) => {
      if (alive) setMe((data as Me | null) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [session?.user.id]);

  const name = me?.display_name?.trim() || me?.username || session?.user.email?.split("@")[0] || "You";
  return (
    <Screen>
      <View style={{ paddingTop: 20, alignItems: "center", marginBottom: 24 }}>
        {me?.avatar_url ? (
          <Image source={{ uri: me.avatar_url }} style={{ width: 84, height: 84, borderRadius: 42, marginBottom: 12 }} />
        ) : (
          <View style={{ width: 84, height: 84, borderRadius: 42, marginBottom: 12, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontSize: 30, fontWeight: "800" }}>{name.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800" }}>{name}</Text>
        {me?.username && <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>@{me.username}</Text>}
      </View>
      <Button kind="secondary" onPress={() => void Linking.openURL(me?.username ? `${SITE}/@${me.username}` : SITE)}>Open my profile on the web</Button>
      <View style={{ height: 10 }} />
      <Button kind="secondary" onPress={() => void signOut().then(() => router.replace("/sign-in"))}>Sign out</Button>
      <Note>Editing your profile, settings and communities stay on agorasphere.net for now.</Note>
    </Screen>
  );
}

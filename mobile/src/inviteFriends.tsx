/* Invite friends to a community (components/community/InviteFriends.tsx):
   friends who aren't members yet; Invite sends them a message that
   renders as a join card. */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "./supabase";
import { SITE } from "./api";
import { Avatar } from "./avatar";
import { showToast } from "./toast";
import { colors, fonts } from "./theme";

interface Candidate { id: string; username: string; display_name: string | null; avatar_url: string | null; invited: boolean }
const ERRORS: Record<string, string> = {
  not_friends: "You can only invite friends — people who follow you back.",
  mods_only: "Only moderators can invite people to a private community.",
  invite_rate_limit: "That's a lot of invites — try again in an hour.",
  already_member: "They're already in the community.",
  not_a_member: "Join the community before inviting people to it.",
};

export function InviteFriends({ communityId, communityName, isPrivate }: { communityId: string; communityName: string; isPrivate: boolean }) {
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    void supabase.rpc("get_community_invite_candidates", { p_community: communityId }).then(({ data }) => { if (on) setRows((data as Candidate[] | null) ?? []); });
    return () => { on = false; };
  }, [communityId]);
  const invite = async (c: Candidate) => {
    if (busy) return;
    setBusy(c.id);
    setError(null);
    const { error: err } = await supabase.rpc("send_community_invite", { p_community: communityId, p_to: c.id });
    setBusy(null);
    if (err) { const key = Object.keys(ERRORS).find((k) => err.message.includes(k)); setError(key ? ERRORS[key] : "Couldn't send the invite."); return; }
    setRows((r) => (r ?? []).map((x) => (x.id === c.id ? { ...x, invited: true } : x)));
  };
  const copyLink = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Clipboard = require("expo-clipboard") as typeof import("expo-clipboard");
      await Clipboard.setStringAsync(`${SITE}/communities`);
      showToast("Link copied");
    } catch { showToast("Couldn't copy"); }
  };
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: "rgba(238,238,245,0.55)", fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18 }}>
        {isPrivate ? `Invites let friends into ${communityName} without applying. ` : `Friends you invite get a message with a one-tap join for ${communityName}. `}Friends are people who follow you back.
      </Text>
      {error && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: "#1a0b0b", borderWidth: 1, borderColor: "#5a2a2a" }}>{error}</Text>}
      {rows === null ? <Text style={{ color: "rgba(238,238,245,0.4)", fontFamily: fonts.body, fontSize: 12 }}>Finding friends…</Text> : rows.length === 0 ? (
        <View style={{ alignItems: "center", paddingVertical: 18, borderRadius: 12, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2a2a34" }}>
          <Ionicons name="people-outline" size={18} color="rgba(238,238,245,0.4)" />
          <Text style={{ color: "rgba(238,238,245,0.6)", fontFamily: fonts.body, fontSize: 12.5, marginTop: 6 }}>No one to invite yet.</Text>
          <Text style={{ color: "rgba(238,238,245,0.4)", fontFamily: fonts.body, fontSize: 11.5, marginTop: 2 }}>Your friends who aren't members will show up here.</Text>
        </View>
      ) : rows.map((c) => (
        <View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2a2a34" }}>
          <Avatar url={c.avatar_url} name={c.username} size={30} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: "#eeeef5", fontFamily: fonts.semi, fontSize: 13 }}>{c.display_name?.trim() || c.username}</Text>
            <Text style={{ color: "rgba(238,238,245,0.45)", fontFamily: fonts.body, fontSize: 11 }}>@{c.username}</Text>
          </View>
          <Pressable onPress={() => !c.invited && void invite(c)} disabled={busy === c.id} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: c.invited ? "#0b0b0d" : colors.yellow, borderWidth: 1, borderColor: c.invited ? "#2e2e38" : colors.yellow }}>
            {c.invited && <Ionicons name="checkmark" size={12} color="#c9c9d2" />}
            <Text style={{ color: c.invited ? "#c9c9d2" : colors.ink, fontFamily: fonts.bold, fontSize: 12 }}>{c.invited ? "Invited" : busy === c.id ? "Sending…" : "Invite"}</Text>
          </Pressable>
        </View>
      ))}
      <Pressable onPress={() => void copyLink()} style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" }}>
        <Ionicons name="link-outline" size={12} color="rgba(238,238,245,0.55)" />
        <Text style={{ color: "rgba(238,238,245,0.55)", fontFamily: fonts.body, fontSize: 12 }}>Copy a link to Communities</Text>
      </Pressable>
    </View>
  );
}

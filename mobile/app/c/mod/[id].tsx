/* Mod tools: the site's mod panel as its own screen (components/
   CommunitiesPage.tsx, community/ModerationPanels.tsx). Applications to a
   private community, the moderators and the members with their roles and
   bans, the ban list, the mod log, the community's banner and picture,
   about & rules with the bookmarks and the application question, and the
   post tags. Every moderator bans, approves, edits and tags; only the
   owner promotes, demotes and changes privacy. The database enforces all
   of it; this screen only hides what a role can't do. */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../src/supabase";
import { useSession } from "../../../src/session";
import { fetchCommunity, fetchTags, type Community, type Tag } from "../../../src/communities";
import {
  TAG_COLORS, addCommunityTag, approveJoinRequest, banMember, fetchBans, fetchJoinRequests, fetchMembers, fetchModLog, logPhrase, modError,
  personName, removeCommunityTag, saveCommunityAbout, setCommunityBranding, setMemberRole, unbanMember,
  type BanRow, type JoinRequest, type Member, type MiniUser, type ModLogRow,
} from "../../../src/communityAdmin";
import { formatBookmarks } from "../../../src/communityBookmarks";
import { pickImage, uploadPostImage, uploadSquareImage } from "../../../src/postImages";
import { cleanTextError, BODY_MIN } from "../../../src/cleanText";
import { BanSheet } from "../../../src/communitySheets";
import { usePresence } from "../../../src/presence";
import { useUserMenu } from "../../../src/userMenu";
import { Btn, Input, Msg, Pad, SectionCard, Toggle } from "../../../src/settingsUi";
import { TagChip, RoleBadge } from "../../../src/postCard";
import { Avatar } from "../../../src/avatar";
import { timeAgo } from "../../../src/communities";
import { showToast } from "../../../src/toast";
import { LoadingLine } from "../../../src/sky";
import { colors, fonts } from "../../../src/theme";

type M = { kind: "ok" | "err"; text: string } | null;

/* Small outline buttons on a person's row: grey, green to approve, red to ban or deny. */
function RowBtn({ label, tone = "ghost", onPress, disabled }: { label: string; tone?: "ghost" | "ok" | "danger"; onPress: () => void; disabled?: boolean }) {
  const color = tone === "ok" ? "#00b894" : tone === "danger" ? "#ee8888" : "rgba(238,238,245,0.75)";
  const border = tone === "ok" ? "#1f6f5c" : tone === "danger" ? "#6b2a2a" : "#3a3a42";
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={4} style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, borderWidth: 1, borderColor: border, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text style={{ color, fontFamily: fonts.semi, fontSize: 11.5 }}>{label}</Text>
    </Pressable>
  );
}

function Empty({ children }: { children: string }) {
  return <Text style={{ color: "rgba(238,238,245,0.36)", fontFamily: fonts.body, fontSize: 12.5, paddingHorizontal: 16, paddingVertical: 6 }}>{children}</Text>;
}

export default function ModToolsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const presence = usePresence();
  const { openUserMenu } = useUserMenu();
  const [c, setC] = useState<Community | null | undefined>(undefined);
  const [members, setMembers] = useState<Member[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [bans, setBans] = useState<BanRow[]>([]);
  const [log, setLog] = useState<ModLogRow[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [banning, setBanning] = useState<{ userId: string; name: string } | null>(null);
  /* About & rules drafts, seeded from the row once it loads. */
  const [draft, setDraft] = useState({ description: "", rules: "", bookmarks: "", prompt: "", isPrivate: false });
  const seededFor = useRef<string | null>(null);
  const [aboutMsg, setAboutMsg] = useState<M>(null);
  const [brandMsg, setBrandMsg] = useState<M>(null);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState(TAG_COLORS[0]);
  const [tagMsg, setTagMsg] = useState<M>(null);

  const loadLists = useCallback(async () => {
    const results = await Promise.allSettled([fetchMembers(supabase, id), fetchJoinRequests(supabase, id), fetchBans(supabase, id), fetchModLog(supabase, id), fetchTags(supabase, id)]);
    if (results[0].status === "fulfilled") setMembers(results[0].value);
    if (results[1].status === "fulfilled") setRequests(results[1].value);
    if (results[2].status === "fulfilled") setBans(results[2].value);
    if (results[3].status === "fulfilled") setLog(results[3].value);
    if (results[4].status === "fulfilled") setTags(results[4].value);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    setListError(failed ? (failed.reason instanceof Error ? failed.reason.message : "Couldn't load everything.") : null);
  }, [id]);

  const load = useCallback(async () => {
    try {
      const cm = await fetchCommunity(supabase, id, uid);
      setC(cm);
      if (cm && (cm.my_role === "owner" || cm.my_role === "moderator")) {
        if (seededFor.current !== cm.id) {
          setDraft({ description: cm.description ?? "", rules: cm.rules ?? "", bookmarks: formatBookmarks(cm.bookmarks), prompt: cm.application_prompt ?? "", isPrivate: cm.is_private });
          seededFor.current = cm.id;
        }
        await loadLists();
      }
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Couldn't load this community.");
      setC((cur) => cur ?? null);
    }
  }, [id, uid, loadLists]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (c === undefined) return <View style={{ flex: 1, backgroundColor: colors.bg }}><Stack.Screen options={{ title: "Mod tools" }} /><LoadingLine /></View>;
  const isOwner = c?.my_role === "owner";
  const isMod = isOwner || c?.my_role === "moderator";
  if (!c || !isMod || !uid) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 24 }}>
        <Stack.Screen options={{ title: "Mod tools" }} />
        <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{c ? "Only this community's moderators can open mod tools." : "That community isn't here anymore."}</Text>
      </View>
    );
  }

  /* One action at a time, then the lists and the log catch up. */
  const act = async (key: string, run: () => Promise<void>, done?: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await run();
      if (done) showToast(done);
      await loadLists();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't do that.");
    } finally {
      setBusy(null);
    }
  };

  const person = (userId: string, u: MiniUser | null, right: ReactNode, below?: ReactNode) => (
    <View key={userId} style={{ paddingHorizontal: 16, paddingVertical: 7 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable onPress={() => u?.username && openUserMenu({ userId, username: u.username, displayName: u.display_name })} style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <Avatar url={u?.avatar_url ?? null} name={u?.username ?? "?"} size={26} />
          <Text numberOfLines={1} style={{ flexShrink: 1, color: "rgba(238,238,245,0.9)", fontFamily: fonts.body, fontSize: 13.5 }}>{personName(u)}</Text>
        </Pressable>
        {right}
      </View>
      {below}
    </View>
  );
  const active = (userId: string) => {
    const on = presence.has(userId);
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: on ? "#00b894" : "rgba(238,238,245,0.22)" }} />
        <Text style={{ color: on ? "#00b894" : "rgba(238,238,245,0.36)", fontFamily: fonts.body, fontSize: 11 }}>{on ? "Active" : "Offline"}</Text>
      </View>
    );
  };

  const modsList = members.filter((m) => m.role === "owner" || m.role === "moderator").sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
  const plain = members.filter((m) => m.role === "member");

  const changeImage = async (kind: "banner" | "avatar") => {
    setBrandMsg(null);
    try {
      const img = await pickImage();
      if (!img) return;
      setBusy(kind);
      const url = kind === "banner" ? await uploadPostImage(uid, img) : await uploadSquareImage(uid, img);
      await setCommunityBranding(supabase, c.id, kind, url);
      setBrandMsg({ kind: "ok", text: kind === "banner" ? "Banner updated." : "Picture updated." });
      await load();
    } catch (e) {
      setBrandMsg({ kind: "err", text: e instanceof Error ? modError(e.message) : "Image upload failed." });
    } finally {
      setBusy(null);
    }
  };
  const clearImage = async (kind: "banner" | "avatar") => {
    setBrandMsg(null);
    setBusy(kind);
    try {
      await setCommunityBranding(supabase, c.id, kind, "");
      setBrandMsg({ kind: "ok", text: kind === "banner" ? "Banner removed." : "Picture removed." });
      await load();
    } catch (e) {
      setBrandMsg({ kind: "err", text: e instanceof Error ? e.message : "Couldn't remove it." });
    } finally {
      setBusy(null);
    }
  };

  const saveAbout = async () => {
    setAboutMsg(null);
    const issue = [draft.description, draft.rules, draft.prompt].map((t) => (t.trim() ? cleanTextError(t, BODY_MIN) : null)).find(Boolean);
    if (issue) { setAboutMsg({ kind: "err", text: issue }); return; }
    setBusy("about");
    try {
      await saveCommunityAbout(supabase, c.id, {
        description: draft.description,
        rules: draft.rules,
        applicationPrompt: draft.prompt,
        bookmarksText: draft.bookmarks,
        isPrivate: isOwner && draft.isPrivate !== c.is_private ? draft.isPrivate : null,
      });
      setAboutMsg({ kind: "ok", text: "Saved." });
      seededFor.current = null;
      await load();
    } catch (e) {
      setAboutMsg({ kind: "err", text: e instanceof Error ? e.message : "Couldn't save." });
    } finally {
      setBusy(null);
    }
  };

  const addTag = async () => {
    const name = tagName.trim();
    if (!name) return;
    setTagMsg(null);
    const issue = cleanTextError(name, 1);
    if (issue) { setTagMsg({ kind: "err", text: issue }); return; }
    await act("tag", async () => { await addCommunityTag(supabase, c.id, uid, name, tagColor); setTagName(""); });
  };

  const mono = Platform.OS === "ios" ? "Menlo" : "monospace";
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: "Mod tools" }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.color, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
            {c.avatar_url ? <Image source={{ uri: c.avatar_url }} style={{ width: 34, height: 34 }} /> : <Text style={{ color: "#fff", fontFamily: fonts.title, fontSize: 15 }}>{c.name.charAt(0).toUpperCase()}</Text>}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 17 }}>{c.name}</Text>
            <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5 }}>{c.members} member{c.members === 1 ? "" : "s"} · {c.is_private ? "private" : "public"} · you're {isOwner ? "the owner" : "a moderator"}</Text>
          </View>
        </View>
        {listError && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12.5, marginBottom: 10 }}>{listError}</Text>}

        {c.is_private && (
          <SectionCard title={`Applications${requests.length ? ` · ${requests.length}` : ""}`} sub="People asking to join. Approving makes them members.">
            {requests.length === 0 ? <Empty>No pending applications.</Empty> : requests.map((r) => person(r.user_id, r.user, (
              <>
                <Text style={{ color: "rgba(238,238,245,0.36)", fontFamily: fonts.body, fontSize: 11 }}>{timeAgo(r.created_at)}</Text>
                <RowBtn label="Approve" tone="ok" disabled={!!busy} onPress={() => void act(`ok:${r.user_id}`, () => approveJoinRequest(supabase, c.id, r.user_id, true), `Approved ${personName(r.user)}`)} />
                <RowBtn label="Deny" tone="danger" disabled={!!busy} onPress={() => void act(`no:${r.user_id}`, () => approveJoinRequest(supabase, c.id, r.user_id, false), "Request denied")} />
              </>
            ), r.message ? <Text style={{ color: "rgba(238,238,245,0.62)", fontFamily: fonts.body, fontStyle: "italic", fontSize: 12.5, lineHeight: 18, marginTop: 4, marginLeft: 36 }}>“{r.message}”</Text> : undefined))}
          </SectionCard>
        )}

        <SectionCard title="Moderators" sub={isOwner ? "You can take a moderator back to member." : undefined}>
          {modsList.length === 0 ? <Empty>Loading…</Empty> : modsList.map((m) => person(m.user_id, m.user, (
            <>
              {active(m.user_id)}
              <RoleBadge role={m.role} />
              {isOwner && m.role === "moderator" && m.user_id !== uid && (
                <RowBtn label="Remove" disabled={!!busy} onPress={() => void act(`role:${m.user_id}`, () => setMemberRole(supabase, c.id, m.user_id, "member"), `${personName(m.user)} is a member again`)} />
              )}
            </>
          )))}
        </SectionCard>

        <SectionCard title={`Members${plain.length ? ` · ${plain.length}` : ""}`} sub={isOwner ? "Make someone a moderator, or ban them." : "Ban someone who breaks the rules."}>
          {plain.length === 0 ? <Empty>No members beyond the mod team yet.</Empty> : plain.map((m) => person(m.user_id, m.user, (
            <>
              {active(m.user_id)}
              {isOwner && m.user_id !== uid && <RowBtn label="Make mod" disabled={!!busy} onPress={() => void act(`role:${m.user_id}`, () => setMemberRole(supabase, c.id, m.user_id, "moderator"), `${personName(m.user)} is a moderator`)} />}
              {m.user_id !== uid && <RowBtn label="Ban" tone="danger" disabled={!!busy} onPress={() => setBanning({ userId: m.user_id, name: personName(m.user) })} />}
            </>
          )))}
        </SectionCard>

        <SectionCard title={bans.length ? `Banned · ${bans.length}` : "Banned"}>
          {bans.length === 0 ? <Empty>No bans.</Empty> : bans.map((b) => person(b.user_id, b.user, (
            <>
              <Text style={{ color: "rgba(238,238,245,0.36)", fontFamily: fonts.body, fontSize: 11 }}>{timeAgo(b.created_at)}</Text>
              <RowBtn label="Unban" disabled={!!busy} onPress={() => void act(`unban:${b.user_id}`, () => unbanMember(supabase, c.id, b.user_id), `Unbanned ${personName(b.user)}`)} />
            </>
          ), b.reason?.trim() ? <Text style={{ color: "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 12, marginTop: 3, marginLeft: 36 }}>{b.reason.trim()}</Text> : undefined))}
        </SectionCard>

        <SectionCard title="Mod log" sub="The last thirty moderator actions.">
          {log.length === 0 ? <Empty>Nothing logged yet.</Empty> : (
            <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
              {log.map((r) => {
                const p = logPhrase(r);
                return (
                  <View key={r.id} style={{ flexDirection: "row", gap: 10, paddingVertical: 3 }}>
                    <Text numberOfLines={1} style={{ width: 54, color: "rgba(238,238,245,0.36)", fontFamily: fonts.body, fontSize: 11.5 }}>{timeAgo(r.created_at)}</Text>
                    <Text style={{ flex: 1, color: "rgba(238,238,245,0.65)", fontFamily: fonts.body, fontSize: 12, lineHeight: 17 }}>
                      <Text style={{ color: "#eeeef5" }}>{personName(r.actor)}</Text> {p.verb}{p.target ? " " : ""}{p.target && <Text style={{ color: "#e2b96b" }}>{p.target}</Text>}{p.tail ? ` ${p.tail}` : ""}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </SectionCard>

        <SectionCard title="Look" sub="The banner runs across the top of the community page; the picture sits beside its name.">
          <View style={{ marginHorizontal: 16, marginTop: 6, height: 84, borderRadius: 10, overflow: "hidden", backgroundColor: c.color }}>
            {c.banner_url && <Image source={{ uri: c.banner_url }} style={{ width: "100%", height: 84 }} resizeMode="cover" />}
          </View>
          <Pad>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Btn label={busy === "banner" ? "Working…" : c.banner_url ? "Change banner" : "Add a banner"} disabled={!!busy} onPress={() => void changeImage("banner")} />
              {c.banner_url && <Btn kind="ghost" label="Remove banner" disabled={!!busy} onPress={() => void clearImage("banner")} />}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 }}>
              <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: c.color, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
                {c.avatar_url ? <Image source={{ uri: c.avatar_url }} style={{ width: 52, height: 52 }} /> : <Text style={{ color: "#fff", fontFamily: fonts.title, fontSize: 22 }}>{c.name.charAt(0).toUpperCase()}</Text>}
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, flex: 1 }}>
                <Btn label={busy === "avatar" ? "Working…" : c.avatar_url ? "Change picture" : "Add a picture"} disabled={!!busy} onPress={() => void changeImage("avatar")} />
                {c.avatar_url && <Btn kind="ghost" label="Remove" disabled={!!busy} onPress={() => void clearImage("avatar")} />}
              </View>
            </View>
            <Msg msg={brandMsg} />
          </Pad>
        </SectionCard>

        <SectionCard title="About & rules">
          <Pad>
            <Input value={draft.description} onChangeText={(t) => setDraft((d) => ({ ...d, description: t.slice(0, 500) }))} placeholder="Description (what is this community for?)" maxLength={500} />
            <Input value={draft.rules} onChangeText={(t) => setDraft((d) => ({ ...d, rules: t.slice(0, 4000) }))} placeholder={"Rules — one per line\nBe civil.\nStay on topic."} multiline maxLength={4000} style={{ minHeight: 90, textAlignVertical: "top" }} />
            <Input value={draft.bookmarks} onChangeText={(t) => setDraft((d) => ({ ...d, bookmarks: t.slice(0, 4000) }))} placeholder={"Community bookmarks — one per line\nDiscord | https://discord.gg/yourboard\n## Social Links\nX | https://x.com/yourboard"} multiline maxLength={4000} autoCapitalize="none" autoCorrect={false} style={{ minHeight: 100, textAlignVertical: "top", fontFamily: mono, fontSize: 12.5 }} />
            <Text style={{ color: "rgba(238,238,245,0.4)", fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16 }}>Bookmarks: Label | URL per line; a line starting with ## begins a dropdown group.</Text>
            {(draft.isPrivate || c.is_private) && (
              <>
                <Input value={draft.prompt} onChangeText={(t) => setDraft((d) => ({ ...d, prompt: t.slice(0, 1000) }))} placeholder={"Application questions — what should applicants tell you?\ne.g. What school are you from? Why do you want to join?"} multiline maxLength={1000} style={{ minHeight: 70, textAlignVertical: "top" }} />
                <Text style={{ color: "rgba(238,238,245,0.4)", fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16 }}>Shown to everyone who applies; when set, an application must answer it. Leave empty for a plain optional message.</Text>
              </>
            )}
          </Pad>
          {isOwner && (
            <Toggle on={draft.isPrivate} onChange={(v) => setDraft((d) => ({ ...d, isPrivate: v }))} label="Private (join by approval)" sub="Posts become visible to members only; people apply to get in." />
          )}
          <Pad>
            <Btn label={busy === "about" ? "Saving…" : "Save changes"} disabled={!!busy} onPress={() => void saveAbout()} />
            <Msg msg={aboutMsg} />
          </Pad>
        </SectionCard>

        <SectionCard title="Post tags" sub="Tags people can put on a post in this community.">
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
            {tags.length === 0 ? <Text style={{ color: "rgba(238,238,245,0.36)", fontFamily: fonts.body, fontSize: 12.5 }}>No tags yet.</Text> : tags.map((t) => (
              <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <TagChip name={t.name} color={t.color} />
                <Pressable onPress={() => void act(`tag:${t.id}`, () => removeCommunityTag(supabase, t.id), `Deleted ${t.name}`)} disabled={!!busy} hitSlop={8} accessibilityLabel={`Delete tag ${t.name}`}>
                  <Ionicons name="close" size={14} color="rgba(238,238,245,0.45)" />
                </Pressable>
              </View>
            ))}
          </View>
          <Pad>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Input value={tagName} onChangeText={(t) => setTagName(t.slice(0, 24))} placeholder="New tag" maxLength={24} onSubmitEditing={() => void addTag()} style={{ flex: 1 }} />
              <Btn label="Add" disabled={!tagName.trim() || !!busy} onPress={() => void addTag()} />
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {TAG_COLORS.map((col) => (
                <Pressable key={col} onPress={() => setTagColor(col)} accessibilityLabel={`Tag colour ${col}`} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: col, borderWidth: 2, borderColor: tagColor === col ? "#eeeef5" : "transparent" }} />
              ))}
            </View>
            <Msg msg={tagMsg} />
          </Pad>
        </SectionCard>
      </ScrollView>
      <BanSheet
        target={banning}
        communityName={c.name}
        onClose={() => setBanning(null)}
        onBan={async (reason) => {
          if (!banning) return null;
          try {
            await banMember(supabase, c.id, banning.userId, reason);
            showToast(`Banned ${banning.name}`);
            await loadLists();
            return null;
          } catch (e) {
            return e instanceof Error ? e.message : "Couldn't ban them.";
          }
        }}
      />
    </KeyboardAvoidingView>
  );
}


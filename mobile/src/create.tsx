/* The Create button, from anywhere: the site's Create menu (CreateMenu.tsx —
   Create a Discussion, Write a post, New community); the Start a discussion
   and Create a community cards (newRoomSheet.tsx, createCommunity.tsx),
   which share one modal and trade places from their Discussion | Community
   tabs as on the site (GlobalActions.tsx); and Write a post — pick a
   community, then the same composer the community page uses. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { useSession } from "./session";
import { ItemSheet } from "./itemSheet";
import { ComposerSheet, type ComposeClip } from "./composer";
import { attachPostTopic } from "./postTopic";
import { CreateCommunityCard } from "./createCommunity";
import { useMe } from "./me";
import { SITE } from "./api";
import { showToast } from "./toast";
import { createPost, fetchCommunities, type Community } from "./communities";
import { CommunityTile } from "./postCard";
import { colors, fonts } from "./theme";
import { NewRoomCard, type RoomPrefill } from "./newRoomSheet";
import { CardSwitch, SheetModal } from "./sheetModal";
export type { RoomPrefill };
export interface PostRequest { clip?: ComposeClip; to?: Community }
interface CreateState {
  openMenu(): void;
  openRoom(prefill?: RoomPrefill): void;
  openPost(req?: PostRequest): void;
  openCommunity(): void;
}
const Ctx = createContext<CreateState | null>(null);
export function useCreate(): CreateState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCreate outside CreateProvider");
  return v;
}

export function CreateProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const [menu, setMenu] = useState(false);
  /* The create card: which one shows, kept while the modal plays its exit. */
  const [card, setCard] = useState<{ open: boolean; which: "discussion" | "community"; prefill: RoomPrefill }>({ open: false, which: "discussion", prefill: {} });
  const [picking, setPicking] = useState(false);
  const [postIn, setPostIn] = useState<Community | null>(null);
  const [clip, setClip] = useState<ComposeClip | null>(null);
  const me = useMe();
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    if (!uid) { setVerified(false); return; }
    void supabase.from("users").select("verified").eq("id", uid).maybeSingle().then(({ data }) => setVerified(!!(data as { verified?: boolean } | null)?.verified));
  }, [uid]);
  void me;

  const needSignIn = useCallback(() => { router.push("/sign-in"); }, []);
  const closeCard = useCallback(() => setCard((c) => ({ ...c, open: false })), []);
  const value = useMemo<CreateState>(() => ({
    openMenu: () => (uid ? setMenu(true) : needSignIn()),
    openRoom: (prefill = {}) => (uid ? setCard({ open: true, which: "discussion", prefill }) : needSignIn()),
    openPost: (req = {}) => { if (!uid) return needSignIn(); setClip(req.clip ?? null); if (req.to) setPostIn(req.to); else setPicking(true); },
    openCommunity: () => (uid ? setCard({ open: true, which: "community", prefill: {} }) : needSignIn()),
  }), [uid, needSignIn]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <ItemSheet
        open={menu}
        title="Create"
        onClose={() => setMenu(false)}
        items={[
          { icon: "sparkles-outline", label: "Create a Discussion", run: () => setCard({ open: true, which: "discussion", prefill: {} }) },
          { icon: "create-outline", label: "Write a post", run: () => { setClip(null); setPicking(true); } },
          { icon: "people-outline", label: "New community", run: () => setCard({ open: true, which: "community", prefill: {} }) },
        ]}
      />
      <SheetModal open={card.open} onClose={closeCard} kind="card" scrim="rgba(0,0,0,0.78)">
        <CardSwitch
          current={card.which}
          render={(which) => which === "community"
            ? <CreateCommunityCard onClose={closeCard} onCreateDiscussion={() => setCard((c) => ({ ...c, which: "discussion", prefill: {} }))} />
            /* A community's own discussion has no Community tab. */
            : <NewRoomCard prefill={card.prefill} onClose={closeCard} onCreateCommunity={card.prefill.community ? undefined : () => setCard((c) => ({ ...c, which: "community" }))} />}
        />
      </SheetModal>
      <CommunityPicker open={picking} uid={uid} onClose={() => setPicking(false)} onPick={(c) => { setPicking(false); setPostIn(c); }} />
      <ComposerSheet
        open={!!postIn}
        kind="post"
        context={postIn ? `in ${postIn.name}` : null}
        communityId={postIn?.id ?? null}
        userId={uid}
        canAttachTopic={verified}
        clip={clip}
        onClose={() => { setPostIn(null); setClip(null); }}
        onSubmit={async ({ title, body, imageUrl, tagId, topic }) => {
          if (!uid || !postIn) return "Sign in to post.";
          try {
            /* A clip rides as its link at the end of the body, as on the site. */
            const text = [body, clip ? `${SITE}/clips/${clip.id}` : ""].filter(Boolean).join("\n\n");
            const id = await createPost(supabase, { communityId: postIn.id, authorId: uid, title, body: text || null, tagId, imageUrl });
            if (topic) { try { await attachPostTopic(supabase, id, topic, title); } catch (e) { showToast(e instanceof Error ? `Posted, but the queue wasn't attached: ${e.message}` : "Posted, but the queue wasn't attached."); } }
            setPostIn(null);
            setClip(null);
            router.push({ pathname: "/posts/[id]", params: { id } });
            return null;
          } catch (e) {
            return e instanceof Error ? e.message : "Couldn't post.";
          }
        }}
      />
    </Ctx.Provider>
  );
}

/* ── New post: where to ── */
function CommunityPicker({ open, uid, onClose, onPick }: { open: boolean; uid: string | null; onClose: () => void; onPick: (c: Community) => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [list, setList] = useState<Community[] | null>(null);
  useEffect(() => {
    if (!open) return;
    setList(null);
    fetchCommunities(supabase, uid)
      .then((cs) => setList(cs.filter((c) => (c.kind === "profile" ? c.my_role === "owner" : !c.is_private || c.joined)).sort((a, b) => Number(b.joined) - Number(a.joined) || a.name.localeCompare(b.name))))
      .catch(() => setList([]));
  }, [open, uid]);
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} />
      <View style={{ backgroundColor: colors.surface2, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#23232b", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 + insets.bottom, maxHeight: Math.round(height * 0.7) }}>
        <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 17 }}>New post</Text>
        <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13, marginTop: 2, marginBottom: 10 }}>Where does it go?</Text>
        <ScrollView>
          {list === null && <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 13, paddingVertical: 12 }}>Loading…</Text>}
          {list?.length === 0 && <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 13, paddingVertical: 12 }}>Join a community first.</Text>}
          {list?.map((c) => (
            <Pressable key={c.id} onPress={() => onPick(c)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 8, borderRadius: 10, backgroundColor: pressed ? "#1f1f26" : "transparent" })}>
              <CommunityTile name={c.name} color={c.color} avatarUrl={c.avatar_url} size={30} />
              <View style={{ flex: 1 }}>
                {/* A profile's community is named for its owner, "@jordan", as the site shows it. */}
                <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 14 }}>{c.name}</Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5 }}>{c.kind === "profile" ? "your profile" : `${c.members} member${c.members === 1 ? "" : "s"}${c.joined ? " · joined" : ""}`}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.faint} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

/* The Create button, from anywhere: the Create menu (createMenu.tsx — a
   small glass panel over the + in the tab bar: Create a Discussion, Write
   a post, New community); the Start a discussion
   and Create a community cards (newRoomSheet.tsx, createCommunity.tsx),
   which share one modal and trade places from their Discussion | Community
   tabs as on the site (GlobalActions.tsx); and Write a post — where it
   goes, then the same composer the community page uses, the two sharing
   one sheet the same way. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LayoutAnimation, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { useSession } from "./session";
import { CreateMenu, type CreateMenuItem } from "./createMenu";
import { ComposerPanel, type ComposeClip } from "./composer";
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
/* How long one asking for the communities list stands for the next: the
   Create menu asks as it opens, and the row tapped a moment later needn't. */
const PLACES_FRESH_MS = 5000;
export interface PostRequest { clip?: ComposeClip; to?: Community }
interface CreateState {
  openMenu(): void;
  openRoom(prefill?: RoomPrefill): void;
  openPost(req?: PostRequest): void;
  openCommunity(): void;
}
const Ctx = createContext<CreateState | null>(null);
/* The Create menu's own state, apart from the actions: the tabs draw
   the menu over themselves (CreateMenuHost), above the bar it rises
   from, so it is theirs to read. */
const MenuCtx = createContext<{ open: boolean; close: () => void; items: CreateMenuItem[] } | null>(null);
export function CreateMenuHost() {
  const m = useContext(MenuCtx);
  return m ? <CreateMenu open={m.open} items={m.items} onClose={m.close} /> : null;
}
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
  /* Write a post: where it goes (`to` not chosen yet), then the composer.
     `to` and the clip are kept while the sheet plays its exit. */
  const [post, setPost] = useState<{ open: boolean; to: Community | null }>({ open: false, to: null });
  const [clip, setClip] = useState<ComposeClip | null>(null);
  /* Where I can post, kept from one opening to the next, so the list is
     already there as the sheet rises. */
  const [mine, setMine] = useState<{ uid: string | null; list: Community[] } | null>(null);
  const places = mine && mine.uid === uid ? mine.list : null;
  const me = useMe();
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    if (!uid) { setVerified(false); return; }
    void supabase.from("users").select("verified").eq("id", uid).maybeSingle().then(({ data }) => setVerified(!!(data as { verified?: boolean } | null)?.verified));
  }, [uid]);
  void me;

  /* The list is on screen, still waiting to be filled. */
  const waiting = useRef(false);
  useEffect(() => { waiting.current = post.open && !post.to && !places; });
  const asked = useRef<{ uid: string | null; at: number }>({ uid: null, at: 0 });
  const loadPlaces = useCallback(() => {
    if (asked.current.uid === uid && Date.now() - asked.current.at < PLACES_FRESH_MS) return;
    asked.current = { uid, at: Date.now() };
    fetchCommunities(supabase, uid)
      .then((cs) => {
        /* Arriving under a sheet already up: it grows to fit rather than jumping. */
        if (waiting.current) LayoutAnimation.configureNext(LayoutAnimation.create(200, "easeInEaseOut", "opacity"));
        setMine({ uid, list: cs.filter((c) => (c.kind === "profile" ? c.my_role === "owner" : !c.is_private || c.joined)).sort((a, b) => Number(b.joined) - Number(a.joined) || a.name.localeCompare(b.name)) });
      })
      .catch(() => {
        asked.current.at = 0;
        setMine((m) => (m && m.uid === uid ? m : { uid, list: [] }));
      });
  }, [uid]);

  const needSignIn = useCallback(() => { router.push("/sign-in"); }, []);
  const closeCard = useCallback(() => setCard((c) => ({ ...c, open: false })), []);
  const closePost = useCallback(() => setPost((p) => ({ ...p, open: false })), []);
  const value = useMemo<CreateState>(() => ({
    openMenu: () => { if (!uid) return needSignIn(); loadPlaces(); setMenu(true); },
    openRoom: (prefill = {}) => (uid ? setCard({ open: true, which: "discussion", prefill }) : needSignIn()),
    openPost: (req = {}) => {
      if (!uid) return needSignIn();
      setClip(req.clip ?? null);
      if (!req.to) loadPlaces();
      setPost({ open: true, to: req.to ?? null });
    },
    openCommunity: () => (uid ? setCard({ open: true, which: "community", prefill: {} }) : needSignIn()),
  }), [uid, needSignIn, loadPlaces]);

  const menuValue = useMemo(() => ({
    open: menu,
    close: () => setMenu(false),
    items: [
      { icon: "sparkles-outline", label: "Create a Discussion", run: () => setCard({ open: true, which: "discussion", prefill: {} }) },
      { icon: "create-outline", label: "Write a post", run: () => { setClip(null); loadPlaces(); setPost({ open: true, to: null }); } },
      { icon: "people-outline", label: "New community", run: () => setCard({ open: true, which: "community", prefill: {} }) },
    ] satisfies CreateMenuItem[],
  }), [menu, loadPlaces]);

  const postTo = post.to;
  return (
    <Ctx.Provider value={value}>
      <MenuCtx.Provider value={menuValue}>{children}</MenuCtx.Provider>
      <SheetModal open={card.open} onClose={closeCard} kind="card" scrim="rgba(0,0,0,0.78)">
        <CardSwitch
          current={card.which}
          render={(which) => which === "community"
            ? <CreateCommunityCard onClose={closeCard} onCreateDiscussion={() => setCard((c) => ({ ...c, which: "discussion", prefill: {} }))} />
            /* A community's own discussion has no Community tab. */
            : <NewRoomCard prefill={card.prefill} onClose={closeCard} onCreateCommunity={card.prefill.community ? undefined : () => setCard((c) => ({ ...c, which: "community" }))} />}
        />
      </SheetModal>
      {/* One sheet for both halves: a community picked, the list dissolves
          as the composer rises in its place, the scrim never leaving. Two
          sheets in turn left the bare page showing between them. */}
      <SheetModal open={post.open} onClose={closePost}>
        <CardSwitch
          kind="bottom"
          current={postTo ? "write" : "pick"}
          render={(step) => step === "write" && postTo
            ? (
              <ComposerPanel
                kind="post"
                context={`in ${postTo.name}`}
                communityId={postTo.id}
                userId={uid}
                canAttachTopic={verified}
                clip={clip}
                onClose={closePost}
                onSubmit={async ({ title, body, imageUrl, tagId, topic }) => {
                  if (!uid) return "Sign in to post.";
                  try {
                    /* A clip rides as its link at the end of the body, as on the site. */
                    const text = [body, clip ? `${SITE}/clips/${clip.id}` : ""].filter(Boolean).join("\n\n");
                    const id = await createPost(supabase, { communityId: postTo.id, authorId: uid, title, body: text || null, tagId, imageUrl });
                    if (topic) { try { await attachPostTopic(supabase, id, topic, title); } catch (e) { showToast(e instanceof Error ? `Posted, but the queue wasn't attached: ${e.message}` : "Posted, but the queue wasn't attached."); } }
                    closePost();
                    router.push({ pathname: "/posts/[id]", params: { id } });
                    return null;
                  } catch (e) {
                    return e instanceof Error ? e.message : "Couldn't post.";
                  }
                }}
              />
            )
            : <PostPlaces list={places} onPick={(to) => setPost({ open: true, to })} />}
        />
      </SheetModal>
    </Ctx.Provider>
  );
}

/* ── New post: where to ── */
/* The first half of the Write a post sheet: the communities I can post
   in. */
function PostPlaces({ list, onPick }: { list: Community[] | null; onPick: (c: Community) => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
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
  );
}

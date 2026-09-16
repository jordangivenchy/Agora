/* The site's post card (components/community/PostCard.tsx): votes down
   the left, the community's tile, the meta line, the title, a two-line
   preview, the picture (tap to see it big), the clip it shares, the
   conversation it carries, the repost's original, and the actions:
   comments, share, repost. The ⋯ menu sits at the top right, where a
   phone's width has room for it (press and hold opens it too, as on the
   site's phones). The thread view uses it whole. */
import { Image, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Img } from "./img";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { timeAgo, type PostRow } from "./communities";
import { RichText } from "./richText";
import { SITE } from "./api";
import { openImage } from "./lightbox";
import { clipIdInBody, stripClipLink } from "./clips";
import { PostTopicQueue } from "./postTopic";
import { openPostMenu, startRepost, type PostHandlers } from "./postMenu";
import { colors, fonts } from "./theme";

export const META = "rgba(238,238,245,0.5)";
export const CARD = { backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 14 } as const;

export function CommunityTile({ name, color, avatarUrl, size = 30 }: { name: string; color?: string | null; avatarUrl?: string | null; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.32), overflow: "hidden", backgroundColor: color || colors.blue, alignItems: "center", justifyContent: "center" }}>
      {avatarUrl ? (
        <Img uri={avatarUrl} style={{ width: size, height: size }} />
      ) : (
        <Text style={{ color: "#fff", fontFamily: fonts.title, fontSize: Math.round(size * 0.45) }}>{name.trim().charAt(0).toUpperCase()}</Text>
      )}
    </View>
  );
}

/* Small tracked caps in a colour: OWNER, MOD, PINNED. */
export function Badge({ label, color, icon }: { label: string; color: string; icon?: "pin-outline" }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      {icon && <Ionicons name={icon} size={10} color={color} />}
      <Text style={{ color, fontFamily: fonts.extra, fontSize: 9, letterSpacing: 0.8 }}>{label}</Text>
    </View>
  );
}
export function RoleBadge({ role }: { role: string | null }) {
  if (role !== "owner" && role !== "moderator") return null;
  return <Badge label={role === "owner" ? "OWNER" : "MOD"} color={role === "owner" ? colors.gold : "#00b894"} />;
}

export function TagChip({ name, color }: { name: string; color: string | null }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 1, paddingLeft: 6, paddingRight: 7, borderRadius: 999, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color || META }} />
      <Text style={{ color: "#eeeef5", fontFamily: fonts.semi, fontSize: 9.5 }}>{name}</Text>
    </View>
  );
}

/* A post that shares a clip carries the link in its body; the card shows a chip to the clip's page. */
export function ClipChip({ clipId, small }: { clipId: string | null; small?: boolean }) {
  if (!clipId) return null;
  return (
    <Pressable onPress={() => router.push({ pathname: "/clips/[id]", params: { id: clipId } })} style={{ flexDirection: "row", alignItems: "center", gap: 7, alignSelf: "flex-start", marginTop: 8, paddingVertical: small ? 5 : 7, paddingLeft: 6, paddingRight: 12, borderRadius: 999, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2e2e38" }}>
      <View style={{ width: small ? 20 : 24, height: small ? 20 : 24, borderRadius: 6, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" }}><Ionicons name="play" size={small ? 9 : 11} color={colors.ink} /></View>
      <Text style={{ color: "#eeeef5", fontFamily: fonts.semi, fontSize: small ? 11.5 : 12.5 }}>Clip</Text>
    </Pressable>
  );
}

export function VoteBox({ score, myVote, onVote, size = 13 }: { score: number; myVote: number; onVote: (v: number) => void; size?: number }) {
  return (
    <View style={{ width: 34, alignItems: "center" }}>
      <Pressable onPress={() => onVote(myVote === 1 ? 0 : 1)} hitSlop={6} accessibilityLabel="Upvote">
        <Ionicons name="chevron-up" size={size + 7} color={myVote === 1 ? colors.gold : "rgba(238,238,245,0.32)"} />
      </Pressable>
      <Text style={{ color: "#eeeef5", fontFamily: fonts.semi, fontSize: size }}>{score}</Text>
      <Pressable onPress={() => onVote(myVote === -1 ? 0 : -1)} hitSlop={6} accessibilityLabel="Downvote">
        <Ionicons name="chevron-down" size={size + 7} color={myVote === -1 ? "#64B5F6" : "rgba(238,238,245,0.32)"} />
      </Pressable>
    </View>
  );
}

export interface CommunityArt { name: string; color?: string | null; avatarUrl?: string | null }

export function PostCard({ post: p, communityArt, showCommunity, full, onVote, onOpen, onOpenCommunity, actions, onChanged, onRemoved }: {
  post: PostRow;
  communityArt?: CommunityArt;
  showCommunity?: boolean;
  /** The thread view: the whole body, no card press. */
  full?: boolean;
  onVote: (v: number) => void;
  onOpen?: () => void;
  onOpenCommunity?: () => void;
  /** More actions on the row, from the page. */
  actions?: React.ReactNode;
  /** The menu changed the post here: pinned, featured, edited. */
  onChanged?: PostHandlers["onChanged"];
  /** The menu deleted it. */
  onRemoved?: PostHandlers["onRemoved"];
}) {
  const share = () => void Share.share({ message: p.title, url: `${SITE}/posts/${p.id}` }).catch(() => undefined);
  const handlers: PostHandlers = { onChanged, onRemoved };
  const menu = () => openPostMenu(p, handlers);
  const body = stripClipLink(p.body);
  const origBody = stripClipLink(p.orig_body);
  return (
    <Pressable onPress={onOpen} onLongPress={() => { void Haptics.selectionAsync().catch(() => undefined); menu(); }} delayLongPress={350} style={({ pressed }) => [CARD, { padding: 14, marginBottom: 12, opacity: pressed && onOpen ? 0.92 : 1 }]}>
      {/* One rail, not two: the picture with the score under it. The
          votes used to have a gutter of their own beside the tile, which
          cost a phone forty points of width and left the score floating
          in the middle of a long post. */}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ alignItems: "center" }}>
          {communityArt && (
            <Pressable onPress={onOpenCommunity} disabled={!onOpenCommunity} style={{ marginTop: 2 }}>
              <CommunityTile name={communityArt.name} color={communityArt.color} avatarUrl={communityArt.avatarUrl} />
            </Pressable>
          )}
          {/* Under the picture, and down the middle of what is left: on a
              long post the score sits beside the words it belongs to
              rather than riding at the very top. */}
          <View style={{ flex: 1, justifyContent: "center", paddingVertical: 4 }}>
            <VoteBox score={p.score} myVote={p.my_vote} onVote={onVote} />
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <Text style={{ color: META, fontFamily: fonts.body, fontSize: 10.5 }}>
              {showCommunity && <Text style={{ color: colors.gold }} onPress={onOpenCommunity}>{p.community_name} · </Text>}
              <Text onPress={() => router.push({ pathname: "/u/[username]", params: { username: p.author_username } })}>@{p.author_username}</Text> · {timeAgo(p.created_at)}{p.edited_at ? " · edited" : ""}
            </Text>
            <RoleBadge role={p.author_role} />
            {p.pinned_at && <Badge label="PINNED" color={colors.blueText} icon="pin-outline" />}
            {p.tag_name && <TagChip name={p.tag_name} color={p.tag_color} />}
          </View>
            <Pressable onPress={menu} hitSlop={10} accessibilityLabel="More actions" style={({ pressed }) => ({ width: 28, height: 20, marginTop: -3, marginRight: -6, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? "#1a1a1f" : "transparent" })}>
              <Ionicons name="ellipsis-horizontal" size={16} color="#c9c9d2" />
            </Pressable>
          </View>
          <RichText text={p.title} numberOfLines={full ? undefined : 3} style={{ color: "#eeeef5", fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, marginTop: 2 }} />
          {!!body && (
            <View style={{ marginTop: 4 }}>
              <RichText text={body} numberOfLines={full ? undefined : 2} style={{ color: full ? "#d6d6de" : "rgba(238,238,245,0.55)", fontFamily: fonts.body, fontSize: full ? 13.5 : 12, lineHeight: full ? 20 : 18 }} />
            </View>
          )}
          <ClipChip clipId={clipIdInBody(p.body)} small={!full} />
          {p.image_url && (
            <Pressable onPress={() => openImage(p.image_url!)} accessibilityLabel="Open image">
              <Img uri={p.image_url} style={{ marginTop: 8, borderRadius: 8, width: "100%", height: full ? 260 : 180 }} recyclingKey={p.id} />
            </Pressable>
          )}
          <PostTopicQueue postId={p.id} compact={!full} />
          {p.is_repost && (
            <View style={{ marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }}>
              {p.repost_of ? (
                <>
                  <Text style={{ color: META, fontFamily: fonts.body, fontSize: 10 }}>
                    <Ionicons name="repeat-outline" size={10} color={META} /> from <Text style={{ color: colors.gold }}>{p.orig_community_name}</Text> · @{p.orig_author_username}
                  </Text>
                  {!!p.orig_title && <Text onPress={() => router.push({ pathname: "/posts/[id]", params: { id: p.repost_of! } })} style={{ color: "rgba(238,238,245,0.88)", fontFamily: fonts.medium, fontSize: 12.5, marginTop: 5 }}>{p.orig_title}</Text>}
                  {!!origBody && <RichText text={origBody} numberOfLines={2} style={{ color: "rgba(238,238,245,0.55)", fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, marginTop: 3 }} />}
                  <ClipChip clipId={clipIdInBody(p.orig_body)} small />
                  {p.orig_image_url && <Pressable onPress={() => openImage(p.orig_image_url!)}><Image source={{ uri: p.orig_image_url }} style={{ marginTop: 6, borderRadius: 8, width: "100%", height: 140 }} resizeMode="cover" /></Pressable>}
                </>
              ) : (
                <Text style={{ color: META, fontFamily: fonts.body, fontSize: 11.5 }}>The original post was unavailable or deleted.</Text>
              )}
            </View>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons name="chatbubble-outline" size={13} color="#c9c9d2" />
              <Text style={{ color: "#c9c9d2", fontFamily: fonts.medium, fontSize: 11.5 }}>{p.comment_count} comment{Number(p.comment_count) === 1 ? "" : "s"}</Text>
            </View>
            <Pressable onPress={share} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons name="share-social-outline" size={13} color="#c9c9d2" />
              <Text style={{ color: "#c9c9d2", fontFamily: fonts.medium, fontSize: 11.5 }}>Share</Text>
            </Pressable>
            <Pressable onPress={() => startRepost(p, handlers)} hitSlop={6} accessibilityLabel="Repost" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons name="repeat-outline" size={14} color="#c9c9d2" />
              <Text style={{ color: "#c9c9d2", fontFamily: fonts.medium, fontSize: 11.5 }}>Repost</Text>
            </Pressable>
            {actions}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/* Best / New / Top, and Top / New: the site's sort pills. */
export function SortChips<T extends string>({ value, options, onChange, quiet }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; /** The comment sort: small grey pills, not the yellow ones. */ quiet?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: quiet ? 6 : 8 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={quiet
              ? { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: on ? colors.surface2 : "transparent", borderWidth: StyleSheet.hairlineWidth, borderColor: on ? colors.border : colors.hairline }
              : { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: on ? colors.yellow : colors.surface, borderWidth: 1, borderColor: on ? colors.yellow : colors.hairline }}
          >
            <Text style={quiet ? { color: on ? "#eeeef5" : META, fontFamily: fonts.body, fontSize: 11 } : { color: on ? colors.ink : "#eeeef5", fontFamily: fonts.semi, fontSize: 12.5 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

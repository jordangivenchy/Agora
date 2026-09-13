/* The site's post card (components/community/PostCard.tsx): votes down
   the left, the community's tile, the meta line, the title, a two-line
   preview, the picture, and the actions. The thread view uses it whole. */
import { Image, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { timeAgo, type PostRow } from "./communities";
import { RichText } from "./richText";
import { SITE } from "./api";
import { colors, fonts } from "./theme";

export const META = "rgba(238,238,245,0.5)";
export const CARD = { backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 14 } as const;

export function CommunityTile({ name, color, avatarUrl, size = 30 }: { name: string; color?: string | null; avatarUrl?: string | null; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.32), overflow: "hidden", backgroundColor: color || colors.blue, alignItems: "center", justifyContent: "center" }}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={{ width: size, height: size }} />
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

export function VoteBox({ score, myVote, onVote, size = 13 }: { score: number; myVote: number; onVote: (v: number) => void; size?: number }) {
  return (
    <View style={{ width: 34, alignItems: "center", alignSelf: "center" }}>
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

export function PostCard({ post: p, communityArt, showCommunity, full, onVote, onOpen, onOpenCommunity }: {
  post: PostRow;
  communityArt?: CommunityArt;
  showCommunity?: boolean;
  /** The thread view: the whole body, no card press. */
  full?: boolean;
  onVote: (v: number) => void;
  onOpen?: () => void;
  onOpenCommunity?: () => void;
}) {
  const share = () => void Share.share({ message: p.title, url: `${SITE}/posts/${p.id}` }).catch(() => undefined);
  return (
    <Pressable onPress={onOpen} disabled={!onOpen} style={({ pressed }) => [CARD, { padding: 14, marginBottom: 12, opacity: pressed ? 0.92 : 1 }]}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <VoteBox score={p.score} myVote={p.my_vote} onVote={onVote} />
        {communityArt && (
          <Pressable onPress={onOpenCommunity} disabled={!onOpenCommunity} style={{ marginTop: 2 }}>
            <CommunityTile name={communityArt.name} color={communityArt.color} avatarUrl={communityArt.avatarUrl} />
          </Pressable>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <Text style={{ color: META, fontFamily: fonts.body, fontSize: 10.5 }}>
              {showCommunity && <Text style={{ color: colors.gold }} onPress={onOpenCommunity}>{p.community_name} · </Text>}
              <Text onPress={() => router.push({ pathname: "/u/[username]", params: { username: p.author_username } })}>@{p.author_username}</Text> · {timeAgo(p.created_at)}{p.edited_at ? " · edited" : ""}
            </Text>
            <RoleBadge role={p.author_role} />
            {p.pinned_at && <Badge label="PINNED" color={colors.blueText} icon="pin-outline" />}
            {p.tag_name && <TagChip name={p.tag_name} color={p.tag_color} />}
          </View>
          <RichText text={p.title} numberOfLines={full ? undefined : 3} style={{ color: "#eeeef5", fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, marginTop: 2 }} />
          {!!p.body && (
            <View style={{ marginTop: 4 }}>
              <RichText text={p.body} numberOfLines={full ? undefined : 2} style={{ color: full ? "#d6d6de" : "rgba(238,238,245,0.55)", fontFamily: fonts.body, fontSize: full ? 13.5 : 12, lineHeight: full ? 20 : 18 }} />
            </View>
          )}
          {p.image_url && <Image source={{ uri: p.image_url }} style={{ marginTop: 8, borderRadius: 8, width: "100%", height: full ? 260 : 180 }} resizeMode="cover" />}
          {p.is_repost && (p.orig_title || p.orig_body) && (
            <View style={{ marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }}>
              <Text style={{ color: META, fontFamily: fonts.body, fontSize: 10 }}>
                <Ionicons name="repeat-outline" size={10} color={META} /> from <Text style={{ color: colors.gold }}>{p.orig_community_name}</Text> · @{p.orig_author_username}
              </Text>
              {!!p.orig_title && <Text style={{ color: "rgba(238,238,245,0.88)", fontFamily: fonts.medium, fontSize: 12.5, marginTop: 5 }}>{p.orig_title}</Text>}
              {!!p.orig_body && <RichText text={p.orig_body} numberOfLines={2} style={{ color: "rgba(238,238,245,0.55)", fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, marginTop: 3 }} />}
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

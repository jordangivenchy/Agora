"use client";

/* A group's picture: two members' avatars stacked (the people, not an
   icon), falling back to a solid users tile when nobody else is in it. */

import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import type { GroupMember } from "./groups";

export default function GroupTile({
  members,
  size = 44,
  /** Colour of the ring separating the two stacked pictures — match the surface. */
  ring = "#0b0b0d",
}: {
  members: GroupMember[];
  size?: number;
  ring?: string;
}) {
  const pair = members.slice(0, 2);
  if (pair.length === 2) {
    const s = Math.round(size * 0.68);
    return (
      <span
        aria-hidden="true"
        style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "inline-block" }}
      >
        <span style={{ position: "absolute", top: 0, right: 0, lineHeight: 0 }}>
          <UserAvatar size={s} username={pair[1].username} avatarUrl={pair[1].avatar_url} seed={pair[1].id} />
        </span>
        <span
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            lineHeight: 0,
            borderRadius: "50%",
            boxShadow: `0 0 0 2px ${ring}`,
          }}
        >
          <UserAvatar size={s} username={pair[0].username} avatarUrl={pair[0].avatar_url} seed={pair[0].id} />
        </span>
      </span>
    );
  }
  if (pair.length === 1) {
    return <UserAvatar size={size} username={pair[0].username} avatarUrl={pair[0].avatar_url} seed={pair[0].id} />;
  }
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "#1e2129",
        color: "#c9c9d2",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Icon name="users" size={Math.round(size * 0.44)} />
    </span>
  );
}

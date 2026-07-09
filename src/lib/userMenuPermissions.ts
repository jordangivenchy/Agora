/**
 * THE single source of truth for which context-menu actions a user sees.
 * Every surface (tiles, audience, chat, profiles, sidebar) renders the
 * menu from this function — permission logic must never be duplicated
 * in components.
 */

export type MenuActionId =
  // standard
  | "view_profile"
  | "whisper"
  | "follow"
  | "mute_audio"
  | "hide_camera"
  | "block"
  | "report"
  | "copy_link"
  // host
  | "host_stage_pro"
  | "host_stage_con"
  | "host_to_audience"
  | "host_mute_mic"
  | "host_disable_cam"
  | "host_end_turn"
  | "host_give_turn"
  | "host_timeout"
  | "host_kick"
  | "host_ban"
  // moderator
  | "mod_panel"
  | "mod_warn"
  | "mod_suspend"
  | "mod_ban_account";

export interface MenuPermissionInput {
  signedIn: boolean;
  isSelf: boolean;
  /** Menu opened inside a debate room. */
  inRoom: boolean;
  /** Target currently holds a debater seat. */
  targetIsDebater: boolean;
  /** Target is in the room as a spectator. */
  targetIsSpectator: boolean;
  /** Current user hosts this room. */
  isHost: boolean;
  /** Turn timer is running with both debaters present. */
  timerActive: boolean;
  /** It is currently the target's speaking turn. */
  targetHasTurn: boolean;
  /** Current user is a platform moderator. */
  isModerator: boolean;
  /** Suppress View Profile (already on the profile). */
  hideViewProfile?: boolean;
}

export interface MenuSections {
  standard: MenuActionId[];
  host: MenuActionId[];
  moderator: MenuActionId[];
}

export function visibleActions(p: MenuPermissionInput): MenuSections {
  const standard: MenuActionId[] = [];
  const host: MenuActionId[] = [];
  const moderator: MenuActionId[] = [];

  if (p.isSelf) {
    // Own avatar: only navigation-ish actions.
    if (!p.hideViewProfile) standard.push("view_profile");
    standard.push("copy_link");
    return { standard, host, moderator };
  }

  if (!p.hideViewProfile) standard.push("view_profile");
  if (p.signedIn) {
    standard.push("whisper", "follow");
    // Local AV controls only make sense for someone publishing media.
    if (p.inRoom && p.targetIsDebater) {
      standard.push("mute_audio", "hide_camera");
    }
    standard.push("block", "report");
  }
  standard.push("copy_link");

  if (p.signedIn && p.isHost && p.inRoom) {
    if (p.targetIsSpectator) host.push("host_stage_pro", "host_stage_con");
    if (p.targetIsDebater) {
      host.push("host_to_audience", "host_mute_mic", "host_disable_cam");
      if (p.timerActive) {
        host.push(p.targetHasTurn ? "host_end_turn" : "host_give_turn");
      }
    }
    if (p.targetIsDebater || p.targetIsSpectator) {
      host.push("host_timeout", "host_kick", "host_ban");
    }
  }

  if (p.signedIn && p.isModerator) {
    moderator.push("mod_panel", "mod_warn", "mod_suspend", "mod_ban_account");
  }

  return { standard, host, moderator };
}

"use client";

import { createContext, useContext } from "react";

export interface MenuRoomContext {
  roomId: string;
  isHost: boolean;
  targetIsDebater: boolean;
  targetIsSpectator: boolean;
  targetStance?: "PRO" | "CON" | null;
  timerActive?: boolean;
  targetHasTurn?: boolean;
  /** Local-only AV state + toggles, owned by the debate stage. */
  audioMutedLocally?: boolean;
  cameraHiddenLocally?: boolean;
  onToggleLocalMute?: () => void;
  onToggleHideCamera?: () => void;
  /** Host turn control (broadcast lives in the stage). */
  onForceTurn?: (stance: "PRO" | "CON") => void;
}

export interface MenuChatContext {
  roomId: string;
  messageId: string;
  messagePreview: string;
}

export interface OpenMenuOptions {
  room?: MenuRoomContext;
  chat?: MenuChatContext;
  hideViewProfile?: boolean;
}

export interface UserMenuApi {
  openUserMenu: (
    at: { x: number; y: number },
    target: { userId: string; username: string },
    opts?: OpenMenuOptions
  ) => void;
}

export const UserMenuCtx = createContext<UserMenuApi | null>(null);

export function useUserMenu(): UserMenuApi {
  const ctx = useContext(UserMenuCtx);
  if (!ctx) throw new Error("useUserMenu must be used inside <UserMenuProvider>");
  return ctx;
}

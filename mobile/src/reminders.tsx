/* "Notify me when this goes live": a reminder on a scheduled public room,
   set and read the way the site's bells do (toggle_room_reminder,
   get_room_reminders). When the room's doors open, the reminder job sends
   an in-app notification, an email and a web push. The bell is gold once
   set; the count is how many are waiting. */
import { useCallback, useState } from "react";
import { Pressable } from "react-native";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { supabase } from "./supabase";
import { useSession } from "./session";
import { showToast } from "./toast";

export interface ReminderState { count: number; amSet: boolean }

export async function fetchReminders(client: SupabaseClient, roomIds: string[]): Promise<Record<string, ReminderState>> {
  if (roomIds.length === 0) return {};
  const { data } = await client.rpc("get_room_reminders", { p_rooms: roomIds });
  const out: Record<string, ReminderState> = {};
  for (const r of (data ?? []) as { room_id: string; reminder_count: number | string; am_set: boolean }[]) {
    out[r.room_id] = { count: Number(r.reminder_count) || 0, amSet: !!r.am_set };
  }
  return out;
}

/** Flip my reminder on a room; resolves to whether it's set now. */
export async function toggleRoomReminder(client: SupabaseClient, roomId: string): Promise<boolean> {
  const { data, error } = await client.rpc("toggle_room_reminder", { p_room: roomId });
  if (error) throw new Error(error.message.includes("suspended") ? "Your account is suspended." : error.message.replace(/^[a-z_]+:\s*/, ""));
  return data === true;
}

export function reminderToast(on: boolean) {
  showToast(on ? "You'll be notified when it starts" : "Reminder removed");
}

/* Reminders for a set of rooms with an optimistic toggle; a guest is sent
   to sign in. They're read again whenever the screen comes back into view,
   so a bell set on one screen shows on the others. */
export function useReminders(roomIds: string[]) {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const key = [...new Set(roomIds)].sort().join(",");
  const [reminders, setReminders] = useState<Record<string, ReminderState>>({});
  const [busy, setBusy] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    let live = true;
    void fetchReminders(supabase, key ? key.split(",") : []).then((m) => { if (live) setReminders(m); });
    return () => { live = false; };
  }, [key, uid]));
  const toggle = useCallback(async (roomId: string) => {
    if (!uid) { router.push("/sign-in"); return; }
    if (busy) return;
    setBusy(roomId);
    try {
      const on = await toggleRoomReminder(supabase, roomId);
      setReminders((m) => {
        const cur = m[roomId] ?? { count: 0, amSet: false };
        const delta = on === cur.amSet ? 0 : on ? 1 : -1;
        return { ...m, [roomId]: { count: Math.max(0, cur.count + delta), amSet: on } };
      });
      reminderToast(on);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't set a reminder.");
    } finally {
      setBusy(null);
    }
  }, [uid, busy]);
  return { reminders, toggle, busy };
}

/* The round bell: gold once set. On a photo it sits on solid black. */
export function ReminderBell({ set, onPress, size = 34, disabled }: { set: boolean; onPress: () => void; size?: number; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ selected: set, disabled }}
      accessibilityLabel={set ? "Reminder set, tap to remove" : "Notify me when this goes live"}
      style={({ pressed }) => ({
        width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center",
        backgroundColor: set ? "#e2b96b" : "#0b0b0d", borderWidth: 1, borderColor: set ? "#d9a238" : "#34343c",
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <Ionicons name={set ? "notifications" : "notifications-outline"} size={Math.round(size * 0.46)} color={set ? "#3a2a05" : "#c9c9d2"} />
    </Pressable>
  );
}

/* The stage, drawn for a phone: the speakers as tiles that light up when
   they talk, the raised hands as a strip the host works from, the
   audience as faces along the bottom. Hosts tap a tile or a hand for
   the choices; everyone else just watches it move. */
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Avatar } from "./avatar";
import { ActionSheet, type SheetAction } from "./actionSheet";
import { ROLE_LABEL, deriveStageRole, isHostRole, onStage, seatName, seatUser, sortRequests, type Seat, type StageRole } from "./stageModel";
import { colors } from "./theme";

export interface StageActions {
  bringUp(seat: Seat): void;
  dismiss(seat: Seat): void;
  toAudience(seat: Seat): void;
  makeCohost(seat: Seat, make: boolean): void;
}

export function StageView({
  seats, hostId, meId, myRole, speaking, actions, requestsLocked, onToggleLock,
}: { seats: Seat[]; hostId: string; meId: string | null; myRole: StageRole; speaking: Set<string>; actions: StageActions | null; requestsLocked: boolean; onToggleLock: () => void }) {
  const [picked, setPicked] = useState<{ seat: Seat; role: StageRole } | null>(null);
  const withRole = seats.map((seat) => ({ seat, role: deriveStageRole(seat, hostId) }));
  const stage = withRole.filter((x) => onStage(x.role)).sort((a, b) => rank(a.role) - rank(b.role) || a.seat.joined_at.localeCompare(b.seat.joined_at));
  const requests = sortRequests(withRole.filter((x) => !onStage(x.role) && !!x.seat.hand_raised_at).map((x) => x.seat));
  const audience = withRole.filter((x) => !onStage(x.role) && !x.seat.hand_raised_at);
  const canManage = actions !== null && isHostRole(myRole);

  const sheetActions: SheetAction[] = picked && actions
    ? onStage(picked.role)
      ? [
          ...(picked.role === "speaker" ? [{ label: "Make co-host", onPress: () => actions.makeCohost(picked.seat, true) }] : []),
          ...(picked.role === "cohost" ? [{ label: "Back to speaker", onPress: () => actions.makeCohost(picked.seat, false) }] : []),
          ...(picked.role !== "host" ? [{ label: "Send to the audience", onPress: () => actions.toAudience(picked.seat), danger: true }] : []),
        ]
      : [
          { label: "Bring up to speak", onPress: () => actions.bringUp(picked.seat), primary: true },
          { label: "Lower their hand", onPress: () => actions.dismiss(picked.seat) },
        ]
    : [];

  return (
    <View>
      {/* The stage */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {stage.length === 0 && (
          <View style={{ width: "100%", padding: 22, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}>
            <Text style={{ color: colors.muted, fontSize: 13 }}>The stage is empty.</Text>
          </View>
        )}
        {stage.map(({ seat, role }) => {
          const user = seatUser(seat);
          const name = seatName(seat);
          const talking = speaking.has(seat.user_id);
          const me = seat.user_id === meId;
          const wide = stage.length === 1;
          return (
            <Pressable
              key={seat.id}
              disabled={!canManage || role === "host"}
              onPress={() => setPicked({ seat, role })}
              style={({ pressed }) => ({
                width: wide ? "100%" : "48%", alignItems: "center", paddingVertical: 18, borderRadius: 18,
                backgroundColor: talking ? "#161307" : colors.surface, borderWidth: 1, borderColor: talking ? colors.yellow : colors.border, opacity: pressed ? 0.85 : 1,
              })}
            >
              <Avatar url={user?.avatar_url} name={name} size={wide ? 96 : 72} ring={talking} />
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14.5, fontWeight: "700", marginTop: 10, maxWidth: "90%" }}>{name}{me ? " (you)" : ""}</Text>
              <Text style={{ color: talking ? colors.yellow : colors.muted, fontSize: 11.5, marginTop: 2, fontWeight: talking ? "700" : "500" }}>
                {talking ? "Speaking" : seat.mic_muted ? "Muted" : ROLE_LABEL[role]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Hands up */}
      <View style={{ marginTop: 18 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 }}>
            HANDS UP{requests.length > 0 ? ` · ${requests.length}` : ""}
          </Text>
          {canManage && (
            <Pressable onPress={onToggleLock} hitSlop={8}>
              <Text style={{ color: requestsLocked ? colors.red : colors.blueText, fontSize: 12, fontWeight: "700" }}>{requestsLocked ? "Requests closed · open" : "Close requests"}</Text>
            </Pressable>
          )}
        </View>
        {requests.length === 0 ? (
          <Text style={{ color: colors.faint, fontSize: 12.5 }}>{requestsLocked ? "Requests are closed." : "No one waiting."}</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {requests.map((seat, i) => (
              <Pressable key={seat.id} disabled={!canManage} onPress={() => setPicked({ seat, role: "audience" })} style={{ alignItems: "center", width: 64 }}>
                <View>
                  <Avatar url={seatUser(seat)?.avatar_url} name={seatName(seat)} size={52} />
                  <View style={{ position: "absolute", right: -4, top: -4, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.bg }}>
                    <Text style={{ color: colors.ink, fontSize: 11, fontWeight: "800" }}>{i + 1}</Text>
                  </View>
                </View>
                <Text numberOfLines={1} style={{ color: colors.text, fontSize: 11.5, marginTop: 6, maxWidth: 64 }}>{seat.user_id === meId ? "You" : seatName(seat)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Listening */}
      <View style={{ marginTop: 18 }}>
        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginBottom: 8 }}>LISTENING{audience.length > 0 ? ` · ${audience.length}` : ""}</Text>
        {audience.length === 0 ? (
          <Text style={{ color: colors.faint, fontSize: 12.5 }}>Nobody yet.</Text>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {audience.slice(0, 24).map(({ seat }) => (
              <Avatar key={seat.id} url={seatUser(seat)?.avatar_url} name={seatName(seat)} size={36} dim={seat.user_id !== meId} />
            ))}
            {audience.length > 24 && (
              <View style={{ height: 36, paddingHorizontal: 10, borderRadius: 18, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>+{audience.length - 24}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      <ActionSheet
        open={!!picked}
        title={picked ? seatName(picked.seat) : ""}
        sub={picked ? (onStage(picked.role) ? ROLE_LABEL[picked.role] : "Hand up") : undefined}
        actions={sheetActions}
        onClose={() => setPicked(null)}
      />
    </View>
  );
}

const rank = (r: StageRole) => (r === "host" ? 0 : r === "cohost" ? 1 : r === "speaker" ? 2 : 3);

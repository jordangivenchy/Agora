/* The room's people: raised hands first (for the host to work), then the
   stage, then the audience. Hosts get the controls inline. */
import { Pressable, Text, View } from "react-native";
import { ROLE_LABEL, deriveStageRole, isHostRole, onStage, seatName, sortRequests, type Seat, type StageRole } from "./stageModel";
import { colors } from "./theme";

export interface SeatActions {
  bringUp(seat: Seat): void;
  dismiss(seat: Seat): void;
  toAudience(seat: Seat): void;
}

export function SeatList({
  seats, hostId, meId, myRole, speaking, actions,
}: { seats: Seat[]; hostId: string; meId: string | null; myRole: StageRole; speaking: Set<string>; actions: SeatActions | null }) {
  const withRole = seats.map((s) => ({ seat: s, role: deriveStageRole(s, hostId) }));
  const requests = sortRequests(withRole.filter((x) => !!x.seat.hand_raised_at && !onStage(x.role)).map((x) => x.seat));
  const stage = withRole.filter((x) => onStage(x.role)).sort((a, b) => rank(a.role) - rank(b.role));
  const audience = withRole.filter((x) => !onStage(x.role) && !x.seat.hand_raised_at);
  const canManage = actions !== null && isHostRole(myRole);

  return (
    <View>
      {requests.length > 0 && (
        <Group title="Hands up" count={requests.length}>
          {requests.map((s) => (
            <Row key={s.id} seat={s} role="audience" me={s.user_id === meId} speaking={speaking.has(s.user_id)} hand>
              {canManage && (
                <>
                  <Small onPress={() => actions!.bringUp(s)} primary>Bring up</Small>
                  <Small onPress={() => actions!.dismiss(s)}>Dismiss</Small>
                </>
              )}
            </Row>
          ))}
        </Group>
      )}
      <Group title="On stage" count={stage.length}>
        {stage.length === 0 && <Text style={{ color: colors.faint, fontSize: 12.5 }}>Nobody yet.</Text>}
        {stage.map(({ seat, role }) => (
          <Row key={seat.id} seat={seat} role={role} me={seat.user_id === meId} speaking={speaking.has(seat.user_id)}>
            {canManage && role === "speaker" && <Small onPress={() => actions!.toAudience(seat)}>To audience</Small>}
          </Row>
        ))}
      </Group>
      <Group title="Listening" count={audience.length}>
        {audience.length === 0 && <Text style={{ color: colors.faint, fontSize: 12.5 }}>Nobody yet.</Text>}
        {audience.map(({ seat }) => (
          <Row key={seat.id} seat={seat} role="audience" me={seat.user_id === meId} speaking={false} />
        ))}
      </Group>
    </View>
  );
}

const rank = (r: StageRole) => (r === "host" ? 0 : r === "cohost" ? 1 : r === "speaker" ? 2 : 3);

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 }}>{title.toUpperCase()}</Text>
        {count > 0 && <Text style={{ color: colors.faint, fontSize: 11 }}>{count}</Text>}
      </View>
      {children}
    </View>
  );
}

function Row({ seat, role, me, speaking, hand, children }: { seat: Seat; role: StageRole; me: boolean; speaking: boolean; hand?: boolean; children?: React.ReactNode }) {
  const name = seatName(seat);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.surface2 }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: speaking ? colors.yellow : colors.surface2, borderWidth: 1, borderColor: speaking ? colors.yellow : colors.border }}>
        <Text style={{ color: speaking ? colors.ink : colors.text, fontWeight: "800", fontSize: 13 }}>{name.replace(/^@/, "").slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>{name}{me ? " (you)" : ""}</Text>
        <Text style={{ color: colors.muted, fontSize: 11.5 }}>{hand ? "hand up" : ROLE_LABEL[role]}{seat.mic_muted && onStage(role) ? " · muted" : ""}</Text>
      </View>
      {children}
    </View>
  );
}

function Small({ children, onPress, primary }: { children: React.ReactNode; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={{ paddingHorizontal: 11, height: 30, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: primary ? colors.yellow : colors.surface, borderWidth: 1, borderColor: primary ? colors.yellow : colors.border, marginLeft: 6 }}>
      <Text style={{ color: primary ? colors.ink : colors.text, fontSize: 12, fontWeight: "700" }}>{children}</Text>
    </Pressable>
  );
}

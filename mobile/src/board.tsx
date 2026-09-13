/* "Browse" from the site's home: the fields as chips, then the chosen
   field's popular rooms, its scheduled ones, and its daily topics. */
import { useEffect, useState, type ReactNode } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { TOPICS, darkInkOn, type IconName, type Topic } from "./topics";
import { fmtRotate, isScheduled, msToUtcMidnight, personName, roomHost, type BoardRoom, type TopicRow } from "./home";
import { whenLabel } from "./rooms";
import { openWeb } from "./web";
import { colors, fonts } from "./theme";

const QUESTIONS_SHOWN = 4;

export function TopicBoard({ topics, rooms, onQueue }: { topics: TopicRow[]; rooms: BoardRoom[]; onQueue: (t: TopicRow) => void }) {
  const [selectedKey, setSelectedKey] = useState(TOPICS[0].key);
  const [showAll, setShowAll] = useState(false);
  const [rotateLeft, setRotateLeft] = useState(msToUtcMidnight);
  useEffect(() => {
    const t = setInterval(() => setRotateLeft(msToUtcMidnight()), 30_000);
    return () => clearInterval(t);
  }, []);

  const sel = TOPICS.find((t) => t.key === selectedKey) ?? TOPICS[0];
  const fieldRooms = rooms.filter((r) => r.topic_key === sel.key);
  /* Live first, most watched on top; then open lobbies, newest first. */
  const popular = fieldRooms
    .filter((r) => !isScheduled(r))
    .sort((a, b) => {
      if ((a.status === "live") !== (b.status === "live")) return a.status === "live" ? -1 : 1;
      if (a.status === "live") return (b.viewer_count ?? 0) - (a.viewer_count ?? 0);
      return b.created_at.localeCompare(a.created_at);
    });
  const scheduled = fieldRooms.filter(isScheduled).sort((a, b) => (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? ""));
  const questions = topics.filter((t) => t.topic_key === sel.key);
  const shown = showAll ? questions : questions.slice(0, QUESTIONS_SHOWN);

  return (
    <View style={{ paddingTop: 22 }}>
      <Text style={{ paddingHorizontal: 20, color: colors.text, fontFamily: fonts.title, fontSize: 22, letterSpacing: -0.3 }}>Browse</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingVertical: 14 }}>
        {TOPICS.map((cat) => (
          <Chip key={cat.key} cat={cat} active={cat.key === sel.key} status={statusFor(cat, topics, rooms)} onPress={() => { setSelectedKey(cat.key); setShowAll(false); }} />
        ))}
      </ScrollView>
      <View style={{ paddingHorizontal: 20 }}>
        <SectionHead title="Popular rooms" color={colors.blueText} right={popular.length > 2 ? "Explore all →" : undefined} onRight={() => openWeb("/explore")} />
        {popular.length === 0 ? <Empty>No open rooms in {sel.label} yet.</Empty> : <Strip>{popular.map((r) => <RoomTile key={r.id} room={r} />)}</Strip>}
        <SectionHead title="Scheduled" color={colors.purple} />
        {scheduled.length === 0 ? <Empty>Nothing on the calendar in {sel.label} yet.</Empty> : <Strip>{scheduled.map((r) => <RoomTile key={r.id} room={r} />)}</Strip>}
        <SectionHead title="Daily topics" color={colors.yellow} right={`new topics in ${fmtRotate(rotateLeft)}`} icon="refresh-outline" />
        {questions.length === 0 && <Empty>No standing questions in {sel.label} yet.</Empty>}
        {shown.map((t) => <QuestionCard key={t.id} topic={t} onQueue={() => onQueue(t)} />)}
        {questions.length > QUESTIONS_SHOWN && (
          <Pressable onPress={() => setShowAll((v) => !v)} hitSlop={6}>
            <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: 12.5, paddingVertical: 4 }}>{showAll ? "Show fewer" : `Show ${questions.length - QUESTIONS_SHOWN} more`}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/* The chip's second line: what is going on in the field, if anything. */
function statusFor(cat: Topic, topics: TopicRow[], rooms: BoardRoom[]): { label: string; color: string } | null {
  const mine = rooms.filter((r) => r.topic_key === cat.key);
  const live = mine.filter((r) => r.status === "live").length;
  const sched = mine.filter(isScheduled).length;
  const open = mine.filter((r) => r.status !== "live" && !isScheduled(r)).length;
  const waiting = topics.filter((t) => t.topic_key === cat.key).reduce((n, t) => n + t.queue_count, 0);
  if (live > 0) return { label: `${live} LIVE`, color: colors.live };
  if (waiting > 0) return { label: `${waiting} WAITING`, color: colors.gold };
  if (open > 0) return { label: `${open} OPEN`, color: colors.green };
  if (sched > 0) return { label: `${sched} SCHEDULED`, color: colors.purple };
  return null;
}

function Chip({ cat, active, status, onPress }: { cat: Topic; active: boolean; status: { label: string; color: string } | null; onPress: () => void }) {
  const ink = darkInkOn(cat.color) ? colors.ink : "#fff";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={{
        minHeight: 46, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 10,
        backgroundColor: active ? cat.color : colors.surface, borderWidth: 1, borderColor: active ? cat.color : colors.hairline,
      }}
    >
      <Ionicons name={cat.icon} size={17} color={active ? ink : cat.color} />
      <View>
        <Text style={{ color: active ? ink : colors.text, fontFamily: fonts.title, fontSize: 12.5 }}>{cat.label}</Text>
        {status && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: active ? ink : status.color }} />
            <Text style={{ color: active ? ink : status.color, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.6 }}>{status.label}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function SectionHead({ title, color, right, icon, onRight }: { title: string; color: string; right?: string; icon?: IconName; onRight?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16, marginBottom: 10 }}>
      <Text style={{ color, fontFamily: fonts.title, fontSize: 16, letterSpacing: -0.2 }}>{title}</Text>
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline }} />
      {right && (
        <Pressable onPress={onRight} disabled={!onRight} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          {icon && <Ionicons name={icon} size={11} color={colors.faint} />}
          <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11.5 }}>{right}</Text>
        </Pressable>
      )}
    </View>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11.5 }}>{children}</Text>;
}

/* Cards bleed to the screen's edges while the headings keep the gutter. */
function Strip({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}>
      {children}
    </ScrollView>
  );
}

/* The 168-square room card: the host's picture, what's on, who's hosting. */
function RoomTile({ room }: { room: BoardRoom }) {
  const host = roomHost(room);
  const img = room.thumbnail_url || host?.avatar_url || null;
  const live = room.status === "live";
  const sched = isScheduled(room);
  const initial = personName(host).replace(/^@/, "").charAt(0).toUpperCase();
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/room/[id]", params: { id: room.id } })}
      style={({ pressed }) => ({ width: 168, height: 168, borderRadius: 16, overflow: "hidden", backgroundColor: colors.surface2, opacity: pressed ? 0.88 : 1 })}
    >
      {img ? (
        <Image source={{ uri: img }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
          <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 52 }}>{initial}</Text>
        </View>
      )}
      <View style={{ position: "absolute", top: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.bg, borderRadius: 999, paddingHorizontal: 8, height: 22 }}>
        {live && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.live }} />}
        <Text style={{ color: live ? colors.live : sched ? colors.purple : colors.green, fontFamily: fonts.extra, fontSize: 10, letterSpacing: 0.5 }}>
          {live ? `LIVE${room.viewer_count ? ` · ${room.viewer_count}` : ""}` : sched ? whenLabel(room.scheduled_start).toUpperCase() : "OPEN"}
        </Text>
      </View>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, paddingHorizontal: 10, paddingVertical: 8 }}>
        <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 }}>{room.motion}</Text>
        <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11, marginTop: 3 }}>{personName(host)}</Text>
      </View>
    </Pressable>
  );
}

function QuestionCard({ topic, onQueue }: { topic: TopicRow; onQueue: () => void }) {
  const inQueue = topic.am_queued;
  return (
    <View
      style={{
        flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14,
        backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: inQueue ? colors.gold : colors.hairline,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 13, lineHeight: 17 }}>{topic.question}</Text>
        <Text style={{ marginTop: 4, fontFamily: fonts.body, fontSize: 11, color: inQueue ? colors.gold : topic.queue_count > 0 ? colors.waiting : colors.faint }}>
          {inQueue ? "In queue" : topic.queue_count > 0 ? `${topic.queue_count} waiting to talk` : "no one waiting yet"}
        </Text>
      </View>
      <Pressable
        onPress={onQueue}
        style={({ pressed }) => ({ height: 32, paddingHorizontal: 14, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? "#2f6fd6" : colors.blue })}
      >
        <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 12.5 }}>Queue</Text>
      </Pressable>
    </View>
  );
}

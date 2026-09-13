/* Moderation: the report queue (components/ModPage.tsx). Reports come
   from mod_list_reports and move through mod_resolve_report; both are
   gated on the server. The gate here just keeps non-moderators out of
   an empty shell. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { supabase } from "../src/supabase";
import { useSession } from "../src/session";
import { LoadingLine } from "../src/sky";
import { colors, fonts } from "../src/theme";
import { Screen } from "../src/ui";

interface Report {
  id: string; reason: string; context: string; description: string | null; message_content: string | null;
  status: Status; created_at: string; reported_username: string; reporter_username: string;
}
const STATUSES = ["open", "reviewed", "actioned", "dismissed"] as const;
type Status = (typeof STATUSES)[number];
const REASON_LABEL: Record<string, string> = {
  harassment: "Harassment", hate_speech: "Hate speech", threats_violence: "Threats / violence", spam: "Spam", sexual_content: "Sexual content",
  misinformation: "Misinformation", impersonation: "Impersonation", inappropriate_username: "Inappropriate username", other: "Other",
};
const STATUS_COLOR: Record<Status, string> = { open: "#f4d47c", reviewed: "#9cc4f0", actioned: "#97c459", dismissed: "#8b8b94" };

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - +new Date(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function Mod() {
  const { session } = useSession();
  const [checked, setChecked] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [tab, setTab] = useState<Status>("open");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("mod_list_reports", { p_status: null, p_limit: 200 });
    if (error) { setLoadError(error.message.includes("not_moderator") ? "You don't have moderator access." : error.message); return; }
    setLoadError(null);
    setReports((data ?? []) as Report[]);
  }, []);

  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) { router.replace("/sign-in"); return; }
    let on = true;
    void supabase.from("users").select("is_moderator").eq("id", uid).maybeSingle().then(({ data: row }) => {
      if (!on) return;
      if (!(row as { is_moderator?: boolean } | null)?.is_moderator) { router.replace("/"); return; }
      setChecked(true);
      void load();
    });
    return () => { on = false; };
  }, [session?.user.id, load]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { open: 0, reviewed: 0, actioned: 0, dismissed: 0 };
    for (const r of reports) c[r.status]++;
    return c;
  }, [reports]);
  const visible = useMemo(() => reports.filter((r) => r.status === tab), [reports, tab]);

  async function resolve(report: Report, status: Status) {
    setBusyId(report.id);
    setActionError(null);
    const prev = report.status;
    setReports((rs) => rs.map((r) => (r.id === report.id ? { ...r, status } : r)));
    const { error } = await supabase.rpc("mod_resolve_report", { p_report: report.id, p_status: status });
    setBusyId(null);
    if (error) {
      setReports((rs) => rs.map((r) => (r.id === report.id ? { ...r, status: prev } : r)));
      setActionError(`Couldn't update report: ${error.message}`);
    }
  }

  const chip = (label: string, onPress: () => void, style: { bg: string; border: string; color: string }, disabled?: boolean) => (
    <Pressable key={label} onPress={onPress} disabled={disabled} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: style.bg, borderWidth: 1, borderColor: style.border, opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ color: style.color, fontFamily: fonts.semi, fontSize: 11.5 }}>{label}</Text>
    </Pressable>
  );

  return (
    <Screen style={{ paddingHorizontal: 16 }}>
      <Stack.Screen options={{ title: "Moderation", headerBackTitle: "Back" }} />
      {!checked ? <LoadingLine /> : (
        <ScrollView contentContainerStyle={{ paddingTop: 10, paddingBottom: 40 }}>
          <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, marginBottom: 12 }}>Report queue · every action is audit-logged</Text>
          {(loadError || actionError) && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12, marginBottom: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: "#5a2a2a", backgroundColor: "#1c1010" }}>{loadError || actionError}</Text>}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 14 }}>
            {STATUSES.map((s) => (
              <Pressable key={s} onPress={() => setTab(s)} style={{ flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: tab === s ? "#26262e" : colors.surface2, borderWidth: 1, borderColor: tab === s ? "#4a4a54" : "#34343c" }}>
                <Text style={{ color: tab === s ? colors.text : "#c0c0c8", fontFamily: fonts.medium, fontSize: 12 }}>{s.charAt(0).toUpperCase() + s.slice(1)}</Text>
                <Text style={{ color: STATUS_COLOR[s], fontFamily: fonts.medium, fontSize: 12 }}>{counts[s]}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => void load()} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: "#34343c" }}>
              <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: 12 }}>↻ Refresh</Text>
            </Pressable>
          </ScrollView>
          {visible.length === 0 ? (
            <View style={{ padding: 28, alignItems: "center", backgroundColor: "#121218", borderWidth: 1, borderColor: colors.border, borderRadius: 12 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 13 }}>{tab === "open" ? "No open reports" : `No ${tab} reports`}</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, marginTop: 4 }}>{tab === "open" ? "The queue is clear." : "Nothing here yet."}</Text>
            </View>
          ) : visible.map((r) => (
            <View key={r.id} style={{ padding: 14, backgroundColor: "#121218", borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: "#1c1c22", borderWidth: 1, borderColor: STATUS_COLOR[r.status] + "55" }}>
                  <Text style={{ color: STATUS_COLOR[r.status], fontFamily: fonts.semi, fontSize: 10.5 }}>{REASON_LABEL[r.reason] ?? r.reason}</Text>
                </View>
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11 }}>in {r.context} · {timeAgo(r.created_at)}</Text>
              </View>
              <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 13 }}>
                <Text onPress={() => router.push({ pathname: "/u/[username]", params: { username: r.reported_username } })} style={{ color: "#9cc4f0" }}>@{r.reported_username}</Text>
                <Text style={{ color: colors.muted }}> reported by </Text>@{r.reporter_username}
              </Text>
              {!!r.description && <Text style={{ color: "#c0c0c8", fontFamily: fonts.body, fontSize: 12, lineHeight: 18, marginTop: 6 }}>“{r.description}”</Text>}
              {!!r.message_content && <Text style={{ color: "#9a9aa2", fontFamily: fonts.body, fontSize: 11, marginTop: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: "#0a0a0e", borderWidth: 1, borderColor: colors.border }}>Reported message: “{r.message_content}”</Text>}
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {r.status !== "actioned" && chip("Mark actioned", () => void resolve(r, "actioned"), { bg: "#15261a", border: "#3a5a3a", color: "#97c459" }, busyId === r.id)}
                {r.status === "open" && chip("Mark reviewed", () => void resolve(r, "reviewed"), { bg: "#14233a", border: "#2c5382", color: "#9cc4f0" }, busyId === r.id)}
                {r.status !== "dismissed" && chip("Dismiss", () => void resolve(r, "dismissed"), { bg: "transparent", border: "#3a3a42", color: colors.muted }, busyId === r.id)}
                {r.status !== "open" && chip("Reopen", () => void resolve(r, "open"), { bg: "transparent", border: "#3a3a42", color: colors.muted }, busyId === r.id)}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

/* Picking the question, when the queue was opened from a headline.

   A headline reports something that happened. The queue matches two
   people on opposite sides, so it needs a claim one of them can refuse —
   and "Energy secretary says US might not reach nuclear agreement with
   Iran" has no other side to take. This is the step in between: four
   questions drafted from the story by the website (api/news/motions),
   one of each shape, or your own words.

   Some stories carry no argument — a verdict, a death. Then the drafting
   comes back empty and says so, rather than inventing a side.

   The site's src/components/QueueMotions.tsx, in the app's clothes. */
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fetchMotions, motionProblem, shapeLabel, MOTION_MAX, type DraftedMotion } from "./motions";
import { pickMotion, type QueueStory } from "./queue";
import { useSession } from "./session";
import { colors, fonts } from "./theme";

export function QueueMotions({ story }: { story: QueueStory }) {
  const { session, pass } = useSession();
  const token = session?.access_token ?? null;
  const [motions, setMotions] = useState<DraftedMotion[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [own, setOwn] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchMotions(story, { token, pass }).then((found) => {
      if (!alive) return;
      setMotions(found ?? []);
      setFailed(found === null);
    });
    return () => { alive = false; };
  }, [story, token, pass]);

  const problem = own === null ? null : motionProblem(own);

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Ionicons name="newspaper-outline" size={13} color={colors.muted} style={{ marginTop: 2 }} />
        <Text style={{ flex: 1, color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16 }}>{story.headline}</Text>
      </View>
      <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 15 }}>What do you want to take a side on?</Text>

      {motions === null && <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>Reading the story…</Text>}

      {motions?.length === 0 && (
        <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, lineHeight: 17 }}>
          {failed
            ? "Couldn't read that story — put it in your own words."
            : "There isn’t a side to take on this one — everyone would say the same. Put it in your own words if you disagree."}
        </Text>
      )}

      {motions?.map((m) => (
        <Pressable
          key={m.text}
          onPress={() => pickMotion(m.text)}
          style={({ pressed }) => ({ padding: 10, borderRadius: 10, backgroundColor: pressed ? "#141418" : "#08080b", borderWidth: 1, borderColor: pressed ? colors.yellow : "#2e2e38" })}
        >
          <Text style={{ color: colors.muted, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.5 }}>{shapeLabel(m.shape).toUpperCase()}</Text>
          <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 13.5, lineHeight: 18, marginTop: 2 }}>{m.text}</Text>
        </Pressable>
      ))}

      {own === null ? (
        <Pressable
          onPress={() => setOwn("")}
          style={({ pressed }) => ({ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 999, backgroundColor: pressed ? "#141418" : "#0b0b0d", borderWidth: 1, borderColor: "#2e2e38" })}
        >
          <Ionicons name="pencil-outline" size={13} color={colors.muted} />
          <Text style={{ color: "#c9c9d2", fontFamily: fonts.semi, fontSize: 12.5 }}>Write your own</Text>
        </Pressable>
      ) : (
        <View style={{ gap: 8 }}>
          <TextInput
            value={own}
            onChangeText={(t) => setOwn(t.slice(0, MOTION_MAX))}
            placeholder="Should the EU fine carriers that overbook?"
            placeholderTextColor={colors.faint}
            multiline
            autoFocus
            style={{ minHeight: 56, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "#2e2e38", backgroundColor: "#08080b", color: colors.text, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 18, textAlignVertical: "top" }}
          />
          {/* The rule the queue lives by, said once the writing has started. */}
          {own.trim() !== "" && !!problem && (
            <Text style={{ color: colors.yellow, fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16 }}>{problem}</Text>
          )}
          <Pressable
            onPress={() => pickMotion(own.trim().replace(/\s+/g, " "))}
            disabled={!!problem}
            style={{ height: 42, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: colors.yellow, opacity: problem ? 0.5 : 1 }}
          >
            <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 13.5 }}>Use this question</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/* The conversation a post carries (components/community/PostTopicQueue.tsx,
   lib/postTopics.ts): its question, how many are waiting, one way in —
   Queue — through the queue panel; Leave drops the line. Cards ask in
   one batched get_post_topics call. */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "./supabase";
import { isQueued, leaveQueue, onQueueChanged, openQueue, useQueue } from "./queue";
import { topicOf } from "./topics";
import type { TopicDraft } from "./composer";
import { colors, fonts } from "./theme";

export type PostTopic = { post_id: string; topic_id: string; question: string; topic_key: string; queue_count: number; pro_count: number; con_count: number; am_queued: boolean; my_stance: "PRO" | "CON" | null };

type Entry = PostTopic | null;
const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<(t: Entry) => void>>();
let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function emit(id: string) { listeners.get(id)?.forEach((fn) => fn(cache.has(id) ? (cache.get(id) as Entry) : null)); }
async function flush() {
  timer = null;
  const ids = [...pending];
  pending = new Set();
  if (!ids.length) return;
  const { data } = await supabase.rpc("get_post_topics", { p_posts: ids });
  const byPost = new Map(((data ?? []) as PostTopic[]).map((r) => [r.post_id, r]));
  for (const id of ids) { cache.set(id, byPost.get(id) ?? null); emit(id); }
}
function request(id: string) { pending.add(id); if (!timer) timer = setTimeout(() => void flush(), 20); }
export function refreshPostTopic(postId: string) { cache.delete(postId); request(postId); }

export function usePostTopic(postId: string | null | undefined): PostTopic | null | undefined {
  const [topic, setTopic] = useState<PostTopic | null | undefined>(() => (postId && cache.has(postId) ? (cache.get(postId) as Entry) : undefined));
  useEffect(() => {
    if (!postId) return;
    const fn = (t: Entry) => setTopic(t);
    let set = listeners.get(postId);
    if (!set) listeners.set(postId, (set = new Set()));
    set.add(fn);
    if (cache.has(postId)) fn(cache.get(postId) as Entry); else request(postId);
    const off = onQueueChanged(() => refreshPostTopic(postId));
    return () => { set?.delete(fn); if (set && set.size === 0) listeners.delete(postId); off(); };
  }, [postId]);
  return topic;
}

/** After a post is inserted: attach its conversation. Throws with the server's message on refusal. */
export async function attachPostTopic(client: SupabaseClient, postId: string, draft: TopicDraft, fallbackQuestion: string): Promise<void> {
  const question = (draft.question.trim() || fallbackQuestion).trim();
  const { error } = await client.rpc("create_post_topic", { p_post: postId, p_question: question, p_topic_key: draft.topicKey });
  if (error) throw new Error(error.message.replace(/^[a-z_]+:\s*/, ""));
  refreshPostTopic(postId);
}

export function PostTopicQueue({ postId, compact }: { postId: string; compact?: boolean }) {
  const topic = usePostTopic(postId);
  const q = useQueue();
  if (!topic) return null;
  const inLine = topic.am_queued || isQueued(topic.topic_id);
  const field = topicOf(topic.topic_key);
  const waiting = topic.queue_count;
  return (
    <View style={{ marginTop: compact ? 8 : 12, paddingHorizontal: compact ? 12 : 14, paddingVertical: compact ? 10 : 12, borderRadius: 12, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2a2a34", gap: compact ? 8 : 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Ionicons name="flash-outline" size={12} color={colors.yellow} />
          <Text style={{ color: colors.yellow, fontFamily: fonts.extra, fontSize: 10.5, letterSpacing: 0.6 }}>QUEUE A CONVERSATION</Text>
        </View>
        <Text style={{ color: field.color, fontFamily: fonts.semi, fontSize: 10.5 }}>{field.label}</Text>
        <View style={{ flex: 1 }} />
        <Text style={{ color: "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 11 }}>{inLine ? "In line" : waiting > 0 ? `${waiting} waiting to talk` : "No one waiting yet"}</Text>
      </View>
      <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: compact ? 13.5 : 15, lineHeight: compact ? 18 : 20 }}>{topic.question}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {inLine ? (
          <>
            <Text style={{ color: colors.yellow, fontFamily: fonts.semi, fontSize: 12.5 }}>● In line — waiting for a match…</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => void leaveQueue(topic.topic_id)} disabled={q.busy} style={{ height: 30, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: "#2e2e38", backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#c9c9d2", fontFamily: fonts.semi, fontSize: 12 }}>Leave</Text></Pressable>
          </>
        ) : (
          <Pressable onPress={() => openQueue({ id: topic.topic_id, question: topic.question, topicKey: topic.topic_key, queueCount: topic.queue_count, proCount: topic.pro_count, conCount: topic.con_count })} style={{ height: 30, paddingHorizontal: 16, borderRadius: 999, backgroundColor: waiting > 0 ? colors.yellow : colors.blue, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: waiting > 0 ? colors.ink : "#fff", fontFamily: fonts.bold, fontSize: 12 }}>{waiting > 0 ? "Queue · match now" : "Queue"}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

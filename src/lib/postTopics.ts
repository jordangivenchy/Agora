"use client";

/* Post topics: a verified author can attach a conversation question to
   a post (create_post_topic); anyone can queue into it and get matched
   into a room the same way the rail's "Queue a conversation" works.

   Cards ask for their post's topic through usePostTopic(postId). The
   loader batches every id asked for in the same tick into one
   get_post_topics call, caches the rows, and re-fetches on demand
   (after a queue / leave), so lists of any length cost one request. */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

export type PostTopic = {
  post_id: string;
  topic_id: string;
  question: string;
  topic_key: string;
  queue_count: number;
  pro_count: number;
  con_count: number;
  am_queued: boolean;
  my_stance: "PRO" | "CON" | null;
};

/** What the composer collects; attachPostTopic sends it after the post exists. */
export type TopicDraft = { on: boolean; question: string; topicKey: string };

export const EMPTY_TOPIC: TopicDraft = { on: false, question: "", topicKey: "politics-law" };

/** Fields create_post_topic accepts (mirrors the server-side list). */
export const TOPIC_QUEUE_KEYS = new Set([
  "politics-law", "politics-ethics", "sports", "culture", "economics", "science-tech", "foreign-policy", "philosophy",
]);

type Entry = PostTopic | null; // null: asked, and the post has no topic
const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<(t: Entry) => void>>();
let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let client: ReturnType<typeof createClient> | null = null;

function emit(id: string) {
  const t = cache.has(id) ? (cache.get(id) as Entry) : null;
  listeners.get(id)?.forEach((fn) => fn(t));
}

async function flush() {
  timer = null;
  const ids = [...pending];
  pending = new Set();
  if (ids.length === 0) return;
  client ??= createClient();
  const { data } = await client.rpc("get_post_topics", { p_posts: ids });
  const rows = (data ?? []) as PostTopic[];
  const byPost = new Map(rows.map((r) => [r.post_id, r]));
  for (const id of ids) {
    cache.set(id, byPost.get(id) ?? null);
    emit(id);
  }
}

function request(id: string) {
  pending.add(id);
  if (!timer) timer = setTimeout(() => void flush(), 20);
}

/** Drop what we know about a post and fetch it again (after queue/leave). */
export function refreshPostTopic(postId: string) {
  cache.delete(postId);
  request(postId);
}

/** The topic attached to a post, or null once we know there is none;
    undefined while it loads. */
export function usePostTopic(postId: string | null | undefined): PostTopic | null | undefined {
  const [topic, setTopic] = useState<PostTopic | null | undefined>(() =>
    postId && cache.has(postId) ? (cache.get(postId) as Entry) : undefined
  );
  useEffect(() => {
    if (!postId) return;
    const fn = (t: Entry) => setTopic(t);
    let set = listeners.get(postId);
    if (!set) listeners.set(postId, (set = new Set()));
    set.add(fn);
    if (cache.has(postId)) fn(cache.get(postId) as Entry);
    else request(postId);
    return () => {
      set?.delete(fn);
      if (set && set.size === 0) listeners.delete(postId);
    };
  }, [postId]);
  return topic;
}

/** After a post is inserted: create/attach its topic. Throws with the
    server's message ("not_verified: …", "bad_question: …") on refusal. */
export async function attachPostTopic(
  supabase: ReturnType<typeof createClient>,
  postId: string,
  draft: TopicDraft,
  fallbackQuestion: string
): Promise<string> {
  const question = (draft.question.trim() || fallbackQuestion).trim();
  const { data, error } = await supabase.rpc("create_post_topic", {
    p_post: postId,
    p_question: question,
    p_topic_key: TOPIC_QUEUE_KEYS.has(draft.topicKey) ? draft.topicKey : "politics-law",
  });
  if (error) throw new Error(error.message.replace(/^[a-z_]+:\s*/, ""));
  refreshPostTopic(postId);
  return data as string;
}

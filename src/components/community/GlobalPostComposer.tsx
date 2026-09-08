"use client";

/* The post composer as a sheet on any page. Mounted once in the root
   layout; opened by an agora:compose-post event whose detail says where
   the post should go (to: "profile" for your own board, a community id,
   or nothing — the board you last posted to) and, from a clip page,
   the clip to attach. It loads your boards, tags and verified status
   itself, inserts the post (plus its conversation topic when one was
   attached), then announces agora:post-created — the profile refreshes
   its Posts tab in place; anywhere else you are taken to the post. */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { pathFor } from "@/lib/routes";
import { uploadPostImage } from "@/lib/postImages";
import PostComposer, { POST_BODY_MAX } from "@/components/community/PostComposer";
import { giphyEnabled } from "@/components/community/GifPicker";
import type { PickerCommunity } from "@/components/community/CommunityPicker";
import { EMPTY_TOPIC, attachPostTopic, type TopicDraft } from "@/lib/postTopics";

export type ComposeClip = { id: string; title: string; duration: string | null };
export type ComposeRequest = { to?: "profile" | string; clip?: ComposeClip };

type Tag = { id: string; community_id: string; name: string; color: string | null };

/** Open the composer from anywhere. */
export function openPostComposer(req: ComposeRequest = {}) {
  window.dispatchEvent(new CustomEvent<ComposeRequest>("agora:compose-post", { detail: req }));
}

export default function GlobalPostComposer() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [req, setReq] = useState<ComposeRequest | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [communities, setCommunities] = useState<PickerCommunity[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [meVerified, setMeVerified] = useState(false);
  const [composeCommunity, setComposeCommunity] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tagId, setTagId] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [topic, setTopic] = useState<TopicDraft>(EMPTY_TOPIC);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickImage = useCallback((file: File | null) => {
    setImage(file);
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    if (file) setGifUrl(null);
  }, []);

  const close = useCallback(() => {
    setReq(null);
    setTitle(""); setBody(""); setTagId(""); setGifUrl(null); setTopic(EMPTY_TOPIC); setError(null);
    pickImage(null);
  }, [pickImage]);

  /* Open: sign-in gate, then boards (mine first-class, others' u/ boards out), tags, verified. */
  const open = useCallback(async (r: ComposeRequest) => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { window.location.href = "/login"; return; }
    const uid = auth.user.id;
    setUserId(uid);
    setError(null);
    setTitle(r.clip ? r.clip.title : "");
    setReq(r);
    await supabase.rpc("ensure_profile_community").then(undefined, () => {});
    const [commRes, tagRes, meRes] = await Promise.all([
      supabase
        .from("communities")
        .select("id, name, kind, color, avatar_url, is_private, community_members(user_id, role, favorite)"),
      supabase.from("community_tags").select("id, community_id, name, color"),
      supabase.from("users").select("verified").eq("id", uid).maybeSingle(),
    ]);
    setMeVerified(!!meRes.data?.verified);
    const rows = ((commRes.data ?? []) as unknown as {
      id: string; name: string; kind: string; color: string; avatar_url: string | null; is_private: boolean;
      community_members: { user_id: string; role: string | null; favorite: boolean | null }[] | null;
    }[]).map((c) => {
      const members = c.community_members ?? [];
      const mine = members.find((m) => m.user_id === uid) ?? null;
      return {
        id: c.id, name: c.name, kind: c.kind, color: c.color, avatar_url: c.avatar_url, is_private: c.is_private,
        members: members.length, joined: !!mine, favorite: !!mine?.favorite, my_role: mine?.role ?? null,
      } satisfies PickerCommunity;
    }).filter((c) => c.kind === "profile" ? c.my_role === "owner" : (!c.is_private || c.joined));
    rows.sort((a, b) => a.name.localeCompare(b.name));
    setCommunities(rows);
    setTags((tagRes.data ?? []) as Tag[]);
    const profile = rows.find((c) => c.kind === "profile");
    let last: string | null = null;
    try { last = window.localStorage.getItem("agora:lastPostCommunity"); } catch {}
    const pick =
      r.to === "profile" ? profile
      : r.to ? rows.find((c) => c.id === r.to)
      : (rows.find((c) => c.id === last && c.joined) ?? profile ?? rows.find((c) => c.joined));
    setComposeCommunity((pick ?? rows[0])?.id ?? "");
  }, [supabase]);

  useEffect(() => {
    const onOpen = (e: Event) => void open(((e as CustomEvent<ComposeRequest>).detail) ?? {});
    window.addEventListener("agora:compose-post", onOpen);
    return () => window.removeEventListener("agora:compose-post", onOpen);
  }, [open]);

  const submit = useCallback(async () => {
    if (!req || !userId || busy) return;
    const t = title.trim();
    if (!composeCommunity || !t) return;
    if (body.length > POST_BODY_MAX) {
      setError(`Post body is too long (${body.length.toLocaleString()} / ${POST_BODY_MAX.toLocaleString()} characters).`);
      return;
    }
    setBusy(true);
    setError(null);
    let imageUrl: string | null = null;
    if (image) {
      try {
        imageUrl = await uploadPostImage(supabase, userId, image);
      } catch (e) {
        setBusy(false);
        setError(e instanceof Error ? e.message : "Image upload failed.");
        return;
      }
    }
    /* A clip rides as its link at the end of the body (ClipEmbed keys off it). */
    const text = [body.trim(), req.clip ? `${window.location.origin}/clips/${req.clip.id}` : ""].filter(Boolean).join("\n\n");
    const { data, error: err } = await supabase
      .from("community_posts")
      .insert({ community_id: composeCommunity, author_id: userId, title: t, body: text || null, tag_id: tagId || null, image_url: imageUrl ?? gifUrl })
      .select("id")
      .single();
    if (err) {
      setBusy(false);
      setError(err.message.includes("rate_limited")
        ? "You're posting too quickly — try again in a few minutes."
        : err.message.includes("profile_board")
          ? "Only the profile's owner can post there."
          : err.message.includes("row-level security")
            ? "You can't post there — join that community first."
            : err.message);
      return;
    }
    const id = (data as { id: string }).id;
    let topicNote: string | null = null;
    if (topic.on) {
      try { await attachPostTopic(supabase, id, topic, t); }
      catch (e) { topicNote = e instanceof Error ? e.message : "the queue wasn't attached"; }
    }
    setBusy(false);
    try { window.localStorage.setItem("agora:lastPostCommunity", composeCommunity); } catch {}
    const onProfile = /^\/(users\/|@)/.test(window.location.pathname);
    close();
    window.dispatchEvent(new CustomEvent("agora:post-created", { detail: { id, communityId: composeCommunity, topicNote } }));
    if (!onProfile) router.push(pathFor.post(id));
  }, [req, userId, busy, title, composeCommunity, body, image, gifUrl, tagId, topic, supabase, close, router]);

  if (!req) return null;
  return (
    <PostComposer
      clip={req.clip ?? null}
      pickCommunity={{ communities, value: composeCommunity, onChange: (id) => { setComposeCommunity(id); setTagId(""); } }}
      title={title}
      onTitle={setTitle}
      body={body}
      onBody={setBody}
      tags={tags.filter((x) => x.community_id === composeCommunity)}
      tagId={tagId}
      onTagId={(id) => setTagId(tagId === id ? "" : id)}
      imagePreview={imagePreview}
      gifUrl={gifUrl}
      onPickImage={pickImage}
      onGif={setGifUrl}
      busy={busy}
      error={error}
      canSubmit={!busy && !!title.trim() && !!composeCommunity}
      giphyEnabled={giphyEnabled}
      mentions={!!userId}
      maxLength={POST_BODY_MAX}
      onSubmit={submit}
      onClose={close}
      canAttachTopic={meVerified}
      topic={topic}
      onTopic={setTopic}
    />
  );
}

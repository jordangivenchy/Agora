"use client";

/* Site-wide actions, mounted by the chrome on every route: the create
   modals — a discussion, a community, and the crossfade between them —
   and the window events the rest of the app raises for them.
     agora:create            open the discussion modal (detail: a prefill)
     agora:create-community  open the community modal
     agora:profile           someone's id → their profile page
     agora:tab               a section → its route ("battle": the topics)
     agora:logout            sign out
   plus the ?create= deep links the profile's empty states and the
   create menu's no-script fallback use. The sections are routes, so
   none of this depends on the home page being the one that is loaded. */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { sessionUser } from "@/lib/session";
import { readNavUser, writeNavUser } from "@/lib/navUserCache";
import { isHomeSection, pathFor } from "@/lib/routes";
import { markHomeChosen } from "@/lib/homeChoice";
import { userPath } from "@/lib/urls";
import CreateRoomModal from "@/components/CreateRoomModal";
import CreateCommunityModal from "@/components/community/CreateCommunityModal";

/** What agora:create may carry. */
export type CreatePrefill = {
  motion: string;
  topic: string;
  schedule?: boolean;
  communityId?: string;
  communityName?: string;
};

/** Raise the discussion modal from anywhere. */
export function requestCreate(prefill?: CreatePrefill): void {
  window.dispatchEvent(new CustomEvent("agora:create", { detail: prefill ?? null }));
}

export default function GlobalActions() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  /* The Discussion ⇄ Community switch crossfades the two modals in place:
     `createLeaving` is the one fading out for ~170ms, `createVia` the one
     that arrived by switching (its overlay must not fade in again). */
  const [createLeaving, setCreateLeaving] = useState<"discussion" | "community" | null>(null);
  const [createVia, setCreateVia] = useState<"discussion" | "community" | null>(null);
  const [createPrefill, setCreatePrefill] = useState<CreatePrefill | null>(null);
  const switchCreate = useCallback((to: "discussion" | "community") => {
    const from = to === "discussion" ? "community" : "discussion";
    if (to === "community") setShowCreateCommunity(true);
    else setShowCreate(true);
    setCreateVia(to);
    setCreateLeaving(from);
    window.setTimeout(() => {
      if (from === "community") setShowCreateCommunity(false);
      else setShowCreate(false);
      setCreateLeaving(null);
    }, 170);
  }, []);

  /* Every path into the modals goes through here: signed-out visitors
     are sent to /login instead of a modal they can't submit. */
  const openCreate = useCallback(async (prefill: CreatePrefill | null) => {
    const { data: auth } = await sessionUser(supabase);
    if (!auth?.user) { window.location.href = "/login"; return; }
    setCreatePrefill(prefill);
    setShowCreate(true);
  }, [supabase]);
  const openCreateCommunity = useCallback(async () => {
    const { data: auth } = await sessionUser(supabase);
    if (!auth?.user) { window.location.href = "/login"; return; }
    setShowCreate(false);
    setShowCreateCommunity(true);
  }, [supabase]);

  /* Profile links land on the profile page. Ids (events, legacy links)
     resolve to a username first; unresolvable ids are dropped. */
  const goToProfileById = useCallback((id: string) => {
    supabase
      .from("users")
      .select("username")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => { if (data?.username) router.push(userPath(data.username)); });
  }, [supabase, router]);

  useEffect(() => {
    const onCreate = (e: Event) => {
      const d = (e as CustomEvent).detail as CreatePrefill | null | undefined;
      void openCreate(d && typeof d === "object" ? d : null);
    };
    const onCreateCommunity = () => { void openCreateCommunity(); };
    const onProfile = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "string" && detail) { goToProfileById(detail); return; }
      // Own profile (nav avatar → Profile): same destination.
      const me = readNavUser()?.id;
      if (me) goToProfileById(me);
    };
    const onTab = (e: Event) => {
      const tab = (e as CustomEvent).detail;
      if (typeof tab !== "string" || tab === "close") return;
      // The old Topics tab: the dropdowns live on the home feed.
      if (tab === "battle") { markHomeChosen(); router.push("/#topics"); return; }
      if (tab === "home") markHomeChosen();
      if (isHomeSection(tab)) router.push(pathFor.section(tab));
    };
    const onLogout = async () => {
      writeNavUser(null);
      await supabase.auth.signOut();
      window.location.reload();
    };
    window.addEventListener("agora:create", onCreate);
    window.addEventListener("agora:create-community", onCreateCommunity);
    window.addEventListener("agora:profile", onProfile);
    window.addEventListener("agora:tab", onTab);
    window.addEventListener("agora:logout", onLogout);

    /* ?create=1, ?create=schedule or ?create=community: open the modal
       and drop the parameter from the address. */
    const params = new URLSearchParams(window.location.search);
    const c = params.get("create");
    if (c) {
      params.delete("create");
      const q = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : "") + window.location.hash);
      queueMicrotask(() => {
        if (c === "community") void openCreateCommunity();
        else void openCreate({ motion: "", topic: "", schedule: c === "schedule" });
      });
    }
    return () => {
      window.removeEventListener("agora:create", onCreate);
      window.removeEventListener("agora:create-community", onCreateCommunity);
      window.removeEventListener("agora:profile", onProfile);
      window.removeEventListener("agora:tab", onTab);
      window.removeEventListener("agora:logout", onLogout);
    };
  }, [supabase, router, openCreate, openCreateCommunity, goToProfileById]);

  return (
    <>
      <CreateRoomModal
        open={showCreate}
        onClose={() => { setShowCreate(false); setCreateVia((v) => (v === "discussion" ? null : v)); }}
        switchPhase={createLeaving === "discussion" ? "out" : createVia === "discussion" ? "in" : undefined}
        initialMotion={createPrefill?.motion}
        initialTopic={createPrefill?.topic}
        initialSchedule={createPrefill?.schedule}
        communityId={createPrefill?.communityId}
        communityName={createPrefill?.communityName}
        onCreateCommunity={() => switchCreate("community")}
      />
      <CreateCommunityModal
        open={showCreateCommunity}
        onClose={() => { setShowCreateCommunity(false); setCreateVia((v) => (v === "community" ? null : v)); }}
        onCreateDiscussion={() => switchCreate("discussion")}
        switchPhase={createLeaving === "community" ? "out" : createVia === "community" ? "in" : undefined}
        onCreated={(c) => {
          /* Land in the new board. Its route mounts the boards page with a
             fresh list; a boards page already up refreshes on the event. */
          router.push(pathFor.community(c.id));
          window.setTimeout(() => {
            document.dispatchEvent(new CustomEvent("agora:open-community", { detail: { communityId: c.id, refresh: true } }));
          }, 80);
        }}
      />
    </>
  );
}

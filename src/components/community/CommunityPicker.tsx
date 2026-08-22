"use client";

/* Community picker for the post composer — a tailored dropdown instead of
   a bare <select>: avatar, name, member count, lock for private boards;
   groups Favorites → Joined → Other public; search once the list is long;
   keyboard navigable. Value is the community id. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import useEscapeClose from "@/lib/useEscapeClose";

export type PickerCommunity = {
  id: string;
  name: string;
  color: string;
  avatar_url: string | null;
  is_private: boolean;
  members: number;
  joined: boolean;
  favorite: boolean;
  my_role: string | null;
};

const GROUP_LABEL: Record<string, string> = { fav: "Favorites", joined: "Joined", other: "Other communities" };

function Avatar({ c, size }: { c: PickerCommunity; size: number }) {
  return (
    <span
      className="flex items-center justify-center shrink-0 overflow-hidden"
      style={{
        width: size, height: size, borderRadius: Math.round(size / 3.2),
        background: c.color, color: "#fff", fontSize: Math.round(size * 0.45),
        fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700,
      }}
    >
      {c.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        c.name.charAt(0).toUpperCase()
      )}
    </span>
  );
}

function fmtMembers(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export default function CommunityPicker({
  communities, value, onChange,
}: {
  communities: PickerCommunity[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEscapeClose(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) { setQ(""); setHi(0); requestAnimationFrame(() => searchRef.current?.focus()); }
  }, [open]);

  const selected = communities.find((c) => c.id === value) ?? null;
  const searchable = communities.length > 6;

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = needle ? communities.filter((c) => c.name.toLowerCase().includes(needle)) : communities;
    const byName = (a: PickerCommunity, b: PickerCommunity) => a.name.localeCompare(b.name);
    const fav = pool.filter((c) => c.joined && c.favorite).sort(byName);
    const joined = pool.filter((c) => c.joined && !c.favorite).sort(byName);
    const other = pool.filter((c) => !c.joined).sort((a, b) => b.members - a.members || byName(a, b));
    return [["fav", fav], ["joined", joined], ["other", other]] as const;
  }, [communities, q]);
  const flat = useMemo(() => groups.flatMap(([, xs]) => xs), [groups]);

  const pick = (c: PickerCommunity) => { onChange(c.id); setOpen(false); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[hi]) pick(flat[hi]); }
  };

  return (
    <div ref={wrapRef} className="relative self-start" style={{ zIndex: open ? 60 : undefined }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="cursor-pointer flex items-center gap-2 text-[13px] rounded-lg"
        style={{
          padding: "5px 10px 5px 6px",
          background: "rgba(16,16,19,0.7)",
          border: "0.5px solid rgba(255,255,255,0.12)",
          color: "rgba(238,238,245,0.9)",
          fontFamily: "inherit",
          minWidth: 200,
        }}
      >
        {selected ? (
          <>
            <Avatar c={selected} size={22} />
            <span className="flex items-center gap-1 min-w-0">
              {selected.is_private && <Icon name="lock" size={11} style={{ opacity: 0.7 }} />}
              <span className="truncate" style={{ fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif" }}>{selected.name}</span>
            </span>
          </>
        ) : (
          <span style={{ color: "rgba(238,238,245,0.5)", paddingLeft: 4 }}>
            {communities.length === 0 ? "No communities yet" : "Choose a community"}
          </span>
        )}
        <Icon name="chevron-down" size={14} style={{ marginLeft: "auto", opacity: 0.6 }} />
      </button>

      {open && (
        <div
          role="listbox"
          onKeyDown={onKey}
          className="absolute left-0"
          style={{
            top: "calc(100% + 6px)",
            width: 300,
            maxHeight: 360,
            display: "flex",
            flexDirection: "column",
            background: "rgba(12,12,16,0.98)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
            boxShadow: "0 18px 50px rgba(0,0,0,0.6)",
            overflow: "hidden",
          }}
        >
          {searchable && (
            <div style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="relative flex items-center">
                <span className="absolute left-2 flex items-center" style={{ color: "rgba(255,255,255,0.4)", pointerEvents: "none" }}>
                  <Icon name="search" size={13} />
                </span>
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setHi(0); }}
                  placeholder="Find a community"
                  style={{
                    width: "100%", boxSizing: "border-box", height: 30, borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)",
                    color: "white", fontSize: 12.5, padding: "0 8px 0 26px", outline: "none", fontFamily: "inherit",
                  }}
                />
              </div>
            </div>
          )}
          <div style={{ overflowY: "auto", padding: 4 }}>
            {flat.length === 0 && (
              <p className="m-0 text-center text-[12px]" style={{ color: "#8b8b94", padding: "18px 12px" }}>No matches.</p>
            )}
            {groups.map(([key, xs]) => xs.length === 0 ? null : (
              <div key={key}>
                <p className="m-0" style={{ padding: "8px 10px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#6b6b74" }}>
                  {GROUP_LABEL[key].toUpperCase()}
                </p>
                {xs.map((c) => {
                  const idx = flat.indexOf(c);
                  const active = c.id === value;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setHi(idx)}
                      onClick={() => pick(c)}
                      className="cursor-pointer w-full flex items-center gap-2.5 text-left"
                      style={{
                        padding: "7px 8px",
                        borderRadius: 8,
                        border: "none",
                        background: idx === hi ? "rgba(255,255,255,0.07)" : "transparent",
                        color: "#eeeef5",
                        fontFamily: "inherit",
                      }}
                    >
                      <Avatar c={c} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          {c.is_private && <Icon name="lock" size={11} style={{ opacity: 0.7 }} />}
                          <span className="truncate text-[13px]" style={{ fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif" }}>{c.name}</span>
                          {(c.my_role === "owner" || c.my_role === "moderator") && (
                            <span className="text-[9px] font-bold px-1 rounded" style={{ background: "rgba(226,185,107,0.14)", color: "#e2b96b", letterSpacing: "0.04em" }}>
                              {c.my_role === "owner" ? "OWNER" : "MOD"}
                            </span>
                          )}
                        </span>
                        <span className="block text-[11px]" style={{ color: "#8b8b94" }}>
                          {fmtMembers(c.members)} member{c.members === 1 ? "" : "s"}{!c.joined && " · not joined"}
                        </span>
                      </span>
                      {active && <Icon name="check" size={14} style={{ color: "#e2b96b" }} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { NextResponse } from "next/server";
import { getAppConfig } from "@/lib/appConfig";
import { digestMessage, type DigestItem } from "@/lib/discord";

/* Every morning: the bugs and feedback posted in Discord since
   yesterday, as one card in the private #team channel, so nothing is
   lost when the forums get busy. Reads the two forums with the bot
   (DISCORD_BOT_TOKEN, DISCORD_GUILD_ID) and posts as the bot, since
   webhooks cannot read. Scheduled in vercel.json.

   Auth: same CRON_SECRET bearer scheme as the other crons. */

const API = "https://discord.com/api/v10";
const WINDOW_MS = 24 * 60 * 60 * 1000;

interface Channel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  available_tags?: Array<{ id: string; name: string }>;
}
interface Thread {
  id: string;
  name: string;
  parent_id?: string | null;
  owner_id?: string | null;
  applied_tags?: string[];
  thread_metadata?: { create_timestamp?: string | null; archived?: boolean };
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.DISCORD_BOT_TOKEN;
  const guild = process.env.DISCORD_GUILD_ID;
  if (!token || !guild) return NextResponse.json({ ok: true, posted: false, skipped: "no_bot" });

  const headers = { Authorization: `Bot ${token}`, "User-Agent": "DiscordBot (https://agorasphere.net, 1.0)", "Content-Type": "application/json" };
  const api = async <T,>(path: string, init?: RequestInit): Promise<T | null> => {
    const res = await fetch(`${API}${path}`, { ...init, headers, signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!res || !res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  };

  try {
    const channels = (await api<Channel[]>(`/guilds/${guild}/channels`)) ?? [];
    const forums = { bug: channels.find((c) => c.type === 15 && c.name === "bugs"), feedback: channels.find((c) => c.type === 15 && c.name === "feedback") };
    const team = channels.find((c) => c.type === 0 && c.name === "team");
    if (!team || (!forums.bug && !forums.feedback)) {
      return NextResponse.json({ ok: true, posted: false, skipped: "channels_missing" });
    }

    /* Threads still open, plus the ones archived since yesterday. */
    const active = ((await api<{ threads: Thread[] }>(`/guilds/${guild}/threads/active`))?.threads ?? []).filter((t) => !t.thread_metadata?.archived);
    const archived: Thread[] = [];
    for (const f of [forums.bug, forums.feedback]) {
      if (!f) continue;
      archived.push(...(((await api<{ threads: Thread[] }>(`/channels/${f.id}/threads/archived/public?limit=50`))?.threads) ?? []));
    }
    const since = Date.now() - WINDOW_MS;
    const seen = new Set<string>();
    const fresh = [...active, ...archived].filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      const created = Date.parse(t.thread_metadata?.create_timestamp ?? "");
      return Number.isFinite(created) && created >= since && (t.parent_id === forums.bug?.id || t.parent_id === forums.feedback?.id);
    });

    const names = new Map<string, string | null>();
    const authorOf = async (id: string | null | undefined) => {
      if (!id) return null;
      if (!names.has(id)) {
        const m = await api<{ nick?: string | null; user?: { global_name?: string | null; username?: string } }>(`/guilds/${guild}/members/${id}`);
        names.set(id, m?.nick ?? m?.user?.global_name ?? m?.user?.username ?? null);
      }
      return names.get(id) ?? null;
    };

    const items: DigestItem[] = [];
    for (const t of fresh.slice(0, 40)) {
      const forum = t.parent_id === forums.bug?.id ? forums.bug : forums.feedback;
      const tagNames = (t.applied_tags ?? []).map((id) => forum?.available_tags?.find((x) => x.id === id)?.name).filter((n): n is string => Boolean(n));
      items.push({
        kind: forum === forums.bug ? "bug" : "feedback",
        title: t.name,
        url: `https://discord.com/channels/${guild}/${t.id}`,
        author: await authorOf(t.owner_id),
        createdAt: t.thread_metadata?.create_timestamp ?? new Date().toISOString(),
        tags: tagNames,
      });
    }
    items.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

    const cfg = await getAppConfig().catch(() => ({}) as Record<string, string>);
    const message = digestMessage(items, cfg.app_origin ?? "https://agorasphere.net");
    if (!message) return NextResponse.json({ ok: true, posted: false, items: 0 });

    const sent = await api<{ id: string }>(`/channels/${team.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ embeds: message.embeds, allowed_mentions: { parse: [] } }),
    });
    return NextResponse.json({ ok: true, posted: Boolean(sent), items: items.length });
  } catch (e) {
    console.error("[discord-digest] failed:", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

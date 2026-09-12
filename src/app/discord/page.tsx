import type { Metadata } from "next";
import AuthShell from "@/components/auth/AuthShell";
import { gateConfigured, gateGuilds, gateLabel } from "@/lib/discordGate";

/* The door to the Discord server. Visitors arrive here from the partner
   server's post with no beta pass; the page says who may come in and
   sends them through Discord's sign-in (/api/discord/join). They land
   back here with ?r= saying how it went. */

export const metadata: Metadata = { title: "Discord · AgoraSphere" };

type Link = { href: string; label: string };
type View = { title: string; sub: string; primary: Link | null; secondary?: Link; fine?: string };

export default async function DiscordDoorPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const raw = (await searchParams).r;
  const gates = gateGuilds();
  const label = gateLabel(gates);
  const live = gateConfigured();
  const r = typeof raw === "string" ? raw : live ? "" : "off";
  const guild = process.env.DISCORD_GUILD_ID;
  const openDiscord: Link = { href: guild ? `https://discord.com/channels/${guild}` : "https://discord.com/app", label: "Open Discord" };
  const signIn: Link = { href: "/api/discord/join", label: "Continue with Discord" };
  const haveKey: Link = { href: "/beta", label: "Have a key? Enter it" };
  const partner = gates.find((g) => g.invite) ?? null;

  let view: View;
  switch (r) {
    case "joined":
      view = {
        title: "You're in",
        sub: "The bot has added you to the AgoraSphere server. Say hello in #general, and press Get my beta key in #welcome for your key to the app.",
        primary: openDiscord,
        secondary: haveKey,
      };
      break;
    case "already":
      view = {
        title: "You're already in",
        sub: "That Discord account is a member of the AgoraSphere server already. Your key is behind Get my beta key in #welcome.",
        primary: openDiscord,
        secondary: haveKey,
      };
      break;
    case "outside":
      view = {
        title: `Join ${label} first`,
        sub: `The AgoraSphere server is open to members of ${label}. Join ${label} with the same Discord account, then come back here.`,
        primary: partner ? { href: partner.invite!, label: `Open ${partner.label}` } : null,
        secondary: { href: signIn.href, label: "Try again" },
      };
      break;
    case "denied":
      view = {
        title: "Nothing changed",
        sub: "You left Discord's sign-in without allowing it, so nothing happened. Try again when you're ready.",
        primary: signIn,
      };
      break;
    case "off":
      view = {
        title: "The door isn't open yet",
        sub: `Membership through ${label} is still being switched on. Check back soon.`,
        primary: null,
      };
      break;
    case "state":
    case "failed":
      view = {
        title: "That didn't go through",
        sub: "Discord didn't finish the sign-in. Try again in a minute.",
        primary: { href: signIn.href, label: "Try again" },
      };
      break;
    default:
      view = {
        title: "The AgoraSphere Discord",
        sub: `The beta server is open to members of ${label}. Sign in with Discord so we can see you're one, and the bot brings you in. There are no invite links.`,
        primary: signIn,
        fine: "We see your username and which servers you're in, nothing more. Nothing is posted for you.",
      };
  }

  return (
    <AuthShell width={400} brandHref={null} footer={<a href="/beta" className="auth-link">Have a key already? Enter it</a>}>
      <div className="auth-form">
        <div>
          <h1 className="auth-title">{view.title}</h1>
          <p className="auth-sub" style={{ marginBottom: 0 }}>{view.sub}</p>
        </div>
        {view.primary && (
          <a href={view.primary.href} className="auth-primary">
            {view.primary.label}
          </a>
        )}
        {view.secondary && (
          <a href={view.secondary.href} className="auth-secondary">
            {view.secondary.label}
          </a>
        )}
        {view.fine && (
          <p className="auth-fine" style={{ textAlign: "center", margin: "0 auto" }}>
            {view.fine}
          </p>
        )}
      </div>
    </AuthShell>
  );
}

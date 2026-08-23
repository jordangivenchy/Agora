/* Transactional email via Resend's HTTP API (no SDK dependency).
   Env-gated: without RESEND_API_KEY every send is a silent no-op, so the
   app behaves identically until the account + DNS exist. Server-side only.

   To activate: create a Resend account, verify the agorasphere.net domain
   (DNS records from their dashboard), then set in Vercel:
     RESEND_API_KEY=re_...
     EMAIL_FROM="AgoraSphere <no-reply@agorasphere.net>"  (optional override) */

const FROM = process.env.EMAIL_FROM ?? "AgoraSphere <no-reply@agorasphere.net>";

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to: [opts.to], subject: opts.subject, html: opts.html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* One shared shell so every mail reads as AgoraSphere: dark header with the
   wordmark, a light body (email clients punish dark-mode-only designs),
   and a muted footer. */
export function brandedEmail(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f7;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr><td style="background:#0e0e10;padding:22px 32px;">
          <span style="font-size:19px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Agora<span style="color:#4a9eff;">Sphere</span></span>
        </td></tr>
        <tr><td style="padding:30px 32px 8px;">
          <h1 style="margin:0 0 14px;font-size:19px;color:#17171a;">${title}</h1>
          <div style="font-size:14px;line-height:1.65;color:#3c3c43;">${bodyHtml}</div>
        </td></tr>
        <tr><td style="padding:22px 32px 28px;">
          <p style="margin:0;font-size:11.5px;line-height:1.6;color:#9a9aa2;">
            You're receiving this because of activity on your AgoraSphere account.
            If this wasn't you, secure your account from Settings right away.
            <br/>© AgoraSphere · <a href="https://agorasphere.net" style="color:#4a9eff;text-decoration:none;">agorasphere.net</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function debateReminderEmail(motion: string, startsAt: Date, roomUrl: string): { subject: string; html: string } {
  const time = startsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return {
    subject: `Starting soon: ${motion}`,
    html: brandedEmail(
      "Your debate starts in 30 minutes",
      `<p style="font-size:15px;"><strong>&ldquo;${motion.replace(/</g, "&lt;")}&rdquo;</strong></p>
       <p>Doors are open now — the debate begins at ${time}.</p>
       <p style="margin-top:20px;">
         <a href="${roomUrl}" style="display:inline-block;background:#4a9eff;color:#ffffff;
            padding:11px 22px;border-radius:10px;text-decoration:none;font-weight:600;">
           Take your seat →
         </a>
       </p>`
    ),
  };
}

export function twoFactorCodeEmail(code: string): { subject: string; html: string } {
  return {
    subject: `${code} is your AgoraSphere code`,
    html: brandedEmail(
      "Your verification code",
      `<p>Enter this code to continue signing in:</p>
       <p style="font-size:30px;font-weight:700;letter-spacing:0.28em;color:#17171a;
          margin:18px 0;font-family:'Courier New',monospace;">${code}</p>
       <p>The code expires in 10 minutes.</p>
       <p><strong>If you didn't try to sign in</strong>, someone may know your
       password — change it from Settings right away.</p>`
    ),
  };
}

export function passwordChangedEmail(): { subject: string; html: string } {
  return {
    subject: "Your AgoraSphere password was changed",
    html: brandedEmail(
      "Your password was changed",
      `<p>The password for your AgoraSphere account was just changed.</p>
       <p>If this was you, no action is needed — other signed-in sessions have been signed out.</p>
       <p><strong>If this wasn't you</strong>, reset your password immediately from the
       <a href="https://agorasphere.net/forgot-password" style="color:#4a9eff;">forgot password</a>
       page — an attacker with your old password can no longer use it, but act quickly.</p>`
    ),
  };
}

export function debateReplayReadyEmail(motion: string, replayUrl: string): { subject: string; html: string } {
  const safe = motion.replace(/</g, "&lt;");
  return {
    subject: `Your replay is ready: ${motion}`,
    html: brandedEmail(
      "Your debate replay is ready",
      `<p style="font-size:15px;"><strong>&ldquo;${safe}&rdquo;</strong></p>
       <p>The recording has been finalized. Watch it back, read the transcript, and keep the conversation going in the discussion thread.</p>
       <p style="margin-top:20px;">
         <a href="${replayUrl}" style="display:inline-block;background:#4a9eff;color:#ffffff;
            padding:11px 22px;border-radius:10px;text-decoration:none;font-weight:600;">
           Watch the replay →
         </a>
       </p>`
    ),
  };
}

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

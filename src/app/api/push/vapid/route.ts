import { NextResponse } from "next/server";
import { getAppConfig } from "@/lib/appConfig";

/* Public half of the web-push keypair — the browser needs it to subscribe. */
export async function GET() {
  const cfg = await getAppConfig();
  if (!cfg.vapid_public_key) {
    return NextResponse.json({ error: "push_not_configured" }, { status: 503 });
  }
  return NextResponse.json({ publicKey: cfg.vapid_public_key });
}

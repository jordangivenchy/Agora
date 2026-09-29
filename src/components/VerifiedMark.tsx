"use client";

import type { CSSProperties } from "react";
import VerifiedBadge from "@/components/VerifiedBadge";
import { useVerified } from "@/lib/verified";

/* The verification mark beside a name, wherever a person is shown. It
   asks the shared list (lib/verified) by id or username, whichever the
   caller has, and draws nothing for everyone else. Sized to the name's
   own type unless told otherwise; `spaced` puts a small gap before it
   for names in running text (rows that already have a gap pass false). */
export default function VerifiedMark({ id, username, size = "1em", spaced = true, style }: {
  id?: string | null;
  username?: string | null;
  size?: number | string;
  spaced?: boolean;
  style?: CSSProperties;
}) {
  if (!useVerified({ id, username })) return null;
  return <VerifiedBadge size={size} style={spaced ? { marginLeft: "0.3em", ...style } : style} />;
}

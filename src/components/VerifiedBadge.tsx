/* The verification mark — granted by moderators (users.verified via the
   set_user_verified RPC): the seal in the brand yellow with the check in
   ink, so it sits with the site's own pills rather than beside them.
   VerifiedMark shows it beside any name, given an id or username (not in
   a call: its tiles, chat and panels go without).

   Drawn from exact geometry, so it is even all the way round: eight equal
   lobes, each an arc of a circle r 4.6 whose centre sits 6.4 from the
   seal's (the lobes meet 9.8 out, reach 11), and the check's box centred
   on the seal's. The hand-typed outline it replaced was lopsided. */

import type { CSSProperties } from "react";

export default function VerifiedBadge({ size = 15, style }: { size?: number | string; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Verified account"
      role="img"
      /* inline-block: the base styles make every svg a block, which would
         drop the mark onto its own line after a name in running text. */
      style={{ display: "inline-block", flexShrink: 0, verticalAlign: "-0.15em", ...style }}
    >
      <title>Verified</title>
      <path
        d="M8.25 2.94A4.6 4.6 0 0 1 15.75 2.94A4.6 4.6 0 0 1 21.06 8.25A4.6 4.6 0 0 1 21.06 15.75A4.6 4.6 0 0 1 15.75 21.06A4.6 4.6 0 0 1 8.25 21.06A4.6 4.6 0 0 1 2.94 15.75A4.6 4.6 0 0 1 2.94 8.25A4.6 4.6 0 0 1 8.25 2.94Z"
        fill="#ffb700"
      />
      <path
        d="M7.6 12.05L10.6 14.95L16.4 9.05"
        stroke="#1a0e00"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

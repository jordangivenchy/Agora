/* The verification mark — granted by moderators (users.verified via the
   set_user_verified RPC): the seal in the brand yellow with the check in
   ink, so it sits with the site's own pills rather than beside them. */

export default function VerifiedBadge({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Verified account"
      role="img"
      style={{ flexShrink: 0, verticalAlign: "-2px" }}
    >
      <path
        d="M12 1.8l2.3 2 3-.4 1.2 2.8 2.8 1.2-.4 3 2 2.3-2 2.3.4 3-2.8 1.2-1.2 2.8-3-.4-2.3 2-2.3-2-3 .4-1.2-2.8L2.7 17l.4-3-2-2.3 2-2.3-.4-3 2.8-1.2L6.7 2.4l3 .4z"
        fill="#ffb700"
      />
      <path
        d="M8.3 12.4l2.5 2.5 5-5.3"
        stroke="#1a0e00"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

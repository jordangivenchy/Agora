/* Verification badge — blue seal + check, granted by moderators
   (users.verified via the set_user_verified RPC). */

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
        fill="#3b82f6"
      />
      <path
        d="M8.4 12.3l2.4 2.4 4.8-5"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* Text wordmark — replaces the old logo.png image. Space Grotesk to match
   the display type everywhere else; two-tone kept from the original mark. */

export default function Wordmark({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{
        display: "inline-block",
        fontFamily: "'Space Grotesk', sans-serif",
        fontWeight: 700,
        fontSize: size,
        letterSpacing: "-0.03em",
        lineHeight: 1,
        whiteSpace: "nowrap",
        color: "#f5f5f0",
      }}
    >
      Agora<span style={{ color: "#3b6cf6" }}>Sphere</span>
    </span>
  );
}

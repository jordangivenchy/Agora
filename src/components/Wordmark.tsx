/* Brand wordmark — the logo.png image mark. (A text-based version briefly
   replaced it; the image is the canonical logo.) `size` is the rendered
   height in px, matching how the old inline <img> tags were sized. */

export default function Wordmark({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="AgoraSphere"
      className={className}
      style={{ height: size, width: "auto", display: "inline-block", verticalAlign: "middle" }}
    />
  );
}

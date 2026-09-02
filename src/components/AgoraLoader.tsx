/* The AgoraSphere loading state: the mark with a soft ring pulsing out of
   it and three dots keeping time, on the starfield black. Used by
   app/loading.tsx (route transitions) and mirrored in plain DOM by
   mvp-adapter.js for the shell's full-page jumps (.agora-leaving), so
   both kinds of navigation look the same. Styles live in globals.css
   (.agora-loader*), keyframes at the top of that file. */

export default function AgoraLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="agora-loader" role="status" aria-live="polite" aria-label={label}>
      <span className="agora-loader-mark">
        <span className="agora-loader-ring" />
        <span className="agora-loader-ring agora-loader-ring--late" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.png" alt="" width={56} height={56} />
      </span>
      <span className="agora-loader-dots" aria-hidden="true">
        <span /><span /><span />
      </span>
    </div>
  );
}

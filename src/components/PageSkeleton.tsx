/* Route-transition skeleton (Kick's pattern): the chrome stays put — a
   top bar with the wordmark and the right cluster, the phone tab bar —
   the content area is placeholders in the shape of what is coming,
   pulsing softly, and a thin bar trickles along the top. Pure markup
   and CSS on purpose: a loading fallback must not touch React state
   (an update from here while the home shell is still hydrating forces
   it to client-render and its history calls then hit the router before
   it is initialised). */

function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`sk-bone${className ? ` ${className}` : ""}`} style={style} />;
}

export default function PageSkeleton() {
  return (
    <div className="sk-page" role="status" aria-label="Loading">
      <div className="sk-progress" aria-hidden="true" />

      {/* Top bar: the real wordmark so the chrome doesn't flicker. */}
      <div className="sk-nav">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="sk-nav-logo" />
        <div className="sk-nav-search"><Bone style={{ width: "100%", height: 34, borderRadius: 999 }} /></div>
        <div className="sk-nav-cluster">
          <Bone className="sk-circle" />
          <Bone className="sk-circle" />
          <Bone className="sk-circle" />
        </div>
      </div>

      <div className="sk-body">
        <Bone className="sk-hero" />
        <div className="sk-chips">
          {[92, 72, 84, 66, 78].map((w, i) => <Bone key={i} style={{ width: w, height: 34, borderRadius: 999 }} />)}
        </div>
        <Bone style={{ width: 160, height: 18, borderRadius: 6, marginTop: 6 }} />
        <div className="sk-list">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="sk-row">
              <Bone className="sk-avatar" />
              <div className="sk-lines">
                <Bone style={{ width: `${70 - i * 8}%`, height: 14, borderRadius: 5 }} />
                <Bone style={{ width: `${48 + i * 6}%`, height: 11, borderRadius: 5 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Phone tab bar (CSS shows it under 640px only). */}
      <div className="sk-tabbar" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => <Bone key={i} className={`sk-tab${i === 2 ? " sk-tab--create" : ""}`} />)}
      </div>
    </div>
  );
}

/* The loading screen: a black sky of stars, a wireframe sphere turning
   slowly with two satellites on their rounds, the wordmark beneath it
   and a word for what is on its way, while a thin bar trickles along
   the top. Route fallbacks (app/⋯/loading.tsx) and the live room's
   entrance both show it. Pure markup and CSS on purpose: a loading
   fallback must not touch React state (an update from here while the
   home shell is still hydrating forces it to client-render, and its
   history calls then hit the router before it is initialised). The
   stars are laid out once from a fixed seed, so the server and the
   client draw the same sky. */

type Tier = { count: number; size: number; blur: number; color: string };

const TIERS: Tier[] = [
  { count: 120, size: 1, blur: 0, color: "rgba(187,222,251,0.5)" },
  { count: 46, size: 1.5, blur: 0, color: "rgba(227,242,253,0.72)" },
  { count: 16, size: 2, blur: 3, color: "rgba(255,221,0,0.85)" },
];

/* mulberry32: small, deterministic, good enough for a sky. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKY = (() => {
  const rnd = seeded(20260909);
  return TIERS.map((t) => {
    const dots: string[] = [];
    for (let i = 0; i < t.count; i++) {
      const x = (rnd() * 100).toFixed(2);
      const y = (rnd() * 100).toFixed(2);
      dots.push(`${x}vw ${y}vh ${t.blur ? `${t.blur}px 1px` : "0 0"} ${t.color}`);
    }
    return { size: t.size, shadow: dots.join(", ") };
  });
})();

const MERIDIANS = [0, 30, 60, 90, 120, 150];
/* Latitude rings: (height above the equator, radius) on a unit sphere. */
const PARALLELS = [
  { z: 0.5, r: 0.866 },
  { z: -0.5, r: 0.866 },
  { z: 0.82, r: 0.572 },
  { z: -0.82, r: 0.572 },
];

export default function LoadingScreen({ label = "Loading" }: { label?: string }) {
  return (
    <div className="ld-screen" role="status" aria-label={label}>
      <div className="sk-progress" aria-hidden="true" />

      <div className="ld-sky" aria-hidden="true">
        {SKY.map((tier, i) => (
          <i
            key={i}
            className={`ld-stars ld-stars--${i}`}
            style={{ width: tier.size, height: tier.size, boxShadow: tier.shadow }}
          />
        ))}
      </div>

      <div className="ld-center">
        <div className="ld-stage" aria-hidden="true">
          <i className="ld-core" />
          <div className="ld-tilt">
            <div className="ld-spin">
              {MERIDIANS.map((a) => (
                <i key={a} className="ld-ring" style={{ transform: `rotateY(${a}deg)` }} />
              ))}
              <i className="ld-ring ld-ring--equator" />
              {PARALLELS.map((p) => (
                <i
                  key={p.z}
                  className="ld-ring ld-ring--parallel"
                  style={{
                    inset: `${((1 - p.r) * 50).toFixed(2)}%`,
                    transform: `rotateX(90deg) translateZ(calc(var(--ld-r) * ${p.z}))`,
                  }}
                />
              ))}
            </div>
          </div>
          <span className="ld-orbit ld-orbit--a"><i /></span>
          <span className="ld-orbit ld-orbit--b"><i /></span>
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="AgoraSphere" className="ld-wordmark" />
        <p className="ld-label">
          {label}
          <span className="ld-ellipsis" aria-hidden="true"><i /><i /><i /></span>
        </p>
      </div>
    </div>
  );
}

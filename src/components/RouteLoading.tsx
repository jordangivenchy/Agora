/* What a route shows while its first view is on its way, inside the
   chrome: a loading line in the content area, never a curtain. The sky
   is the site's opening (BootSplash) and the live room's entrance. */

import { LoadingLine } from "@/components/LoadingScreen";

export default function RouteLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "72px 24px" }}>
      <LoadingLine label={label} />
    </div>
  );
}

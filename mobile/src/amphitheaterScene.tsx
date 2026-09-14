"use dom";

/* The website's amphitheater, the very component (components/agora/
   AgoraScene3D.tsx — the bowl under the night sky, the crowd in its seats,
   the line for the mic standing in the aisle), running inside the app as
   an Expo DOM component: a web view with WebGL, fed the room's people from
   the native screen. Nothing here is redrawn for the app; a change to the
   site's scene is a change here. metro.config.js lets this file reach
   into the site's source. */
import type { DOMProps } from "expo/dom";
import AgoraScene3D, { type SeatedPerson } from "../../src/components/agora/AgoraScene3D";

export default function AmphitheaterScene({
  roomId,
  audience,
  viewerCount,
  queue,
  micHolder,
  micLive,
  performanceMode,
}: {
  roomId: string;
  audience: SeatedPerson[];
  viewerCount: number;
  queue: SeatedPerson[];
  micHolder: SeatedPerson | null;
  micLive: boolean;
  performanceMode: boolean;
  dom?: DOMProps;
}) {
  return (
    <>
      {/* The site's .ag-scene3d rules (app/agora/agora.css), the only CSS the scene needs. */}
      <style>{`html,body{margin:0;height:100%;overflow:hidden;background:#05070f}.ag-scene3d{position:fixed;inset:0;z-index:0}.ag-scene3d canvas{width:100%;height:100%;display:block}`}</style>
      <AgoraScene3D
        roomId={roomId}
        audience={audience}
        viewerCount={viewerCount}
        view="audience"
        queue={queue}
        micHolder={micHolder}
        micLive={micLive}
        performanceMode={performanceMode}
      />
    </>
  );
}

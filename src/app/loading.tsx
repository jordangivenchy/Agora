/* Route-transition fallback for every page: shown by Next the moment a
   client navigation starts, until the new page's tree arrives. */

import AgoraLoader from "@/components/AgoraLoader";

export default function Loading() {
  return (
    <div className="agora-loader-screen">
      <AgoraLoader />
    </div>
  );
}

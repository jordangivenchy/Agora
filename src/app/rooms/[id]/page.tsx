/* /rooms/<id> was the first room page; the amphitheater (/agora/<id>)
   has been the room for a long time and nothing links here any more.
   Old links, wherever they still live, land in the amphitheater. */

import { permanentRedirect } from "next/navigation";

export default async function LegacyRoom({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  permanentRedirect(`/agora/${encodeURIComponent(id)}`);
}

/* Route-transition fallback (Kick's pattern): the chrome stays, the
   content is a pulsing skeleton, a thin bar trickles along the top.
   Per route rather than at the root: the home shell has nothing to
   show here (its tabs switch client-side) and its hydration does not
   tolerate a fallback of this shape. */

import PageSkeleton from "@/components/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}

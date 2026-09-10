/* Route-transition fallback: the loading screen (a sky, the sphere,
   the wordmark) with a word for what is coming. Per route rather than
   at the root: the home shell has nothing to show here (its tabs
   switch client-side) and its hydration does not tolerate a fallback
   of this shape. */

import LoadingScreen from "@/components/LoadingScreen";

export default function Loading() {
  return <LoadingScreen label="Opening the conversation" />;
}

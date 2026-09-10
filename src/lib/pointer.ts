/* Whether the primary pointer is a finger (phones, tablets) — for copy
   that only makes sense with a keyboard, like a composer's "⌘↩ to
   send". */

import { useMediaQuery } from "@/lib/media";

export function useCoarsePointer(): boolean {
  return useMediaQuery("(pointer: coarse)");
}

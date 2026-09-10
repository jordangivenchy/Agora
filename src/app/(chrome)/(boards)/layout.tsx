/* The boards: /communities, /communities/<slug> and /posts/<id> share
   this layout (inside the chrome's) so the communities page stays mounted — with its lists,
   its scroll and its composer — while the address moves between a
   board and a post. The page reads the address itself
   (CommunitiesPage.tsx); the routes under here only carry titles. */

import type { ReactNode } from "react";
import CommunitiesPage from "@/components/CommunitiesPage";

export default function BoardsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <CommunitiesPage />
      {children}
    </>
  );
}

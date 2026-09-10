/* /search?q=… — the search panel, pinned as a page. The chrome's navbar
   owns the panel (SiteNavbar opens it on this path with the query from
   the address); the page itself is only the ground under it. */

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Search · AgoraSphere" };

export default function SearchRoute() {
  return (
    <>
      <div style={{ minHeight: "60vh" }} />
    </>
  );
}

/* /trending — the rooms and clips getting attention right now. */

import type { Metadata } from "next";
import TrendingPage from "@/components/TrendingPage";

export const metadata: Metadata = { title: "Trending · AgoraSphere" };

export default function TrendingRoute() {
  return (
    <>
      <TrendingPage />
    </>
  );
}

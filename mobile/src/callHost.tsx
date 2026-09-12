/* Web and Expo Go: nothing to mount around the app. */
import type { ReactNode } from "react";

export function CallHost({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

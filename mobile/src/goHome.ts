/* Back to the tabs from a page that is done with you — signed in, let
   in by the key, turned away from a page that isn't yours.

   Not `router.replace("/")`: when the tabs are already underneath (a
   guest sent to sign in from the +, say), replacing the page on top
   with "/" stacks a second set of tabs on the first, and two Home
   screens then run at once. This goes back down to the tabs that are
   there, and only where there are none does it put them in this page's
   place. */
import { router } from "expo-router";

export function goHome(): void {
  router.dismissTo("/");
}

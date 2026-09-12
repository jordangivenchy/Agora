/* The door: past the gate, then signed in, then home. */
import { Redirect } from "expo-router";
import { useSession } from "../src/session";
import { Spinner } from "../src/ui";

export default function Index() {
  const { ready, session, pass, gated } = useSession();
  if (!ready) return <Spinner />;
  if (gated && !pass) return <Redirect href="/beta" />;
  if (!session) return <Redirect href="/sign-in" />;
  return <Redirect href="/home" />;
}

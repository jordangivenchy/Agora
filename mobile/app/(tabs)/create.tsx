/* The + in the tab bar is a button, not a place: the layout marks it
   disabled, so a tap never comes here and opens the Create menu instead
   ((tabs)/_layout.tsx). The system's bar still wants a screen behind
   every item; this is it, and anything that does land on it is sent
   Home. */
import { Redirect } from "expo-router";

export default function Create() {
  return <Redirect href="/" />;
}

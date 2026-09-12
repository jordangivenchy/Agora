/* Where Google sends the phone back. The session hook already exchanged
   the code by the time this renders; the door decides where to go. */
import { Redirect } from "expo-router";

export default function AuthReturn() {
  return <Redirect href="/" />;
}

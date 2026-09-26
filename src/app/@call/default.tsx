/* No call: the slot is empty. A full page load anywhere but a room lands
   here, which is also what ends a call when the page is reloaded. */
export default function NoCall() {
  return null;
}

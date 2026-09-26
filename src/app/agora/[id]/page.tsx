/* A room lives in the root layout's call slot (app/@call/agora/[id]),
   not here: that is what lets a call outlast the page — minimized to a
   card in the corner while you browse the site, the way the app keeps a
   call going above its tabs. The route itself needs a page, and this is
   it: empty, so nothing sits under the room. */
export default function AgoraRoute() {
  return null;
}

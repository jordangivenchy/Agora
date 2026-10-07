import { describe, it, expect } from "vitest";
import { ownStreamGrant, ownStreamIdentity, ownStreamLink } from "./ownStream";
import { planWebhook } from "./roomLifecycle";

const ROOM = "90dabdf2-c208-46c9-8417-b5070fba44a0";

describe("the host's own restream link", () => {
  it("lets its viewer watch and nothing else, unseen", () => {
    const g = ownStreamGrant(ROOM);
    expect(g).toMatchObject({ room: ROOM, roomJoin: true, canSubscribe: true, hidden: true, recorder: true });
    expect(g.canPublish).toBe(false);
    expect(g.canPublishData).toBe(false);
  });

  it("opens the room's broadcast view: both the pass and the call's address are in it", () => {
    const link = new URL(ownStreamLink("https://agorasphere.net/", ROOM, "wss://call.example.cloud", "a.b+c/d=="));
    expect(link.origin + link.pathname).toBe(`https://agorasphere.net/agora/${ROOM}`);
    /* What the page (and the beta gate's exemption) look for, intact through the encoding. */
    expect(link.searchParams.get("token")).toBe("a.b+c/d==");
    expect(link.searchParams.get("url")).toBe("wss://call.example.cloud");
    /* Marked as the host's own, so the page fits itself to the frame. */
    expect(link.searchParams.has("own")).toBe(true);
  });

  it("is never taken for a person coming or going", () => {
    const who = ownStreamIdentity("1a2b3c4d");
    expect(planWebhook("participant_joined", ROOM, who)).toEqual({ action: "ignore" });
    expect(planWebhook("participant_left", ROOM, who)).toEqual({ action: "ignore" });
  });
});

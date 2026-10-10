import { describe, expect, it } from "vitest";
import { countGuests, heldElsewhere, isGuest } from "./roomPresence";

/* Who is really in a room: the two questions the call answers better
   than the seats do. */
const ANA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";

describe("leaving on one device while still there on another", () => {
  it("keeps the seat when the call holds a different connection of theirs", () => {
    // Ana's laptop tab (PA_old) leaves; the call moved to her phone (PA_new) a moment ago
    expect(heldElsewhere([{ identity: ANA, sid: "PA_new" }, { identity: BEN, sid: "PA_ben" }], ANA, "PA_old")).toBe(true);
  });

  it("lets the seat go when the connection leaving is the one the call holds", () => {
    expect(heldElsewhere([{ identity: ANA, sid: "PA_only" }], ANA, "PA_only")).toBe(false);
  });

  it("lets the seat go when they are connected nowhere", () => {
    expect(heldElsewhere([{ identity: BEN, sid: "PA_ben" }], ANA, "PA_old")).toBe(false);
    expect(heldElsewhere([], ANA, null)).toBe(false);
  });

  it("keeps the seat for a page that had no connection of its own while another device is in the call", () => {
    // watching the broadcast, or a tab the call had already left for the phone
    expect(heldElsewhere([{ identity: ANA, sid: "PA_phone" }], ANA, null)).toBe(true);
  });

  it("does as it always did for a page too old to say which connection it was", () => {
    expect(heldElsewhere([{ identity: ANA, sid: "PA_phone" }], ANA, undefined)).toBe(false);
  });

  it("is about that person only", () => {
    expect(heldElsewhere([{ identity: BEN, sid: "PA_ben" }], ANA, "PA_ben")).toBe(false);
  });
});

describe("guests", () => {
  it("are the connections without an account", () => {
    expect(isGuest("guest-k3j9x2ab")).toBe(true);
    expect(isGuest("Guest-ABCD1234")).toBe(true);
    expect(isGuest(ANA)).toBe(false);
    expect(isGuest("EG_recorder")).toBe(false);
    expect(isGuest("")).toBe(false);
  });

  it("are counted once each, among everyone connected", () => {
    expect(countGuests([ANA, "guest-aaaa1111", BEN, "guest-bbbb2222"])).toBe(2);
    expect(countGuests([ANA, BEN])).toBe(0);
    expect(countGuests(new Set(["guest-aaaa1111"]).values())).toBe(1);
    expect(countGuests([])).toBe(0);
  });
});

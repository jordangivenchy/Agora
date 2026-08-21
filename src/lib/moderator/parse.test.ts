import { describe, it, expect } from "vitest";
import { buildTranscriptWindow, parseModeratorAction } from "./parse";

describe("buildTranscriptWindow", () => {
  it("labels each line with its speaker, oldest first", () => {
    expect(
      buildTranscriptWindow([
        { username: "alan", content: "UBI reduces poverty." },
        { username: "jordan", content: "But at what fiscal cost?" },
      ])
    ).toBe("alan: UBI reduces poverty.\njordan: But at what fiscal cost?");
  });
});

describe("parseModeratorAction", () => {
  it("parses a context drop", () => {
    expect(
      parseModeratorAction('{"action":"context","text":"Worth noting: Kenya runs the largest UBI pilot.","confidence":0.85}')
    ).toEqual({ kind: "context", text: "Worth noting: Kenya runs the largest UBI pilot.", confidence: 0.85 });
  });

  it("parses an insight nudge and strips code fences", () => {
    expect(
      parseModeratorAction('```json\n{"action":"insight","text":"The con side has raised costs twice without a response.","confidence":0.9}\n```')
    ).toEqual({ kind: "insight", text: "The con side has raised costs twice without a response.", confidence: 0.9 });
  });

  it("returns null for the 'none' decision", () => {
    expect(parseModeratorAction('{"action":"none"}')).toBeNull();
  });

  it("returns null for junk, empty text, and unknown actions", () => {
    expect(parseModeratorAction("I think I should add context here")).toBeNull();
    expect(parseModeratorAction('{"action":"context","text":"  "}')).toBeNull();
    expect(parseModeratorAction('{"action":"interrupt","text":"stop"}')).toBeNull();
  });

  it("clamps confidence and caps text length", () => {
    const long = "x".repeat(2000);
    const parsed = parseModeratorAction(`{"action":"context","text":"${long}","confidence":7}`);
    expect(parsed!.confidence).toBe(1);
    expect(parsed!.text.length).toBe(600);
  });
});

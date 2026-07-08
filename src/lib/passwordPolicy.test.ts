import { describe, it, expect } from "vitest";
import { validateNewPassword, MIN_PASSWORD_LENGTH } from "./passwordPolicy";

describe("validateNewPassword", () => {
  it("rejects passwords shorter than the minimum", () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(validateNewPassword(short, short)).toMatch(/at least/i);
  });

  it("accepts a password at exactly the minimum length", () => {
    const ok = "a".repeat(MIN_PASSWORD_LENGTH);
    expect(validateNewPassword(ok, ok)).toBeNull();
  });

  it("rejects mismatched confirmation", () => {
    expect(validateNewPassword("longenough1", "longenough2")).toMatch(/match/i);
  });

  it("accepts a valid, matching password", () => {
    expect(validateNewPassword("correcthorse", "correcthorse")).toBeNull();
  });
});

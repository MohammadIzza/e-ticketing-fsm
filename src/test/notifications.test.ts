import { describe, it, expect } from "vitest";
import { isEventEnabled } from "../lib/notifications";
import type { NotificationPrefs } from "../lib/types";

describe("isEventEnabled", () => {
  it("returns false when prefs is null/undefined", () => {
    expect(isEventEnabled(null, "diterima")).toBe(false);
    expect(isEventEnabled(undefined, "diterima")).toBe(false);
  });

  it("returns false when master switch is off, regardless of per-event", () => {
    const prefs: NotificationPrefs = {
      enabled: false,
      diterima: true,
      ditugaskan: true,
      diselesaikan: true,
      verified: true,
    };
    expect(isEventEnabled(prefs, "diterima")).toBe(false);
    expect(isEventEnabled(prefs, "ditugaskan")).toBe(false);
    expect(isEventEnabled(prefs, "diselesaikan")).toBe(false);
    expect(isEventEnabled(prefs, "verified")).toBe(false);
  });

  it("returns false when master switch on but specific event off", () => {
    const prefs: NotificationPrefs = {
      enabled: true,
      diterima: false,
      ditugaskan: false,
      diselesaikan: false,
      verified: false,
    };
    // This was the original UX bug: master ON but events all OFF —
    // pelapor tidak menerima notifikasi sama sekali. Sekarang diperbaiki
    // di Profile.tsx (handleToggleMaster otomatis menyalakan SEMUA event
    // saat master pertama kali enabled), tapi semantic isEventEnabled
    // di sini tetap sama: butuh master AND per-event keduanya true.
    expect(isEventEnabled(prefs, "diterima")).toBe(false);
  });

  it("returns true only when both master and event are on", () => {
    const prefs: NotificationPrefs = {
      enabled: true,
      diterima: true,
      ditugaskan: false,
      diselesaikan: true,
      verified: false,
    };
    expect(isEventEnabled(prefs, "diterima")).toBe(true);
    expect(isEventEnabled(prefs, "ditugaskan")).toBe(false);
    expect(isEventEnabled(prefs, "diselesaikan")).toBe(true);
    expect(isEventEnabled(prefs, "verified")).toBe(false);
  });

  it("treats missing event keys as false (no implicit-true)", () => {
    const prefs: NotificationPrefs = { enabled: true };
    expect(isEventEnabled(prefs, "diterima")).toBe(false);
    expect(isEventEnabled(prefs, "ditugaskan")).toBe(false);
  });
});

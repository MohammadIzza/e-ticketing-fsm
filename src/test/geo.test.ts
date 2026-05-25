import { describe, it, expect } from "vitest";
import {
  buildMapsUrl,
  formatAccuracy,
  formatCoords,
  hasCoords,
} from "../lib/geo";

describe("geo helpers", () => {
  describe("hasCoords", () => {
    it("true when both lat & lng are finite numbers", () => {
      expect(hasCoords({ latitude: -6.2, longitude: 106.8 })).toBe(true);
    });
    it("false when missing or non-finite", () => {
      expect(hasCoords({ latitude: null, longitude: 106.8 })).toBe(false);
      expect(hasCoords({ latitude: 0, longitude: undefined })).toBe(false);
      expect(hasCoords({ latitude: NaN, longitude: 0 })).toBe(false);
    });
  });

  describe("formatCoords", () => {
    it("returns - when missing", () => {
      expect(formatCoords({ latitude: null, longitude: null })).toBe("-");
    });
    it("formats with default 6 digits", () => {
      expect(formatCoords({ latitude: -6.2, longitude: 106.8 })).toBe(
        "-6.200000, 106.800000",
      );
    });
    it("respects custom digits", () => {
      expect(
        formatCoords({ latitude: -6.123456, longitude: 106.987654 }, 2),
      ).toBe("-6.12, 106.99");
    });
  });

  describe("formatAccuracy", () => {
    it("empty when missing", () => {
      expect(formatAccuracy(null)).toBe("");
      expect(formatAccuracy(undefined)).toBe("");
    });
    it("uses meters when < 1000", () => {
      expect(formatAccuracy(0)).toBe("±0 m");
      expect(formatAccuracy(12.4)).toBe("±12 m");
      expect(formatAccuracy(999)).toBe("±999 m");
    });
    it("uses km when >= 1000", () => {
      expect(formatAccuracy(1000)).toBe("±1.0 km");
      expect(formatAccuracy(2500)).toBe("±2.5 km");
    });
  });

  describe("buildMapsUrl", () => {
    it("returns null when missing", () => {
      expect(buildMapsUrl({ latitude: null, longitude: null })).toBeNull();
    });
    it("returns Google Maps URL with q param", () => {
      const url = buildMapsUrl({ latitude: -6.2, longitude: 106.8 });
      expect(url).toContain("https://www.google.com/maps?q=");
      expect(url).toContain("-6.2");
      expect(url).toContain("106.8");
    });
  });
});

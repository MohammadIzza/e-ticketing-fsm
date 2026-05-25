import { describe, it, expect } from "vitest";
import {
  EMPTY_STATS,
  aggregateOwnedStats,
  belumSelesai,
  normalizeStats,
} from "../lib/dashboardStats";

describe("dashboardStats", () => {
  describe("normalizeStats", () => {
    it("returns zeroed stats for null/undefined/non-object input", () => {
      expect(normalizeStats(null)).toEqual(EMPTY_STATS);
      expect(normalizeStats(undefined)).toEqual(EMPTY_STATS);
      expect(normalizeStats("oops")).toEqual(EMPTY_STATS);
      expect(normalizeStats(42)).toEqual(EMPTY_STATS);
    });

    it("coerces numeric strings (Postgres bigint comes as string)", () => {
      const out = normalizeStats({
        total: "12",
        dikirim: "3",
        diterima: "1",
        ditugaskan: "2",
        diselesaikan: "6",
        pending_verification: "1",
        overdue: "0",
        hari_ini: "4",
      });
      expect(out).toEqual({
        total: 12,
        dikirim: 3,
        diterima: 1,
        ditugaskan: 2,
        diselesaikan: 6,
        pending_verification: 1,
        overdue: 0,
        hari_ini: 4,
      });
    });

    it("treats missing fields and non-numeric values as 0", () => {
      const out = normalizeStats({
        total: 5,
        dikirim: "abc",
        // others missing
      });
      expect(out.total).toBe(5);
      expect(out.dikirim).toBe(0);
      expect(out.diterima).toBe(0);
      expect(out.overdue).toBe(0);
    });
  });

  describe("belumSelesai", () => {
    it("sums dikirim + diterima + ditugaskan", () => {
      expect(
        belumSelesai({
          ...EMPTY_STATS,
          dikirim: 2,
          diterima: 3,
          ditugaskan: 4,
          diselesaikan: 100,
        }),
      ).toBe(9);
    });

    it("returns 0 when nothing is open", () => {
      expect(
        belumSelesai({ ...EMPTY_STATS, diselesaikan: 100 }),
      ).toBe(0);
    });
  });

  describe("aggregateOwnedStats", () => {
    const FIXED_NOW = new Date("2026-05-24T12:00:00Z");

    it("returns empty stats for empty input", () => {
      expect(aggregateOwnedStats([], FIXED_NOW)).toEqual(EMPTY_STATS);
    });

    it("counts each status correctly", () => {
      const out = aggregateOwnedStats(
        [
          {
            status: "dikirim",
            sla_due_at: null,
            pending_verification: false,
            created_at: "2026-05-20T08:00:00Z",
          },
          {
            status: "diterima",
            sla_due_at: null,
            pending_verification: false,
            created_at: "2026-05-20T08:00:00Z",
          },
          {
            status: "ditugaskan",
            sla_due_at: null,
            pending_verification: false,
            created_at: "2026-05-20T08:00:00Z",
          },
          {
            status: "diselesaikan",
            sla_due_at: null,
            pending_verification: false,
            created_at: "2026-05-20T08:00:00Z",
          },
        ],
        FIXED_NOW,
      );
      expect(out.total).toBe(4);
      expect(out.dikirim).toBe(1);
      expect(out.diterima).toBe(1);
      expect(out.ditugaskan).toBe(1);
      expect(out.diselesaikan).toBe(1);
      expect(out.pending_verification).toBe(0);
      expect(out.overdue).toBe(0);
    });

    it("counts overdue (sla_due_at past, status != diselesaikan)", () => {
      const out = aggregateOwnedStats(
        [
          {
            status: "ditugaskan",
            sla_due_at: "2026-05-23T11:00:00Z", // past
            pending_verification: false,
            created_at: "2026-05-20T08:00:00Z",
          },
          {
            status: "ditugaskan",
            sla_due_at: "2026-05-30T11:00:00Z", // future
            pending_verification: false,
            created_at: "2026-05-20T08:00:00Z",
          },
          {
            // diselesaikan with past SLA → NOT overdue (already closed)
            status: "diselesaikan",
            sla_due_at: "2026-05-23T11:00:00Z",
            pending_verification: false,
            created_at: "2026-05-20T08:00:00Z",
          },
        ],
        FIXED_NOW,
      );
      expect(out.overdue).toBe(1);
    });

    it("counts pending_verification only for diselesaikan", () => {
      const out = aggregateOwnedStats(
        [
          {
            status: "diselesaikan",
            sla_due_at: null,
            pending_verification: true,
            created_at: "2026-05-20T08:00:00Z",
          },
          {
            // pending_verification ignored on non-selesai
            status: "ditugaskan",
            sla_due_at: null,
            pending_verification: true,
            created_at: "2026-05-20T08:00:00Z",
          },
        ],
        FIXED_NOW,
      );
      expect(out.pending_verification).toBe(1);
    });

    it("counts hari_ini based on created_at >= start of today", () => {
      const out = aggregateOwnedStats(
        [
          {
            status: "dikirim",
            sla_due_at: null,
            pending_verification: false,
            created_at: "2026-05-24T03:00:00Z", // today
          },
          {
            status: "dikirim",
            sla_due_at: null,
            pending_verification: false,
            created_at: "2026-05-23T23:00:00Z", // yesterday (UTC)
          },
        ],
        FIXED_NOW,
      );
      expect(out.hari_ini).toBe(1);
    });

    it("ignores invalid dates without throwing", () => {
      const out = aggregateOwnedStats(
        [
          {
            status: "dikirim",
            sla_due_at: "not-a-date",
            pending_verification: false,
            created_at: "also-bad",
          },
        ],
        FIXED_NOW,
      );
      expect(out.total).toBe(1);
      expect(out.overdue).toBe(0);
      expect(out.hari_ini).toBe(0);
    });
  });
});

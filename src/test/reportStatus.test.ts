import { describe, it, expect } from "vitest";
import {
  STATUS_ORDER,
  STATUS_LABEL,
  availableActions,
  canDeleteReport,
  effectiveStatus,
  formatSlaCountdown,
  isOverdue,
  nextStatus,
} from "../lib/reportStatus";

describe("reportStatus helpers", () => {
  describe("STATUS_ORDER", () => {
    it("matches the documented workflow order", () => {
      expect(STATUS_ORDER).toEqual([
        "dikirim",
        "diterima",
        "ditugaskan",
        "diselesaikan",
      ]);
    });
  });

  describe("STATUS_LABEL", () => {
    it("has a human label for every status (incl. melebihi_sla)", () => {
      for (const s of STATUS_ORDER) {
        expect(STATUS_LABEL[s]).toBeTruthy();
      }
      expect(STATUS_LABEL.melebihi_sla).toBe("Melebihi SLA");
    });
  });

  describe("nextStatus", () => {
    it("returns the next status in the workflow", () => {
      expect(nextStatus("dikirim")).toBe("diterima");
      expect(nextStatus("diterima")).toBe("ditugaskan");
      expect(nextStatus("ditugaskan")).toBe("diselesaikan");
    });
    it("returns null for terminal status", () => {
      expect(nextStatus("diselesaikan")).toBeNull();
    });
  });

  describe("canDeleteReport", () => {
    it("owner CAN delete when status is dikirim", () => {
      expect(canDeleteReport("dikirim", true, ["pelapor"])).toBe(true);
    });

    it("owner CANNOT delete after the report has been received", () => {
      expect(canDeleteReport("diterima", true, ["pelapor"])).toBe(false);
      expect(canDeleteReport("ditugaskan", true, ["pelapor"])).toBe(false);
      expect(canDeleteReport("diselesaikan", true, ["pelapor"])).toBe(false);
    });

    it("non-owner non-admin CANNOT delete regardless of status", () => {
      expect(canDeleteReport("dikirim", false, ["pelapor"])).toBe(false);
      expect(canDeleteReport("dikirim", false, ["pimpinan"])).toBe(false);
      expect(canDeleteReport("dikirim", false, ["petugas"])).toBe(false);
    });

    it("superadmin CAN delete in any status, owner or not", () => {
      for (const s of STATUS_ORDER) {
        expect(canDeleteReport(s, true, ["superadmin"])).toBe(true);
        expect(canDeleteReport(s, false, ["superadmin"])).toBe(true);
        expect(canDeleteReport(s, false, ["pimpinan", "superadmin"])).toBe(true);
      }
    });
  });

  describe("availableActions (legacy positional signature)", () => {
    it("pelapor sees no management actions", () => {
      expect(availableActions("dikirim", ["pelapor"], false)).toEqual([]);
      expect(availableActions("ditugaskan", ["pelapor"], false)).toEqual([]);
    });

    it("pimpinan can Terima dikirim, Tugaskan dikirim/diterima, but not Selesai", () => {
      const fromDikirim = availableActions("dikirim", ["pimpinan"], false).map(
        (a) => a.key,
      );
      expect(fromDikirim).toContain("terima");
      expect(fromDikirim).toContain("tugaskan");
      expect(fromDikirim).not.toContain("selesai");

      const fromDiterima = availableActions(
        "diterima",
        ["pimpinan"],
        false,
      ).map((a) => a.key);
      expect(fromDiterima).toContain("tugaskan");
      expect(fromDiterima).not.toContain("terima");
    });

    it("petugas can only Selesai when assigned to them", () => {
      expect(
        availableActions("ditugaskan", ["petugas"], true).map((a) => a.key),
      ).toEqual(["selesai"]);
      expect(
        availableActions("ditugaskan", ["petugas"], false).map((a) => a.key),
      ).toEqual([]);
    });

    it("pelapor who is the assignee can Selesai (self-executable category)", () => {
      // Kategori "bisa dikerjakan sendiri": setelah pimpinan Terima, sistem
      // auto-assign laporan ke pelapor itu sendiri sehingga si pelapor —
      // tanpa role petugas — tetap dapat menekan tombol Selesaikan.
      expect(
        availableActions("ditugaskan", ["pelapor"], true).map((a) => a.key),
      ).toEqual(["selesai"]);
      // Pelapor lain (bukan assignee) tetap tidak melihat aksi apapun.
      expect(
        availableActions("ditugaskan", ["pelapor"], false).map((a) => a.key),
      ).toEqual([]);
    });

    it("superadmin sees all actions for the corresponding status", () => {
      expect(
        availableActions("dikirim", ["superadmin"], false).map((a) => a.key),
      ).toEqual(["terima", "tugaskan"]);
      expect(
        availableActions("diterima", ["superadmin"], false).map((a) => a.key),
      ).toEqual(["tugaskan"]);
      expect(
        availableActions("ditugaskan", ["superadmin"], false).map((a) => a.key),
      ).toEqual(["selesai"]);
      expect(availableActions("diselesaikan", ["superadmin"], false)).toEqual(
        [],
      );
    });

    it("user with multiple roles gets union of capabilities", () => {
      const actions = availableActions(
        "dikirim",
        ["pimpinan", "petugas"],
        false,
      ).map((a) => a.key);
      expect(actions).toContain("terima");
      expect(actions).toContain("tugaskan");
    });
  });

  describe("availableActions (object signature with verification)", () => {
    it("offers verifikasi to pimpinan when status=diselesaikan + pendingVerification=true", () => {
      const actions = availableActions({
        status: "diselesaikan",
        roles: ["pimpinan"],
        isAssignee: false,
        pendingVerification: true,
      }).map((a) => a.key);
      expect(actions).toContain("verifikasi");
    });

    it("does NOT offer verifikasi when pendingVerification=false", () => {
      const actions = availableActions({
        status: "diselesaikan",
        roles: ["pimpinan"],
        isAssignee: false,
        pendingVerification: false,
      }).map((a) => a.key);
      expect(actions).not.toContain("verifikasi");
    });

    it("petugas non-pimpinan does NOT get verifikasi", () => {
      const actions = availableActions({
        status: "diselesaikan",
        roles: ["petugas"],
        isAssignee: true,
        pendingVerification: true,
      }).map((a) => a.key);
      expect(actions).not.toContain("verifikasi");
    });
  });

  describe("availableActions (self-executable category)", () => {
    // Untuk kategori "bisa dikerjakan sendiri" — alur "Terima" sudah
    // langsung men-set status → 'ditugaskan' dan assigned_to=pelapor
    // (lihat migrasi 0011_self_executable.sql). Tombol "Tugaskan"
    // tidak boleh muncul karena akan menabrak alur otomatis tersebut.

    it("hides Tugaskan when selfExecutable=true at status=dikirim", () => {
      const keys = availableActions({
        status: "dikirim",
        roles: ["pimpinan"],
        isAssignee: false,
        selfExecutable: true,
      }).map((a) => a.key);
      expect(keys).toContain("terima");
      expect(keys).not.toContain("tugaskan");
    });

    it("hides Tugaskan when selfExecutable=true at status=diterima", () => {
      // Catatan: pada self-executable laporan tidak akan singgah di
      // status 'diterima' karena Terima langsung lompat ke 'ditugaskan'.
      // Tapi kalaupun ada laporan di state ini (misalnya kategorinya
      // baru di-flag self_executable setelah Terima), tombol Tugaskan
      // tetap kita sembunyikan agar konsisten.
      const keys = availableActions({
        status: "diterima",
        roles: ["pimpinan"],
        isAssignee: false,
        selfExecutable: true,
      }).map((a) => a.key);
      expect(keys).not.toContain("tugaskan");
    });

    it("default selfExecutable=false keeps Tugaskan visible (back-compat)", () => {
      const keys = availableActions({
        status: "dikirim",
        roles: ["pimpinan"],
        isAssignee: false,
      }).map((a) => a.key);
      expect(keys).toContain("tugaskan");
    });

    it("superadmin also loses Tugaskan when selfExecutable=true", () => {
      const keys = availableActions({
        status: "dikirim",
        roles: ["superadmin"],
        isAssignee: false,
        selfExecutable: true,
      }).map((a) => a.key);
      expect(keys).toEqual(["terima"]);
    });
  });

  describe("effectiveStatus & isOverdue", () => {
    const FIXED_NOW = new Date("2026-05-24T12:00:00Z");
    const future = "2026-06-01T00:00:00Z";
    const past = "2026-05-20T00:00:00Z";

    it("returns DB status when SLA is not set", () => {
      expect(
        effectiveStatus({ status: "dikirim", slaDueAt: null, now: FIXED_NOW }),
      ).toBe("dikirim");
    });

    it("returns DB status when SLA is in the future", () => {
      expect(
        effectiveStatus({ status: "ditugaskan", slaDueAt: future, now: FIXED_NOW }),
      ).toBe("ditugaskan");
      expect(
        isOverdue({ status: "ditugaskan", slaDueAt: future, now: FIXED_NOW }),
      ).toBe(false);
    });

    it("returns 'melebihi_sla' when SLA passed and status not diselesaikan", () => {
      expect(
        effectiveStatus({ status: "ditugaskan", slaDueAt: past, now: FIXED_NOW }),
      ).toBe("melebihi_sla");
      expect(
        effectiveStatus({ status: "diterima", slaDueAt: past, now: FIXED_NOW }),
      ).toBe("melebihi_sla");
      expect(
        isOverdue({ status: "ditugaskan", slaDueAt: past, now: FIXED_NOW }),
      ).toBe(true);
    });

    it("keeps 'diselesaikan' even if SLA already lapsed (laporan sudah closed)", () => {
      expect(
        effectiveStatus({
          status: "diselesaikan",
          slaDueAt: past,
          now: FIXED_NOW,
        }),
      ).toBe("diselesaikan");
      expect(
        isOverdue({
          status: "diselesaikan",
          slaDueAt: past,
          now: FIXED_NOW,
        }),
      ).toBe(false);
    });

    it("handles invalid SLA strings gracefully", () => {
      expect(
        effectiveStatus({
          status: "ditugaskan",
          slaDueAt: "not-a-date",
          now: FIXED_NOW,
        }),
      ).toBe("ditugaskan");
    });
  });

  describe("formatSlaCountdown", () => {
    const FIXED_NOW = new Date("2026-05-24T12:00:00Z");

    it("returns null for invalid date", () => {
      expect(formatSlaCountdown("not-a-date", FIXED_NOW)).toBeNull();
    });

    it("tone=ok when more than 24h remaining (days+hours)", () => {
      const due = new Date("2026-05-26T15:00:00Z").toISOString();
      const out = formatSlaCountdown(due, FIXED_NOW);
      expect(out).not.toBeNull();
      expect(out!.tone).toBe("ok");
      expect(out!.text).toBe("Sisa 2 hari 3 jam");
    });

    it("tone=warn when less than 24h remaining (hours+minutes)", () => {
      const due = new Date("2026-05-24T17:30:00Z").toISOString();
      const out = formatSlaCountdown(due, FIXED_NOW);
      expect(out!.tone).toBe("warn");
      expect(out!.text).toBe("Sisa 5 jam 30 menit");
    });

    it("tone=warn when only minutes remain", () => {
      const due = new Date("2026-05-24T12:42:00Z").toISOString();
      const out = formatSlaCountdown(due, FIXED_NOW);
      expect(out!.tone).toBe("warn");
      expect(out!.text).toBe("Sisa 42 menit");
    });

    it("tone=danger when already overdue", () => {
      const due = new Date("2026-05-23T11:30:00Z").toISOString();
      const out = formatSlaCountdown(due, FIXED_NOW);
      expect(out!.tone).toBe("danger");
      // 24h 30min lewat → 1 hari + 0 jam → label compact "1 hari".
      expect(out!.text).toBe("Terlambat 1 hari");
    });

    it("tone=danger with hours+minutes when overdue < 1 day", () => {
      const due = new Date("2026-05-24T09:30:00Z").toISOString();
      const out = formatSlaCountdown(due, FIXED_NOW);
      expect(out!.tone).toBe("danger");
      expect(out!.text).toBe("Terlambat 2 jam 30 menit");
    });

    it("compact label when exactly hours/days", () => {
      const due3h = new Date("2026-05-24T15:00:00Z").toISOString();
      expect(formatSlaCountdown(due3h, FIXED_NOW)!.text).toBe("Sisa 3 jam");
      const due2d = new Date("2026-05-26T12:00:00Z").toISOString();
      expect(formatSlaCountdown(due2d, FIXED_NOW)!.text).toBe("Sisa 2 hari");
    });
  });
});

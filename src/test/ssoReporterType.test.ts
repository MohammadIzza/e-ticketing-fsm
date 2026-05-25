import { describe, expect, it } from "vitest";
import {
  REPORTER_TYPE_LABEL,
  reporterTypeFromEmail,
} from "../lib/ssoReporterType";

describe("reporterTypeFromEmail", () => {
  it("memetakan domain mahasiswa", () => {
    expect(reporterTypeFromEmail("alice@students.undip.ac.id")).toBe(
      "mahasiswa",
    );
    expect(reporterTypeFromEmail("BOB@MAHASISWA.UNDIP.AC.ID")).toBe(
      "mahasiswa",
    );
  });

  it("memetakan domain dosen", () => {
    expect(reporterTypeFromEmail("dr.x@lecturer.undip.ac.id")).toBe("dosen");
    expect(reporterTypeFromEmail("dr.x@dosen.undip.ac.id")).toBe("dosen");
  });

  it("memetakan domain staf/staff", () => {
    expect(reporterTypeFromEmail("y@staff.undip.ac.id")).toBe("staf");
    expect(reporterTypeFromEmail("z@staf.undip.ac.id")).toBe("staf");
  });

  it("subdomain prefix tetap dikenali", () => {
    expect(
      reporterTypeFromEmail("user@math.students.undip.ac.id"),
    ).toBe("mahasiswa");
    expect(reporterTypeFromEmail("u@dept.staff.undip.ac.id")).toBe("staf");
  });

  it("domain Undip generik dianggap umum (null)", () => {
    expect(reporterTypeFromEmail("user@undip.ac.id")).toBeNull();
    expect(reporterTypeFromEmail("user@fsm.undip.ac.id")).toBeNull();
    expect(reporterTypeFromEmail("user@ft.undip.ac.id")).toBeNull();
  });

  it("domain non-Undip → null", () => {
    expect(reporterTypeFromEmail("a@gmail.com")).toBeNull();
    expect(reporterTypeFromEmail("a@example.com")).toBeNull();
  });

  it("input tidak valid → null", () => {
    expect(reporterTypeFromEmail("")).toBeNull();
    expect(reporterTypeFromEmail(null)).toBeNull();
    expect(reporterTypeFromEmail(undefined)).toBeNull();
    expect(reporterTypeFromEmail("no-at-sign")).toBeNull();
    expect(reporterTypeFromEmail("@students.undip.ac.id")).toBeNull();
    expect(reporterTypeFromEmail("user@")).toBeNull();
  });

  it("trickery domain dengan suffix berbeda → null", () => {
    // "students.undip.ac.id.attacker.com" → tidak match (anchor $ di regex)
    expect(
      reporterTypeFromEmail("u@students.undip.ac.id.attacker.com"),
    ).toBeNull();
    // "fakestudents.undip.ac.id" → tidak match (boundary `(?:^|\.)`)
    expect(reporterTypeFromEmail("u@fakestudents.undip.ac.id")).toBeNull();
  });

  it("REPORTER_TYPE_LABEL lengkap untuk semua canonical", () => {
    expect(REPORTER_TYPE_LABEL.mahasiswa).toBe("Mahasiswa");
    expect(REPORTER_TYPE_LABEL.dosen).toBe("Dosen");
    expect(REPORTER_TYPE_LABEL.staf).toBe("Staf");
  });
});

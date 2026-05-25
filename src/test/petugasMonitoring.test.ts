import { describe, expect, it } from "vitest";
import {
  aggregatePetugas,
  describePeriod,
  periodToRange,
  sortPetugas,
  type PetugasInfo,
  type PetugasAssigneeRow,
  type PetugasSurveyRow,
} from "../lib/petugasMonitoring";

const ALICE: PetugasInfo = {
  id: "alice",
  full_name: "Alice",
  email: null,
  username: null,
  avatar_url: null,
};
const BOB: PetugasInfo = {
  id: "bob",
  full_name: "Bob",
  email: null,
  username: null,
  avatar_url: null,
};

const surveys: PetugasSurveyRow[] = [
  // Alice — 2 in Jan 2025, 1 active
  {
    id: "s1",
    created_by: "alice",
    status: "in_progress",
    created_at: "2025-01-10T08:00:00Z",
    title: "S1",
  },
  {
    id: "s2",
    created_by: "alice",
    status: "validated",
    created_at: "2025-01-20T08:00:00Z",
    title: "S2",
  },
  // Alice — 1 in Aug 2025
  {
    id: "s3",
    created_by: "alice",
    status: "validated",
    created_at: "2025-08-01T08:00:00Z",
    title: "S3",
  },
  // Bob — none
];
const assignments: PetugasAssigneeRow[] = [
  // Alice — 1 active in Mar 2025
  {
    report_id: "r1",
    assignee_id: "alice",
    assigned_at: "2025-03-01T08:00:00Z",
    report_status: "ditugaskan",
  },
  // Bob — 1 done in Jul 2025
  {
    report_id: "r2",
    assignee_id: "bob",
    assigned_at: "2025-07-15T08:00:00Z",
    report_status: "diselesaikan",
  },
];

describe("aggregatePetugas", () => {
  it("all-time mengumpulkan semua pekerjaan dan menghitung active correctly", () => {
    const out = aggregatePetugas({
      petugasList: [ALICE, BOB],
      surveys,
      assignments,
      range: {},
    });
    const alice = out.find((x) => x.petugas.id === "alice")!;
    const bob = out.find((x) => x.petugas.id === "bob")!;
    expect(alice.total).toBe(4); // 3 surveys + 1 assignment
    expect(alice.surveyCount).toBe(3);
    expect(alice.reportCount).toBe(1);
    // Active: s1 (in_progress) + r1 (ditugaskan) = 2
    expect(alice.active).toBe(2);
    expect(alice.status).toBe("working");
    expect(bob.total).toBe(1);
    expect(bob.active).toBe(0);
    expect(bob.status).toBe("idle");
  });

  it("range filter membatasi total, tapi active tetap all-time", () => {
    // Periode: Januari 2025 saja
    const range = periodToRange({ kind: "month", year: 2025, month: 1 });
    const out = aggregatePetugas({
      petugasList: [ALICE, BOB],
      surveys,
      assignments,
      range,
    });
    const alice = out.find((x) => x.petugas.id === "alice")!;
    const bob = out.find((x) => x.petugas.id === "bob")!;
    expect(alice.surveyCount).toBe(2); // s1 + s2
    expect(alice.reportCount).toBe(0);
    expect(alice.total).toBe(2);
    expect(alice.active).toBe(2); // active tetap all-time
    expect(bob.total).toBe(0);
  });

  it("semester 1 (Jan-Jun) dan semester 2 (Jul-Dec)", () => {
    const sem1 = periodToRange({ kind: "semester", year: 2025, semester: 1 });
    const sem2 = periodToRange({ kind: "semester", year: 2025, semester: 2 });
    const out1 = aggregatePetugas({
      petugasList: [ALICE],
      surveys,
      assignments,
      range: sem1,
    });
    const out2 = aggregatePetugas({
      petugasList: [ALICE],
      surveys,
      assignments,
      range: sem2,
    });
    // Sem 1: s1 (Jan), s2 (Jan), r1 (Mar) → 3
    expect(out1[0].total).toBe(3);
    // Sem 2: s3 (Aug) → 1
    expect(out2[0].total).toBe(1);
  });

  it("tahun 2025 mencakup semua tahun itu", () => {
    const range = periodToRange({ kind: "year", year: 2025 });
    const out = aggregatePetugas({
      petugasList: [ALICE, BOB],
      surveys,
      assignments,
      range,
    });
    expect(out.find((x) => x.petugas.id === "alice")!.total).toBe(4);
    expect(out.find((x) => x.petugas.id === "bob")!.total).toBe(1);
  });

  it("tahun lain (2024) → 0 untuk semua", () => {
    const range = periodToRange({ kind: "year", year: 2024 });
    const out = aggregatePetugas({
      petugasList: [ALICE, BOB],
      surveys,
      assignments,
      range,
    });
    expect(out.every((x) => x.total === 0)).toBe(true);
  });
});

describe("sortPetugas", () => {
  const rows = [
    {
      petugas: BOB,
      total: 1,
      active: 0,
      surveyCount: 0,
      reportCount: 1,
      status: "idle" as const,
    },
    {
      petugas: ALICE,
      total: 4,
      active: 2,
      surveyCount: 3,
      reportCount: 1,
      status: "working" as const,
    },
  ];

  it("total_desc menempatkan yang terbanyak di atas", () => {
    const s = sortPetugas(rows, "total_desc");
    expect(s[0].petugas.id).toBe("alice");
  });
  it("active_desc menempatkan yang paling aktif", () => {
    const s = sortPetugas(rows, "active_desc");
    expect(s[0].petugas.id).toBe("alice");
  });
  it("name_asc alfabet", () => {
    const s = sortPetugas(rows, "name_asc");
    expect(s.map((x) => x.petugas.id)).toEqual(["alice", "bob"]);
  });
});

describe("describePeriod", () => {
  it("formatted dengan benar untuk setiap kind", () => {
    expect(describePeriod({ kind: "all", year: 2025 })).toBe("Semua waktu");
    expect(describePeriod({ kind: "year", year: 2025 })).toBe("Tahun 2025");
    expect(
      describePeriod({ kind: "semester", year: 2025, semester: 2 }),
    ).toBe("Semester 2 · 2025");
    expect(describePeriod({ kind: "month", year: 2025, month: 4 })).toBe(
      "April 2025",
    );
  });
});

describe("periodToRange Desember edge case", () => {
  it("Desember rolls over ke Januari tahun berikutnya", () => {
    const r = periodToRange({ kind: "month", year: 2025, month: 12 });
    expect(r.from).toBe(new Date(2025, 11, 1).toISOString());
    expect(r.to).toBe(new Date(2026, 0, 1).toISOString());
  });
});

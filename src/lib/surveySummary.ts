import { supabase } from "./supabase";

export interface SurveySummary {
  buildings: number;
  rooms: number;
  assets: number;
  surveys: number;
}

/**
 * Ambil ringkasan jumlah (gedung, ruang, aset, survey) untuk dipajang
 * di header modul Survey Aset. Pakai `count: "exact", head: true`
 * supaya tidak menarik baris.
 */
export async function fetchSurveySummary(): Promise<SurveySummary> {
  const [b, r, a, s] = await Promise.all([
    supabase.from("buildings").select("*", { count: "exact", head: true }),
    supabase.from("rooms").select("*", { count: "exact", head: true }),
    supabase.from("assets").select("*", { count: "exact", head: true }),
    supabase
      .from("asset_surveys")
      .select("*", { count: "exact", head: true }),
  ]);
  return {
    buildings: b.count ?? 0,
    rooms: r.count ?? 0,
    assets: a.count ?? 0,
    surveys: s.count ?? 0,
  };
}

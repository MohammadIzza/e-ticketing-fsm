/**
 * Mapping email domain Undip → jenis pelapor canonical.
 *
 * Dipakai oleh `/api/auth/sso` server-side (logic di-duplikat verbatim di
 * sana — lihat `api/auth/sso.ts`) dan oleh frontend (mis. ditampilkan
 * sebagai hint di Profile saat user lihat jenis pelapornya yang
 * di-derive otomatis dari email SSO).
 *
 * Aturan (sesuai keputusan user):
 *   - `*@students.undip.ac.id` / `*@mahasiswa.undip.ac.id` → mahasiswa
 *   - `*@lecturer.undip.ac.id` / `*@dosen.undip.ac.id`     → dosen
 *   - `*@staff.undip.ac.id`    / `*@staf.undip.ac.id`      → staf
 *   - domain lain                                          → null (umum)
 *
 * Subdomain di depan (cth: `dept.students.undip.ac.id`) ikut dimatch.
 */

export type CanonicalReporterType = "mahasiswa" | "dosen" | "staf";

/**
 * Label human-readable untuk setiap jenis pelapor canonical. Inilah
 * value yang akan disimpan di kolom `reporter_types.name` (unique) saat
 * sistem auto-create row baru. Hanya 3 ini yang boleh auto-create —
 * domain lain tidak menghasilkan apa-apa (fallback ke "umum" / null).
 */
export const REPORTER_TYPE_LABEL: Record<CanonicalReporterType, string> = {
  mahasiswa: "Mahasiswa",
  dosen: "Dosen",
  staf: "Staf",
};

const PATTERN: { canonical: CanonicalReporterType; rx: RegExp }[] = [
  {
    canonical: "mahasiswa",
    rx: /(?:^|\.)(students|mahasiswa)\.undip\.ac\.id$/i,
  },
  {
    canonical: "dosen",
    rx: /(?:^|\.)(lecturer|dosen)\.undip\.ac\.id$/i,
  },
  {
    canonical: "staf",
    rx: /(?:^|\.)(staff|staf)\.undip\.ac\.id$/i,
  },
];

/**
 * Resolve canonical jenis pelapor dari alamat email.
 * Mengembalikan `null` bila email kosong/invalid atau domain tidak
 * cocok dengan tiga pola Undip yang didukung — pada kasus itu user
 * dianggap "umum" dan `profiles.reporter_type_id` tidak diset
 * otomatis (dibiarkan null sampai admin mengaturnya manual).
 */
export function reporterTypeFromEmail(
  email: string | null | undefined,
): CanonicalReporterType | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain) return null;
  for (const { canonical, rx } of PATTERN) {
    if (rx.test(domain)) return canonical;
  }
  return null;
}

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Ambient declarations so file compiles without @types/node in any tsconfig
declare const process: { env: Record<string, string | undefined> }
declare const console: { error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void }

const SSO_SECRET = 'fsm_sso_undip_custom'

// ---------------------------------------------------------------------------
// Email domain → jenis pelapor canonical
//
// MIRROR dari `src/lib/ssoReporterType.ts` (lihat tes unit di
// `src/test/ssoReporterType.test.ts`). Logic disengaja di-duplikat karena
// folder `api/` dan `src/` punya tsconfig terpisah dan tidak saling import.
// Kalau menambah pola, sinkronkan di kedua tempat.
// ---------------------------------------------------------------------------

type CanonicalReporterType = 'mahasiswa' | 'dosen' | 'staf'

const REPORTER_TYPE_LABEL: Record<CanonicalReporterType, string> = {
  mahasiswa: 'Mahasiswa',
  dosen: 'Dosen',
  staf: 'Staf',
}

const REPORTER_PATTERNS: { canonical: CanonicalReporterType; rx: RegExp }[] = [
  { canonical: 'mahasiswa', rx: /(?:^|\.)(students|mahasiswa)\.undip\.ac\.id$/i },
  { canonical: 'dosen',     rx: /(?:^|\.)(lecturer|dosen)\.undip\.ac\.id$/i },
  { canonical: 'staf',      rx: /(?:^|\.)(staff|staf)\.undip\.ac\.id$/i },
]

function reporterTypeFromEmail(email: string | null | undefined): CanonicalReporterType | null {
  if (!email) return null
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return null
  const domain = email.slice(at + 1).toLowerCase().trim()
  if (!domain) return null
  for (const { canonical, rx } of REPORTER_PATTERNS) {
    if (rx.test(domain)) return canonical
  }
  return null
}

/**
 * Pastikan baris di `reporter_types` ada dengan nama canonical yang
 * dimaksud, lalu set `profiles.reporter_type_id` user — tetapi HANYA
 * jika kolom itu masih NULL (artinya admin belum mengaturnya manual).
 *
 * Aman dijalankan idempotent setiap kali user SSO login.
 */
async function syncReporterTypeForUser(
  supabase: SupabaseClient,
  userId: string,
  email: string,
): Promise<void> {
  const canonical = reporterTypeFromEmail(email)
  if (!canonical) {
    // Domain tidak dikenali → jangan sentuh apa-apa (fallback ke "umum"
    // dengan reporter_type_id NULL, kecuali admin set manual).
    return
  }
  const label = REPORTER_TYPE_LABEL[canonical]

  // 1) Find or create reporter type by exact name (case-insensitive).
  const { data: existing, error: findErr } = await supabase
    .from('reporter_types')
    .select('id')
    .ilike('name', label)
    .maybeSingle()
  if (findErr) {
    console.warn('[sso] gagal cari reporter_type:', findErr.message)
    return
  }

  let reporterTypeId = existing?.id as string | undefined
  if (!reporterTypeId) {
    const { data: created, error: insErr } = await supabase
      .from('reporter_types')
      .insert({ name: label, is_active: true })
      .select('id')
      .single()
    if (insErr) {
      // Possible race: parallel SSO request created it first → re-fetch.
      const { data: again } = await supabase
        .from('reporter_types')
        .select('id')
        .ilike('name', label)
        .maybeSingle()
      if (!again) {
        console.warn('[sso] gagal create reporter_type:', insErr.message)
        return
      }
      reporterTypeId = again.id
    } else {
      reporterTypeId = created.id
    }
  }
  if (!reporterTypeId) return

  // 2) Backfill profile.reporter_type_id only when still NULL.
  //    `.is('reporter_type_id', null)` memastikan kita tidak menimpa
  //    pengaturan manual oleh superadmin.
  const { error: updErr } = await supabase
    .from('profiles')
    .update({ reporter_type_id: reporterTypeId })
    .eq('id', userId)
    .is('reporter_type_id', null)
  if (updErr) {
    console.warn('[sso] gagal backfill reporter_type_id:', updErr.message)
  }
}

interface SsoPayload {
  id: string
  username: string
  role: string
  name: string
  iat: number
  exp: number
}

function b64urlToBytes(str: string): Uint8Array<ArrayBuffer> {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(pad)
  const buf = new ArrayBuffer(bin.length)
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function verifyJwt(token: string): Promise<SsoPayload> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT format')

  const [header, payload, signature] = parts

  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SSO_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  const valid = await globalThis.crypto.subtle.verify(
    'HMAC',
    key,
    b64urlToBytes(signature),
    new TextEncoder().encode(`${header}.${payload}`),
  )
  if (!valid) throw new Error('Invalid signature')

  const decoded = JSON.parse(
    new TextDecoder().decode(b64urlToBytes(payload)),
  ) as SsoPayload

  if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired')
  }

  return decoded
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = (req.headers['authorization'] as string | undefined) ?? ''
  if (!token) {
    return res.status(401).json({ status: false, message: 'Token missing' })
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const appUrl =
    process.env.APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5173')

  if (!supabaseUrl || !serviceKey) {
    const missing = [
      !supabaseUrl && 'SUPABASE_URL',
      !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
    ].filter(Boolean).join(', ')
    console.error('[sso] Missing env vars:', missing)
    return res.status(500).json({ status: false, message: 'Server misconfigured', missing })
  }

  let ssoUser: SsoPayload
  try {
    ssoUser = await verifyJwt(token)
  } catch (err: any) {
    const msg = err.message === 'Token expired' ? 'Token expired' : 'Token invalid or expired'
    return res.status(401).json({ status: false, message: msg })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const { username: email, name } = ssoUser

    // Auto-register: kalau profile belum ada, buat user baru. Trigger
    // `handle_new_user` otomatis insert ke profiles + assign role
    // 'pelapor'. (Item #1 PR-B — auto-register via SSO Undip.)
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    let userId: string | undefined = existingProfile?.id

    if (!existingProfile) {
      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: name },
      })
      if (createError) throw createError
      userId = created?.user?.id
    }

    // Auto-assign jenis pelapor berdasarkan domain email Undip.
    // Idempotent — dijalankan setiap login SSO untuk back-fill akun
    // lama yang masih NULL. Tidak menimpa pengaturan manual admin.
    if (userId) {
      try {
        await syncReporterTypeForUser(supabase, userId, email)
      } catch (e) {
        console.warn('[sso] syncReporterTypeForUser non-fatal:', (e as any)?.message ?? e)
      }
    }

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${appUrl}/dashboard` },
    })
    if (linkError) throw linkError

    const callbackUrl = `/sso-redirect?link=${encodeURIComponent(linkData.properties.action_link)}`
    return res.status(200).json({ callback_url: callbackUrl })
  } catch (err: any) {
    const detail = err?.message ?? String(err)
    console.error('[sso] Handler error:', detail)
    return res.status(500).json({ status: false, message: 'Internal server error', detail })
  }
}

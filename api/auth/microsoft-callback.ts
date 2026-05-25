/**
 * /api/auth/microsoft-callback
 *
 * Handler OAuth2 callback dari Microsoft (Azure Entra ID UNDIP).
 * Menerima `code` dari Microsoft, tukar dengan token, ambil profil user,
 * lalu buat/login user di Supabase dan redirect ke /dashboard.
 *
 * Alur:
 *   1. Browser → /login klik tombol → redirect ke Microsoft login UNDIP
 *   2. User login di Microsoft → Microsoft redirect ke /api/auth/microsoft-callback?code=xxx
 *   3. Handler ini tukar code → access_token → dapatkan email+name
 *   4. Buat/lookup user di Supabase auth (via admin.createUser + generateLink)
 *   5. Auto-assign reporter_type dari domain email (PR-B logic)
 *   6. Redirect ke /sso-redirect?link=<supabase_magic_link>
 *
 * Env vars yang dibutuhkan (set di Vercel dashboard):
 *   MICROSOFT_CLIENT_ID      — Client ID dari App Registration di Azure UNDIP
 *   MICROSOFT_CLIENT_SECRET  — Client Secret dari App Registration
 *   MICROSOFT_TENANT_ID      — Tenant ID UNDIP: 03290435-ff74-45d1-aeaa-173677221cf8
 *   SUPABASE_URL             — URL Supabase project
 *   SUPABASE_SERVICE_ROLE_KEY— Service role key Supabase
 *   APP_URL                  — URL publik app: https://fsm-lapor.vercel.app
 */

import { createClient } from '@supabase/supabase-js'

declare const process: { env: Record<string, string | undefined> }
declare const console: { error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void }

// ---------------------------------------------------------------------------
// SSO reporter type mapping (mirror dari src/lib/ssoReporterType.ts)
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
  for (const { canonical, rx } of REPORTER_PATTERNS) {
    if (rx.test(domain)) return canonical
  }
  return null
}

async function syncReporterType(supabase: ReturnType<typeof createClient>, userId: string, email: string) {
  const canonical = reporterTypeFromEmail(email)
  if (!canonical) return
  const label = REPORTER_TYPE_LABEL[canonical]
  const { data: existing } = await supabase
    .from('reporter_types').select('id').ilike('name', label).maybeSingle()
  let rtId = existing?.id as string | undefined
  if (!rtId) {
    const { data: created, error: insErr } = await supabase
      .from('reporter_types').insert({ name: label, is_active: true }).select('id').single()
    if (insErr) {
      const { data: retry } = await supabase
        .from('reporter_types').select('id').ilike('name', label).maybeSingle()
      rtId = retry?.id
    } else {
      rtId = created?.id
    }
  }
  if (!rtId) return
  await supabase.from('profiles')
    .update({ reporter_type_id: rtId })
    .eq('id', userId)
    .is('reporter_type_id', null)
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const clientId     = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  const tenantId     = process.env.MICROSOFT_TENANT_ID ?? '03290435-ff74-45d1-aeaa-173677221cf8'
  const supabaseUrl  = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY
  const appUrl       = process.env.APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5173')

  // Cek env vars wajib
  const missing = [
    !clientId && 'MICROSOFT_CLIENT_ID',
    !clientSecret && 'MICROSOFT_CLIENT_SECRET',
    !supabaseUrl && 'SUPABASE_URL',
    !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean).join(', ')

  if (missing) {
    console.error('[ms-callback] Missing env vars:', missing)
    return res.status(500).json({ error: 'Server misconfigured', missing })
  }

  const code  = req.query.code as string | undefined
  const error = req.query.error as string | undefined

  // User cancel atau error dari Microsoft
  if (error || !code) {
    const desc = (req.query.error_description as string | undefined) ?? error ?? 'Login dibatalkan'
    return res.redirect(`${appUrl}/login?sso_error=${encodeURIComponent(desc)}`)
  }

  try {
    // 1) Tukar authorization code dengan access token
    const redirectUri = `${appUrl}/api/auth/microsoft-callback`
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     clientId!,
          client_secret: clientSecret!,
          code,
          redirect_uri:  redirectUri,
          grant_type:    'authorization_code',
          scope:         'openid profile email User.Read',
        }),
      },
    )
    const tokenData = await tokenRes.json() as Record<string, unknown>
    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`)
    }
    const accessToken = tokenData.access_token as string

    // 2) Ambil profil user dari Microsoft Graph
    const graphRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const graphData = await graphRes.json() as Record<string, unknown>
    if (!graphRes.ok) {
      throw new Error(`Graph API failed: ${JSON.stringify(graphData)}`)
    }

    // Email: pakai mail, fallback ke userPrincipalName
    const email = ((graphData.mail ?? graphData.userPrincipalName) as string | undefined)?.toLowerCase()
    const name  = (graphData.displayName as string | undefined) ?? ''

    if (!email) {
      throw new Error('Tidak dapat membaca email dari akun Microsoft UNDIP')
    }

    // 3) Validasi domain (opsional tapi aman) — hanya @*.undip.ac.id
    if (!email.endsWith('undip.ac.id')) {
      return res.redirect(`${appUrl}/login?sso_error=${encodeURIComponent('Hanya akun email UNDIP yang diperbolehkan')}`)
    }

    // 4) Buat/lookup user di Supabase
    const supabase = createClient(supabaseUrl!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: existingProfile } = await supabase
      .from('profiles').select('id').eq('email', email).maybeSingle()

    let userId: string | undefined = existingProfile?.id

    if (!existingProfile) {
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: name },
      })
      if (createErr) throw createErr
      userId = created?.user?.id
    }

    // 5) Auto-assign reporter type (idempotent)
    if (userId) {
      try { await syncReporterType(supabase, userId, email) } catch (e) {
        console.warn('[ms-callback] syncReporterType non-fatal:', e)
      }
    }

    // 6) Generate magic link → redirect ke /sso-redirect
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${appUrl}/dashboard` },
    })
    if (linkErr) throw linkErr

    const callbackUrl = `/sso-redirect?link=${encodeURIComponent(linkData.properties.action_link)}`
    return res.redirect(`${appUrl}${callbackUrl}`)

  } catch (err: any) {
    console.error('[ms-callback] Error:', err?.message ?? err)
    return res.redirect(`${appUrl}/login?sso_error=${encodeURIComponent(err?.message ?? 'Login SSO gagal')}`)
  }
}

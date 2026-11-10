const SB_URL = import.meta.env.VITE_SUPABASE_URL || "https://ywzgikawjreajymfjahw.supabase.co"
const SB_KEY = import.meta.env.VITE_SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3emdpa2F3anJlYWp5bWZqYWh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NjA2NjMsImV4cCI6MjA5MjIzNjY2M30.TE6qea6Odtvr1M0Zu1j3pweVrOgD0KREdnBdjbXEaLU"

const H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
}

export async function sbGet(table, query = '') {
  const r = await fetch(`${SB_URL}/rest/v1/${table}${query ? '?' + query : ''}`, { headers: H })
  if (!r.ok) throw new Error(`DB read failed (${r.status})`)
  return r.json()
}

export async function sbPost(table, body, upsert = false) {
  const pref = upsert ? 'resolution=merge-duplicates,return=representation' : 'return=representation'
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...H, Prefer: pref },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`DB write failed (${r.status}): ${await r.text()}`)
  return r.json()
}

export async function sbPatch(table, query, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`DB update failed (${r.status})`)
  return r.json()
}

export async function sbDel(table, query) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: H,
  })
  if (!r.ok) throw new Error(`DB delete failed (${r.status})`)
}

export const saveSetting = (key, value) =>
  sbPost('settings', { key, value, updated_at: new Date().toISOString() }, true).catch(() => {})

// ── File storage (Supabase Storage) ──────────────────────────────────────────
// Private buckets: files are read back with the key, never by public URL.
// Paths should not contain patient names (use record ids / chart #).
const enc = (path) => String(path).split('/').map(encodeURIComponent).join('/')

export async function sbUpload(bucket, path, blob, contentType) {
  const r = await fetch(`${SB_URL}/storage/v1/object/${bucket}/${enc(path)}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': contentType || blob.type || 'application/octet-stream', 'x-upsert': 'false' },
    body: blob,
  })
  if (!r.ok) throw new Error(`File upload failed (${r.status}): ${await r.text()}`)
  return path
}

export async function sbDownload(bucket, path) {
  const r = await fetch(`${SB_URL}/storage/v1/object/${bucket}/${enc(path)}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  })
  if (!r.ok) throw new Error(`File download failed (${r.status})`)
  return r.blob()
}

export async function sbRemove(bucket, paths) {
  const r = await fetch(`${SB_URL}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: { ...H },
    body: JSON.stringify({ prefixes: Array.isArray(paths) ? paths : [paths] }),
  })
  if (!r.ok) throw new Error(`File delete failed (${r.status})`)
}

/** Supabase Auth requires an email — we derive one from username (never shown to users). */
const INTERNAL_EMAIL_DOMAIN = 'internal.qalat.local'

export function usernameToInternalEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`
}

export function isInternalAuthEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${INTERNAL_EMAIL_DOMAIN}`)
}

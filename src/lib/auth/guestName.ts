/** Validates and normalises a guest display name.
 *  Returns the trimmed name if valid, null otherwise. */
export function validateGuestName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  if (!name || name.length > 24) return null
  return name
}

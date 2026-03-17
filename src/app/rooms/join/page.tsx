'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { copy } from '@/lib/ui/copy'

const CODE_LENGTH = 7

function getErrorMessage(status: number, serverError: string): string {
  if (status === 404) return copy.errors.roomNotFound
  if (status === 409) return copy.errors.alreadyInRoom
  if (status === 422) {
    if (/full/i.test(serverError)) return copy.errors.roomFull
    if (/started/i.test(serverError)) return copy.errors.roomInProgress
  }
  return copy.errors.generic
}

export default function JoinRoomPage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, CODE_LENGTH)
    setCode(value)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (code.length !== CODE_LENGTH) {
      setError(`Code must be ${CODE_LENGTH} characters`)
      return
    }

    setError(null)
    setLoading(true)

    try {
      const res = await fetch(`/api/rooms/${code}/join`, { method: 'POST' })
      const data = await res.json()

      if (res.status === 409) {
        // Already in room — go straight there
        router.push(`/room/${code}`)
        return
      }

      if (!res.ok) {
        setError(getErrorMessage(res.status, data.error ?? ''))
        return
      }

      router.push(`/room/${data.code}`)
    } catch {
      setError(copy.errors.generic)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <div
        className="w-full max-w-md flex flex-col gap-8 p-10"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Header */}
        <div>
          <Link
            href="/"
            className="text-sm mb-4 inline-block"
            style={{ color: 'var(--color-text-muted)' }}
          >
            ← Back
          </Link>
          <h1
            className="text-3xl font-bold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
          >
            {copy.joinRoom.heading}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Code input */}
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={code}
              onChange={handleCodeChange}
              placeholder={copy.joinRoom.codePlaceholder}
              maxLength={CODE_LENGTH}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="w-full px-4 py-3 text-center text-2xl font-bold tracking-widest"
              style={{
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text)',
                border: `2px solid ${code.length === CODE_LENGTH ? 'var(--color-primary)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-md)',
                fontFamily: 'monospace',
                transition: 'border-color 150ms ease',
              }}
            />
            <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
              {code.length}/{CODE_LENGTH} characters
            </p>
          </div>

          {/* Error */}
          {error && (
            <p
              className="text-sm px-4 py-3"
              style={{
                backgroundColor: 'var(--color-error-light)',
                color: 'var(--color-error)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || code.length !== CODE_LENGTH}
            className="btn-primary w-full py-3 font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? copy.joinRoom.submitting : copy.joinRoom.submitButton}
          </button>
        </form>
      </div>
    </main>
  )
}

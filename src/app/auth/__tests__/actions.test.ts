import { describe, it, expect, vi, beforeEach } from 'vitest'

// redirect() in Next.js throws internally — simulate that so code after redirect() never runs
const redirectMock = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { redirectMock(url); throw new Error('NEXT_REDIRECT') },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { signInAsGuest } from '../actions'
import { createClient } from '@/lib/supabase/server'

function makeSupabaseMock({ signInError = null }: { signInError?: unknown } = {}) {
  return {
    auth: {
      signInAnonymously: vi.fn().mockResolvedValue({ error: signInError }),
    },
  }
}

describe('signInAsGuest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock() as never)
  })

  it('redirects to next path after successful guest sign-in', async () => {
    const formData = new FormData()
    formData.set('displayName', 'Alice')
    formData.set('next', '/room/ABC1234')

    await expect(signInAsGuest(formData)).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/room/ABC1234')
  })

  it('redirects to / when no next param', async () => {
    const formData = new FormData()
    formData.set('displayName', 'Alice')

    await expect(signInAsGuest(formData)).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/')
  })

  it('redirects to / when next does not start with / (open redirect guard)', async () => {
    const formData = new FormData()
    formData.set('displayName', 'Alice')
    formData.set('next', 'https://evil.com')

    await expect(signInAsGuest(formData)).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/')
  })

  it('redirects to /sign-in?error=invalid_name when display name is empty', async () => {
    const formData = new FormData()
    formData.set('displayName', '')
    formData.set('next', '/room/ABC1234')

    await expect(signInAsGuest(formData)).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/sign-in?error=invalid_name')
  })

  it('redirects to /sign-in?error=guest_failed when signInAnonymously returns an error', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseMock({ signInError: { message: 'Anonymous sign-ins are disabled' } }) as never
    )
    const formData = new FormData()
    formData.set('displayName', 'Alice')
    formData.set('next', '/room/ABC1234')

    await expect(signInAsGuest(formData)).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/sign-in?error=guest_failed')
  })
})

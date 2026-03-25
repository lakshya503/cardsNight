// src/app/actions/__tests__/submitFeedback.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isRateLimited,
  filterWithAI,
  buildIssueBody,
  validateSubmission,
} from '../submitFeedback'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: vi.fn().mockResolvedValue({ id: 'email-123' }) },
  })),
}))

vi.mock('@anthropic-ai/sdk', () => {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'valid' }],
  })
  function MockAnthropic() {
    return { messages: { create } }
  }
  return { default: MockAnthropic }
})

import { submitFeedback } from '../submitFeedback'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ── validateSubmission ────────────────────────────────────────────────────────

describe('validateSubmission', () => {
  it('returns error when text is empty', () => {
    expect(validateSubmission('', 'bug', [])).toBe('text_required')
  })

  it('returns error when text is whitespace only', () => {
    expect(validateSubmission('   ', 'bug', [])).toBe('text_required')
  })

  it('returns error when screenshots exceed limit', () => {
    const files = [new File(['a'], 'a.png'), new File(['b'], 'b.png'), new File(['c'], 'c.png')]
    expect(validateSubmission('valid text', 'bug', files)).toBe('too_many_screenshots')
  })

  it('returns error when text exceeds 5000 characters', () => {
    expect(validateSubmission('a'.repeat(5001), 'bug', [])).toBe('text_too_long')
  })

  it('returns error when a screenshot exceeds 2MB', () => {
    const bigFile = new File([new ArrayBuffer(3 * 1024 * 1024)], 'big.png', { type: 'image/png' })
    expect(validateSubmission('valid text', 'bug', [bigFile])).toBe('file_too_large')
  })

  it('returns error when type is invalid', () => {
    expect(validateSubmission('valid text', 'invalid' as never, [])).toBe('invalid_type')
  })

  it('returns null when input is valid', () => {
    expect(validateSubmission('Something broke', 'bug', [])).toBeNull()
  })

  it('returns null with up to 2 screenshots', () => {
    const files = [new File(['a'], 'a.png'), new File(['b'], 'b.png')]
    expect(validateSubmission('Works great', 'suggestion', files)).toBeNull()
  })
})

// ── filterWithAI ──────────────────────────────────────────────────────────────

describe('filterWithAI', () => {
  it('returns "valid" for meaningful feedback and calls correct model', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'valid' }],
    })
    const mockClient = { messages: { create: mockCreate } }

    const result = await filterWithAI('The scoreboard does not update after round 2', mockClient as never)

    expect(result).toBe('valid')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-haiku-4-5-20251001',
      messages: expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('The scoreboard does not update after round 2') }),
      ]),
    }), expect.anything())
  })

  it('returns "garbage" for nonsensical input', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'garbage' }],
    })
    const mockClient = { messages: { create: mockCreate } }

    const result = await filterWithAI('asdfghjkl qwerty 123', mockClient as never)
    expect(result).toBe('garbage')
  })
})

// ── buildIssueBody ────────────────────────────────────────────────────────────

describe('buildIssueBody', () => {
  it('includes all context fields', () => {
    const body = buildIssueBody({
      text: 'Something broke',
      userEmail: 'alice@example.com',
      pageUrl: '/game/abc123',
      userAgent: 'Mozilla/5.0',
      screenSize: '1440x900',
      screenshotUrls: [],
    })

    expect(body).toContain('alice@example.com')
    expect(body).toContain('/game/abc123')
    expect(body).toContain('Something broke')
    expect(body).toContain('1440x900')
  })

  it('embeds screenshot image links when provided', () => {
    const body = buildIssueBody({
      text: 'See screenshot',
      userEmail: 'bob@example.com',
      pageUrl: '/',
      userAgent: 'Mozilla/5.0',
      screenSize: '1280x800',
      screenshotUrls: ['https://example.com/img1.png', 'https://example.com/img2.png'],
    })

    expect(body).toContain('![screenshot-1](https://example.com/img1.png)')
    expect(body).toContain('![screenshot-2](https://example.com/img2.png)')
  })

  it('omits screenshot section when none provided', () => {
    const body = buildIssueBody({
      text: 'No images',
      userEmail: 'c@c.com',
      pageUrl: '/',
      userAgent: 'ua',
      screenSize: '1024x768',
      screenshotUrls: [],
    })

    expect(body).not.toContain('screenshot')
  })
})

// ── isRateLimited ─────────────────────────────────────────────────────────────

describe('isRateLimited', () => {
  it('returns true when user has 5 or more submissions in the last 24h', async () => {
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockResolvedValue({ count: 5, error: null }),
          }),
        }),
      }),
    }

    const result = await isRateLimited('user-123', mockAdmin as never)
    expect(result).toBe(true)
  })

  it('returns false when user has fewer than 5 submissions', async () => {
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockResolvedValue({ count: 2, error: null }),
          }),
        }),
      }),
    }

    const result = await isRateLimited('user-123', mockAdmin as never)
    expect(result).toBe(false)
  })
})

// ── submitFeedback integration ────────────────────────────────────────────────

function makeMockAdmin(overrides: Record<string, unknown> = {}) {
  const insert = vi.fn().mockResolvedValue({ error: null })
  const gte = vi.fn().mockResolvedValue({ count: 0, error: null })
  const eq = vi.fn().mockReturnValue({ gte })
  const select = vi.fn().mockReturnValue({ eq })
  const upload = vi.fn().mockResolvedValue({ error: null })
  const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.url/img.png' } })
  const storageBucket = { upload, createSignedUrl }
  const storage = { from: vi.fn().mockReturnValue(storageBucket) }
  return {
    from: vi.fn().mockReturnValue({ select, insert }),
    storage,
    ...overrides,
  }
}

describe('submitFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(''),
    })
  })

  it('returns success on happy path', async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'user@example.com' } },
        }),
      },
    } as never)
    vi.mocked(createAdminClient).mockReturnValue(makeMockAdmin() as never)

    const formData = new FormData()
    formData.set('text', 'The scoreboard does not update')
    formData.set('type', 'bug')
    formData.set('pageUrl', '/game/abc')
    formData.set('userAgent', 'Mozilla/5.0')
    formData.set('screenSize', '1440x900')

    const result = await submitFeedback(formData)
    expect(result).toEqual({ success: true })
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/issues'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('returns server_error when GitHub API fails, but rate limit is still recorded', async () => {
    const mockAdmin = makeMockAdmin()
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'user@example.com' } },
        }),
      },
    } as never)
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin as never)
    global.fetch = vi.fn().mockResolvedValue({ ok: false, text: vi.fn().mockResolvedValue('Forbidden') })

    const formData = new FormData()
    formData.set('text', 'Something broke')
    formData.set('type', 'bug')
    formData.set('pageUrl', '/')
    formData.set('userAgent', 'ua')
    formData.set('screenSize', '1280x800')

    const result = await submitFeedback(formData)
    expect(result).toEqual({ error: 'server_error' })
    // Rate limit insert should still have been called before the GitHub failure
    expect(mockAdmin.from).toHaveBeenCalledWith('feedback_submissions')
  })

  it('returns unauthenticated when no user', async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as never)

    const formData = new FormData()
    formData.set('text', 'A bug')
    formData.set('type', 'bug')
    formData.set('pageUrl', '/')
    formData.set('userAgent', 'ua')
    formData.set('screenSize', '1280x800')

    const result = await submitFeedback(formData)
    expect(result).toEqual({ error: 'unauthenticated' })
  })
})

// src/app/actions/__tests__/submitFeedback.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isRateLimited,
  filterWithAI,
  buildIssueBody,
  validateSubmission,
} from '../submitFeedback'

// vi.mock calls are hoisted by Vitest — must be at the top level, not inside beforeEach
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() },
  })),
}))

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
  // The top-level vi.mock('@anthropic-ai/sdk') is already hoisted — use vi.mocked() to configure per-test

  it('returns "valid" for meaningful feedback', async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'valid' }],
        }),
      },
    } as never))

    const result = await filterWithAI('The scoreboard does not update after round 2')
    expect(result).toBe('valid')
  })

  it('returns "garbage" for nonsensical input', async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'garbage' }],
        }),
      },
    } as never))

    const result = await filterWithAI('asdfghjkl qwerty 123')
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

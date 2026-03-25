// src/components/__tests__/FeedbackWidget.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FeedbackWidget } from '../FeedbackWidget'

// Mock the server action
vi.mock('@/app/actions/submitFeedback', () => ({
  submitFeedback: vi.fn(),
}))

// Mock the Supabase browser client — default to an authenticated session
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}))

import { submitFeedback } from '@/app/actions/submitFeedback'
import { createClient } from '@/lib/supabase/client'

function mockAuthenticatedSession() {
  vi.mocked(createClient).mockReturnValue({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: 'test-user' } } },
      }),
    },
  } as unknown as ReturnType<typeof createClient>)
}

describe('FeedbackWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')
    mockAuthenticatedSession()
  })

  it('renders a floating trigger button', async () => {
    render(<FeedbackWidget />)
    expect(await screen.findByTestId('feedback-trigger')).toBeInTheDocument()
  })

  it('opens the modal when the trigger is clicked', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(await screen.findByTestId('feedback-trigger'))
    expect(screen.getByTestId('feedback-modal')).toBeInTheDocument()
  })

  it('closes the modal when the close button is clicked', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(await screen.findByTestId('feedback-trigger'))
    await userEvent.click(screen.getByTestId('feedback-close'))
    expect(screen.queryByTestId('feedback-modal')).not.toBeInTheDocument()
  })

  it('disables the submit button when text is empty', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(await screen.findByTestId('feedback-trigger'))
    expect(screen.getByTestId('feedback-submit')).toBeDisabled()
  })

  it('enables the submit button when text is entered', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(await screen.findByTestId('feedback-trigger'))
    await userEvent.type(screen.getByTestId('feedback-text'), 'Something is broken')
    expect(screen.getByTestId('feedback-submit')).not.toBeDisabled()
  })

  it('shows type toggle with bug selected by default', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(await screen.findByTestId('feedback-trigger'))
    expect(screen.getByTestId('feedback-type-bug')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('feedback-type-suggestion')).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows success message after successful submission', async () => {
    vi.mocked(submitFeedback).mockResolvedValue({ success: true })

    render(<FeedbackWidget />)
    await userEvent.click(await screen.findByTestId('feedback-trigger'))
    await userEvent.type(screen.getByTestId('feedback-text'), 'Something broke')
    await userEvent.click(screen.getByTestId('feedback-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('feedback-success')).toHaveTextContent("Thanks! We're working on it.")
    })
  })

  it('shows rate limit error when rate limited', async () => {
    vi.mocked(submitFeedback).mockResolvedValue({ error: 'rate_limited' })

    render(<FeedbackWidget />)
    await userEvent.click(await screen.findByTestId('feedback-trigger'))
    await userEvent.type(screen.getByTestId('feedback-text'), 'Another report')
    await userEvent.click(screen.getByTestId('feedback-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('feedback-error')).toBeInTheDocument()
    })
  })

  it('shows screenshot preview after file is selected', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(await screen.findByTestId('feedback-trigger'))

    const file = new File(['image'], 'screenshot.png', { type: 'image/png' })
    const input = screen.getByTestId('feedback-screenshot-input')
    await userEvent.upload(input, file)

    await waitFor(() => {
      expect(screen.getByTestId('feedback-screenshot-preview-0')).toBeInTheDocument()
    })
  })

  it('does not allow more than 2 screenshots', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(await screen.findByTestId('feedback-trigger'))

    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
      new File(['c'], 'c.png', { type: 'image/png' }),
    ]
    const input = screen.getByTestId('feedback-screenshot-input')
    await userEvent.upload(input, files)

    expect(screen.getAllByTestId(/feedback-screenshot-preview-/)).toHaveLength(2)
  })

  it('shows sign-in prompt when unauthenticated', async () => {
    vi.mocked(submitFeedback).mockResolvedValue({ error: 'unauthenticated' })

    render(<FeedbackWidget />)
    await userEvent.click(await screen.findByTestId('feedback-trigger'))
    await userEvent.type(screen.getByTestId('feedback-text'), 'A bug report')
    await userEvent.click(screen.getByTestId('feedback-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('feedback-error')).toHaveTextContent('Please sign in to send feedback.')
    })
  })

  it('hides the trigger button when not authenticated', async () => {
    vi.mocked(createClient).mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      },
    } as unknown as ReturnType<typeof createClient>)

    render(<FeedbackWidget />)

    // Give the async useEffect time to resolve, then assert trigger is absent
    await waitFor(() => {
      expect(screen.queryByTestId('feedback-trigger')).not.toBeInTheDocument()
    })
  })
})

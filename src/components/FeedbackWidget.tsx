// src/components/FeedbackWidget.tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { submitFeedback } from '@/app/actions/submitFeedback'
import { createClient } from '@/lib/supabase/client'

type FeedbackType = 'bug' | 'suggestion'

interface Screenshot {
  file: File
  preview: string
}

export function FeedbackWidget() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<FeedbackType>('bug')
  const [text, setText] = useState('')
  const [screenshots, setScreenshots] = useState<Screenshot[]>([])
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error' | 'rate_limited' | 'unauthenticated' | 'file_too_large'>('idle')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      setIsAuthenticated(!!data.session)
    })
  }, [])

  function close() {
    setOpen(false)
    setType('bug')
    setText('')
    setScreenshots(prev => {
      prev.forEach(s => URL.revokeObjectURL(s.preview))
      return []
    })
    setStatus('idle')
  }

  const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB

  function addScreenshots(files: File[]) {
    const remaining = 2 - screenshots.length
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE)
    const valid = files.filter(f => f.size <= MAX_FILE_SIZE)
    const toAdd = valid.slice(0, remaining)
    const newScreenshots = toAdd.map(file => ({
      file,
      preview: URL.createObjectURL(file),
    }))
    setScreenshots(prev => [...prev, ...newScreenshots])
    if (oversized.length > 0) {
      setStatus('file_too_large')
    } else {
      setStatus(prev => prev === 'file_too_large' ? 'idle' : prev)
    }
  }

  function removeScreenshot(index: number) {
    setScreenshots(prev => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  async function handleSubmit() {
    setStatus('submitting')

    const formData = new FormData()
    formData.set('text', text)
    formData.set('type', type)
    formData.set('pageUrl', window.location.pathname)
    formData.set('userAgent', navigator.userAgent)
    formData.set('screenSize', `${window.screen.width}x${window.screen.height}`)
    screenshots.forEach(s => formData.append('screenshots', s.file))

    const result = await submitFeedback(formData)

    if ('success' in result) {
      setStatus('success')
    } else if (result.error === 'rate_limited') {
      setStatus('rate_limited')
    } else if (result.error === 'unauthenticated') {
      setStatus('unauthenticated')
    } else {
      setStatus('error')
    }
  }

  return (
    <>
      {/* Floating trigger — only shown when authenticated */}
      {isAuthenticated && (
      <button
        data-testid="feedback-trigger"
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        className="fixed bottom-5 right-5 z-50 flex items-center justify-center w-11 h-11 rounded-full shadow-lg transition-transform hover:scale-105"
        style={{
          backgroundColor: 'var(--color-surface-raised)',
          border: '1px solid var(--color-border-strong)',
          color: 'var(--color-text-muted)',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
      )}

      {/* Modal backdrop + panel */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-end p-4 sm:p-6"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          onClick={e => { if (e.target === e.currentTarget) close() }}
        >
          <div
            data-testid="feedback-modal"
            className="w-full sm:w-96 rounded-xl p-5 space-y-4 shadow-lg"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                Send feedback
              </h2>
              <button
                data-testid="feedback-close"
                onClick={close}
                aria-label="Close"
                className="text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                ✕
              </button>
            </div>

            {status === 'success' ? (
              <p data-testid="feedback-success" className="text-sm py-4 text-center" style={{ color: 'var(--color-success)' }}>
                Thanks! We&apos;re working on it.
              </p>
            ) : (
              <>
                {/* Type toggle */}
                <div className="flex gap-2">
                  {(['bug', 'suggestion'] as FeedbackType[]).map(t => (
                    <button
                      key={t}
                      data-testid={`feedback-type-${t}`}
                      aria-pressed={type === t}
                      onClick={() => setType(t)}
                      className="flex-1 py-1.5 rounded-md text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: type === t ? 'var(--color-primary-light)' : 'var(--color-surface-raised)',
                        color: type === t ? 'var(--color-primary)' : 'var(--color-text-muted)',
                        border: `1px solid ${type === t ? 'var(--color-primary)' : 'var(--color-border)'}`,
                      }}
                    >
                      {t === 'bug' ? '🐛 Bug' : '💡 Suggestion'}
                    </button>
                  ))}
                </div>

                {/* Text area */}
                <textarea
                  data-testid="feedback-text"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={type === 'bug' ? "What's going wrong?" : "What would you improve?"}
                  rows={4}
                  className="w-full resize-none rounded-md px-3 py-2 text-sm outline-none"
                  style={{
                    backgroundColor: 'var(--color-surface-raised)',
                    color: 'var(--color-text)',
                    border: '1px solid var(--color-border)',
                  }}
                />

                {/* Screenshots */}
                <div className="space-y-2">
                  {screenshots.length < 2 && (
                    <>
                      <input
                        ref={fileInputRef}
                        data-testid="feedback-screenshot-input"
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: 'none' }}
                        onChange={e => {
                          if (e.target.files) addScreenshots(Array.from(e.target.files))
                          e.target.value = ''
                        }}
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        + Attach screenshot (optional, up to 2)
                      </button>
                    </>
                  )}
                  {screenshots.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {screenshots.map((s, i) => (
                        <div key={i} data-testid={`feedback-screenshot-preview-${i}`} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.preview} alt={`screenshot ${i + 1}`} className="w-16 h-16 rounded object-cover" />
                          <button
                            onClick={() => removeScreenshot(i)}
                            className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-xs flex items-center justify-center"
                            style={{ backgroundColor: 'var(--color-error)', color: '#fff' }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Error states */}
                {(status === 'error' || status === 'rate_limited' || status === 'unauthenticated' || status === 'file_too_large') && (
                  <p data-testid="feedback-error" className="text-xs" style={{ color: 'var(--color-error)' }}>
                    {status === 'rate_limited'
                      ? "You've sent a lot of feedback recently — try again tomorrow."
                      : status === 'unauthenticated'
                      ? 'Please sign in to send feedback.'
                      : status === 'file_too_large'
                      ? 'One or more files exceed the 2 MB limit and were not attached.'
                      : 'Something went wrong. Please try again.'}
                  </p>
                )}

                {/* Submit */}
                <button
                  data-testid="feedback-submit"
                  onClick={handleSubmit}
                  disabled={!text.trim() || status === 'submitting'}
                  className="w-full py-2 rounded-md text-sm font-semibold disabled:opacity-40 transition-opacity"
                  style={{
                    backgroundColor: 'var(--color-primary)',
                    color: 'var(--color-text-on-primary)',
                  }}
                >
                  {status === 'submitting' ? 'Sending…' : 'Send feedback'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

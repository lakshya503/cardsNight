'use client'

import { useState } from 'react'

interface ToastBannerProps {
  message: string
}

export default function ToastBanner({ message }: ToastBannerProps) {
  const [visible, setVisible] = useState(true)

  if (!visible) return null

  return (
    <div
      role="alert"
      className="w-full flex items-center justify-between gap-4 px-5 py-3 text-sm font-medium"
      style={{
        backgroundColor: 'var(--color-error-light)',
        color: 'var(--color-error)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <span>{message}</span>
      <button
        onClick={() => setVisible(false)}
        aria-label="Dismiss"
        className="cursor-pointer text-lg leading-none flex-shrink-0"
        style={{ color: 'var(--color-error)' }}
      >
        ×
      </button>
    </div>
  )
}

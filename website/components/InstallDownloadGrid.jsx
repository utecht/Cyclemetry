'use client'

import { useEffect, useState } from 'react'

const DOWNLOADS = [
  {
    id: 'macos',
    href: '/install/macos',
    title: 'Download for Mac',
    subtitle: 'Apple Silicon and Intel',
    icon: (
      <svg
        className="install-download-icon"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M17.05 12.04c-.03-2.93 2.39-4.34 2.5-4.41-1.36-1.99-3.49-2.26-4.24-2.29-1.8-.18-3.51 1.06-4.43 1.06-.92 0-2.32-1.03-3.82-1-1.96.03-3.78 1.14-4.78 2.9-2.06 3.57-.52 8.84 1.46 11.74.97 1.42 2.13 3.01 3.64 2.96 1.47-.06 2.02-.94 3.8-.94 1.77 0 2.27.94 3.82.91 1.58-.03 2.58-1.45 3.55-2.88 1.12-1.65 1.58-3.27 1.6-3.36-.04-.02-3.07-1.18-3.1-4.69zm-3.05-8.6C14.83 2.42 15.4 1 15.23 0c-1.21.05-2.69.81-3.55 1.81-.77.88-1.45 2.34-1.27 3.31 1.36.1 2.74-.69 3.59-1.68z" />
      </svg>
    ),
  },
  {
    id: 'windows',
    href: '/install/windows',
    title: 'Download for Windows',
    subtitle: 'Setup executable',
    icon: (
      <svg
        className="install-download-icon"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.851" />
      </svg>
    ),
  },
  {
    id: 'linux',
    href: '/install/linux',
    title: 'Download for Linux',
    subtitle: 'Debian package',
    icon: (
      <svg
        className="install-download-icon"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M6.5 3.75h7.25L18.5 8.5v11.75H6.5V3.75Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M13.5 4v5h5"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M9 14.75h6M9 17.25h4"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      </svg>
    ),
  },
]

function detectPlatform() {
  const platform = (
    navigator.userAgentData?.platform ||
    navigator.platform ||
    ''
  ).toLowerCase()
  const userAgent = navigator.userAgent.toLowerCase()
  const source = `${platform} ${userAgent}`

  if (source.includes('mac') || source.includes('iphone') || source.includes('ipad')) {
    return 'macos'
  }
  if (source.includes('win')) return 'windows'
  if (source.includes('linux') || source.includes('x11')) return 'linux'

  return null
}

export default function InstallDownloadGrid() {
  const [recommended, setRecommended] = useState(null)

  useEffect(() => {
    setRecommended(detectPlatform())
  }, [])

  return (
    <div className="install-download-grid">
      {DOWNLOADS.map((item) => {
        const isRecommended = item.id === recommended

        return (
          <a
            key={item.id}
            className={`install-download-button${isRecommended ? ' install-download-button-recommended' : ''}`}
            href={item.href}
          >
            <span className="install-download-icon-shell" aria-hidden="true">
              {item.icon}
            </span>
            <span className="install-download-copy">
              <span className="install-download-title-row">
                <span className="install-download-title">{item.title}</span>
                {isRecommended ? (
                  <span className="install-download-badge">Recommended</span>
                ) : null}
              </span>
              <span className="install-download-subtitle">{item.subtitle}</span>
            </span>
            <svg
              className="install-download-arrow"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4.5 10h10m0 0-4-4m4 4-4 4"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
          </a>
        )
      })}
    </div>
  )
}

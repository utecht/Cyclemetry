'use client'

import { useEffect, useState, useCallback } from 'react'
import fund from '../content/fund.json'

const GOAL = fund.goalPerYear
const START_YEAR = fund.startYear
const PRESETS = [5, 10, 25]

const usd = (n) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)

export function Fund() {
  const [total, setTotal] = useState(null)
  const [selected, setSelected] = useState(10)
  const [customValue, setCustomValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkoutError, setCheckoutError] = useState(null)
  const [donated, setDonated] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('donated') === '1') {
      setDonated(true)
      const clean = new URL(window.location.href)
      clean.searchParams.delete('donated')
      window.history.replaceState({}, '', clean.toString())
    }

    fetch('/api/donate/total')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setTotal(data))
      .catch(() => {})
  }, [])

  const raised = total?.raised ?? 0
  const supporters = total?.supporters ?? 0
  const isLoaded = total !== null

  const fundedYears = Math.floor(raised / GOAL)
  const currentYear = START_YEAR + fundedYears
  const inCurrent = raised - fundedYears * GOAL
  const pct = isLoaded ? Math.min(100, Math.round((inCurrent / GOAL) * 100)) : 0
  const remaining = GOAL - inCurrent
  const markerPct = Math.min(96, pct)
  const fundedList = Array.from({ length: fundedYears }, (_, i) => START_YEAR + i)

  const isCustomMode = selected === null
  const amount = isCustomMode ? Number(customValue) : selected
  const amountCents = Math.round(amount * 100)
  const amountValid = Number.isFinite(amount) && amount >= 1 && amount <= 1000

  const handlePreset = (val) => {
    setSelected(val)
    setCustomValue('')
    setCheckoutError(null)
  }

  const handleCustomFocus = () => {
    setSelected(null)
    setCheckoutError(null)
  }

  const handleDonate = useCallback(async () => {
    if (!amountValid || loading) return
    setLoading(true)
    setCheckoutError(null)
    try {
      const res = await fetch('/api/donate/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        setCheckoutError(data.error ?? 'Something went wrong.')
        setLoading(false)
      }
    } catch {
      setCheckoutError('Could not connect to checkout.')
      setLoading(false)
    }
  }, [amountCents, amountValid, loading])

  return (
    <div className="showcase-page showcase-page-narrow">
      {donated && (
        <div className="fund-thanks">
          <span aria-hidden="true">🎉</span>
          <div>
            <strong>Thank you!</strong> Your support helps keep Cyclemetry open
            and installable.
          </div>
        </div>
      )}

      <div className="showcase-hero">
        <div className="showcase-hero-kicker">SUPPORT</div>
        <h1 className="showcase-hero-title">Retire the Terminal step</h1>
        <p className="showcase-hero-desc">
          Cyclemetry is free and open source. The one papercut on macOS is the{' '}
          <code className="fund-code">xattr -cr</code> command you run once
          after installing. It exists because notarizing the app with Apple
          costs <strong>${GOAL}/year</strong>. Chip in and the build gets
          signed — so everyone can just open it.
        </p>
      </div>

      <div className="fund-card">
        <div className="fund-card-head">
          <div className="fund-amount">
            <span
              className={`fund-amount-raised${!isLoaded ? ' fund-skeleton' : ''}`}
            >
              {isLoaded ? usd(raised) : '$—'}
            </span>
            <span className="fund-amount-goal">
              raised toward {currentYear}&apos;s {usd(GOAL)}
            </span>
          </div>
          <div className={`fund-pct${!isLoaded ? ' fund-skeleton' : ''}`}>
            {isLoaded ? `${pct}%` : '—%'}
          </div>
        </div>

        <div
          className="fund-track"
          style={{
            '--fund-fill': `${pct}%`,
            '--fund-marker': `${markerPct}%`,
          }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${pct}% funded toward ${currentYear}'s Apple Developer Program fee`}
        >
          <div className="fund-track-fill" />
          <div className="fund-cyclist" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="5.5" cy="17.5" r="3.5" />
              <circle cx="18.5" cy="17.5" r="3.5" />
              <path d="M5.5 17.5 9 9l4.5 1.5 2 4" />
              <path d="M9 9h3.5" />
              <circle cx="15.5" cy="5" r="1.4" />
              <path d="M18.5 17.5 16 8.5" />
            </svg>
          </div>
          <div className="fund-flag" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 21V4" />
              <path d="M5 4h11l-2 3 2 3H5" />
            </svg>
          </div>
        </div>

        <div className="fund-meta">
          {pct >= 100 ? (
            <span className="fund-meta-funded">
              🎉 {currentYear} is funded — the macOS build can be signed.
            </span>
          ) : isLoaded ? (
            <span>
              <strong>{usd(remaining)}</strong> to go.{' '}
              {supporters > 0
                ? `${supporters} ${supporters === 1 ? 'cyclist has' : 'cyclists have'} chipped in.`
                : 'Be the first to chip in.'}
            </span>
          ) : (
            <span className="fund-skeleton fund-skeleton-meta">Loading…</span>
          )}
        </div>

        <div className="fund-divider" />

        <div className="fund-presets">
          {PRESETS.map((val) => (
            <button
              key={val}
              type="button"
              className={`fund-preset${selected === val ? ' fund-preset-active' : ''}`}
              onClick={() => handlePreset(val)}
            >
              {usd(val)}
            </button>
          ))}
          <div
            className={`fund-custom-wrap${isCustomMode ? ' fund-custom-active' : ''}`}
          >
            <span className="fund-custom-symbol">$</span>
            <input
              type="number"
              inputMode="decimal"
              min="1"
              max="1000"
              placeholder="Other"
              className="fund-custom-input"
              value={customValue}
              onFocus={handleCustomFocus}
              onChange={(e) => setCustomValue(e.target.value)}
              aria-label="Custom donation amount in dollars"
            />
          </div>
        </div>

        {checkoutError ? (
          <p className="fund-error">{checkoutError}</p>
        ) : null}

        <button
          type="button"
          className={`showcase-button showcase-button-primary fund-cta${!amountValid || loading ? ' fund-cta-disabled' : ''}`}
          onClick={handleDonate}
          disabled={!amountValid || loading}
        >
          {loading ? (
            'Redirecting to checkout…'
          ) : (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
              </svg>
              Donate {amountValid ? usd(amount) : ''}
            </>
          )}
        </button>

        {fundedYears > 0 ? (
          <div className="fund-years">
            <span className="fund-years-label">Funded</span>
            {fundedList.map((year) => (
              <span key={year} className="fund-year-chip">
                {year} ✓
              </span>
            ))}
            <span className="fund-year-chip fund-year-chip-active">
              {currentYear}
            </span>
          </div>
        ) : null}
      </div>

      <div className="showcase-content fund-explainer">
        <h2>What your donation unlocks</h2>
        <p>
          A signed, notarized build means installing Cyclemetry is drag, drop,
          open. No Terminal. No <code className="fund-code">xattr -cr</code>.
          No &ldquo;unidentified developer&rdquo; warning to click past.
        </p>
        <h2>Where the money goes</h2>
        <p>
          Straight to the {usd(GOAL)}/year Apple Developer Program membership —
          nothing else. Anything raised past this year&apos;s goal rolls forward
          to keep the signature alive next year.
        </p>
      </div>
    </div>
  )
}

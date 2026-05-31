"use client";

import { useEffect, useState, useCallback } from "react";
import fund from "../content/fund.json";

const GOAL = fund.goalPerYear;
const START_YEAR = fund.startYear;
const PRESETS = [5, 10, 25];

const usd = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

export function Fund() {
  const [total, setTotal] = useState(null);
  const [selected, setSelected] = useState(5);
  const [customValue, setCustomValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [donated, setDonated] = useState(false);
  const [donatedAmount, setDonatedAmount] = useState(null);
  const [animationDone, setAnimationDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("donated") === "1") {
      setDonated(true);
      const amountParam = params.get("amount");
      if (amountParam && Number.isFinite(Number(amountParam))) {
        setDonatedAmount(Math.round(Number(amountParam)) / 100);
      }
      const clean = new URL(window.location.href);
      clean.searchParams.delete("donated");
      clean.searchParams.delete("amount");
      window.history.replaceState({}, "", clean.toString());
    }

    fetch("/api/donate/total")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setTotal(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setAnimationDone(true), 1100);
    return () => clearTimeout(t);
  }, []);

  const raised = total?.raised ?? 0;
  const supporters = total?.supporters ?? 0;
  const isLoaded = total !== null;

  const fundedYears = Math.floor(raised / GOAL);
  const currentYear = START_YEAR + fundedYears;
  const inCurrent = raised - fundedYears * GOAL;
  const pct = isLoaded
    ? Math.min(100, Math.round((inCurrent / GOAL) * 100))
    : 0;
  const remaining = GOAL - inCurrent;
  const markerPct = Math.min(96, pct);
  const fundedList = Array.from(
    { length: fundedYears },
    (_, i) => START_YEAR + i,
  );

  const isCustomMode = selected === null;
  const amount = isCustomMode ? Number(customValue) : selected;
  const amountCents = Math.round(amount * 100);
  const amountValid = Number.isFinite(amount) && amount >= 1 && amount <= 1000;

  // Preview bar
  const previewAmount = amountValid ? amount : 0;
  const previewInCurrent = Math.min(GOAL, inCurrent + previewAmount);
  const previewPct = isLoaded
    ? Math.min(100, Math.round((previewInCurrent / GOAL) * 100))
    : pct;
  const showPreview =
    isLoaded && previewAmount > 0 && previewInCurrent > inCurrent;
  const displayMarkerPct = Math.min(96, showPreview ? previewPct : markerPct);

  // Thank-you donation animation
  const donorPct = donatedAmount
    ? Math.min(pct, Math.round((donatedAmount / GOAL) * 100))
    : 0;
  const beforePct = Math.max(0, pct - donorPct);
  const showDonationAnim = donated && donatedAmount !== null && isLoaded;

  const handlePreset = (val) => {
    setSelected(val);
    setCustomValue("");
    setCheckoutError(null);
  };

  const handleCustomFocus = () => {
    setSelected(null);
    setCheckoutError(null);
  };

  const handleDonate = useCallback(async () => {
    if (!amountValid || loading) return;
    setLoading(true);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/donate/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setCheckoutError(data.error ?? "Something went wrong.");
        setLoading(false);
      }
    } catch {
      setCheckoutError("Could not connect to checkout.");
      setLoading(false);
    }
  }, [amountCents, amountValid, loading]);

  return (
    <div className="showcase-page showcase-page-narrow">
      {donated && (
        <div className="fund-thanks">
          <span className="fund-thanks-emoji" aria-hidden="true">
            🎉
          </span>
          <div>
            <strong>
              Thank you
              {donatedAmount ? ` for your ${usd(donatedAmount)} donation` : ""}!
            </strong>{" "}
            Your support helps keep Cyclemetry open and free to install.
          </div>
        </div>
      )}

      <div className="showcase-hero">
        <div className="showcase-hero-kicker">SUPPORT</div>
        <h1 className="showcase-hero-title">
          To hell with the sketchy install
        </h1>
        <p className="showcase-hero-desc">
          Cyclemetry is free and open source. Signing and notarizing the macOS
          app requires an Apple Developer membership, which costs $99/year.
          Reaching this goal removes the need for Terminal commands and security
          workarounds, making installation seamless for everyone.
        </p>
      </div>

      <div className="fund-card">
        <div className="fund-card-head">
          <div className="fund-amount">
            <span
              className={`fund-amount-raised${!isLoaded ? " fund-skeleton" : ""}`}
            >
              {isLoaded ? usd(raised) : "$—"}
            </span>
            <span className="fund-amount-goal">
              raised toward this year&apos;s {usd(GOAL)}
            </span>
          </div>
          <div className={`fund-pct${!isLoaded ? " fund-skeleton" : ""}`}>
            {isLoaded ? `${pct}%` : "—%"}
          </div>
        </div>

        <div
          className="fund-track"
          style={{
            "--fund-fill": showDonationAnim ? `${beforePct}%` : `${pct}%`,
            "--fund-marker": `${displayMarkerPct}%`,
            "--fund-preview": `${previewPct}%`,
            "--fund-before": `${beforePct}%`,
            "--fund-donation-width": `${donorPct}%`,
          }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${pct}% funded toward this year's Apple Developer Program fee`}
        >
          <div className="fund-track-fill" />
          {showDonationAnim && <div className="fund-track-donation" />}
          {showPreview && !showDonationAnim && (
            <div className="fund-track-preview" />
          )}
          <div
            className={`fund-cyclist${animationDone ? " fund-cyclist-live" : ""}`}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="5" cy="17" r="4" />
              <circle cx="19" cy="17" r="4" />
              <path d="M5 17L12 17L9.5 10Z" />
              <path d="M9.5 10L16 10L12 17" />
              <path d="M16 10L19 17" />
              <path d="M8 9.5L11 9.5" />
              <path d="M16 9L18.5 8.5" />
              <circle cx="13.5" cy="4.5" r="1.4" />
              <path d="M10.5 9.5L13 6.5L17 8.5" />
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
          {showPreview && isLoaded ? (
            <span className="fund-meta-preview">
              Your <strong>{usd(amount)}</strong> would bring this to{" "}
              <strong>{previewPct}%</strong>
              {previewPct >= 100 ? " — fully funding this year's goal 🎉" : ""}
            </span>
          ) : pct >= 100 ? (
            <span className="fund-meta-funded">
              🎉 {currentYear} is funded — the macOS build can be signed.
            </span>
          ) : isLoaded ? (
            <span>
              <strong>{usd(remaining)}</strong> to go.{" "}
              {supporters > 0
                ? `${supporters} ${supporters === 1 ? "cyclist has" : "cyclists have"} chipped in.`
                : "Be the first to chip in."}
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
              className={`fund-preset${selected === val ? " fund-preset-active" : ""}`}
              onClick={() => handlePreset(val)}
            >
              {usd(val)}
            </button>
          ))}
          {isLoaded && remaining > 0 && !PRESETS.includes(remaining) && (
            <button
              type="button"
              className={`fund-preset fund-preset-goal${selected === remaining ? " fund-preset-active" : ""}`}
              onClick={() => handlePreset(remaining)}
            >
              hit the goal
            </button>
          )}
          <div
            className={`fund-custom-wrap${isCustomMode ? " fund-custom-active" : ""}`}
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

        {checkoutError ? <p className="fund-error">{checkoutError}</p> : null}

        <button
          type="button"
          className={`showcase-button showcase-button-primary fund-cta${!amountValid || loading ? " fund-cta-disabled" : ""}`}
          onClick={handleDonate}
          disabled={!amountValid || loading}
        >
          {loading ? (
            "Redirecting to checkout…"
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
                className="fund-heart"
              >
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
              </svg>
              Donate {amountValid ? usd(amount) : ""}
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
          open. No Terminal. No <code className="fund-code">xattr -cr</code>. No
          &ldquo;unidentified developer&rdquo; warning to click past.
        </p>
        <h2>Where the money goes</h2>
        <p>
          Straight to the {usd(GOAL)}/year Apple Developer Program membership.
          Anything raised past this year&apos;s goal rolls forward to keep the
          signature alive.
        </p>
      </div>
    </div>
  );
}

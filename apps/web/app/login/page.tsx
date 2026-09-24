"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { IconArrowLeft, IconHome, IconShield } from "@/components/Icons";
import { api, ApiError, saveSession, Session } from "@/lib/api";

// Demo-only helper (docker-compose sets these): one-click fill for the two
// seeded demo accounts. The fixed code only works for those two numbers, and
// only when the API is started with DEMO_STATIC_OTP set (never in production).
const SHOW_DEMO = process.env.NEXT_PUBLIC_SHOW_DEMO_LOGINS === "true";
const DEMO_OTP = process.env.NEXT_PUBLIC_DEMO_OTP ?? "123456";
const DEMO_ACCOUNTS = [
  { phone: "+237600000001", name: "Admin & landlord", note: "Owns the sample listings" },
  { phone: "+237600000002", name: "Demo tenant", note: "Has a tenancy and one interest" },
];

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const rawNext = search.get("next") ?? "";
  // Only ever follow same-site relative paths (guards against open redirects).
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";
  const cameFromInterest = search.get("reason") === "interest";

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("+237");
  const [challengeId, setChallengeId] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isDemoPhone = SHOW_DEMO && DEMO_ACCOUNTS.some((a) => a.phone === phone.trim());

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ challenge_id: string; expires_in_seconds: number }>("/auth/otp/request", {
        method: "POST",
        body: { phone_number: phone.trim(), purpose: "login" },
        auth: false,
      });
      setChallengeId(res.challenge_id);
      setOtp(isDemoPhone ? DEMO_OTP : "");
      setStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not request a code. Is the API running?");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const session = await api<Session>("/auth/otp/verify", {
        method: "POST",
        body: { challenge_id: challengeId, otp },
        auth: false,
      });
      saveSession(session);
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed.");
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <aside className="auth-art">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <IconHome size={19} />
          </span>
          Rental Platform
        </Link>
        <div>
          <h2>Homes and offices across Cameroon, one tap away.</h2>
          <p>Sign in with your phone number — no password to remember.</p>
        </div>
        <span style={{ fontSize: 13, opacity: 0.75 }}>Photos: Unsplash</span>
      </aside>

      <main className="auth-panel">
        <div className="auth-box">
          <Link href="/" className="btn btn-ghost" style={{ padding: "6px 10px", marginLeft: -10, marginBottom: 18 }}>
            <IconArrowLeft size={16} /> Back to listings
          </Link>
          <h1>{step === "phone" ? "Welcome back" : "Enter your code"}</h1>
          <p className="muted" style={{ fontSize: 15, margin: "0 0 22px" }}>
            {step === "phone"
              ? cameFromInterest
                ? "Sign in to send your interest — we’ll pick up right where you left off."
                : "Sign in or create an account with your phone number."
              : `We sent a 6-digit code to ${phone}.`}
          </p>

          {error && <div className="error">{error}</div>}

          {step === "phone" ? (
            <form onSubmit={requestOtp}>
              <div className="field">
                <label htmlFor="phone">Phone number</label>
                <input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+237 6XX XXX XXX"
                  required
                  autoFocus
                />
              </div>
              <button type="submit" className="btn-lg btn-block" disabled={loading}>
                {loading ? "Sending…" : "Send code"}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyOtp}>
              <div className="field">
                <label htmlFor="otp">6-digit code</label>
                <input
                  id="otp"
                  className="otp-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="······"
                  maxLength={6}
                  required
                  autoFocus
                />
              </div>
              {!isDemoPhone && (
                <p className="muted" style={{ marginTop: 0 }}>
                  Dev mode: SMS is a console stub — find the code with <code>docker compose logs api</code>.
                </p>
              )}
              <button type="submit" className="btn-lg btn-block" disabled={loading || otp.length !== 6}>
                {loading ? "Verifying…" : "Verify & continue"}
              </button>
              <button
                type="button"
                className="btn-ghost btn-block"
                style={{ marginTop: 8 }}
                onClick={() => {
                  setStep("phone");
                  setError(null);
                }}
              >
                Use a different number
              </button>
            </form>
          )}

          {SHOW_DEMO && step === "phone" && (
            <div className="demo-box">
              <h4>
                <IconShield size={13} /> Demo accounts
              </h4>
              {DEMO_ACCOUNTS.map((a) => (
                <div key={a.phone} className="demo-row">
                  <div>
                    <strong>{a.name}</strong>
                    <code>{a.phone}</code> · <span className="muted">{a.note}</span>
                  </div>
                  <button type="button" className="secondary" onClick={() => setPhone(a.phone)}>
                    Use
                  </button>
                </div>
              ))}
              <p className="muted" style={{ margin: "10px 0 0" }}>
                One-time code for both: <strong>{DEMO_OTP}</strong> (filled in for you).
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary on a statically prerendered page.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

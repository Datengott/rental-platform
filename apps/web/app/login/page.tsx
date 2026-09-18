"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, saveSession, Session } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("+237");
  const [challengeId, setChallengeId] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ challenge_id: string; expires_in_seconds: number }>("/auth/otp/request", {
        method: "POST",
        body: { phone_number: phone, purpose: "login" },
        auth: false,
      });
      setChallengeId(res.challenge_id);
      setStep("otp");
      // Every gateway in this demo is a dev-only console stub — the OTP
      // never reaches a real phone. Surface it in the UI instead of asking
      // stakeholders to tail docker logs mid-demo.
      setDevOtpHint("Dev mode: check `docker compose logs api` for the SMS stub with your code.");
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
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <h1>Rental Platform</h1>
      <p className="muted">Landlord + tenant demo — sign in with your phone number.</p>

      <div className="card">
        {error && <div className="error">{error}</div>}
        {devOtpHint && step === "otp" && <div className="success-box">{devOtpHint}</div>}

        {step === "phone" ? (
          <form onSubmit={requestOtp}>
            <div className="field">
              <label htmlFor="phone">Phone number</label>
              <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+237670000000" required />
            </div>
            <button type="submit" disabled={loading}>
              {loading ? "Sending…" : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp}>
            <div className="field">
              <label htmlFor="otp">6-digit code</label>
              <input
                id="otp"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="123456"
                maxLength={6}
                required
                autoFocus
              />
            </div>
            <div className="row">
              <button type="submit" disabled={loading}>
                {loading ? "Verifying…" : "Verify & continue"}
              </button>
              <button type="button" className="secondary" onClick={() => setStep("phone")}>
                Use a different number
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { api, ApiError, loadSession, Session } from "@/lib/api";
import { AppNotification } from "@/lib/types";

function describeNotification(n: AppNotification): string {
  const p = n.payload ?? {};
  switch (n.event_type) {
    case "tenancy.notice_given":
      return `Termination notice issued for ${p.unitLabel ?? "your unit"} — effective ${p.effectiveDate}.`;
    case "payment.confirmed":
      return `Rent payment confirmed for ${p.unitLabel ?? "your unit"} — covered through ${p.periodEnd}.`;
    case "payment.failed":
      return `A rent payment for ${p.unitLabel ?? "your unit"} failed: ${p.reason}.`;
    case "rent_expiry.first_reminder_due":
    case "rent_expiry.second_reminder_due":
    case "rent_expiry.due_today":
      return `Rent reminder — ${p.tenantName ?? "tenant"} at ${p.unitLabel ?? "unit"}, due ${p.paidThroughDate}.`;
    case "rent_expiry.overdue":
      return `Rent overdue — ${p.tenantName ?? "tenant"} at ${p.unitLabel ?? "unit"} since ${p.paidThroughDate}.`;
    case "visit_request.created":
      return `New visit request for ${p.unitLabel ?? "a unit"} from ${p.tenantName ?? "a tenant"}.`;
    case "visit_request.responded":
      return `Your visit request was updated: ${p.visitAction}.`;
    case "complaint.created":
      return `New complaint (${p.complaintCategory}) for ${p.unitLabel ?? "a unit"} from ${p.tenantName ?? "a tenant"}.`;
    case "complaint.status_changed":
      return `Your complaint for ${p.unitLabel ?? "a unit"} is now: ${p.complaintStatus}.`;
    default:
      return n.event_type;
  }
}

export default function DashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ results: AppNotification[] }>("/users/me/notifications");
      setNotifications(res.results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    // One-time client-side session hydration on mount — there's no other
    // lifecycle hook for reading localStorage before the first paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(s);
    void load();
  }, [router]);

  async function markRead(id: string) {
    try {
      await api(`/users/me/notifications/${id}/read`, { method: "PATCH" });
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    } catch {
      // best-effort — a demo doesn't need a retry UI for this
    }
  }

  if (!session) return null;

  return (
    <>
      <NavBar />
      <div className="page">
        <h1>Welcome</h1>
        <p className="muted">
          Signed in as <strong>{session.user.phone_number}</strong> — roles: {session.user.roles.join(", ") || "none yet"}, KYC:{" "}
          {session.user.kyc_tier}
        </p>

        <div className="grid-2">
          <Link href="/dashboard/landlord" className="card" style={{ textDecoration: "none", display: "block" }}>
            <h2>🏢 Landlord tools</h2>
            <p className="muted">List properties, manage tenancies, review visit requests and complaints.</p>
          </Link>
          <Link href="/dashboard/tenant" className="card" style={{ textDecoration: "none", display: "block" }}>
            <h2>🔑 Tenant tools</h2>
            <p className="muted">Browse units, view your tenancy, pay rent, file complaints.</p>
          </Link>
        </div>

        <div className="card">
          <h2>Notifications</h2>
          {error && <div className="error">{error}</div>}
          {loading ? (
            <p className="muted">Loading…</p>
          ) : notifications.length === 0 ? (
            <p className="muted">No notifications yet — actions elsewhere in the app will show up here.</p>
          ) : (
            <ul className="list">
              {notifications.map((n) => (
                <li key={n.id} className="list-item" style={{ opacity: n.read_at ? 0.6 : 1 }}>
                  <div>
                    <div>{describeNotification(n)}</div>
                    <div className="muted">{new Date(n.created_at).toLocaleString()}</div>
                  </div>
                  {!n.read_at && (
                    <button className="secondary" onClick={() => markRead(n.id)}>
                      Mark read
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

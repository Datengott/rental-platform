import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError, loadSession } from "./api";
import type { MyInterest } from "./types";

const PENDING_KEY = "rental_platform_pending_interest";

// "I'm interested" for the public listing pages. A signed-out visitor is
// sent to sign in first, and the click is remembered (sessionStorage) so the
// interest is sent automatically when they land back on the listing —
// they don't have to find the button and click it a second time.
export function useInterest(notify: (kind: "success" | "error", text: string) => void) {
  const router = useRouter();
  const pathname = usePathname();
  const [interested, setInterested] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const send = useCallback(
    async (unitId: string) => {
      setBusyId(unitId);
      try {
        await api(`/units/${unitId}/interest`, { method: "POST" });
        setInterested((prev) => new Set(prev).add(unitId));
        notify("success", "Interest sent — the landlord has been notified.");
      } catch (err) {
        notify("error", err instanceof ApiError ? err.message : "Could not send your interest.");
      } finally {
        setBusyId(null);
      }
    },
    [notify],
  );

  useEffect(() => {
    if (!loadSession()) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<{ results: MyInterest[] }>("/tenants/me/interests");
        if (cancelled) return;
        setInterested(new Set(res.results.map((i) => i.unit_id)));
      } catch {
        // Marking cards as "Interested" is a nicety; the listings still work without it.
      }
      if (cancelled) return;
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (!raw) return;
      sessionStorage.removeItem(PENDING_KEY);
      try {
        const { unitId } = JSON.parse(raw) as { unitId?: string };
        if (unitId) await send(unitId);
      } catch {
        // malformed leftover — ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [send]);

  const express = useCallback(
    async (unitId: string) => {
      if (!loadSession()) {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({ unitId }));
        router.push(`/login?next=${encodeURIComponent(pathname)}&reason=interest`);
        return;
      }
      await send(unitId);
    },
    [router, pathname, send],
  );

  return { interested, busyId, express };
}

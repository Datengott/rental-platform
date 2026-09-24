"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ChangeList from "@/components/ChangeList";
import { api, ApiError, loadSession } from "@/lib/api";
import type { ListingChange } from "@/lib/types";

// Admin audit view of every landlord edit to a property or unit, with who made
// it. The filter that matters is "made while a tenant was living there".
export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [changes, setChanges] = useState<ListingChange[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [occupiedOnly, setOccupiedOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (opts: { occupiedOnly: boolean; cursor?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (opts.occupiedOnly) params.set("while_occupied", "true");
      if (opts.cursor) params.set("cursor", opts.cursor);
      const res = await api<{ results: ListingChange[]; next_cursor: string | null }>(
        `/admin/listing-changes?${params.toString()}`,
      );
      setChanges((prev) => (opts.cursor ? [...prev, ...res.results] : res.results));
      setNextCursor(res.next_cursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the change log.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const session = loadSession();
    if (!session) {
      router.replace("/login?next=/dashboard/admin");
      return;
    }
    if (!session.user.roles.includes("admin")) {
      router.replace("/dashboard");
      return;
    }
    // Page gating on mount from the stored session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
    void load({ occupiedOnly });
    // Re-load only when the filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, occupiedOnly]);

  if (!ready) return null;

  return (
    <div className="page">
      <h1>Listing change log</h1>
      <p className="muted">
        Every edit landlords make to their properties and units, append-only. Use the filter to see just the edits
        made after a tenant had moved in.
      </p>

      <div className="card">
        <label className="chip" style={{ display: "inline-flex" }}>
          <input type="checkbox" checked={occupiedOnly} onChange={(e) => setOccupiedOnly(e.target.checked)} />
          Only changes made while a tenant lived there
        </label>
        {error && <div className="error">{error}</div>}
        <ChangeList
          changes={changes}
          showActor
          emptyText={loading ? "Loading…" : occupiedOnly ? "No edits have been made while a tenant was living there." : "No edits recorded yet."}
        />
        {nextCursor && (
          <button className="secondary" style={{ marginTop: 14 }} disabled={loading} onClick={() => void load({ occupiedOnly, cursor: nextCursor })}>
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}

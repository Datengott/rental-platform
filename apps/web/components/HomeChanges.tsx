"use client";

import { useEffect, useState } from "react";
import ChangeList from "@/components/ChangeList";
import { api } from "@/lib/api";
import type { ListingChange } from "@/lib/types";

// "Changes to your home" — what the landlord edited (unit and property) since
// this tenancy began. Shown to the tenant so a change after move-in is never a
// surprise; the landlord's identity is deliberately not part of this view.
export default function HomeChanges({ tenancyId }: { tenancyId: string }) {
  const [changes, setChanges] = useState<ListingChange[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<{ results: ListingChange[] }>(`/tenancies/${tenancyId}/listing-changes`);
        if (!cancelled) setChanges(res.results ?? []);
      } catch {
        if (!cancelled) setChanges([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenancyId]);

  if (changes === null) return null;

  return (
    <details className="details-toggle" style={{ marginTop: 10 }} open={changes.length > 0}>
      <summary>
        Changes to your home{" "}
        <span className={`badge ${changes.length > 0 ? "pending" : ""}`}>{changes.length}</span>
      </summary>
      <ChangeList changes={changes} showFlags={false} emptyText="Your landlord hasn't changed anything since your tenancy began." />
    </details>
  );
}

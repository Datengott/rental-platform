import { ACTION_LABELS, FIELD_LABELS, formatChangeValue, isPhotoField } from "@/lib/changes";
import type { ListingChange } from "@/lib/types";

// The change history for listings — used by the landlord (their own edits),
// the tenant (edits since their tenancy began) and admins (everything, with
// who made each change). Changes made while a tenant was living there are
// called out, since that's what someone reviewing this is looking for.
export default function ChangeList({
  changes,
  showActor = false,
  showFlags = true,
  emptyText = "No changes recorded.",
}: {
  changes: ListingChange[];
  showActor?: boolean;
  // The "tenant living there" / "verified property" flags are for a reviewer
  // (landlord, admin); they mean nothing to the tenant reading their own home's history.
  showFlags?: boolean;
  emptyText?: string;
}) {
  if (changes.length === 0) return <p className="muted">{emptyText}</p>;

  return (
    <ul className="change-list">
      {changes.map((c) => (
        <li key={c.id} className={`change-item ${showFlags && c.while_occupied ? "occupied" : ""}`}>
          <div className="change-head">
            <span>
              <span className="badge">{c.entity_type}</span> <strong>{c.entity_label ?? "(unnamed)"}</strong>
              <span className="muted"> · {ACTION_LABELS[c.action] ?? c.action}</span>
            </span>
            <span className="row" style={{ gap: 6, alignItems: "center" }}>
              {showFlags && c.while_occupied && <span className="badge failed">Tenant living there</span>}
              {showFlags && c.property_verified_at_change && c.entity_type === "property" && (
                <span className="badge pending">Verified property</span>
              )}
              <span className="muted">
                {new Date(c.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </span>
          </div>

          {showActor && c.changed_by_profile && (
            <div className="muted">
              by {c.changed_by_profile.name ?? "landlord"}
              {c.changed_by_profile.phone_number ? ` (${c.changed_by_profile.phone_number})` : ""}
            </div>
          )}

          <ul className="change-fields">
            {c.changes.map((f, i) => (
              <li key={i}>
                <b>{FIELD_LABELS[f.field] ?? f.field}</b>
                {isPhotoField(f.field) ? (
                  <span className="change-photos">
                    {typeof f.from === "string" && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.from} alt="before" className="thumb" />
                    )}
                    {typeof f.from === "string" && typeof f.to === "string" && <span aria-hidden> → </span>}
                    {typeof f.to === "string" && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.to} alt="after" className="thumb" />
                    )}
                    {f.to === null && <span className="muted"> removed</span>}
                  </span>
                ) : (
                  <span>
                    <span className="from">{formatChangeValue(f.field, f.from)}</span>
                    <span aria-hidden> → </span>
                    <span className="to">{formatChangeValue(f.field, f.to)}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>

          {c.note && <div className="change-note">Reason given: “{c.note}”</div>}
        </li>
      ))}
    </ul>
  );
}

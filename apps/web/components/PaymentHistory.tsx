import { describeCoveredMonths, dueStatus, formatDate, formatTimestampDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { LedgerEntry } from "@/lib/types";

// Every payment states the same three things: when it was made, which
// month(s) it covers, and (on the latest one) when the next payment is
// expected. Rent the landlord recorded as paid upfront is labelled as such.
export default function PaymentHistory({
  entries,
  currency,
  nextPaymentDue,
  today,
}: {
  entries: LedgerEntry[];
  currency: string;
  nextPaymentDue: string | null;
  today: string;
}) {
  if (entries.length === 0) return null;

  return (
    <div className="ledger">
      <div className="label">Payment history</div>
      {entries.map((e, i) => {
        const covered = e.period_start && e.period_end ? describeCoveredMonths(e.period_start, e.period_end) : null;
        const status = nextPaymentDue ? dueStatus(nextPaymentDue, today) : null;
        return (
          <div key={e.id} className="ledger-row">
            <div>
              <div>
                {e.provider === "offline" && (
                  <span className="badge active" style={{ marginRight: 6 }}>
                    Paid upfront
                  </span>
                )}
                {covered ? (
                  <strong>
                    {covered.label} · {covered.count} month{covered.count === 1 ? "" : "s"}
                  </strong>
                ) : (
                  (e.description ?? "Rent payment")
                )}
              </div>
              <div className="muted">
                {e.paid_at ? `Paid on ${formatTimestampDate(e.paid_at)}` : "Payment recorded"}
                {e.period_start && e.period_end && ` · ${formatDate(e.period_start)} – ${formatDate(e.period_end)}`}
                {e.provider === "offline" && " · recorded by your landlord"}
              </div>
              {i === 0 && nextPaymentDue && (
                <div className="next-due">
                  Next payment due <strong>{formatDate(nextPaymentDue)}</strong>
                  {status === "overdue" && (
                    <span className="badge failed" style={{ marginLeft: 6 }}>
                      overdue
                    </span>
                  )}
                  {status === "today" && (
                    <span className="badge pending" style={{ marginLeft: 6 }}>
                      due today
                    </span>
                  )}
                </div>
              )}
            </div>
            <strong>
              {e.type === "credit" ? "+" : "−"}
              {formatMoney(e.amount)} {currency}
            </strong>
          </div>
        );
      })}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { bedroomsText } from "@/components/ListingCard";
import {
  IconArea,
  IconArrowLeft,
  IconBath,
  IconBed,
  IconCalendar,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconHeart,
  IconHome,
  IconPin,
  IconShield,
} from "@/components/Icons";
import { useToast } from "@/components/Toast";
import { api, ApiError, loadSession } from "@/lib/api";
import { facilityIcon, facilityLabel, PROPERTY_TYPE_LABELS } from "@/lib/facilities";
import { cycleLabel, formatMoney } from "@/lib/format";
import { useInterest } from "@/lib/interest";
import type { PublicUnitDetail } from "@/lib/types";

export default function UnitDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { interested, busyId, express } = useInterest(toast.show);

  const [unit, setUnit] = useState<PublicUnitDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [visitOpen, setVisitOpen] = useState(false);
  const [slot, setSlot] = useState("");
  const [visitBusy, setVisitBusy] = useState(false);
  const [visitSent, setVisitSent] = useState(false);
  // datetime-local wants *local* wall-clock time, not UTC; earliest bookable slot is an hour from now.
  const [minSlot] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<PublicUnitDetail>(`/units/${params.id}`, { auth: false });
        if (cancelled) return;
        setUnit(res);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        // 404: gone/not listed. 400: malformed id (ParseUUIDPipe) — same thing to a visitor.
        setStatus(err instanceof ApiError && (err.status === 404 || err.status === 400) ? "missing" : "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const photos = unit?.photos ?? [];
  const step = useCallback(
    (delta: number) => setLightbox((i) => (i === null ? i : (i + delta + photos.length) % photos.length)),
    [photos.length],
  );

  useEffect(() => {
    if (lightbox === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox, step]);

  async function requestVisit(e: React.FormEvent) {
    e.preventDefault();
    if (!unit) return;
    if (!loadSession()) {
      router.push(`/login?next=${encodeURIComponent(`/units/${unit.id}`)}`);
      return;
    }
    setVisitBusy(true);
    try {
      await api(`/units/${unit.id}/visit-requests`, {
        method: "POST",
        body: { requested_slots: [{ start: new Date(slot).toISOString() }] },
      });
      setVisitSent(true);
      setVisitOpen(false);
      toast.show("success", "Visit requested — the landlord will respond within 48 hours.");
    } catch (err) {
      toast.show("error", err instanceof ApiError ? err.message : "Could not request a visit.");
    } finally {
      setVisitBusy(false);
    }
  }

  if (status === "loading") {
    return (
      <main className="container" style={{ paddingTop: 30 }}>
        <div className="skeleton" style={{ height: 34, width: 260, marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 440 }} />
      </main>
    );
  }

  if (status !== "ready" || !unit) {
    return (
      <main className="container" style={{ paddingTop: 48 }}>
        <div className="empty">
          <IconHome size={34} />
          <h3>{status === "missing" ? "This listing is no longer available" : "We couldn’t load this listing"}</h3>
          <p style={{ margin: "0 0 18px" }}>
            {status === "missing" ? "It may have just been rented, or taken down by the landlord." : "Please try again in a moment."}
          </p>
          <Link href="/" className="btn">
            Browse other homes
          </Link>
        </div>
      </main>
    );
  }

  const allFacilities = Array.from(new Set(unit.facilities));
  const compoundFacilities = Array.from(new Set(unit.property.facilities));
  const isInterested = interested.has(unit.id);
  const visible = photos.length >= 5 ? 5 : photos.length === 4 ? 3 : photos.length;
  const galleryClass = visible <= 1 ? "single" : visible === 2 ? "two" : visible === 3 ? "three" : "";
  const hidden = photos.length - visible;
  const location = [unit.property.name, unit.property.city, unit.property.region].filter(Boolean).join(", ");

  return (
    <main className="container" style={{ paddingBottom: 40 }}>
      <div className="crumbs">
        <Link href="/">
          <IconArrowLeft size={16} /> All listings
        </Link>
      </div>

      <div className="detail-title">
        <div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {unit.property.property_type && <span className="badge">{PROPERTY_TYPE_LABELS[unit.property.property_type]}</span>}
            {unit.property.verified && (
              <span className="badge vacant">
                <IconShield size={12} /> Verified property
              </span>
            )}
          </div>
          <h1>{unit.label ?? "Unnamed unit"}</h1>
          <div className="listing-loc" style={{ fontSize: 15 }}>
            <IconPin size={16} /> {location}
          </div>
        </div>
      </div>

      {photos.length === 0 ? (
        <div className="empty">No photos yet.</div>
      ) : (
        <div className={`gallery ${galleryClass}`}>
          {photos.slice(0, visible).map((p, i) => (
            <button key={p.id} onClick={() => setLightbox(i)} aria-label={`Open photo ${i + 1} of ${photos.length}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`${unit.label ?? "Listing"} — photo ${i + 1}`} loading={i === 0 ? "eager" : "lazy"} />
              {i === visible - 1 && hidden > 0 && <span className="more">+{hidden} more</span>}
            </button>
          ))}
        </div>
      )}

      <div className="detail-grid">
        <div>
          <div className="facts">
            <div className="fact">
              <div className="v">{bedroomsText(unit.bedrooms)}</div>
              <span className="k">
                <IconBed size={15} /> Bedrooms
              </span>
            </div>
            {unit.bathrooms !== null && (
              <div className="fact">
                <div className="v">{unit.bathrooms}</div>
                <span className="k">
                  <IconBath size={15} /> Bathrooms
                </span>
              </div>
            )}
            {unit.size_sqm && (
              <div className="fact">
                <div className="v">{Math.round(Number(unit.size_sqm))} m²</div>
                <span className="k">
                  <IconArea size={15} /> Living area
                </span>
              </div>
            )}
            <div className="fact">
              <div className="v" style={{ textTransform: "capitalize" }}>
                {unit.billing_cycle}
              </div>
              <span className="k">
                <IconCalendar size={15} /> Rent billed
              </span>
            </div>
          </div>

          {unit.description && (
            <section className="detail-section">
              <h2>About this place</h2>
              <p>{unit.description}</p>
            </section>
          )}

          {allFacilities.length > 0 && (
            <section className="detail-section">
              <h2>Included in the unit</h2>
              <div className="amenities">
                {allFacilities.map((f) => {
                  const Icon = facilityIcon(f);
                  return (
                    <div key={f} className="amenity">
                      <span className="ico">
                        <Icon size={18} />
                      </span>
                      {facilityLabel(f)}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {compoundFacilities.length > 0 && (
            <section className="detail-section">
              <h2>{unit.property.property_type === "commercial" ? "Building services" : "Building & compound"}</h2>
              <div className="amenities">
                {compoundFacilities.map((f) => {
                  const Icon = facilityIcon(f);
                  return (
                    <div key={f} className="amenity">
                      <span className="ico">
                        <Icon size={18} />
                      </span>
                      {facilityLabel(f)}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="detail-section">
            <h2>Location</h2>
            <p>
              {location}. The exact street address is shared by the landlord once a visit is confirmed.
            </p>
          </section>
        </div>

        <aside className="book-card" aria-label="Contact the landlord">
          <div className="price">
            {formatMoney(unit.rent_amount)} {unit.currency} <small>/ {cycleLabel(unit.billing_cycle)}</small>
          </div>
          <div className="stack">
            <button className={`btn-lg ${isInterested ? "btn-success" : ""}`} onClick={() => void express(unit.id)} disabled={busyId === unit.id || isInterested}>
              {isInterested ? (
                <>
                  <IconCheck size={18} /> You’re interested
                </>
              ) : (
                <>
                  <IconHeart size={18} /> {busyId === unit.id ? "Sending…" : "I’m interested"}
                </>
              )}
            </button>

            {visitSent ? (
              <div className="success-box" style={{ margin: 0 }}>
                Visit requested. You’ll be notified when the landlord responds.
              </div>
            ) : visitOpen ? (
              <form onSubmit={requestVisit} className="stack" style={{ marginTop: 0 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="visit-slot">Preferred date &amp; time</label>
                  <input id="visit-slot" type="datetime-local" required min={minSlot} value={slot} onChange={(e) => setSlot(e.target.value)} />
                </div>
                <button type="submit" className="btn-lg" disabled={visitBusy || !slot}>
                  {visitBusy ? "Sending…" : "Send visit request"}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setVisitOpen(false)}>
                  <IconClose size={15} /> Cancel
                </button>
              </form>
            ) : (
              <button className="secondary btn-lg" onClick={() => setVisitOpen(true)}>
                <IconCalendar size={18} /> Request a visit
              </button>
            )}
          </div>
          <hr />
          <div className="assure">
            <IconShield size={18} />
            <span>
              Expressing interest is free and non-binding. The landlord is notified straight away and can set up your
              tenancy in one click.
            </span>
          </div>
          {!loadSessionSafe() && (
            <p className="muted" style={{ margin: "12px 0 0" }}>
              You’ll be asked to sign in with your phone number first — we’ll remember what you clicked.
            </p>
          )}
        </aside>
      </div>

      {lightbox !== null && photos[lightbox] && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[lightbox].url} alt={`${unit.label ?? "Listing"} — photo ${lightbox + 1}`} onClick={(e) => e.stopPropagation()} />
          <button className="lb-btn lb-close" aria-label="Close" onClick={() => setLightbox(null)}>
            <IconClose size={20} />
          </button>
          {photos.length > 1 && (
            <>
              <button
                className="lb-btn lb-prev"
                aria-label="Previous photo"
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
              >
                <IconChevronLeft size={22} />
              </button>
              <button
                className="lb-btn lb-next"
                aria-label="Next photo"
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
              >
                <IconChevronRight size={22} />
              </button>
            </>
          )}
          <span className="lb-count">
            {lightbox + 1} / {photos.length}
          </span>
        </div>
      )}

      {toast.node}
    </main>
  );
}

// localStorage isn't readable while server-rendering; this page only renders
// after its client-side fetch, so by then it always is.
function loadSessionSafe() {
  return typeof window !== "undefined" && loadSession() !== null;
}

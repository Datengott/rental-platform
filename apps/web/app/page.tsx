"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ListingCard from "@/components/ListingCard";
import { IconArrowRight, IconHome, IconSearch, IconShield } from "@/components/Icons";
import { useToast } from "@/components/Toast";
import { api, ApiError } from "@/lib/api";
import { PROPERTY_TYPE_LABELS } from "@/lib/facilities";
import { formatMoney, normalize } from "@/lib/format";
import { useInterest } from "@/lib/interest";
import type { PublicUnit } from "@/lib/types";

type Sort = "newest" | "price_asc" | "price_desc";

const RENT_STEPS = [100_000, 200_000, 400_000, 800_000, 1_000_000];
const BED_OPTIONS = [
  { value: "", label: "Any" },
  { value: "0", label: "Studio" },
  { value: "1", label: "1+ bedroom" },
  { value: "2", label: "2+ bedrooms" },
  { value: "3", label: "3+ bedrooms" },
  { value: "4", label: "4+ bedrooms" },
];

interface SearchResponse {
  results: PublicUnit[];
  total: number;
  next_cursor: string | null;
}

async function fetchListings(after?: string | null) {
  const qs = new URLSearchParams({ limit: "100" });
  if (after) qs.set("cursor", after);
  return api<SearchResponse>(`/units?${qs}`, { auth: false });
}

function errorText(err: unknown) {
  return err instanceof ApiError ? err.message : "Could not load listings. Is the API running?";
}

export default function LandingPage() {
  const toast = useToast();
  const { interested, busyId, express } = useInterest(toast.show);

  const [units, setUnits] = useState<PublicUnit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [city, setCity] = useState("");
  const [type, setType] = useState("");
  const [beds, setBeds] = useState("");
  const [maxRent, setMaxRent] = useState("");
  const [sort, setSort] = useState<Sort>("newest");

  // Load more / retry: state is set here, after the await, from a click handler.
  const load = useCallback(async (after?: string | null) => {
    if (after) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetchListings(after);
      setUnits((prev) => (after ? [...prev, ...res.results] : res.results));
      setTotal(res.total);
      setCursor(res.next_cursor);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // First load: `loading` already starts true, so this only sets state after
  // the await (never synchronously inside the effect).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchListings();
        if (cancelled) return;
        setUnits(res.results);
        setTotal(res.total);
        setCursor(res.next_cursor);
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Filtering happens client-side over everything loaded (the API returns up
  // to 100 per page and this stays instant while typing/selecting); the
  // accent-insensitive compare is why "Yaounde" finds "Yaoundé".
  const cities = useMemo(() => Array.from(new Set(units.map((u) => u.property.city))).sort((a, b) => a.localeCompare(b)), [units]);

  const filtered = useMemo(() => {
    const list = units.filter((u) => {
      if (city && normalize(u.property.city) !== normalize(city)) return false;
      if (type && u.property.property_type !== type) return false;
      if (beds === "0" && u.bedrooms) return false;
      if (beds && beds !== "0" && (u.bedrooms ?? 0) < Number(beds)) return false;
      if (maxRent && Number(u.rent_amount) > Number(maxRent)) return false;
      return true;
    });
    if (sort === "price_asc") list.sort((a, b) => Number(a.rent_amount) - Number(b.rent_amount));
    if (sort === "price_desc") list.sort((a, b) => Number(b.rent_amount) - Number(a.rent_amount));
    return list;
  }, [units, city, type, beds, maxRent, sort]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const u of units) if (u.property.property_type) counts[u.property.property_type] = (counts[u.property.property_type] ?? 0) + 1;
    return counts;
  }, [units]);

  const filtersActive = Boolean(city || type || beds || maxRent);

  function clearFilters() {
    setCity("");
    setType("");
    setBeds("");
    setMaxRent("");
  }

  function scrollToListings() {
    document.getElementById("listings")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main>
      <section className="hero">
        <div className="container">
          <span className="eyebrow">
            <IconShield size={15} /> Verified rentals across Cameroon
          </span>
          <h1>Find a place you’ll love to call home.</h1>
          <p className="lead">
            Browse homes and offices in Douala, Yaoundé, Buea, Limbe and beyond. Tap “I’m interested” and the
            landlord hears from you straight away.
          </p>
          {!loading && !error && (
            <p style={{ margin: "22px 0 0", display: "flex", gap: 22, flexWrap: "wrap", fontWeight: 600 }}>
              <span>{total} listings available</span>
              <span>{cities.length} cities</span>
              <span>{units.filter((u) => u.property.verified).length} verified</span>
            </p>
          )}
        </div>
      </section>

      <div className="container">
        <form
          className="search-card"
          onSubmit={(e) => {
            e.preventDefault();
            scrollToListings();
          }}
          aria-label="Search listings"
        >
          <div className="field">
            <label htmlFor="f-city">Location</label>
            <select id="f-city" value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">All cities</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-type">Property type</label>
            <select id="f-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Any type</option>
              {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-beds">Bedrooms</label>
            <select id="f-beds" value={beds} onChange={(e) => setBeds(e.target.value)}>
              {BED_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-rent">Max rent / month</label>
            <select id="f-rent" value={maxRent} onChange={(e) => setMaxRent(e.target.value)}>
              <option value="">Any price</option>
              {RENT_STEPS.map((n) => (
                <option key={n} value={n}>
                  Up to {formatMoney(n)} XAF
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-lg">
            <IconSearch size={18} /> Search
          </button>
        </form>

        <section className="section" id="listings" style={{ scrollMarginTop: 84 }}>
          <div className="section-head">
            <div>
              <h2>Available now</h2>
              <p className="muted" style={{ margin: 0 }}>
                {loading
                  ? "Loading listings…"
                  : `${filtered.length} ${filtered.length === 1 ? "listing" : "listings"}${filtersActive ? " match your search" : ""}`}
                {filtersActive && (
                  <>
                    {" · "}
                    <a
                      href="#listings"
                      onClick={(e) => {
                        e.preventDefault();
                        clearFilters();
                      }}
                    >
                      Clear filters
                    </a>
                  </>
                )}
              </p>
            </div>
            <div className="toolbar">
              <button className={`pill ${type === "" ? "active" : ""}`} onClick={() => setType("")}>
                All
              </button>
              {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
                <button key={value} className={`pill ${type === value ? "active" : ""}`} onClick={() => setType(type === value ? "" : value)}>
                  {label} {typeCounts[value] ? `(${typeCounts[value]})` : ""}
                </button>
              ))}
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort listings">
                <option value="newest">Newest first</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
              </select>
            </div>
          </div>

          {error ? (
            <div className="empty">
              <IconHome size={32} />
              <h3>We couldn’t load the listings</h3>
              <p style={{ margin: "0 0 16px" }}>{error}</p>
              <button onClick={() => void load()}>Try again</button>
            </div>
          ) : loading ? (
            <div className="listing-grid">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="skeleton" style={{ height: 420 }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty">
              <IconSearch size={32} />
              <h3>{units.length === 0 ? "No listings yet" : "Nothing matches those filters"}</h3>
              <p style={{ margin: "0 0 16px" }}>
                {units.length === 0
                  ? "Landlords haven’t published anything yet. Run the seed script to load sample listings."
                  : "Try a different city or a higher budget."}
              </p>
              {filtersActive && <button onClick={clearFilters}>Clear filters</button>}
            </div>
          ) : (
            <>
              <div className="listing-grid">
                {filtered.map((u) => (
                  <ListingCard key={u.id} unit={u} interested={interested.has(u.id)} busy={busyId === u.id} onInterest={express} />
                ))}
              </div>
              {cursor && (
                <div style={{ textAlign: "center", marginTop: 28 }}>
                  <button className="secondary btn-lg" onClick={() => void load(cursor)} disabled={loadingMore}>
                    {loadingMore ? "Loading…" : "Show more homes"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <section className="section">
          <div className="section-head">
            <div>
              <h2>How it works</h2>
              <p className="muted" style={{ margin: 0 }}>
                From browsing to move-in, in three steps.
              </p>
            </div>
          </div>
          <div className="steps">
            <div className="step">
              <div className="num">1</div>
              <h3>Find a place</h3>
              <p>Filter by city, type, bedrooms and budget. Every listing shows real photos, amenities and the monthly rent.</p>
            </div>
            <div className="step">
              <div className="num">2</div>
              <h3>Say you’re interested</h3>
              <p>Sign in with your phone number and tap “I’m interested”. The landlord is notified instantly — no back-and-forth needed.</p>
            </div>
            <div className="step">
              <div className="num">3</div>
              <h3>Move in with confidence</h3>
              <p>The landlord sets up your tenancy in one click. Pay rent, get your contract and raise issues, all in one place.</p>
            </div>
          </div>
        </section>

        <section className="cta-band">
          <div>
            <h2>Own a property? List it in minutes.</h2>
            <p>Add your properties and units (even dozens at once), publish them with photos, and see interested tenants the moment they raise their hand.</p>
          </div>
          <Link href="/dashboard/landlord" className="btn btn-lg">
            Start listing <IconArrowRight size={18} />
          </Link>
        </section>
      </div>

      {toast.node}
    </main>
  );
}

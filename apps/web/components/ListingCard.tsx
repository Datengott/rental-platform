"use client";

import Link from "next/link";
import { facilityIcon, facilityLabel, PROPERTY_TYPE_LABELS } from "@/lib/facilities";
import { cycleLabel, formatMoney } from "@/lib/format";
import type { PublicUnit } from "@/lib/types";
import { IconArea, IconBath, IconBed, IconCheck, IconHeart, IconImage, IconPin, IconShield } from "./Icons";

export function bedroomsText(bedrooms: number | null): string {
  return !bedrooms ? "Studio" : `${bedrooms} bed${bedrooms > 1 ? "s" : ""}`;
}

export default function ListingCard({
  unit,
  interested,
  busy,
  onInterest,
}: {
  unit: PublicUnit;
  interested: boolean;
  busy: boolean;
  onInterest: (unitId: string) => void;
}) {
  const href = `/units/${unit.id}`;
  // Unit-level amenities first (what the tenant actually gets inside), then the compound's.
  const tags = Array.from(new Set([...unit.facilities, ...unit.property.facilities]));
  const shown = tags.slice(0, 3);
  const location = [unit.property.name, unit.property.city].filter(Boolean).join(" · ");

  return (
    <article className="listing-card">
      <Link href={href} className="listing-media" aria-label={`View ${unit.label ?? "listing"}`}>
        {unit.cover_photo_url ? (
          // Plain <img>: photos come from the API origin (not a fixed, configured
          // Next image domain), and this keeps the app dependency-free.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={unit.cover_photo_url} alt={unit.label ?? "Listing photo"} loading="lazy" />
        ) : (
          <div className="placeholder">
            <IconImage size={34} />
          </div>
        )}
        <div className="media-badges">
          {unit.property.property_type && (
            <span className="media-badge">{PROPERTY_TYPE_LABELS[unit.property.property_type]}</span>
          )}
          {unit.property.verified && (
            <span className="media-badge verified">
              <IconShield size={13} /> Verified
            </span>
          )}
        </div>
        <div className="price-pill">
          {formatMoney(unit.rent_amount)} {unit.currency} <small>/ {cycleLabel(unit.billing_cycle)}</small>
        </div>
      </Link>

      <div className="listing-body">
        <div>
          <Link href={href} className="listing-title">
            {unit.label ?? "Unnamed unit"}
          </Link>
          <div className="listing-loc" style={{ marginTop: 4 }}>
            <IconPin size={15} /> {location}
          </div>
        </div>

        <div className="listing-meta">
          <span>
            <IconBed size={17} /> {bedroomsText(unit.bedrooms)}
          </span>
          {unit.bathrooms !== null && (
            <span>
              <IconBath size={17} /> {unit.bathrooms} bath{unit.bathrooms === 1 ? "" : "s"}
            </span>
          )}
          {unit.size_sqm && (
            <span>
              <IconArea size={17} /> {Math.round(Number(unit.size_sqm))} m²
            </span>
          )}
        </div>

        <div className="listing-tags">
          {shown.map((f) => {
            const Icon = facilityIcon(f);
            return (
              <span key={f} className="tag">
                <Icon size={12} /> {facilityLabel(f)}
              </span>
            );
          })}
          {tags.length > shown.length && <span className="tag">+{tags.length - shown.length}</span>}
        </div>

        <div className="listing-actions">
          <Link href={href} className="btn btn-secondary">
            Details
          </Link>
          <button
            className={interested ? "btn btn-success" : ""}
            onClick={() => onInterest(unit.id)}
            disabled={busy || interested}
          >
            {interested ? (
              <>
                <IconCheck size={16} /> Interested
              </>
            ) : (
              <>
                <IconHeart size={16} /> {busy ? "Sending…" : "I’m interested"}
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

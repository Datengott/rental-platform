"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconHome } from "./Icons";

export default function Footer() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <footer className="site-footer">
      <div className="inner">
        <div>
          <Link href="/" className="brand">
            <span className="brand-mark">
              <IconHome size={19} />
            </span>
            Rental Platform
          </Link>
          <p style={{ maxWidth: 360, margin: "14px 0 0", fontSize: 14 }}>
            Verified homes and offices for rent across Cameroon — express interest in one tap, and manage your
            tenancy, rent and requests in one place.
          </p>
        </div>
        <div>
          <h4>Renters</h4>
          <Link href="/">Browse homes</Link>
          <Link href="/dashboard/tenant">My rentals &amp; interests</Link>
        </div>
        <div>
          <h4>Landlords</h4>
          <Link href="/dashboard/landlord">List your property</Link>
          <Link href="/dashboard">Notifications</Link>
        </div>
        <div className="fine">
          Demo build — sample listings and photos (Unsplash). Mobile-money payments and SMS/WhatsApp/email
          delivery use simulated providers.
        </div>
      </div>
    </footer>
  );
}

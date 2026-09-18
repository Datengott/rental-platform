"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearSession, loadSession, Session } from "@/lib/api";

export default function NavBar() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    // Reading localStorage during the initial render (instead of here)
    // would mismatch the server-rendered HTML — this has to run post-mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(loadSession());
  }, []);

  function logout() {
    clearSession();
    router.push("/login");
  }

  return (
    <nav className="nav">
      <Link href="/dashboard" className="nav-title">
        🏠 Rental Platform
      </Link>
      <div className="nav-links">
        {session && (
          <>
            <Link href="/dashboard/landlord">Landlord</Link>
            <Link href="/dashboard/tenant">Tenant</Link>
            <Link href="/dashboard">Notifications</Link>
            <span className="muted">{session.user.phone_number}</span>
            <button className="secondary" onClick={logout}>
              Log out
            </button>
          </>
        )}
      </div>
    </nav>
  );
}

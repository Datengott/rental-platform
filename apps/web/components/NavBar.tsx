"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { API_BASE, clearSession, loadSession, Session } from "@/lib/api";
import { initials } from "@/lib/format";
import { IconChevronDown, IconHome } from "./Icons";

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Re-read on every navigation so signing in/out on another page shows up
    // here. localStorage can't be read during render (it would mismatch the
    // server-rendered HTML), so this has to happen post-mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(loadSession());
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (pathname === "/login") return null;

  function logout() {
    clearSession();
    setSession(null);
    setOpen(false);
    router.push("/");
  }

  const isAdmin = session?.user.roles.includes("admin");
  const apiDocsUrl = API_BASE.replace(/\/v1\/?$/, "") + "/docs";

  return (
    <header className="site-header">
      <div className="inner">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <IconHome size={19} />
          </span>
          Rental Platform
        </Link>

        <nav className="nav-links" aria-label="Main">
          <Link href="/" className={`nav-link hide-mobile ${pathname === "/" ? "active" : ""}`}>
            Browse homes
          </Link>
          <Link
            href="/dashboard/landlord"
            className={`nav-link hide-mobile ${pathname.startsWith("/dashboard/landlord") ? "active" : ""}`}
          >
            List your property
          </Link>

          {session ? (
            <div className="user-menu" ref={menuRef}>
              <button
                className="user-button"
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={open}
              >
                <span className="avatar">{initials(session.user.phone_number)}</span>
                <span className="hide-mobile">{session.user.phone_number}</span>
                <IconChevronDown size={16} />
              </button>
              {open && (
                <div className="menu" role="menu">
                  <div className="menu-head">
                    <strong>{session.user.phone_number}</strong>
                    <span className="muted">
                      {session.user.roles.join(" · ")}
                      {isAdmin ? " (admin)" : ""}
                    </span>
                  </div>
                  <Link href="/dashboard" role="menuitem">
                    Dashboard &amp; notifications
                  </Link>
                  <Link href="/dashboard/landlord" role="menuitem">
                    Landlord tools
                  </Link>
                  <Link href="/dashboard/tenant" role="menuitem">
                    My rentals &amp; interests
                  </Link>
                  {isAdmin && (
                    <Link href="/dashboard/admin" role="menuitem">
                      Listing change log
                    </Link>
                  )}
                  {isAdmin && (
                    <a href={apiDocsUrl} target="_blank" rel="noreferrer" role="menuitem">
                      API documentation ↗
                    </a>
                  )}
                  <button onClick={logout} role="menuitem">
                    Log out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="btn" style={{ marginLeft: 8 }}>
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

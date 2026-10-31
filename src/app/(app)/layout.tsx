"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Brand } from "@/components/Brand";
import { NotificationBell } from "@/components/NotificationBell";

const TABS = [
  { href: "/board", label: "All tools" },
  { href: "/listings", label: "My listings" },
  { href: "/requests", label: "My requests" },
  { href: "/incoming", label: "Incoming requests" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensure = useMutation(api.users.ensure);
  const me = useQuery(api.users.me);
  const [ready, setReady] = useState(false);

  // Create/refresh the Convex profile from the verified Clerk token once per session.
  useEffect(() => {
    if (!isAuthenticated) return;
    ensure().then(() => setReady(true), () => setReady(true));
  }, [isAuthenticated, ensure]);

  const tabs = me?.role === "admin" ? [...TABS, { href: "/admin", label: "Admin" }] : TABS;

  return (
    <div className="wrap">
      <header className="topbar">
        <Brand href="/board" />
        <div className="topbar-right">
          {me?.role === "admin" && <span className="badge badge-busy">Admin</span>}
          <NotificationBell />
          <UserButton />
        </div>
      </header>
      <nav className="tabs" aria-label="Sections">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className="tab" aria-current={pathname === t.href ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      <main>{isLoading || !ready ? <p className="muted">Loading…</p> : children}</main>
    </div>
  );
}

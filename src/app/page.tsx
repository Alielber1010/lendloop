"use client";

import Link from "next/link";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Brand } from "@/components/Brand";
import { CATEGORY_LABEL } from "@/lib/labels";

export default function Landing() {
  const { isSignedIn } = useAuth();
  // Public query: returns name and category only, no owner details.
  const tools = useQuery(api.tools.listPublic);

  const cta = isSignedIn ? (
    <Link className="btn btn-primary" href="/board">
      Open the board
    </Link>
  ) : (
    <SignInButton mode="modal" forceRedirectUrl="/board">
      <button className="btn btn-primary">Sign in to lend or borrow</button>
    </SignInButton>
  );

  return (
    <div className="wrap">
      <header className="topbar">
        <Brand />
        {cta}
      </header>

      <section className="hero">
        <span className="pixel">Your street&apos;s shared shed</span>
        <h1 className="display">
          Borrow what you need. <em>Lend what you don&apos;t.</em>
        </h1>
        <p>
          LendLoop is a lending board for neighbours. List the drill that sits in your cupboard, borrow a ladder for a
          weekend, and let the reminders take care of themselves.
        </p>
        <div className="row">{cta}</div>
      </section>

      <section className="section" aria-labelledby="shelf-title">
        <div className="spread" style={{ alignItems: "baseline" }}>
          <h2 id="shelf-title" className="display">
            On the shelf now
          </h2>
          <span className="pixel">{tools ? `${tools.length} tools` : ""}</span>
        </div>
        {tools === undefined ? (
          <p className="muted">Loading the shelf…</p>
        ) : tools.length === 0 ? (
          <div className="card empty">Nothing listed yet. Be the first to lend something.</div>
        ) : (
          <ul className="shelf" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {tools.map((t) => (
              <li key={t._id} className="card shelf-item">
                <strong>{t.name}</strong>
                <span className="pixel">{CATEGORY_LABEL[t.category]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="footer">LendLoop is a demo project. Owner details are shown only to signed-in neighbours.</footer>
    </div>
  );
}

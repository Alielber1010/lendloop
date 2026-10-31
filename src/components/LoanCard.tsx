"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { PixelAvatar } from "@/components/PixelAvatar";
import { errorMessage, formatDay, timeAgo } from "@/lib/labels";

export type LoanView = FunctionReturnType<typeof api.loans.incoming>[number];

const PHASE_BADGE: Record<LoanView["phase"], [string, string]> = {
  pending: ["badge-busy", "Waiting for reply"],
  upcoming: ["badge-live", "Approved"],
  active: ["badge-live", "On loan"],
  overdue: ["badge-late", "Overdue"],
  closed: ["badge-quiet", ""],
};

export function LoanStatus({ loan }: { loan: LoanView }) {
  const [cls, label] = PHASE_BADGE[loan.phase];
  return <span className={`badge ${cls}`}>{label || loan.status}</span>;
}

/** A loan from one side: "lender" sees the borrower, "borrower" sees the lender. */
export function LoanCard({ loan, as }: { loan: LoanView; as: "lender" | "borrower" }) {
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const cancel = useMutation(api.loans.cancel);
  const markReturned = useMutation(api.loans.markReturned);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const other = as === "lender" ? loan.borrower : loan.lender;

  async function run(fn: (a: { loanId: LoanView["_id"] }) => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn({ loanId: loan._id });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card">
      <div className="spread">
        <div>
          <h3>{loan.toolName}</h3>
          <div className="muted" style={{ marginTop: 4 }}>
            {formatDay(loan.startDate)} – {formatDay(loan.endDate)}
          </div>
        </div>
        <LoanStatus loan={loan} />
      </div>
      <div className="lender" style={{ marginTop: 12 }}>
        <PixelAvatar id={other._id} label={`${other.name}'s avatar`} />
        <div>
          <div className="pixel">{as === "lender" ? "Borrower" : "Lender"}</div>
          <div>{other.name}</div>
        </div>
      </div>
      {loan.message && <p className="muted">&ldquo;{loan.message}&rdquo;</p>}

      <div className="row" style={{ marginTop: 12 }}>
        {as === "lender" && loan.status === "requested" && (
          <>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(approve)}>
              Approve
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => run(decline)}>
              Decline
            </button>
          </>
        )}
        {as === "lender" && loan.status === "approved" && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(markReturned)}>
            Mark returned
          </button>
        )}
        {as === "borrower" && loan.status === "requested" && (
          <button className="btn btn-sm" disabled={busy} onClick={() => run(cancel)}>
            Cancel request
          </button>
        )}
      </div>
      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}

      {loan.activity.length > 0 && (
        <ul className="activity" aria-label="Automation activity">
          {loan.activity.map((a) => (
            <li key={a._id}>
              <span style={{ color: a.kind.endsWith("failed") ? "var(--hud-request)" : undefined }}>{a.summary}</span>
              <span>{timeAgo(a.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function LoanList({ loans, as, empty }: { loans: LoanView[] | undefined; as: "lender" | "borrower"; empty: string }) {
  if (loans === undefined) return <p className="muted">Loading…</p>;
  if (loans.length === 0) return <div className="card empty">{empty}</div>;
  const open = loans.filter((l) => l.phase !== "closed");
  const closed = loans.filter((l) => l.phase === "closed");
  return (
    <>
      {open.length > 0 && (
        <div className="grid">
          {open.map((l) => (
            <LoanCard key={l._id} loan={l} as={as} />
          ))}
        </div>
      )}
      {closed.length > 0 && (
        <section className="section">
          <h2 className="display">History</h2>
          <div className="grid">
            {closed.map((l) => (
              <LoanCard key={l._id} loan={l} as={as} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

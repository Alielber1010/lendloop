"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { LoanStatus } from "@/components/LoanCard";
import { errorMessage, formatDay, timeAgo } from "@/lib/labels";

export default function Admin() {
  const me = useQuery(api.users.me);
  if (me === undefined) return <p className="muted">Loading…</p>;
  // The queries below throw for non-admins anyway; this just avoids rendering errors.
  if (me?.role !== "admin") return <div className="card empty">This page is for admins.</div>;
  return <AdminPanels />;
}

function AdminPanels() {
  const loans = useQuery(api.admin.allLoans);
  const users = useQuery(api.admin.users);
  const health = useQuery(api.admin.automationHealth);
  const setTrusted = useMutation(api.admin.setTrusted);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="display">Admin</h1>
          <p className="muted">Loans, lenders and the health of the n8n automations. Remove listings from the board.</p>
        </div>
      </div>

      <section className="section">
        <h2 className="display">Automation health</h2>
        <div className="grid">
          <div className="card">
            <div className="pixel">Deliveries in flight</div>
            <div className="display" style={{ fontSize: 34, lineHeight: "40px" }}>{health?.pendingCount ?? "–"}</div>
          </div>
          <div className="card">
            <div className="pixel">Failed deliveries</div>
            <div className="display" style={{ fontSize: 34, lineHeight: "40px", color: health?.failedEvents.length ? "var(--hud-request)" : undefined }}>
              {health?.failedEvents.length ?? "–"}
            </div>
          </div>
          <div className="card">
            <div className="pixel">Failed n8n runs</div>
            <div className="display" style={{ fontSize: 34, lineHeight: "40px", color: health?.workflowErrors.length ? "var(--hud-request)" : undefined }}>
              {health?.workflowErrors.length ?? "–"}
            </div>
          </div>
        </div>
        {(health?.workflowErrors.length || health?.failedEvents.length) ? (
          <div className="card table-scroll" style={{ marginTop: 14 }}>
            <table className="data">
              <thead>
                <tr><th>When</th><th>Where</th><th>What happened</th></tr>
              </thead>
              <tbody>
                {health.workflowErrors.map((e) => (
                  <tr key={e._id}>
                    <td>{timeAgo(e.at)}</td>
                    <td>{e.workflow} → {e.node} <span className="muted">#{e.executionId}</span></td>
                    <td>{e.message}</td>
                  </tr>
                ))}
                {health.failedEvents.map((e) => (
                  <tr key={e._id}>
                    <td>{timeAgo(e.at)}</td>
                    <td>Convex → n8n ({e.type})</td>
                    <td>{e.lastError} after {e.attempts} tries</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="section">
        <h2 className="display">Lenders</h2>
        <div className="card table-scroll">
          <table className="data">
            <thead>
              <tr><th>Name</th><th>Role</th><th>Listings</th><th>Trusted lender</th></tr>
            </thead>
            <tbody>
              {users?.map((u) => (
                <tr key={u._id}>
                  <td>{u.name}</td>
                  <td>{u.role}</td>
                  <td>{u.listings}</td>
                  <td>
                    <label className="row" style={{ gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={u.trustedLender}
                        onChange={(e) => setTrusted({ userId: u._id, trusted: e.target.checked }).catch((err) => alert(errorMessage(err)))}
                      />
                      {u.trustedLender ? <span className="badge badge-trusted">Trusted</span> : <span className="muted">No</span>}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2 className="display">All loans</h2>
        <div className="card table-scroll">
          <table className="data">
            <thead>
              <tr><th>Tool</th><th>Lender</th><th>Borrower</th><th>Dates</th><th>Status</th><th>Latest automation</th></tr>
            </thead>
            <tbody>
              {loans?.map((l) => (
                <tr key={l._id}>
                  <td>{l.toolName}</td>
                  <td>{l.lender.name}</td>
                  <td>{l.borrower.name}</td>
                  <td>{formatDay(l.startDate)} – {formatDay(l.endDate)}</td>
                  <td><LoanStatus loan={l} /></td>
                  <td className="muted">{l.activity[0] ? `${l.activity[0].summary}, ${timeAgo(l.activity[0].at)}` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loans?.length === 0 && <p className="empty">No loans yet.</p>}
        </div>
      </section>
    </>
  );
}

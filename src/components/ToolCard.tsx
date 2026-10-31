"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { PixelAvatar } from "@/components/PixelAvatar";
import { CATEGORY_LABEL, CONDITION_LABEL, errorMessage, formatDay, todayUtc } from "@/lib/labels";

export type ToolView = FunctionReturnType<typeof api.tools.list>[number];

export function AvailabilityBadge({ a }: { a: ToolView["availability"] }) {
  if (a.state === "available") return <span className="badge badge-live">Available</span>;
  if (a.state === "reserved") return <span className="badge badge-quiet">Free until {formatDay(a.from)}</span>;
  return a.overdue ? (
    <span className="badge badge-late">Overdue</span>
  ) : (
    <span className="badge badge-busy">On loan until {formatDay(a.until)}</span>
  );
}

export function ToolCard({
  tool,
  isAdmin,
  footer,
}: {
  tool: ToolView;
  isAdmin?: boolean;
  footer?: React.ReactNode;
}) {
  const removeAsAdmin = useMutation(api.admin.removeTool);
  const [requesting, setRequesting] = useState(false);

  return (
    <article className="card stack" style={{ gap: 12 }}>
      <div className="spread">
        <div>
          <h3>{tool.name}</h3>
          <div className="pixel" style={{ marginTop: 4 }}>
            {CATEGORY_LABEL[tool.category]} · {CONDITION_LABEL[tool.condition]}
          </div>
        </div>
        <AvailabilityBadge a={tool.availability} />
      </div>
      {tool.description && <p className="muted" style={{ margin: 0 }}>{tool.description}</p>}
      <div className="spread" style={{ alignItems: "center" }}>
        <div className="lender">
          <PixelAvatar id={tool.owner._id} label={`${tool.owner.name}'s avatar`} />
          <div>
            <div>{tool.isMine ? "You" : tool.owner.name}</div>
            {tool.owner.trusted && <span className="badge badge-trusted">Trusted lender</span>}
          </div>
        </div>
        <div className="row">
          {!tool.isMine && !footer && (
            <button className="btn btn-primary btn-sm" onClick={() => setRequesting(!requesting)}>
              {requesting ? "Close" : "Request"}
            </button>
          )}
          {isAdmin && !tool.isMine && (
            <button
              className="btn btn-sm btn-danger"
              onClick={() => {
                if (confirm(`Remove "${tool.name}" from LendLoop? Pending requests will be declined.`)) {
                  removeAsAdmin({ toolId: tool._id }).catch((e) => alert(errorMessage(e)));
                }
              }}
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {footer}
      {requesting && <RequestForm toolId={tool._id} onDone={() => setRequesting(false)} />}
    </article>
  );
}

function RequestForm({ toolId, onDone }: { toolId: ToolView["_id"]; onDone: () => void }) {
  const request = useMutation(api.loans.request);
  const today = todayUtc();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) return <p className="badge badge-live" style={{ justifySelf: "start" }}>Request sent</p>;

  return (
    <form
      className="stack"
      style={{ gap: 10 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await request({ toolId, startDate: start, endDate: end, message: message || undefined });
          setSent(true);
          setTimeout(onDone, 1500);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        <label className="field">
          <span className="pixel">From</span>
          <input className="input" type="date" min={today} value={start} required onChange={(e) => {
            setStart(e.target.value);
            if (end < e.target.value) setEnd(e.target.value);
          }} />
        </label>
        <label className="field">
          <span className="pixel">Until</span>
          <input className="input" type="date" min={start} value={end} required onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span className="pixel">Note to the lender (optional)</span>
        <input className="input" maxLength={280} value={message} placeholder="What's it for?" onChange={(e) => setMessage(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}

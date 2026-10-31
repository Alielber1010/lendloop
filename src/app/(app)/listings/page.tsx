"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { ToolCard, type ToolView } from "@/components/ToolCard";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  CONDITIONS,
  CONDITION_LABEL,
  errorMessage,
  type Category,
  type Condition,
} from "@/lib/labels";

type Draft = { name: string; category: Category; condition: Condition; description: string };
const EMPTY: Draft = { name: "", category: "power_tools", condition: "good", description: "" };

export default function MyListings() {
  const tools = useQuery(api.tools.mine);
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState<ToolView | null>(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="display">My listings</h1>
          <p className="muted">Tools you&apos;re happy to lend.</p>
        </div>
      </div>

      <ListingForm key={editing?._id ?? "new"} editing={editing} onDone={() => setEditing(null)} />

      <section className="section">
        {tools === undefined ? (
          <p className="muted">Loading…</p>
        ) : tools.length === 0 ? (
          <div className="card empty">You haven&apos;t listed anything yet.</div>
        ) : (
          <div className="grid">
            {tools.map((t) => (
              <ToolCard
                key={t._id}
                tool={t}
                footer={
                  <div className="row">
                    <button className="btn btn-sm" onClick={() => setEditing(t)}>
                      Edit
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => {
                        if (confirm(`Delete "${t.name}"? Pending requests will be declined.`)) {
                          remove({ toolId: t._id }).catch((e) => alert(errorMessage(e)));
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                }
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function ListingForm({ editing, onDone }: { editing: ToolView | null; onDone: () => void }) {
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const [draft, setDraft] = useState<Draft>(
    editing
      ? { name: editing.name, category: editing.category, condition: editing.condition, description: editing.description }
      : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          if (editing) await update({ toolId: editing._id, ...draft });
          else await create(draft);
          setDraft(EMPTY);
          onDone();
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="display" style={{ margin: 0, fontSize: 20 }}>
        {editing ? `Edit ${editing.name}` : "List a tool"}
      </h2>
      <div className="form-grid">
        <label className="field">
          <span className="pixel">Name</span>
          <input className="input" required minLength={2} maxLength={60} value={draft.name} placeholder="Cordless drill" onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className="field">
          <span className="pixel">Category</span>
          <select className="select" value={draft.category} onChange={(e) => set("category", e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="pixel">Condition</span>
          <select className="select" value={draft.condition} onChange={(e) => set("condition", e.target.value as Condition)}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="pixel">Short description</span>
        <textarea className="textarea" maxLength={400} value={draft.description} placeholder="18V, two batteries, bits included." onChange={(e) => set("description", e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save changes" : "List it"}
        </button>
        {editing && (
          <button type="button" className="btn" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

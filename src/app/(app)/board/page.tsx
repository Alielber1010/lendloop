"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { ToolCard } from "@/components/ToolCard";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/labels";

export default function Board() {
  const [category, setCategory] = useState<Category | undefined>();
  const tools = useQuery(api.tools.list, { category });
  const me = useQuery(api.users.me);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="display">All tools</h1>
          <p className="muted">Everything your neighbours are willing to lend.</p>
        </div>
      </div>
      <div className="pills" role="group" aria-label="Filter by category" style={{ marginBottom: 18 }}>
        <button className="pill" aria-pressed={!category} onClick={() => setCategory(undefined)}>
          All
        </button>
        {CATEGORIES.map((c) => (
          <button key={c} className="pill" aria-pressed={category === c} onClick={() => setCategory(c)}>
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      {tools === undefined ? (
        <p className="muted">Loading…</p>
      ) : tools.length === 0 ? (
        <div className="card empty">No tools in this category yet.</div>
      ) : (
        <div className="grid">
          {tools.map((t) => (
            <ToolCard key={t._id} tool={t} isAdmin={me?.role === "admin"} />
          ))}
        </div>
      )}
    </>
  );
}

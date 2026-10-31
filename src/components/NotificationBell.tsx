"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { timeAgo } from "@/lib/labels";

/** In-app inbox. n8n writes these via the signed write-back endpoint. */
export function NotificationBell() {
  const items = useQuery(api.notifications.mine) ?? [];
  const markAllRead = useMutation(api.notifications.markAllRead);
  const [open, setOpen] = useState(false);
  const unread = items.filter((n) => !n.read).length;

  return (
    <div className="bell">
      <button
        className="btn btn-sm"
        aria-expanded={open}
        aria-label={`Notifications, ${unread} unread`}
        onClick={() => {
          setOpen(!open);
          if (!open && unread) void markAllRead();
        }}
      >
        Inbox
      </button>
      {unread > 0 && <span className="bell-count">{unread}</span>}
      {open && (
        <div className="popover" role="dialog" aria-label="Notifications">
          {items.length === 0 ? (
            <p className="muted" style={{ margin: 10 }}>
              No notifications yet.
            </p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n._id} className={n.read ? "" : "unread"}>
                  {n.message}
                  <div className="pixel" style={{ marginTop: 4 }}>
                    {timeAgo(n.at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import CafeAvatar from "@/lib/cafe/avatar-engine";

/** FNV-1a: turns an opaque user id into a stable seed, so a neighbour always looks the same. */
function seedFrom(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * A neighbour's chibi pixel avatar from the Virtual Cafe design system.
 * Head and shoulders only (cropped at row 26), drawn at a whole-number scale.
 */
export function PixelAvatar({ id, scale = 2, label }: { id: string; scale?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rows = 26;

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, CafeAvatar.W * scale, rows * scale);
    const { avatar } = CafeAvatar.roll(seedFrom(id));
    CafeAvatar.draw(ctx, avatar, { pose: "stand", scale, shadow: false, cropBottom: rows });
  }, [id, scale]);

  return (
    <canvas
      ref={ref}
      className="avatar"
      width={CafeAvatar.W * scale}
      height={rows * scale}
      role="img"
      aria-label={label}
    />
  );
}

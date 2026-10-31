// Types for the Café Radio Avatar Engine (from the "Virtual Cafe radio themes" design system).
export type Avatar = Record<string, unknown>;

declare const CafeAvatar: {
  W: number;
  H: number;
  roll(seed: number, opts?: { odds?: { basic?: number; mid?: number; legendary?: number } }): {
    avatar: Avatar;
    rarity: "basic" | "mid" | "legendary";
  };
  draw(
    ctx: CanvasRenderingContext2D,
    avatar: Avatar,
    opts?: { pose?: string; blink?: boolean; scale?: number; x?: number; y?: number; shadow?: boolean; cropBottom?: number },
  ): void;
};

export default CafeAvatar;

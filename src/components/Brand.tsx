import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="LendLoop home">
      <span className="brand-mark" aria-hidden>
        L
      </span>
      <span className="brand-name">LendLoop</span>
    </Link>
  );
}

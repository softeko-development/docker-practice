import Link from "next/link";
import type { Pagination } from "@/lib/types";

export function Pager({ meta, search }: { meta: Pagination; search?: string }) {
  const href = (page: number) => {
    const qs = new URLSearchParams({ page: String(page) });
    if (search) qs.set("search", search);
    return `/?${qs}`;
  };

  return (
    <nav className="pager">
      {meta.page > 1 ? <Link href={href(meta.page - 1)}>← Prev</Link> : <span />}
      <span className="muted">
        Page {meta.page} of {Math.max(meta.totalPages, 1)} · {meta.total} users
      </span>
      {meta.page < meta.totalPages ? <Link href={href(meta.page + 1)}>Next →</Link> : <span />}
    </nav>
  );
}

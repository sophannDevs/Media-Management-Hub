"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { MediaNavLink } from "./media-nav";

export function MediaPagination({ page, pageCount, total, pageSize }: { page: number; pageCount: number; total: number; pageSize: number }) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground tabular-nums">{from}–{to}</span> of <span className="tabular-nums">{total}</span> files
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <PageButton page={page - 1} disabled={page <= 1}>
            <ChevronLeft />
            Previous
          </PageButton>
          <span className="px-1 text-sm text-muted-foreground tabular-nums">
            Page {page} of {pageCount}
          </span>
          <PageButton page={page + 1} disabled={page >= pageCount}>
            Next
            <ChevronRight />
          </PageButton>
        </div>
      )}
    </nav>
  );
}

function PageButton({ page, disabled, children }: { page: number; disabled: boolean; children: ReactNode }) {
  if (disabled) {
    return (
      <Button variant="outline" size="lg" className="bg-white" disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="lg" className="bg-white" asChild>
      <MediaNavLink patch={{ page }} scrollTop>
        {children}
      </MediaNavLink>
    </Button>
  );
}

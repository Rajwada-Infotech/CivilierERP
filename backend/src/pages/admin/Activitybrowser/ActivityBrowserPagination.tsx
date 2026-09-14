// pages/admin/activity-browser/ActivityBrowserPagination.tsx
import React from "react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

type Props = {
  activity: any;
  setPage: (page: number) => void;
  isLoading: boolean;
};

export const ActivityBrowserPagination: React.FC<Props> = ({
  activity,
  setPage,
  isLoading,
}) => {
  if (isLoading || !activity?.pages || activity.pages <= 1) return null;

  return (
    <div className="flex justify-center pt-8">
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={() => setPage(Math.max(1, activity.page - 1))}
              className={
                activity.page === 1 ? "pointer-events-none opacity-50" : ""
              }
            />
          </PaginationItem>

          {Array.from(
            { length: Math.min(5, activity.pages) },
            (_, i) => activity.page - 2 + i,
          )
            .filter((p) => p >= 1 && p <= activity.pages)
            .map((p) => (
              <PaginationItem key={p}>
                <PaginationLink
                  isActive={p === activity.page}
                  onClick={() => setPage(p)}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}

          <PaginationItem>
            <PaginationNext
              onClick={() =>
                setPage(Math.min(activity.pages, activity.page + 1))
              }
              className={
                activity.page === activity.pages
                  ? "pointer-events-none opacity-50"
                  : ""
              }
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
};

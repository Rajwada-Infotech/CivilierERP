export interface TicketPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface TicketListResponse<T> {
  data: T[];
  pagination?: TicketPagination;
}

export function unwrapTicketList<T>(payload: unknown): TicketListResponse<T> {
  if (Array.isArray(payload)) {
    return { data: payload as T[] };
  }

  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    const response = payload as {
      data: T[];
      pagination?: TicketPagination;
    };
    return {
      data: response.data,
      pagination: response.pagination,
    };
  }

  return { data: [] };
}

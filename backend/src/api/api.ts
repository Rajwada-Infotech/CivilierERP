/**
 * Standard Enterprise API Response Format
 * Expected to be returned by all endpoints (Express/Node.js)
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data: T;
  errors?: string[];
  metadata?: Record<string, unknown>; // E.g., Pagination details
  requestId?: string;
  timestamp?: string;
}
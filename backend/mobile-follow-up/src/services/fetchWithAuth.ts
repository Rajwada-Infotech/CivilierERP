// RN port of src/lib/fetchWithAuth.ts. Same contract (Bearer token, 401/403
// handling, ApiError), adapted for two things the web version leans on that
// don't exist here: localStorage/sessionStorage (-> expo-secure-store,
// async) and window.location.href (-> sessionEvents, consumed by
// AuthContext).
import { apiUrl } from "@/utils/apiBase";
import { getToken, clearAuthStorage } from "./authStorage";
import { emitSessionExpired } from "./sessionEvents";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface FetchWithAuthOptions extends RequestInit {
  skipActivityLog?: boolean;
}

// A Promise (not a boolean) so concurrent 401s share the same in-flight
// clear+emit instead of racing: two requests can both observe the flag
// unset before either sets it, but only the assignment below is
// synchronous — the awaited work happens inside it, so the second request
// always sees the first's in-progress promise, not a stale flag.
let sessionExpiredFlow: Promise<void> | null = null;

export async function fetchWithAuth(
  url: string,
  options: FetchWithAuthOptions = {},
): Promise<Response> {
  const { skipActivityLog, ...fetchOptions } = options;
  const token = await getToken();

  if (sessionExpiredFlow) {
    if (token) {
      sessionExpiredFlow = null;
    } else {
      throw new ApiError("Authentication redirect in progress.", 401);
    }
  }

  const isFormData =
    typeof FormData !== "undefined" && fetchOptions.body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(apiUrl(url), {
      ...fetchOptions,
      headers: {
        ...(!isFormData ? { "Content-Type": "application/json" } : {}),
        ...(fetchOptions.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(skipActivityLog ? { "X-Skip-Activity-Log": "1" } : {}),
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    console.error("Network error:", err);
    throw new Error("Network error. Please check your connection.");
  }

  if (response.status === 401) {
    if (!sessionExpiredFlow) {
      sessionExpiredFlow = (async () => {
        try {
          await clearAuthStorage();
          emitSessionExpired();
        } finally {
          sessionExpiredFlow = null;
        }
      })();
    }
    await sessionExpiredFlow;
    throw new ApiError("Session expired. Please login again.", response.status);
  }

  if (response.status === 403) {
    throw new ApiError(
      "You do not have permission to perform this action.",
      response.status,
    );
  }

  return response;
}

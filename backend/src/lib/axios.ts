import { fetchWithAuth } from "@/lib/fetchWithAuth";

type RequestConfig = {
  url?: string;
  method?: string;
  data?: unknown;
  headers?: Record<string, string>;
};

type ResponseLike<T = unknown> = {
  data: T;
  status: number;
};

async function request<T = unknown>(config: RequestConfig): Promise<ResponseLike<T>> {
  const response = await fetchWithAuth(config.url || "", {
    method: config.method || "GET",
    headers: config.headers,
    body: config.data !== undefined ? JSON.stringify(config.data) : undefined,
  });

  const data = (await response.json().catch(() => null)) as T;
  return {
    data,
    status: response.status,
  };
}

const axiosInstance = {
  request,
  get: <T = unknown>(url: string, config?: Omit<RequestConfig, "url" | "method">) =>
    request<T>({ ...config, url, method: "GET" }),
  post: <T = unknown>(
    url: string,
    data?: unknown,
    config?: Omit<RequestConfig, "url" | "method" | "data">,
  ) => request<T>({ ...config, url, method: "POST", data }),
  put: <T = unknown>(
    url: string,
    data?: unknown,
    config?: Omit<RequestConfig, "url" | "method" | "data">,
  ) => request<T>({ ...config, url, method: "PUT", data }),
  patch: <T = unknown>(
    url: string,
    data?: unknown,
    config?: Omit<RequestConfig, "url" | "method" | "data">,
  ) => request<T>({ ...config, url, method: "PATCH", data }),
  delete: <T = unknown>(url: string, config?: Omit<RequestConfig, "url" | "method">) =>
    request<T>({ ...config, url, method: "DELETE" }),
};

export default axiosInstance;

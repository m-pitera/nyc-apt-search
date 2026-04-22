import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
const AUTH_TOKEN_COOKIE = "__Host-nyc_apt_token";
let appToken = readRememberedToken();

function readRememberedToken(): string {
  if (typeof document === "undefined") return "";
  try {
    return (
      document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${AUTH_TOKEN_COOKIE}=`))
        ?.slice(AUTH_TOKEN_COOKIE.length + 1) || ""
    );
  } catch {
    return "";
  }
}

function writeRememberedToken(token: string) {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${AUTH_TOKEN_COOKIE}=${encodeURIComponent(token)}; Max-Age=2592000; Path=/; Secure; SameSite=Strict`;
  } catch {
    // Remember-me is a convenience feature. If cookies are unavailable, keep the token in memory only.
  }
}

export function setAppToken(token: string, remember: boolean) {
  appToken = token;
  if (remember) {
    writeRememberedToken(token);
  }
}

function authHeaders(data?: unknown): HeadersInit {
  return {
    ...(data ? { "Content-Type": "application/json" } : {}),
    ...(appToken ? { "X-App-Token": appToken } : {}),
  };
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: authHeaders(data),
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, {
      headers: authHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      staleTime: 0,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

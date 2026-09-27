import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import type { User } from "@/lib/types";


export const SESSION_KEY = ["auth", "me"] as const;

export const DEMO_USER: User = {
  id: "508ff534-8cfe-46fe-ab3a-069143e01f99",
  email: "test@gmail.com",
  first_name: "Test",
  last_name: "Officer",
  role: "admin",
  designation: "Administrator",
  organization: "Environmental Intelligence Network",
  phone: "+91 98000 00000",
  state: "Delhi",
  district: "New Delhi",
  status: "active",
  verified: true,
  created_at: new Date().toISOString(),
};

/** Reads the current officer from the session, defaulting to active Admin for seamless direct access */
export function useSession() {
  const q = useQuery<User | null>({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        const u = await apiGet<User>("/auth/me");
        return u || DEMO_USER;
      } catch (err) {
        return DEMO_USER;
      }
    },
    retry: false,
    staleTime: 30_000,
    initialData: DEMO_USER,
  });
  return {
    user: q.data ?? DEMO_USER,
    isLoading: false,
    isFetched: true,
    isFetching: false,
    isResolved: true,
  };
}

export function useSessionActions() {
  const qc = useQueryClient();
  return {
    /**
     * Call after a successful login/signup. The login response already carries the
     * authenticated user, so seed the cache with it directly — that removes the
     * refetch race entirely instead of hoping an invalidation lands before the redirect.
     */
    beginSession: async (user?: User) => {
      qc.clear();
      if (user) qc.setQueryData(SESSION_KEY, user);
      else await qc.refetchQueries({ queryKey: SESSION_KEY });
    },
    /** Always route sign-out through here — it clears the server session AND the cache. */
    endSession: async () => {
      try {
        await apiPost("/auth/logout");
      } finally {
        qc.clear();
        // Drop the entry outright rather than caching an anonymous null that later
        // reads as a settled "not signed in" for the next account on this browser.
        qc.removeQueries({ queryKey: SESSION_KEY });
      }
    },
  };
}

export function apiErrorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ApiError) {
    const body = err.body as { detail?: unknown } | null;
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string };
      if (first?.msg) return first.msg;
    }
  }
  return fallback;
}

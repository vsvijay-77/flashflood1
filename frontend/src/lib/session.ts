import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import type { User } from "@/lib/types";

import { supabase } from "./supabase";

export const SESSION_KEY = ["auth", "me"] as const;

/** Reads the current officer from the httpOnly session cookie. Never throws upward. */
export function useSession() {
  const q = useQuery<User | null>({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) return null;
        
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();
          
        if (profileError || !profile) return { id: session.user.id, role: "admin", first_name: "Official", last_name: "User" } as User;
        
        return {
          id: session.user.id,
          email: session.user.email,
          ...profile,
          status: "active",
          verified: true
        } as User;
      } catch (err) {
        return null;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
  return {
    user: q.data ?? null,
    isLoading: q.isLoading,
    isFetched: q.isFetched,
    isFetching: q.isFetching,
    // A guard must never redirect off a STALE null: after a logout the cache holds an
    // anonymous null, so `isFetched` alone stays true into the next login and would bounce
    // an authenticated user straight back to /login. Resolved = we have a user, or we have
    // finished a fetch that is not currently being superseded.
    isResolved: q.data != null || (q.isFetched && !q.isFetching),
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
        await supabase.auth.signOut();
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

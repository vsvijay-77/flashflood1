import { QueryClient, dehydrate, hydrate } from "@tanstack/react-query";

const BROWSER_CACHE_KEY = "EIN_BROWSER_QUERY_CACHE_V1";
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute fresh cache avoids redundant network requests
      gcTime: 10 * 60 * 1000, // 10 minutes garbage collection keeping data in memory
      refetchOnWindowFocus: false, // Prevent jarring refetches on window blur/focus
      retry: 1,
    },
  },
});

// Immediately restore cached queries from browser localStorage on app load
try {
  const serialized = localStorage.getItem(BROWSER_CACHE_KEY);
  if (serialized) {
    const { timestamp, dehydratedState } = JSON.parse(serialized);
    if (Date.now() - timestamp < MAX_CACHE_AGE_MS) {
      hydrate(queryClient, dehydratedState);
    } else {
      localStorage.removeItem(BROWSER_CACHE_KEY);
    }
  }
} catch (e) {
  console.warn("Browser query cache restore notice:", e);
}

// Automatically save loaded data to browser cache after query succeeds
let persistTimer: ReturnType<typeof setTimeout> | null = null;

queryClient.getQueryCache().subscribe((event) => {
  if (event.type === "updated" && event.action.type === "success") {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try {
        const dehydratedState = dehydrate(queryClient, {
          shouldDehydrateQuery: (query) => {
            const keyStr = JSON.stringify(query.queryKey);
            return query.state.status === "success" && !keyStr.includes("password") && !keyStr.includes("auth");
          },
        });
        localStorage.setItem(
          BROWSER_CACHE_KEY,
          JSON.stringify({
            timestamp: Date.now(),
            dehydratedState,
          })
        );
      } catch (e) {
        console.warn("Browser query cache persist notice:", e);
      }
    }, 400);
  }
});


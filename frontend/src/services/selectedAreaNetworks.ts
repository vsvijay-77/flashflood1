import { extractNetworks } from "@/lib/routingApi";

/** Retry failed layers; the backend reuses each successfully saved layer. */
export async function loadSelectedAreaNetworks(params: Parameters<typeof extractNetworks>[0], signal: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    if (attempt > 0) {
      // Back off before retrying: 2s, then 4s
      await new Promise<void>((resolve, reject) => {
        const delay = attempt * 2000;
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delay);
        signal.addEventListener("abort", abort, { once: true });
      });
      signal.throwIfAborted();
    }
    try {
      const result = await extractNetworks(params, signal);
      if (result.status === "success" && result.osm_loading?.complete === true) return result;
      // Partial success — all saved layers will be reused on the next attempt
      lastError = new Error("Some network layers are incomplete");
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
    }
  }
  throw lastError;
}

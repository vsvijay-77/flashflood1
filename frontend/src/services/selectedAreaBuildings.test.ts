import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractBuildings } from "@/lib/routingApi";
import { loadSelectedAreaBuildings } from "./selectedAreaBuildings";

vi.mock("@/lib/routingApi", () => ({ extractBuildings: vi.fn() }));

const boundary: [number, number][] = [[10, 77], [10, 77.01], [10.01, 77.01], [10.01, 77]];
const feature = { type: "Feature", geometry: { type: "Polygon", coordinates: [[[77, 10], [77.01, 10], [77.01, 10.01], [77, 10]]] }, properties: { id: "1" } } as never;
const complete = (features: unknown[] = [feature]) => ({
  status: "success",
  osm_loading: { complete: true },
  buildings: { geojson: { features } },
} as never);

describe("selected area building loading", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("forwards the area identity to the backend", async () => {
    vi.mocked(extractBuildings).mockResolvedValue(complete([]));
    expect(await loadSelectedAreaBuildings(boundary, new AbortController().signal, undefined, "area-id")).toEqual([]);
    expect(extractBuildings).toHaveBeenCalledExactlyOnceWith(
      { polygon: boundary, area_id: "area-id", area_key: undefined },
      expect.any(AbortSignal),
    );
  });

  it("returns all backend features without additional polygon filtering", async () => {
    vi.mocked(extractBuildings).mockResolvedValue(complete([feature, feature]));
    const result = await loadSelectedAreaBuildings(boundary, new AbortController().signal);
    expect(result).toHaveLength(2);
  });

  it("retries partial responses even when they contain a buildings array", async () => {
    vi.mocked(extractBuildings)
      .mockResolvedValueOnce({ status: "success", osm_loading: { complete: false }, buildings: { geojson: { features: [] } } } as never)
      .mockResolvedValue(complete());
    const result = loadSelectedAreaBuildings(boundary, new AbortController().signal);
    await vi.runAllTimersAsync();
    expect(await result).toHaveLength(1);
    expect(extractBuildings).toHaveBeenCalledTimes(2);
  });

  it("reports unavailable data after retries instead of generating buildings", async () => {
    vi.mocked(extractBuildings).mockRejectedValue(new Error("offline"));
    const result = expect(loadSelectedAreaBuildings(boundary, new AbortController().signal)).rejects.toThrow("offline");
    await vi.runAllTimersAsync();
    await result;
    expect(extractBuildings).toHaveBeenCalledTimes(3);
  });

  it("cancels retry work when switching areas", async () => {
    const controller = new AbortController();
    vi.mocked(extractBuildings).mockRejectedValue(new Error("busy"));
    const result = expect(loadSelectedAreaBuildings(boundary, controller.signal)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.runAllTimersAsync();
    await result;
    expect(extractBuildings).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, expect, it, vi } from "vitest";
import { extractNetworks } from "@/lib/routingApi";
import { loadSelectedAreaNetworks } from "./selectedAreaNetworks";

vi.mock("@/lib/routingApi", () => ({ extractNetworks: vi.fn() }));

beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); });

it("retries incomplete layers and retains exact area parameters", async () => {
  const complete = { status: "success", osm_loading: { complete: true } } as never;
  vi.mocked(extractNetworks)
    .mockResolvedValueOnce({ status: "success", osm_loading: { complete: false } } as never)
    .mockResolvedValue(complete);
  const params = { area_id: "area-a", polygon: [[10, 77], [10, 78], [11, 78]] };
  const signal = new AbortController().signal;
  const resultPromise = loadSelectedAreaNetworks(params, signal);
  await vi.runAllTimersAsync();
  expect(await resultPromise).toBe(complete);
  expect(extractNetworks).toHaveBeenNthCalledWith(2, params, signal);
});

it("never treats exhausted failures as an empty completed map", async () => {
  vi.mocked(extractNetworks).mockResolvedValue({ status: "success", osm_loading: { complete: false } } as never);
  const resultPromise = expect(loadSelectedAreaNetworks({}, new AbortController().signal)).rejects.toThrow("incomplete");
  await vi.runAllTimersAsync();
  await resultPromise;
  expect(extractNetworks).toHaveBeenCalledTimes(3);
});

it("stops requests when the selected area changes", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(loadSelectedAreaNetworks({}, controller.signal)).rejects.toThrow();
  expect(extractNetworks).not.toHaveBeenCalled();
});

it("shows available geometry while retrying and preserves it if retries fail", async () => {
  const partial = {
    status: "success", osm_loading: { complete: false },
    roads: { geojson: { features: [{ properties: { id: "way-1" } }] } },
    rivers: { geojson: { features: [] } },
  } as never;
  vi.mocked(extractNetworks).mockResolvedValueOnce(partial).mockRejectedValue(new Error("timeout"));
  const onProgress = vi.fn();
  const resultPromise = loadSelectedAreaNetworks({}, new AbortController().signal, onProgress);
  await vi.runAllTimersAsync();
  expect(await resultPromise).toBe(partial);
  expect(onProgress).toHaveBeenCalledWith(partial);
});

it("retains roads when a later instance returns only rivers", async () => {
  const roads = { geojson: { features: [{ properties: { id: "road" } }] } };
  const rivers = { geojson: { features: [{ properties: { id: "river" } }] } };
  const empty = { geojson: { features: [] } };
  vi.mocked(extractNetworks)
    .mockResolvedValueOnce({ status: "success", osm_loading: { complete: false }, roads, rivers: empty } as never)
    .mockResolvedValueOnce({ status: "success", osm_loading: { complete: false }, roads: empty, rivers } as never)
    .mockRejectedValue(new Error("timeout"));
  const promise = loadSelectedAreaNetworks({}, new AbortController().signal);
  await vi.runAllTimersAsync();
  const result = await promise;
  expect(result.roads).toBe(roads);
  expect(result.rivers).toBe(rivers);
  expect(result.osm_loading?.complete).toBe(false);
});

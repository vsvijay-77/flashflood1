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

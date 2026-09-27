import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import manifest from "./bundledAreaManifest.json";
import { loadSelectedAreaNetworks } from "./selectedAreaNetworks";
import { loadSelectedAreaBuildings } from "./selectedAreaBuildings";
import { bundledAreaEntry, loadBundledArea } from "./bundledArea";
import { prepareBuildingFootprints } from "@/components/gis/buildingGeometry";
import { extractNetworks, extractBuildings } from "@/lib/routingApi";

vi.mock("@/lib/routingApi", () => ({ extractNetworks: vi.fn(), extractBuildings: vi.fn() }));
const entry = manifest[0];
const snapshot = JSON.parse(readFileSync(new URL(`../../public/prebaked_zones/${entry.file}`, import.meta.url), "utf8"));
const params = { area_id: entry.area_id, polygon: entry.polygon };
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

it("loads all saved houses, paths and rivers while API is unavailable", async () => {
  vi.mocked(extractNetworks).mockRejectedValue(new Error("API offline"));
  vi.mocked(extractBuildings).mockRejectedValue(new Error("API offline"));
  const fetchFile = vi.fn().mockImplementation(async () => new Response(JSON.stringify(snapshot)));
  vi.stubGlobal("fetch", fetchFile);
  const signal = new AbortController().signal;
  const data = await loadSelectedAreaNetworks(params, signal);
  expect(data.roads.geojson.features).toHaveLength(194);
  expect(data.rivers.geojson.features).toHaveLength(349);
  expect(data.buildings?.geojson.features).toHaveLength(2647);
  const houses = await loadSelectedAreaBuildings(entry.polygon as [number, number][], signal, undefined, entry.area_id);
  expect(houses).toHaveLength(2647);
  expect(prepareBuildingFootprints(houses, entry.polygon as [number, number][])).toHaveLength(2647);
  expect(extractNetworks).not.toHaveBeenCalled();
  expect(extractBuildings).not.toHaveBeenCalled();
  expect(fetchFile).toHaveBeenCalledWith(expect.stringContaining(`/prebaked_zones/${entry.file}?v=`), { signal });
});

it("rejects other areas and changed boundaries instead of showing Zone 2 everywhere", () => {
  expect(bundledAreaEntry({ ...params, area_id: "another-area" })).toBeUndefined();
  expect(bundledAreaEntry({ ...params, polygon: [[31, 78], [31, 79], [32, 79]] })).toBeUndefined();
  expect(bundledAreaEntry({ lat: 31, lng: 79 })).toBeUndefined();
  expect(bundledAreaEntry({ area_id: entry.area_id, north: 31 })).toBeUndefined();
  expect(bundledAreaEntry({ ...params, area_id: `dt-area-${entry.area_id}` })).toBeDefined();
});

it("does not accept HTML rewrites or truncated geometry as a complete snapshot", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>SPA</html>")));
  expect(await loadBundledArea(params, new AbortController().signal)).toBeNull();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...snapshot, buildings: { geojson: { features: [] } } }))));
  expect(await loadBundledArea(params, new AbortController().signal)).toBeNull();
});

it("aborts the static fetch when changing area", async () => {
  const controller = new AbortController();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => { controller.abort(); throw controller.signal.reason; }));
  await expect(loadBundledArea(params, controller.signal)).rejects.toThrow();
});

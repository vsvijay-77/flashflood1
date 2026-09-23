import { describe, expect, it, vi } from "vitest";
import { addMultiHazardLayer } from "./multiHazardCesium";
import type { MultiHazardFeature } from "@/lib/multiHazard";

const node: MultiHazardFeature = {
  type: "Feature", geometry: { type: "Point", coordinates: [76.5, 10.5] },
  properties: {
    node_id: "<script>node</script>", timestamp: "2026-09-22T12:00:00Z", model_version: "model-1",
    flood_probability: 0.71, landslide_probability: 0.25, combined_risk: 0.67,
    confidence: null, lead_time_minutes: null, risk_class: "HIGH",
  },
};

function setup() {
  let completeLoad!: () => void;
  const loading = new Promise<void>(resolve => { completeLoad = resolve; });
  const entity: Record<string, unknown> = { billboard: "default pin" };
  const source = { load: vi.fn((_data: { features: MultiHazardFeature[] }, _options: unknown) => loading), entities: { getById: vi.fn(() => entity), removeAll: vi.fn() } };
  const active = new Set<unknown>();
  const viewer = {
    isDestroyed: vi.fn(() => false), scene: { requestRender: vi.fn() },
    dataSources: {
      contains: vi.fn((value: unknown) => active.has(value)),
      add: vi.fn(async (value: unknown) => { active.add(value); return value; }),
      remove: vi.fn((value: unknown) => active.delete(value)),
    },
  };
  const cesium = {
    GeoJsonDataSource: class { constructor() { return source; } },
    PointGraphics: class { constructor(options: object) { Object.assign(this, options); } },
    Color: { WHITE: "white", fromCssColorString: (value: string) => value },
    HeightReference: { CLAMP_TO_GROUND: 1 },
  };
  const error = vi.fn();
  return { source, entity, viewer, cesium, completeLoad, error };
}

describe("Cesium API risk layer lifecycle", () => {
  it("loads only API coordinates, escapes popup text, and removes the source on teardown", async () => {
    const { cesium, viewer, source, entity, completeLoad, error } = setup();
    const cleanup = addMultiHazardLayer(cesium, viewer, [node], error);
    completeLoad();
    await vi.waitFor(() => expect(viewer.dataSources.add).toHaveBeenCalledOnce());
    expect(source.load.mock.calls[0][0].features[0].geometry.coordinates).toEqual([76.5, 10.5]);
    expect(entity.description).toContain("&lt;script&gt;node&lt;/script&gt;");
    expect(entity.description).not.toContain("<script>");
    expect(entity.description).toContain("71.0%");
    expect(entity.description).toContain("—");
    expect(entity.billboard).toBeUndefined();
    cleanup();
    expect(viewer.dataSources.remove).toHaveBeenCalledWith(source, true);
    expect(error).not.toHaveBeenCalled();
  });

  it("does not attach a late GeoJSON load after changing areas", async () => {
    const { cesium, viewer, completeLoad, error } = setup();
    const cleanup = addMultiHazardLayer(cesium, viewer, [node], error);
    cleanup();
    completeLoad();
    await Promise.resolve();
    await Promise.resolve();
    expect(viewer.dataSources.add).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("does not attach a late load after the viewer is destroyed", async () => {
    const { cesium, viewer, completeLoad, error } = setup();
    addMultiHazardLayer(cesium, viewer, [node], error);
    viewer.isDestroyed.mockReturnValue(true);
    completeLoad();
    await Promise.resolve();
    expect(viewer.dataSources.add).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

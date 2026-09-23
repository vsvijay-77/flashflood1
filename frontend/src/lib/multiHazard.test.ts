import { describe, expect, it } from "vitest";
import { formatHazardLeadTime, formatHazardProbability, parseMultiHazardHeatmap, selectAreaPredictions, type MultiHazardFeature, type MultiHazardHeatmap } from "./multiHazard";

const polygon: [number, number][] = [[10, 76], [11, 76], [11, 77], [10, 77]];
const feature = (coordinates: [number, number] = [76.5, 10.5], areaId: string | undefined = "area-a"): MultiHazardFeature => ({
  type: "Feature", geometry: { type: "Point", coordinates },
  properties: {
    node_id: "node-1", timestamp: "2026-09-22T12:00:00Z", model_version: "model-1", area_id: areaId,
    flood_probability: 0.71, landslide_probability: 0.25, combined_risk: 0.67,
    confidence: null, lead_time_minutes: null, risk_class: "HIGH",
  },
});
const collection = (features: MultiHazardFeature[]): MultiHazardHeatmap => ({ type: "FeatureCollection", features });

describe("API multi-hazard predictions", () => {
  it("preserves real zero probabilities and unavailable confidence and lead time", () => {
    const node = feature();
    node.properties.flood_probability = 0;
    expect(parseMultiHazardHeatmap(collection([node])).features[0].properties.flood_probability).toBe(0);
    expect(formatHazardProbability(0)).toBe("0.0%");
    expect(formatHazardProbability(null)).toBe("—");
    expect(formatHazardLeadTime(null)).toBe("—");
    expect(formatHazardLeadTime(0)).toBe("0 min");
  });

  it("rejects missing probabilities rather than synthesizing a zero", () => {
    const node = feature();
    const invalid = { ...node, properties: { ...node.properties, flood_probability: undefined } };
    expect(() => parseMultiHazardHeatmap({ type: "FeatureCollection", features: [invalid] })).toThrow("invalid node predictions");
    expect(() => parseMultiHazardHeatmap({ type: "FeatureCollection", features: [{ ...node, geometry: { type: "Point", coordinates: [76, 100] } }] })).toThrow();
  });

  it("accepts an empty snapshot without generating demonstration nodes", () => {
    expect(parseMultiHazardHeatmap(collection([])).features).toEqual([]);
    expect(selectAreaPredictions(collection([]), "area-a", polygon)).toEqual([]);
  });

  it("interprets GeoJSON longitude first and clips to the selected latitude-first polygon including boundaries", () => {
    const inside = feature();
    const boundary = feature([76, 10]);
    expect(selectAreaPredictions(collection([inside, boundary, feature([10.5, 76.5]), feature([78, 10.5])]), "area-a", polygon))
      .toEqual([inside, boundary]);
  });

  it("prevents another area's cached results appearing at overlapping coordinates", () => {
    expect(selectAreaPredictions(collection([feature(undefined, "area-b")]), "area-a", polygon)).toEqual([]);
    const snapshot = { ...collection([feature()]), metadata: { area_id: "area-b" } };
    expect(selectAreaPredictions(snapshot, "area-a", polygon)).toEqual([]);
  });

  it("requires a selected area or polygon, and explicit area ownership without a polygon", () => {
    expect(selectAreaPredictions(collection([feature()]))).toEqual([]);
    const unscoped = feature();
    delete unscoped.properties.area_id;
    expect(selectAreaPredictions(collection([unscoped]), "area-a")).toEqual([]);
    expect(selectAreaPredictions({ ...collection([unscoped]), metadata: { area_id: "area-a" } }, "area-a")).toEqual([unscoped]);
    expect(selectAreaPredictions(collection([unscoped]), undefined, polygon)).toEqual([unscoped]);
  });

  it("does not reuse a snapshot after model replacement or server expiry", () => {
    expect(selectAreaPredictions(collection([feature()]), "area-a", polygon, "model-2")).toEqual([]);
    expect(selectAreaPredictions({ ...collection([feature()]), metadata: { stale: true } }, "area-a", polygon)).toEqual([]);
  });
});

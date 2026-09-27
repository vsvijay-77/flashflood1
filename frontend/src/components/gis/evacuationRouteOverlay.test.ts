import { afterEach, describe, expect, it, vi } from "vitest";
import { renderEvacuationSelection, routePrefix } from "./evacuationRouteOverlay";
import type { EvacuationRouteResponse } from "@/lib/routingApi";

afterEach(() => vi.useRealTimers());

const route: EvacuationRouteResponse = {
  status: "success", coordinates: [[0, 0], [0, 1], [1, 1]], selected_candidate_id: "a",
  candidate_routes: [
    { id: "a", coordinates: [[0, 0], [0, 1], [1, 1]], destination: { lat: 1, lng: 1 },
      total_distance_m: 100, estimated_time_minutes: 2, elevation_gain_m: 5, max_slope_pct: 5, clearance_seconds: 300 },
    { id: "b", coordinates: [[0, 0], [1, 0], [1, -1]], destination: { lat: 1, lng: -1 },
      total_distance_m: 120, estimated_time_minutes: 3, elevation_gain_m: 4, max_slope_pct: 5, clearance_seconds: 200 },
  ],
};
function scene() {
  const entities: any[] = [];
  const viewer = { entities: { add: (entity: any) => { entities.push(entity); return entity; }, remove: vi.fn() },
    scene: { requestRender: vi.fn() }, camera: { flyTo: vi.fn() }, isDestroyed: () => false };
  const C = { Cartesian3: { fromDegreesArray: (value: number[]) => value, fromDegrees: (...value: number[]) => value },
    Cartesian2: class {}, Rectangle: { fromDegrees: (...value: number[]) => value },
    Color: { BLACK: "black", WHITE: "white", fromCssColorString: (color: string) => ({ withAlpha: (alpha: number) => ({ color, alpha }) }) },
    PolylineOutlineMaterialProperty: class { value: any; constructor(value: any) { this.value = value; } },
    HeightReference: { CLAMP_TO_GROUND: 1 }, LabelStyle: { FILL_AND_OUTLINE: 1 }, VerticalOrigin: { BOTTOM: 1 } };
  return { entities, viewer, C };
}

describe("evacuation route reveal", () => {
  it("grows along the assessed road bends without drawing a shortcut", () => {
    expect(routePrefix([[0, 0], [0, 1], [1, 1]], 0.25)).toEqual([[0, 0], [0, 0.5]]);
    expect(routePrefix([[0, 0], [0, 1], [1, 1]], 0.75)).toEqual([[0, 0], [0, 1], [0.5, 1]]);
    expect(routePrefix([[0, 0], [0, 1]], 1)).toEqual([[0, 0], [0, 1]]);
  });
  it("reveals candidates, blinks the chosen route, then marks the final evacuation point", () => {
    vi.useFakeTimers();
    const { viewer, C, entities } = scene(), phase = vi.fn();
    const cleanup = renderEvacuationSelection(viewer, C, route, phase);
    expect(phase).toHaveBeenLastCalledWith("revealing");
    expect(entities[3].show).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(phase).toHaveBeenLastCalledWith("highlighting");
    expect(entities[0].polyline.positions).toEqual([0, 0, 1, 0, 1, 1]);
    vi.advanceTimersByTime(125);
    const firstAlpha = entities[0].polyline.material.value.color.alpha;
    vi.advanceTimersByTime(500);
    expect(entities[0].polyline.material.value.color.alpha).not.toBe(firstAlpha);
    vi.advanceTimersByTime(3000);
    expect(phase).toHaveBeenLastCalledWith("confirmed");
    expect(entities[0].show).toBe(true);
    expect(entities[1].show).toBe(false);
    expect(entities[3].show).toBe(true);
    expect(entities[3].position).toEqual([1, 1]);
    expect(vi.getTimerCount()).toBe(0);
    cleanup();
    expect(viewer.entities.remove).toHaveBeenCalledTimes(4);
  });
  it("cancels obsolete animation and never confirms a cleared route", () => {
    vi.useFakeTimers();
    const { viewer, C } = scene(), phase = vi.fn();
    const cleanup = renderEvacuationSelection(viewer, C, route, phase);
    vi.advanceTimersByTime(1000);
    cleanup();
    vi.advanceTimersByTime(6000);
    expect(phase).not.toHaveBeenCalledWith("confirmed");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("respects reduced motion and does not draw a failed route", () => {
    vi.useFakeTimers();
    const { viewer, C, entities } = scene(), phase = vi.fn();
    renderEvacuationSelection(viewer, C, { status: "no_path" }, phase);
    expect(entities).toHaveLength(0);
    renderEvacuationSelection(viewer, C, route, phase, true);
    expect(phase).toHaveBeenLastCalledWith("confirmed");
    expect(vi.getTimerCount()).toBe(0);
  });
});

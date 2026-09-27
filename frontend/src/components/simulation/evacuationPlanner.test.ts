import { describe, expect, it } from 'vitest';
import { planEvacuation, type EvacuationInput } from './evacuationPlanner';
import type { RoadFeature } from '@/lib/routingApi';
const road = (coordinates: [number, number][], name = 'Hill Road'): RoadFeature => ({
  type: 'Feature', geometry: { type: 'LineString', coordinates },
  properties: { id: name, name, road_type: 'residential', length_m: 100, speed_kmh: 30, accessibility: 'open', flood_risk: 0 },
});
function scenario(): EvacuationInput {
  return {
    grid: { cols: 11, rows: 11, west: 0, east: 0.001, south: 0, north: 0.001, dx: 10, dy: 10 },
    bed: Float32Array.from({ length: 121 }, (_, i) => 100 + (i % 11) * 0.5),
    knownTerrain: new Uint8Array(121).fill(1), inside: new Uint8Array(121).fill(1),
    water: new Uint8Array(121), depth: new Float32Array(121), arrivals: new Float64Array(121).fill(-1),
    elapsed: 0, forecastThrough: 3600, origin: { lat: 0.0005, lng: 0.0001 },
    roads: [road([[0.0001, 0.0005], [0.001, 0.0005]])],
  };
}
describe('terrain and flood evacuation planner', () => {
  it('returns distinct viable exits from the same origin and selects the fastest at equal elevation', () => {
    const input = scenario();
    input.roads.push(road([[0.0001, 0.0005], [0.001, 0.0009]], 'North exit'),
      road([[0.0001, 0.0005], [0.001, 0.0001]], 'South exit'));
    const result = planEvacuation(input);
    expect(result.candidate_routes).toHaveLength(3);
    expect(result.selected_candidate_id).toBe(result.candidate_routes![0].id);
    expect(result.candidate_routes![0].coordinates).toEqual(result.coordinates);
    expect(result.destination).toEqual({ lat: 0.0005, lng: 0.001 });
    for (const candidate of result.candidate_routes!) {
      expect(candidate.coordinates[0]).toEqual([input.origin.lat, input.origin.lng]);
      expect(candidate.clearance_seconds).toBeGreaterThan(120);
      expect(candidate.max_slope_pct).toBeLessThanOrEqual(35);
    }
  });
  it('never adds a blocked branch to the animated alternatives', () => {
    const input = scenario();
    input.roads.push(road([[0.0001, 0.0005], [0.0001, 0.0009], [0.001, 0.0009]], 'Flooded exit'));
    input.depth[9 * 11 + 5] = 0.5;
    const result = planEvacuation(input);
    expect(result.candidate_routes).toHaveLength(1);
    expect(result.candidate_routes![0].destination.lat).toBe(0.0005);
  });
  it('follows the road to a reachable higher exit with walking time and clearance', () => {
    const result = planEvacuation(scenario());
    expect(result.status).toBe('success');
    expect(result.route_status).toBe('CAUTION');
    expect(result.destination).toEqual({ lat: 0.0005, lng: 0.001 });
    expect(result.total_distance_m).toBe(90);
    expect(result.estimated_time_minutes).toBeGreaterThanOrEqual(2);
    expect(result.elevation_gain_m).toBeGreaterThan(0);
    expect(result.max_slope_pct).toBe(5);
    expect(result.clearance_seconds).toBeGreaterThan(120);
    expect(result.coordinates!.every(([lat]) => lat === 0.0005)).toBe(true);
  });
  it.each(['water', 'depth', 'knownTerrain', 'arrivals'] as const)('does not route through a blocked %s cell even when no alternative exists', field => {
    const input = scenario(), cell = 5 * 11 + 5;
    if (field === 'water') input.water[cell] = 1;
    if (field === 'depth') input.depth[cell] = 0.15;
    if (field === 'knownTerrain') input.knownTerrain[cell] = 0;
    if (field === 'arrivals') input.arrivals[cell] = 130;
    expect(planEvacuation(input).status).toBe('no_path');
  });
  it('chooses an alternate mapped road around a flooded section', () => {
    const input = scenario();
    input.depth[5 * 11 + 5] = 1;
    input.roads.push(road([[0.0001, 0.0005], [0.0001, 0.0007], [0.001, 0.0007]], 'Upper Road'));
    const result = planEvacuation(input);
    expect(result.status).toBe('success');
    expect(result.segments!.some(s => s.road_name === 'Upper Road')).toBe(true);
    expect(result.coordinates!.some(([lat]) => lat === 0.0007)).toBe(true);
  });
  it('never picks disconnected highest ground', () => {
    const input = scenario();
    input.roads.push(road([[0.0004, 0.0009], [0.001, 0.0009]], 'Disconnected'));
    for (let c = 0; c < 11; c++) input.bed[9 * 11 + c] = 500;
    expect(planEvacuation(input).destination?.lat).toBe(0.0005);
  });
  it('rejects steep terrain, out-of-area points and insufficient forecast coverage', () => {
    const steep = scenario(); steep.bed[5 * 11 + 5] = 200;
    expect(planEvacuation(steep).status).toBe('no_path');
    const outside = scenario(); outside.origin.lng = 1;
    expect(planEvacuation(outside).status).toBe('no_path');
    const partial = scenario(); partial.forecastThrough = 170;
    expect(planEvacuation(partial).status).toBe('no_path');
  });
  it('validates the custom destination connector and counts its walking distance', () => {
    const input = scenario(); input.destination = { lat: 0.00055, lng: 0.0008 };
    const result = planEvacuation(input);
    expect(result.status).toBe('success');
    expect(result.coordinates!.at(-1)).toEqual([0.00055, 0.0008]);
    expect(result.total_distance_m).toBeGreaterThan(70);
    input.depth[6 * 11 + 8] = 1;
    expect(planEvacuation(input).status).toBe('no_path');
  });
  it('rejects unreachable, restricted and unmapped roads rather than drawing a direct escape line', () => {
    const input = scenario(); input.roads[0].properties.accessibility = 'restricted';
    expect(planEvacuation(input).status).toBe('no_path');
    input.roads = []; expect(planEvacuation(input).status).toBe('no_path');
  });
  it('uses the current simulation clock when checking flood deadlines', () => {
    const input = scenario(); input.elapsed = 600; input.arrivals.fill(700);
    expect(planEvacuation(input).status).toBe('no_path');
  });
});

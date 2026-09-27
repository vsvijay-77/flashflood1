import type { EvacuationRouteResponse, RoadFeature, RouteSegment } from '@/lib/routingApi';
import type { ExposureGrid } from './buildingExposure';

export interface EvacuationInput {
  grid: ExposureGrid & { dx: number; dy: number };
  bed: Float32Array; knownTerrain: Uint8Array; inside: Uint8Array; depth: Float32Array; water: Uint8Array;
  arrivals: Float64Array; forecastThrough: number; elapsed: number;
  roads: RoadFeature[];
  origin: { lat: number; lng: number };
  destination?: { lat: number; lng: number };
}
type Point = [number, number]; // longitude, latitude
type Edge = { to: number; length: number; seconds: number; deadline: number; name: string; slope: number };

// Min-heap keeps routing O((V+E) log V), including large road extracts.
class Queue {
  items: [number, number][] = [];
  push(item: [number, number]) {
    let i = this.items.length; this.items.push(item);
    while (i > 0) { const p = (i - 1) >> 1; if (this.items[p][0] <= item[0]) break; this.items[i] = this.items[p]; i = p; }
    this.items[i] = item;
  }
  pop() {
    const first = this.items[0], last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.items.length && this.items[child + 1][0] < this.items[child][0]) child++;
        if (last[0] <= this.items[child][0]) break;
        this.items[i] = this.items[child]; i = child;
      }
      this.items[i] = last;
    }
    return first;
  }
}

/** Candidate walking route on mapped roads, constrained by this simulation snapshot. */
export function planEvacuation(input: EvacuationInput): EvacuationRouteResponse {
  const { grid: g, bed, inside, depth, water, arrivals, elapsed, origin } = input;
  const fail = (message: string): EvacuationRouteResponse => ({ status: 'no_path', message, origin });
  const sx = g.dx * (g.cols - 1) / (g.east - g.west), sy = g.dy * (g.rows - 1) / (g.north - g.south);
  const distance = (a: Point, b: Point) => Math.hypot((a[0] - b[0]) * sx, (a[1] - b[1]) * sy);
  const cell = (p: Point) => {
    if (p[0] < g.west || p[0] > g.east || p[1] < g.south || p[1] > g.north) return -1;
    const c = Math.round((p[0] - g.west) / (g.east - g.west) * (g.cols - 1));
    const r = Math.round((p[1] - g.south) / (g.north - g.south) * (g.rows - 1));
    const i = r * g.cols + c;
    return inside[i] ? i : -1;
  };
  const dry = (i: number) => i >= 0 && input.knownTerrain[i] && Number.isFinite(bed[i]) && Number.isFinite(depth[i]) && depth[i] < 0.1 && !water[i];
  const start: Point = [origin.lng, origin.lat];
  const startCell = cell(start);
  if (!dry(startCell)) return fail('Selected point is flooded, in a waterway, outside the area, or has missing terrain. No walking route can be assessed from here.');
  if (input.forecastThrough < elapsed + 120) return fail('Arrival forecast is still calculating. Wait until at least two minutes ahead are assessed, then calculate again.');
  if (!input.roads.length) return fail('No mapped roads are loaded for this area. Load roads before calculating an evacuation plan.');

  const points: Point[] = [], graph: Edge[][] = [], ids = new Map<string, number>(), exits = new Set<number>();
  const add = (p: Point) => {
    const key = `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
    if (ids.has(key)) return ids.get(key)!;
    const id = points.length; points.push(p); graph.push([]); ids.set(key, id); return id;
  };
  let blocked = 0;
  const assess = (a: Point, b: Point, name: string): Omit<Edge, 'to'> | null => {
    const length = distance(a, b);
    const steps = Math.max(1, Math.ceil(length / Math.max(1, Math.min(g.dx, g.dy) / 3)));
    let deadline = input.forecastThrough, previous = -1, maxSlope = 0, seconds = 0;
    for (let j = 0; j <= steps; j++) {
      const p: Point = [a[0] + (b[0] - a[0]) * j / steps, a[1] + (b[1] - a[1]) * j / steps];
      const i = cell(p);
      if (!dry(i)) return null;
      if (!Number.isFinite(arrivals[i])) return null;
      if (arrivals[i] >= 0) deadline = Math.min(deadline, arrivals[i]);
      if (previous >= 0) {
        // Elevations are sampled at grid centres; use the centre separation
        // rather than the shorter road sampling interval for a cell transition.
        const terrainDistance = Math.hypot((i % g.cols - previous % g.cols) * g.dx, (Math.floor(i / g.cols) - Math.floor(previous / g.cols)) * g.dy);
        const slope = terrainDistance > 0 ? (bed[i] - bed[previous]) / terrainDistance : 0;
        maxSlope = Math.max(maxSlope, Math.abs(slope));
        if (maxSlope > 0.35) return null;
        seconds += length / steps / (1.2 / (1 + 5 * Math.abs(slope) + 5 * Math.max(0, slope)));
      }
      previous = i;
    }
    return { length, seconds, deadline, name, slope: maxSlope };
  };
  // Densify the actual road geometry, retaining shared junction coordinates.
  for (const road of input.roads) {
    if (road.properties.accessibility === 'restricted' || road.properties.accessibility === 'flooded') continue;
    const coordinates = road.geometry.coordinates;
    let previous: number | null = null;
    for (let k = 1; k < coordinates.length; k++) {
      const a = coordinates[k - 1], b = coordinates[k];
      const steps = Math.max(1, Math.ceil(distance(a, b) / Math.max(2, Math.min(g.dx, g.dy) / 2)));
      for (let j = k === 1 ? 0 : 1; j <= steps; j++) {
        const p: Point = [a[0] + (b[0] - a[0]) * j / steps, a[1] + (b[1] - a[1]) * j / steps];
        const i = cell(p);
        if (i < 0) { if (previous !== null) exits.add(previous); previous = null; continue; }
        const node = add(p);
        if (previous === null && (k > 1 || j > 0)) exits.add(node);
        const c = i % g.cols, r = Math.floor(i / g.cols);
        if (p[0] <= g.west + 1e-10 || p[0] >= g.east - 1e-10 || p[1] <= g.south + 1e-10 || p[1] >= g.north - 1e-10 ||
          (c > 0 && !inside[i - 1]) || (c < g.cols - 1 && !inside[i + 1]) ||
          (r > 0 && !inside[i - g.cols]) || (r < g.rows - 1 && !inside[i + g.cols])) exits.add(node);
        if (previous !== null && previous !== node) {
          const forward = assess(points[previous], p, road.properties.name || 'Unnamed road');
          const reverse = assess(p, points[previous], road.properties.name || 'Unnamed road');
          if (forward) graph[previous].push({ ...forward, to: node }); else blocked++;
          if (reverse) graph[node].push({ ...reverse, to: previous });
        }
        previous = node;
      }
    }
  }
  const nearest = (p: Point) => {
    let best = -1, d = 25;
    points.forEach((q, i) => { const gap = distance(p, q); if (gap <= d) { best = i; d = gap; } });
    return best;
  };
  const originNode = nearest(start);
  if (originNode < 0) return fail('Select a starting point within 25 m of a mapped road. Access across unmapped ground cannot be assessed.');
  const connector = assess(start, points[originNode], 'Access to mapped road — verify on site');
  if (!connector || elapsed + connector.seconds + 120 >= connector.deadline) return fail('The connection from the selected point to the road is blocked or may flood before it can be reached.');
  const target: Point | undefined = input.destination && [input.destination.lng, input.destination.lat];
  const targetNode = target ? nearest(target) : -1;
  if (target && (targetNode < 0 || !dry(cell(target)))) return fail('The destination is outside assessed dry terrain or too far from a mapped road.');
  const times = new Float64Array(points.length).fill(Infinity), parent = new Int32Array(points.length).fill(-1);
  const via: (Edge | undefined)[] = new Array(points.length);
  const queue = new Queue(); times[originNode] = connector.seconds; queue.push([connector.seconds, originNode]);
  while (queue.items.length) {
    const [time, node] = queue.pop();
    if (time !== times[node]) continue;
    for (const edge of graph[node]) {
      const next = time + edge.seconds;
      if (elapsed + next + 120 >= edge.deadline || next >= times[edge.to]) continue;
      times[edge.to] = next; parent[edge.to] = node; via[edge.to] = edge; queue.push([next, edge.to]);
    }
  }
  // Choose a reachable boundary road at least as high as the starting point.
  // Highest terrain first, then walking time. Never select a disconnected refuge.
  const candidates = target ? [targetNode] : [...exits].filter(n => n !== originNode && bed[cell(points[n])] >= bed[startCell]);
  const reachable = candidates.filter(n => Number.isFinite(times[n]) && distance(start, points[n]) > 1)
    .sort((a, b) => bed[cell(points[b])] - bed[cell(points[a])] || times[a] - times[b]);
  if (!reachable.length) return fail('No reachable higher-ground exit is dry for the forecast travel time plus a 2-minute margin. No route through floodwater is suggested.');
  // Reuse one graph search for spatially distinct exits; do not invent branches
  // where the mapped network has only one viable escape.
  const selectedEnds: number[] = [];
  for (const node of reachable) {
    if (selectedEnds.every(other => distance(points[node], points[other]) >= Math.max(25, Math.min(g.dx, g.dy) * 2))) selectedEnds.push(node);
    if (selectedEnds.length === 4) break;
  }
  const buildRoute = (end: number): EvacuationRouteResponse => {
    const endConnector = target ? assess(points[end], target, 'Access to selected destination — verify on site') : null;
    if (target && (!endConnector || elapsed + times[end] + endConnector.seconds + 120 >= endConnector.deadline)) return fail('The destination access may flood before arrival. Choose another destination.');
    const path: number[] = [];
    for (let n = end; n >= 0; n = parent[n]) path.push(n);
    path.reverse();
    const segments: RouteSegment[] = [];
    let totalDistance = connector.length, maxSlope = connector.slope;
    let clearance = connector.deadline - elapsed - connector.seconds;
    const append = (e: Omit<Edge, 'to'>, from: number, to: number) => {
      maxSlope = Math.max(maxSlope, e.slope);
      const last = segments.at(-1);
      if (last?.road_name === e.name) { last.length_m += e.length; last.to_node = to; }
      else segments.push({ from_node: from, to_node: to, road_name: e.name, road_type: 'walking', length_m: e.length,
        speed_kmh: e.seconds > 0 ? e.length / e.seconds * 3.6 : 4.32, flood_risk: 0 });
    };
    if (connector.length > 0.1) append(connector, -1, originNode);
    for (let k = 1; k < path.length; k++) {
      const e = via[path[k]]!; totalDistance += e.length; append(e, path[k - 1], path[k]);
      clearance = Math.min(clearance, e.deadline - elapsed - times[path[k]]);
    }
    if (endConnector) { totalDistance += endConnector.length; append(endConnector, end, -2); clearance = Math.min(clearance, endConnector.deadline - elapsed - times[end] - endConnector.seconds); }
    const endpoint = target || points[end];
    return {
      status: 'success', route_status: 'CAUTION', origin,
      destination: { lat: endpoint[1], lng: endpoint[0] }, destination_name: target ? 'Selected destination' : 'Higher-ground area exit',
      coordinates: [start, ...path.map(n => points[n]), ...(target ? [target] : [])].map(([lng, lat]) => [lat, lng]),
      total_distance_m: Math.round(totalDistance), total_distance_km: Math.round(totalDistance / 10) / 100,
      estimated_time_minutes: Math.max(1, Math.ceil((times[end] + (endConnector?.seconds || 0)) / 60)),
      segments: segments.map(s => ({ ...s, length_m: Math.round(s.length_m) })), avoided_blocked_edges: blocked,
      max_slope_pct: Math.round(maxSlope * 100), elevation_gain_m: Math.round(bed[cell(endpoint)] - bed[startCell]),
      departure_simulation_seconds: elapsed, clearance_seconds: Math.floor(clearance),
      message: 'Modeled walking candidate on mapped roads. Avoids water ≥10 cm, waterways, missing terrain and slopes >35%; checks flood arrival with a 2-minute margin. Verify access and road conditions; terrain resolution cannot resolve every obstruction. Conditions beyond the selected area are unassessed. Recalculate before departure.',
    };
  };
  const routes = selectedEnds.map(buildRoute).filter(route => route.status === 'success');
  if (!routes.length) return fail('The destination access may flood before arrival. Choose another destination.');
  return { ...routes[0], selected_candidate_id: 'route-1',
    selection_reason: target
      ? 'Fastest assessed road path to the selected destination.'
      : 'Highest reachable exit at or above the starting elevation, then shortest walking time. Every candidate passes the same water, slope and flood-arrival checks.',
    candidate_routes: routes.map((route, index) => ({ id: `route-${index + 1}`,
      coordinates: route.coordinates!, destination: route.destination!,
      total_distance_m: route.total_distance_m!, estimated_time_minutes: route.estimated_time_minutes!,
      elevation_gain_m: route.elevation_gain_m!, max_slope_pct: route.max_slope_pct!, clearance_seconds: route.clearance_seconds!,
    })),
  };

}

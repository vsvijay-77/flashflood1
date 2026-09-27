import type { EvacuationRouteResponse } from "@/lib/routingApi";

export type EvacuationPhase = "idle" | "revealing" | "highlighting" | "confirmed";
type Coordinate = [number, number];

// Reveal along the road geometry, including an interpolated tip. A straight
// line from origin to destination would incorrectly cross unassessed ground.
export function routePrefix(coordinates: Coordinate[], progress: number): Coordinate[] {
  if (coordinates.length < 2 || progress >= 1) return coordinates;
  const lengths = coordinates.slice(1).map(([lat, lng], i) => {
    const previous = coordinates[i];
    return Math.hypot(lat - previous[0], (lng - previous[1]) * Math.cos((lat + previous[0]) * Math.PI / 360));
  });
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * Math.max(0, progress);
  const result: Coordinate[] = [coordinates[0]];
  for (let i = 0; i < lengths.length; i++) {
    if (remaining >= lengths[i]) { result.push(coordinates[i + 1]); remaining -= lengths[i]; continue; }
    const fraction = lengths[i] > 0 ? remaining / lengths[i] : 0;
    result.push([coordinates[i][0] + (coordinates[i + 1][0] - coordinates[i][0]) * fraction,
      coordinates[i][1] + (coordinates[i + 1][1] - coordinates[i][1]) * fraction]);
    break;
  }
  return result;
}

/** Bounded visual playback of already assessed candidates; returns full cleanup. */
export function renderEvacuationSelection(viewer: any, C: any, route: EvacuationRouteResponse,
  onPhase: (phase: EvacuationPhase) => void, reducedMotion = false): () => void {
  if (route.status !== "success" || !route.coordinates || route.coordinates.length < 2) return () => {};
  const entities: any[] = [];
  const add = (options: any) => { const entity = viewer.entities.add(options); entities.push(entity); return entity; };
  const candidates = route.candidate_routes?.length ? route.candidate_routes : [{ id: "route-1", coordinates: route.coordinates }];
  const selected = Math.max(0, candidates.findIndex(candidate => candidate.id === route.selected_candidate_id));
  const positions = (coordinates: Coordinate[]) => C.Cartesian3.fromDegreesArray(coordinates.flatMap(([lat, lng]) => [lng, lat]));
  const material = (winner: boolean, bright = true) => new C.PolylineOutlineMaterialProperty({
    color: C.Color.fromCssColorString(winner ? "#fbbf24" : "#38bdf8").withAlpha(bright ? 1 : 0.25),
    outlineColor: C.Color.BLACK, outlineWidth: winner ? 2 : 1,
  });
  const lines = candidates.map((candidate, index) => add({
    name: `Assessed evacuation candidate ${index + 1}`,
    polyline: { positions: positions(routePrefix(candidate.coordinates, reducedMotion ? 1 : 0)),
      width: 3, clampToGround: true, material: material(false) },
  }));
  const marker = (coordinate: Coordinate, name: string, text: string, color: string) => add({
    name, position: C.Cartesian3.fromDegrees(coordinate[1], coordinate[0]),
    point: { pixelSize: 18, color: C.Color.fromCssColorString(color), outlineColor: C.Color.WHITE, outlineWidth: 3,
      heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity },
    label: { text, font: "bold 13px system-ui, sans-serif", fillColor: C.Color.WHITE,
      outlineColor: C.Color.BLACK, outlineWidth: 2, style: C.LabelStyle.FILL_AND_OUTLINE,
      showBackground: true, backgroundColor: C.Color.fromCssColorString("#0f172a").withAlpha(0.95),
      pixelOffset: new C.Cartesian2(0, -28), verticalOrigin: C.VerticalOrigin.BOTTOM,
      heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity },
  });
  marker(route.coordinates[0], "Evacuation starting point", "START", "#38bdf8");
  const endpoint = marker(route.coordinates.at(-1)!, "Selected evacuation point", "EVACUATION POINT\nSelected modeled exit", "#fbbf24");
  endpoint.show = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false, tick = 0;
  const confirm = () => {
    lines.forEach((line, i) => { line.show = i === selected; });
    lines[selected].polyline.positions = positions(candidates[selected].coordinates);
    lines[selected].polyline.material = material(true);
    lines[selected].polyline.width = 7;
    endpoint.show = true;
    onPhase("confirmed");
    viewer.scene.requestRender();
  };
  if (reducedMotion) confirm();
  else {
    onPhase("revealing");
    timer = setInterval(() => {
      if (disposed || viewer.isDestroyed()) { clearInterval(timer); return; }
      tick++;
      if (tick <= 16) {
        lines.forEach((line, i) => { line.polyline.positions = positions(routePrefix(candidates[i].coordinates, tick / 16)); });
        if (tick === 16) { onPhase("highlighting"); lines[selected].polyline.width = 7; }
      } else if (tick < 40) {
        lines.forEach((line, i) => { line.polyline.material = material(i === selected, i === selected && Math.floor((tick - 16) / 4) % 2 === 0); });
      } else { clearInterval(timer); confirm(); }
      viewer.scene.requestRender();
    }, 125);
  }
  const coordinates = candidates.flatMap(candidate => candidate.coordinates);
  const lats = coordinates.map(([lat]) => lat), lngs = coordinates.map(([, lng]) => lng);
  const south = Math.min(...lats), north = Math.max(...lats), west = Math.min(...lngs), east = Math.max(...lngs);
  const dy = Math.max(0.001, north - south) * 0.25, dx = Math.max(0.001, east - west) * 0.25;
  viewer.camera.flyTo({ destination: C.Rectangle.fromDegrees(west - dx, south - dy, east + dx, north + dy), duration: reducedMotion ? 0 : 1.2 });
  viewer.scene.requestRender();
  return () => {
    disposed = true;
    clearInterval(timer);
    if (!viewer.isDestroyed()) {
      entities.forEach(entity => viewer.entities.remove(entity));
      viewer.scene.requestRender();
    }
  };
}

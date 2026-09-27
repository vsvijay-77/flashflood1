import { expect, it } from 'vitest';
import { houseBounds } from './BuildingArrivalLabels';
import type { BuildingFeature } from '@/lib/routingApi';
it('bounds every part of a multipolygon house rather than only its first footprint', () => {
  const building: BuildingFeature = { type: 'Feature', properties: { id: 'house' }, geometry: { type: 'MultiPolygon', coordinates: [
    [[[1, 2], [2, 2], [2, 3], [1, 2]]], [[[4, 5], [5, 5], [5, 6], [4, 5]]],
  ] } };
  expect(houseBounds(building)).toEqual({ west: 1, east: 5, south: 2, north: 6 });
  building.geometry = { type: 'Polygon', coordinates: [[[NaN, 1], [1, 1], [1, 1]]] };
  expect(houseBounds(building)).toBeNull();
});

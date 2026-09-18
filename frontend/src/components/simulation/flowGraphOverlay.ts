import * as THREE from "three";
import type { WaterPhysicsState } from "./waterPhysics";

/**
 * Orthogonal flow graph overlay using continuous horizontal (X) and vertical (Z) grid lines.
 *
 * Each cell edge in the physics grid is rendered as an axis-aligned line segment:
 *  - Horizontal edge (isX=true): drawn West→East along the grid row
 *  - Vertical edge (isX=false):  drawn North→South along the grid column
 *
 * Respects 3D terrain elevation:
 *  - Dry cells show a subtle topographic grid contouring the hills and valleys.
 *  - As floodwater rises and flows downhill according to elevation, the grid lines
 *    illuminate in electric aqua and deep cyan reflecting local water depth.
 *  - When rainfall is at full high, the illuminated grid blankets the terrain according
 *    to elevation, showing complete flood inundation extent.
 */
export function createFlowGraphOverlay(state: WaterPhysicsState, terrain: Float32Array, paths: Uint8Array) {
  // Select row and column step to form a continuous orthogonal horizontal & vertical line grid
  const rowStep = Math.max(1, Math.ceil(Math.sqrt(state.totalCells / 600)));
  const colStep = rowStep;

  // Gather edges strictly along selected horizontal rows and vertical columns
  const edgeIndices: number[] = [];
  for (let i = 0; i < state.edges.length; i++) {
    const edge = state.edges[i];
    if (edge.isDiagonal) continue;
    const r = Math.floor(edge.from / state.cols);
    const c = edge.from % state.cols;
    if (edge.isX) {
      if (r % rowStep === 0) {
        edgeIndices.push(i);
      }
    } else {
      if (c % colStep === 0) {
        edgeIndices.push(i);
      }
    }
  }

  // Pre-allocate buffers: each edge = 1 line segment = 2 vertices × 3 floats each
  const positions = new Float32Array(edgeIndices.length * 6);
  const colors = new Float32Array(edgeIndices.length * 6);

  // Grid node dots — placed at the intersections of selected horizontal and vertical lines
  const nodeIndices: number[] = [];
  for (let r = 0; r < state.rows; r += rowStep) {
    for (let c = 0; c < state.cols; c += colStep) {
      const idx = r * state.cols + c;
      if (state.insideMask[idx]) {
        nodeIndices.push(idx);
      }
    }
  }
  const nodes = nodeIndices;
  const nodePositions = new Float32Array(nodes.length * 3);


  // Line geometry — continuous axis-aligned grid segments
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  lineGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));

  // Node dot geometry
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute("position", new THREE.BufferAttribute(nodePositions, 3).setUsage(THREE.DynamicDrawUsage));

  const lineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const pointMaterial = new THREE.PointsMaterial({
    color: 0x000000,
    size: 5.0,
    sizeAttenuation: false,
    depthWrite: false,
  });

  const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
  const points = new THREE.Points(pointGeometry, pointMaterial);
  lines.frustumCulled = false;
  points.frustumCulled = false;

  const group = new THREE.Group();
  group.add(lines, points);

  const update = (current: WaterPhysicsState) => {
    // Lift lines slightly above terrain & water surface so the grid remains clearly visible
    const lift = Math.max(1.2, Math.min(6, current.dx * 0.05));

    for (let displayIndex = 0; displayIndex < edgeIndices.length; displayIndex++) {
      const edge = current.edges[edgeIndices[displayIndex]];
      const a = edge.from;
      const b = edge.to;

      const depthA = current.depth[a] || 0;
      const depthB = current.depth[b] || 0;
      const maxDepth = Math.max(depthA, depthB);
      const isFlooded = maxDepth >= 0.04;
      const isFlowing = Math.abs(edge.discharge) > 0.002;

      // Start point at cell a
      const sx = terrain[a * 3];
      const sy = terrain[a * 3 + 1] + lift + depthA;
      const sz = terrain[a * 3 + 2];

      // End point at cell b — strictly axis-aligned:
      // Horizontal edge (isX=true): row Z is locked, extends in X
      // Vertical edge (isX=false): col X is locked, extends in Z
      let ex: number, ey: number, ez: number;
      if (edge.isX) {
        ex = terrain[b * 3];
        ey = terrain[b * 3 + 1] + lift + depthB;
        ez = sz;
      } else {
        ex = sx;
        ey = terrain[b * 3 + 1] + lift + depthB;
        ez = terrain[b * 3 + 2];
      }

      const offset = displayIndex * 6;
      positions[offset + 0] = sx;
      positions[offset + 1] = sy;
      positions[offset + 2] = sz;
      positions[offset + 3] = ex;
      positions[offset + 4] = ey;
      positions[offset + 5] = ez;

      // White edges:
      // Flooded/flowing edges are brilliant solid white (1.0, 1.0, 1.0)
      // Dry terrain edges are crisp clear white (0.85, 0.85, 0.85)
      const brightness = (maxDepth >= 0.04 || isFlooded || isFlowing) ? 1.0 : 0.85;

      colors[offset + 0] = brightness;
      colors[offset + 1] = brightness;
      colors[offset + 2] = brightness;
      colors[offset + 3] = brightness;
      colors[offset + 4] = brightness;
      colors[offset + 5] = brightness;
    }

    // Update node dots on terrain surface (Black node dots sitting on top of white grid intersections)
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      nodePositions[i * 3 + 0] = terrain[node * 3];
      nodePositions[i * 3 + 1] = terrain[node * 3 + 1] + lift + 0.15 + (current.depth[node] || 0);
      nodePositions[i * 3 + 2] = terrain[node * 3 + 2];
    }

    lineGeometry.attributes.position.needsUpdate = true;
    lineGeometry.attributes.color.needsUpdate = true;
    pointGeometry.attributes.position.needsUpdate = true;
  };

  update(state);

  return {
    group,
    displayedEdges: edgeIndices.length,
    update,
    dispose: () => {
      group.removeFromParent();
      lineGeometry.dispose();
      pointGeometry.dispose();
      lineMaterial.dispose();
      pointMaterial.dispose();
    },
  };
}

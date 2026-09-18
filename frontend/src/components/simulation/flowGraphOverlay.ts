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
    opacity: 0.92,
    depthWrite: false,
  });
  const pointMaterial = new THREE.PointsMaterial({
    color: "#64748b",
    size: 2.0,
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

      // Dynamic flood depth coloring respecting elevation
      const isChannel = current.isSource[a] || current.isSource[b];
      const isRoad = paths[a] || paths[b];

      let cr: number, cg: number, cb: number;
      let brightness: number;

      if (maxDepth >= 0.5) {
        // Deep submerged zone: glowing deep azure cyan
        cr = 0.05; cg = 0.78; cb = 1.0;
        brightness = 1.0;
      } else if (maxDepth >= 0.1) {
        // Moderate flood inundation: vivid electric turquoise
        cr = 0.15; cg = 0.92; cb = 0.98;
        brightness = 0.95;
      } else if (isFlooded || isFlowing) {
        // Shallow active flow: bright aqua
        cr = 0.22; cg = 0.88; cb = 0.82;
        brightness = 0.85;
      } else if (isRoad) {
        // Evacuation path / road: amber
        cr = 0.95; cg = 0.65; cb = 0.15;
        brightness = 0.60;
      } else {
        // Dry terrain — same color for ALL dry cells including channels (no pre-simulation blue lines)
        cr = 0.18; cg = 0.68; cb = 0.42;
        brightness = 0.25;
      }

      const r = cr * brightness;
      const g = cg * brightness;
      const b_ = cb * brightness;

      colors[offset + 0] = r; colors[offset + 1] = g; colors[offset + 2] = b_;
      colors[offset + 3] = r; colors[offset + 4] = g; colors[offset + 5] = b_;
    }

    // Update node dots on terrain surface
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      nodePositions[i * 3 + 0] = terrain[node * 3];
      nodePositions[i * 3 + 1] = terrain[node * 3 + 1] + lift + (current.depth[node] || 0);
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

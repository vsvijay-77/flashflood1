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
/**
 * Creates an antialiased circular dot DataTexture for crisp, pitch-black circular node dots.
 * Using DataTexture avoids DOM canvas dependencies and renders seamlessly in both browser and Vitest.
 */
function createCircleTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size * 0.44;
  const edgeWidth = 1.2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - center;
      const dy = y - center;
      const dist = Math.hypot(dx, dy);

      if (dist <= radius - edgeWidth) {
        // Solid jet black core
        data[idx + 0] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 255;
      } else if (dist <= radius) {
        // Crisp antialiased boundary
        const alpha = Math.max(0, Math.min(1, (radius - dist) / edgeWidth));
        data[idx + 0] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = Math.round(alpha * 255);
      } else {
        // Outside circle
        data[idx + 0] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
      }
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createFlowGraphOverlay(state: WaterPhysicsState, terrain: Float32Array, paths: Uint8Array) {
  // Gather all orthogonal (horizontal and vertical) edges across the simulation domain
  const edgeIndices: number[] = [];
  for (let i = 0; i < state.edges.length; i++) {
    const edge = state.edges[i];
    if (edge.isDiagonal) continue;
    edgeIndices.push(i);
  }

  // Pre-allocate buffers: each edge = 1 line segment = 2 vertices × 3 floats each
  const positions = new Float32Array(edgeIndices.length * 6);
  const colors = new Float32Array(edgeIndices.length * 6);

  // Display all nodes in the simulation domain
  const nodeIndices: number[] = [];
  for (let idx = 0; idx < state.totalCells; idx++) {
    if (!state.insideMask || state.insideMask[idx]) {
      nodeIndices.push(idx);
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

  // Darker circular node dot material
  const circleTexture = createCircleTexture();
  const pointMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    map: circleTexture,
    transparent: true,
    alphaTest: 0.02,
    size: 7.5,
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

      // End point at cell b: connects directly to node b on 3D terrain
      const ex = terrain[b * 3];
      const ey = terrain[b * 3 + 1] + lift + depthB;
      const ez = terrain[b * 3 + 2];

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

    // Update node dots on terrain surface (Dark circular node dots sitting on top of white grid intersections)
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      nodePositions[i * 3 + 0] = terrain[node * 3];
      nodePositions[i * 3 + 1] = terrain[node * 3 + 1] + lift + 0.25 + (current.depth[node] || 0);
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
      circleTexture.dispose();
    },
  };
}

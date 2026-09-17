import * as THREE from "three";
import type { WaterPhysicsState } from "./waterPhysics";

export function createFlowGraphOverlay(state: WaterPhysicsState, terrain: Float32Array, paths: Uint8Array) {
  const stride = Math.max(1, Math.ceil(state.edges.length / 1600));
  const edgeIndices = state.edges.map((_, index) => index).filter(index => index % stride === 0);
  const nodes = [...new Set(edgeIndices.flatMap(index => [state.edges[index].from, state.edges[index].to]))];
  const positions = new Float32Array(edgeIndices.length * 18);
  const colors = new Float32Array(positions.length);
  const nodePositions = new Float32Array(nodes.length * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute("position", new THREE.BufferAttribute(nodePositions, 3).setUsage(THREE.DynamicDrawUsage));
  const lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
  const pointMaterial = new THREE.PointsMaterial({ color: "#e2e8f0", size: 3, sizeAttenuation: false, depthWrite: false });
  const lines = new THREE.LineSegments(geometry, lineMaterial);
  const points = new THREE.Points(pointGeometry, pointMaterial);
  lines.frustumCulled = false;
  points.frustumCulled = false;
  const group = new THREE.Group();
  group.add(lines, points);
  const update = (current: WaterPhysicsState) => {
    const lift = Math.max(2, Math.min(12, current.dx * 0.08));
    for (let displayIndex = 0; displayIndex < edgeIndices.length; displayIndex++) {
      const edge = current.edges[edgeIndices[displayIndex]];
      const forward = Math.abs(edge.discharge) > 0.0000001 ? edge.discharge > 0
        : current.bed[edge.from] + current.depth[edge.from] >= current.bed[edge.to] + current.depth[edge.to];
      const source = forward ? edge.from : edge.to;
      const target = forward ? edge.to : edge.from;
      const sourceX = terrain[source * 3], sourceY = terrain[source * 3 + 1] + lift + current.depth[source], sourceZ = terrain[source * 3 + 2];
      const targetX = terrain[target * 3], targetY = terrain[target * 3 + 1] + lift + current.depth[target], targetZ = terrain[target * 3 + 2];
      const offset = displayIndex * 18;
      positions.set([sourceX, sourceY, sourceZ, targetX, targetY, targetZ], offset);
      const deltaX = targetX - sourceX, deltaZ = targetZ - sourceZ;
      const baseX = sourceX + deltaX * 0.7, baseY = sourceY + (targetY - sourceY) * 0.7, baseZ = sourceZ + deltaZ * 0.7;
      positions.set([targetX, targetY, targetZ, baseX - deltaZ * 0.14, baseY, baseZ + deltaX * 0.14,
        targetX, targetY, targetZ, baseX + deltaZ * 0.14, baseY, baseZ - deltaX * 0.14], offset + 6);
      const channel = current.isSource[source] || current.isSource[target];
      const road = paths[source] || paths[target];
      const color = channel ? [0.13, 0.83, 0.98] : road ? [1, 0.68, 0.15] : [0.2, 0.85, 0.55];
      const brightness = Math.abs(edge.discharge) > 0.0000001 ? 1 : 0.5;
      for (let vertex = 0; vertex < 6; vertex++) for (let axis = 0; axis < 3; axis++) colors[offset + vertex * 3 + axis] = color[axis] * brightness;
    }
    nodes.forEach((node, index) => nodePositions.set([terrain[node * 3], terrain[node * 3 + 1] + lift + current.depth[node], terrain[node * 3 + 2]], index * 3));
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    pointGeometry.attributes.position.needsUpdate = true;
  };
  update(state);
  return { group, displayedEdges: edgeIndices.length, update, dispose: () => {
    group.removeFromParent();
    geometry.dispose(); pointGeometry.dispose(); lineMaterial.dispose(); pointMaterial.dispose();
  } };
}

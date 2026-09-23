/**
 * Cesium TIN Terrain Layer Manager
 *
 * Handles 3D Triangulated Irregular Network (TIN) surface, wireframe, and GNN graph nodes rendering
 * directly inside Cesium using Primitive, Geometry, and PointPrimitiveCollection APIs.
 * Supports:
 * - Real DEM elevation triangulation
 * - Elevation gradient coloring (low -> medium -> high) vs neutral terrain mode
 * - Wireframe toggle following exact TIN Delaunay topology
 * - Real-time vertical exaggeration scaling
 * - 3D GNN Graph Nodes placed on TIN vertices when TIN connects
 * - Opacity / alpha blending so underlying layers (buildings, rivers, roads, nodes) remain visible
 */

import type { TinTerrainData } from "@/services/tinTerrain";

declare const Cesium: any;

export interface TinRenderOptions {
  visible: boolean;
  surfaceVisible: boolean;
  wireframeVisible: boolean;
  elevationColoring: boolean;
  gnnNodesVisible: boolean;
  opacity: number; // 0.1 - 1.0
  verticalExaggeration: number; // 1.0 - 5.0
}

export class CesiumTinTerrainLayer {
  private viewer: any;
  private data: TinTerrainData | null = null;
  private surfacePrimitive: any = null;
  private wireframePrimitive: any = null;
  private gnnNodesCollection: any = null;
  private options: TinRenderOptions = {
    visible: true,
    surfaceVisible: true,
    wireframeVisible: false,
    elevationColoring: true,
    gnnNodesVisible: true,
    opacity: 0.85,
    verticalExaggeration: 1.0,
  };

  constructor(viewer: any) {
    this.viewer = viewer;
  }

  public setData(data: TinTerrainData | null, options?: Partial<TinRenderOptions>) {
    this.data = data;
    if (options) {
      this.options = { ...this.options, ...options };
    }
    this.rebuild();
  }

  public updateOptions(options: Partial<TinRenderOptions>) {
    const prevExaggeration = this.options.verticalExaggeration;
    const prevElevationColoring = this.options.elevationColoring;
    const prevOpacity = this.options.opacity;

    this.options = { ...this.options, ...options };

    // If exaggeration, coloring, or opacity changed, geometry or colors must be rebuilt
    if (
      this.options.verticalExaggeration !== prevExaggeration ||
      this.options.elevationColoring !== prevElevationColoring ||
      this.options.opacity !== prevOpacity
    ) {
      this.rebuild();
    } else {
      // Otherwise simply toggle visibility of primitives
      this.syncVisibility();
    }
  }

  private syncVisibility() {
    const isVisible = this.options.visible && !!this.data;
    if (this.surfacePrimitive) {
      this.surfacePrimitive.show = isVisible && this.options.surfaceVisible;
    }
    if (this.wireframePrimitive) {
      this.wireframePrimitive.show = isVisible && this.options.wireframeVisible;
    }
    if (this.gnnNodesCollection) {
      this.gnnNodesCollection.show = isVisible && this.options.gnnNodesVisible;
    }
    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.scene?.requestRender();
    }
  }

  public destroy() {
    this.clearPrimitives();
    this.data = null;
  }

  private clearPrimitives() {
    if (!this.viewer || this.viewer.isDestroyed()) return;
    const scene = this.viewer.scene;
    if (scene && scene.primitives) {
      if (this.surfacePrimitive) {
        scene.primitives.remove(this.surfacePrimitive);
        this.surfacePrimitive = null;
      }
      if (this.wireframePrimitive) {
        scene.primitives.remove(this.wireframePrimitive);
        this.wireframePrimitive = null;
      }
      if (this.gnnNodesCollection) {
        scene.primitives.remove(this.gnnNodesCollection);
        this.gnnNodesCollection = null;
      }
      scene.requestRender();
    }
  }

  public rebuild() {
    this.clearPrimitives();
    if (!this.data || !this.viewer || this.viewer.isDestroyed()) return;
    if (typeof Cesium === "undefined") return;

    const { vertices, triangles, min_elevation, max_elevation, gnn } = this.data;
    const vertexCount = vertices.length;
    if (vertexCount < 3 || triangles.length === 0) return;

    const {
      visible,
      surfaceVisible,
      wireframeVisible,
      elevationColoring,
      gnnNodesVisible,
      opacity,
      verticalExaggeration,
    } = this.options;

    // 1. Build Cartesian3 positions array applying vertical exaggeration
    const positions = new Float64Array(vertexCount * 3);
    const surfaceColors = new Uint8Array(vertexCount * 4);
    const wireframeColors = new Uint8Array(vertexCount * 4);

    const elevRange = Math.max(max_elevation - min_elevation, 1.0);
    const alphaByte = Math.round(Math.max(0.05, Math.min(1.0, opacity)) * 255);
    const wireframeAlphaByte = Math.round(Math.min(1.0, opacity + 0.15) * 255);

    for (let i = 0; i < vertexCount; i++) {
      const [lon, lat, elev] = vertices[i];
      const scaledElev = elev * verticalExaggeration;
      const cart = Cesium.Cartesian3.fromDegrees(lon, lat, scaledElev);

      positions[i * 3] = cart.x;
      positions[i * 3 + 1] = cart.y;
      positions[i * 3 + 2] = cart.z;

      // Surface vertex color
      const t = Math.max(0.0, Math.min(1.0, (elev - min_elevation) / elevRange));
      let r: number, g: number, b: number;

      if (elevationColoring) {
        // Professional multi-stop terrain gradient:
        // 0.0 - 0.25: Lush Valley Green (#16a34a -> #65a30d)
        // 0.25 - 0.50: Yellowish Lime to Golden Ochre (#65a30d -> #eab308)
        // 0.50 - 0.75: Golden Ochre to Earthy Terracotta (#eab308 -> #ea580c)
        // 0.75 - 1.00: Terracotta to Rocky Alpine Snow (#ea580c -> #f1f5f9)
        if (t < 0.25) {
          const k = t / 0.25;
          r = Math.round(22 + k * (101 - 22));
          g = Math.round(163 + k * (163 - 163));
          b = Math.round(74 + k * (13 - 74));
        } else if (t < 0.5) {
          const k = (t - 0.25) / 0.25;
          r = Math.round(101 + k * (234 - 101));
          g = Math.round(163 + k * (179 - 163));
          b = Math.round(13 + k * (8 - 13));
        } else if (t < 0.75) {
          const k = (t - 0.5) / 0.25;
          r = Math.round(234 + k * (234 - 234));
          g = Math.round(179 + k * (88 - 179));
          b = Math.round(8 + k * (12 - 8));
        } else {
          const k = (t - 0.75) / 0.25;
          r = Math.round(234 + k * (241 - 234));
          g = Math.round(88 + k * (245 - 88));
          b = Math.round(12 + k * (249 - 12));
        }
      } else {
        // Subtle monochromatic slate-cyan terrain shading
        const val = Math.round(70 + t * 90);
        r = val;
        g = Math.round(val * 1.08);
        b = Math.round(val * 1.15);
      }

      surfaceColors[i * 4] = r;
      surfaceColors[i * 4 + 1] = g;
      surfaceColors[i * 4 + 2] = b;
      surfaceColors[i * 4 + 3] = alphaByte;

      // Wireframe vertex color (crisp electric cyan for clear topology contrast)
      wireframeColors[i * 4] = 34;
      wireframeColors[i * 4 + 1] = 211;
      wireframeColors[i * 4 + 2] = 238;
      wireframeColors[i * 4 + 3] = wireframeAlphaByte;
    }

    const boundingSphere = Cesium.BoundingSphere.fromVertices(positions);

    // 2. Create Surface Primitive (TRIANGLES)
    const flatIndices = new (vertexCount > 65535 ? Uint32Array : Uint16Array)(triangles.length * 3);
    for (let i = 0; i < triangles.length; i++) {
      flatIndices[i * 3] = triangles[i][0];
      flatIndices[i * 3 + 1] = triangles[i][1];
      flatIndices[i * 3 + 2] = triangles[i][2];
    }

    const surfaceGeometry = new Cesium.Geometry({
      attributes: {
        position: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.DOUBLE,
          componentsPerAttribute: 3,
          values: positions,
        }),
        color: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
          componentsPerAttribute: 4,
          values: surfaceColors,
          normalize: true,
        }),
      },
      indices: flatIndices,
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: boundingSphere,
    });

    this.surfacePrimitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: surfaceGeometry,
        id: "tin-terrain-surface",
      }),
      appearance: new Cesium.PerInstanceColorAppearance({
        translucent: opacity < 1.0,
        closed: false,
        flat: false,
      }),
      asynchronous: false,
      show: visible && surfaceVisible,
    });

    this.viewer.scene.primitives.add(this.surfacePrimitive);

    // 3. Create Wireframe Primitive (LINES following exact TIN topology)
    const edgeSet = new Set<string>();
    const edgeIndicesList: number[] = [];

    for (let i = 0; i < triangles.length; i++) {
      const [a, b, c] = triangles[i];
      const edges: [number, number][] = [
        [Math.min(a, b), Math.max(a, b)],
        [Math.min(b, c), Math.max(b, c)],
        [Math.min(c, a), Math.max(c, a)],
      ];

      for (const [u, v] of edges) {
        const key = `${u}_${v}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edgeIndicesList.push(u, v);
        }
      }
    }

    const edgeIndices = new (vertexCount > 65535 ? Uint32Array : Uint16Array)(edgeIndicesList);

    const wireframeGeometry = new Cesium.Geometry({
      attributes: {
        position: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.DOUBLE,
          componentsPerAttribute: 3,
          values: positions,
        }),
        color: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
          componentsPerAttribute: 4,
          values: wireframeColors,
          normalize: true,
        }),
      },
      indices: edgeIndices,
      primitiveType: Cesium.PrimitiveType.LINES,
      boundingSphere: boundingSphere,
    });

    this.wireframePrimitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: wireframeGeometry,
        id: "tin-terrain-wireframe",
      }),
      appearance: new Cesium.PerInstanceColorAppearance({
        translucent: true,
        closed: false,
        flat: true,
      }),
      asynchronous: false,
      show: visible && wireframeVisible,
    });

    this.viewer.scene.primitives.add(this.wireframePrimitive);

    // 4. Create GNN Graph Nodes (PointPrimitiveCollection placed when TIN connects)
    this.gnnNodesCollection = new Cesium.PointPrimitiveCollection();
    this.gnnNodesCollection.show = visible && gnnNodesVisible;

    const gnnScores = gnn?.node_scores;
    const stride = vertexCount > 15000 ? Math.ceil(vertexCount / 10000) : 1;

    for (let i = 0; i < vertexCount; i += stride) {
      const [lon, lat, elev] = vertices[i];
      const scaledElev = elev * verticalExaggeration + 1.2;
      const cart = Cesium.Cartesian3.fromDegrees(lon, lat, scaledElev);

      const score = gnnScores && gnnScores[i] !== undefined ? gnnScores[i] : 0.5;
      let ptColor;
      let ptSize = 4.5;

      if (score > 0.65) {
        ptColor = Cesium.Color.fromCssColorString("#ef4444").withAlpha(0.95);
        ptSize = 5.5;
      } else if (score > 0.52) {
        ptColor = Cesium.Color.fromCssColorString("#f59e0b").withAlpha(0.95);
        ptSize = 5.0;
      } else {
        ptColor = Cesium.Color.fromCssColorString("#06b6d4").withAlpha(0.9);
        ptSize = 4.0;
      }

      this.gnnNodesCollection.add({
        position: cart,
        color: ptColor,
        pixelSize: ptSize,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1.0,
      });
    }

    this.viewer.scene.primitives.add(this.gnnNodesCollection);
    this.viewer.scene.requestRender();
  }
}

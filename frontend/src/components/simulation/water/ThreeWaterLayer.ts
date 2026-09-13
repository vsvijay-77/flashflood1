import * as THREE from 'three';
import { createWaterMaterial } from './waterMaterial';
import { FloodModel, inRing, inWaterPolygon, segmentDistance } from './floodModel';
import type { Point } from './floodModel';
import type { WaterFootprint } from './osmWater';

export class ThreeWaterLayer {
  model: FloodModel;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera();
  material: THREE.ShaderMaterial;
  private sceneTexture: THREE.CanvasTexture;
  private terrainTexture: THREE.DataTexture;
  private cornerFlow: Float32Array;
  private cornerShore: Float32Array;
  private shorelines: Float32Array;
  geometry = new THREE.BufferGeometry();
  private terrainGeometry = new THREE.BufferGeometry();
  private terrainMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  private frame: THREE.Matrix4;
  private positions: Float32Array;
  private depths: Float32Array;
  private flows: Float32Array;
  private corners: Float32Array;
  private heights: Float32Array;
  private surface: Float32Array;
  private surfaceWeights: Uint8Array;
  private width: number;
  private height: number;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private viewer: any;
  private constructor(viewer: any, canvas: HTMLCanvasElement, grid: {
    width: number; height: number; spacing: number; corners: Float32Array; heights: Float32Array;
    frame: THREE.Matrix4; bed: Float32Array; active: Uint8Array; source: Uint8Array;
  }) {
    this.viewer = viewer;
    this.sceneTexture = new THREE.CanvasTexture(viewer.scene.canvas);
    this.sceneTexture.colorSpace = THREE.SRGBColorSpace;
    this.sceneTexture.minFilter = THREE.LinearFilter;
    this.sceneTexture.magFilter = THREE.LinearFilter;
    this.sceneTexture.generateMipmaps = false;
    const terrainData = new Float32Array(grid.heights.length*4);
    for(let i=0;i<grid.heights.length;i++) terrainData[i*4]=grid.corners[i*3+2];
    this.terrainTexture = new THREE.DataTexture(terrainData,grid.width+1,grid.height+1,THREE.RGBAFormat,THREE.FloatType);
    this.terrainTexture.minFilter=THREE.LinearFilter;
    this.terrainTexture.magFilter=THREE.LinearFilter;
    this.terrainTexture.needsUpdate=true;
    const start=0, end=(grid.heights.length-1)*3;
    const bounds=new THREE.Vector4(grid.corners[start],grid.corners[start+1],grid.corners[end]-grid.corners[start],grid.corners[end+1]-grid.corners[start+1]);
    this.material = createWaterMaterial(this.sceneTexture,this.terrainTexture,bounds);
    this.material.uniforms.swellLength.value = Math.max(60,grid.spacing*5);
    this.cornerFlow = new Float32Array(grid.heights.length*2);
    this.cornerShore = new Float32Array(grid.heights.length);
    this.shorelines = new Float32Array(grid.bed.length*6);
    this.width = grid.width; this.height = grid.height; this.frame = grid.frame;
    this.corners = grid.corners; this.heights = grid.heights;
    this.surface = new Float32Array(grid.heights.length);
    this.surfaceWeights = new Uint8Array(grid.heights.length);
    this.model = new FloodModel(grid.width, grid.height, grid.spacing, grid.bed, grid.active, grid.source);
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setClearColor(0, 0); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.positions = new Float32Array(grid.bed.length * 18);
    this.depths = new Float32Array(grid.bed.length * 6);
    this.flows = new Float32Array(grid.bed.length * 12);
    this.geometry.setAttribute('shoreline', new THREE.BufferAttribute(this.shorelines, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('depth', new THREE.BufferAttribute(this.depths, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('flow', new THREE.BufferAttribute(this.flows, 2).setUsage(THREE.DynamicDrawUsage));
    const water = new THREE.Mesh(this.geometry, this.material);
    water.frustumCulled = false; water.renderOrder = 1; this.scene.add(water);
    this.terrainGeometry.setAttribute('position', new THREE.BufferAttribute(grid.corners, 3));
    const indices: number[] = [];
    for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
      const a = y * (grid.width + 1) + x, b = a + 1, c = a + grid.width + 1, d = c + 1;
      indices.push(a,b,c,b,d,c);
    }
    this.terrainGeometry.setIndex(indices);
    const terrain = new THREE.Mesh(this.terrainGeometry, this.terrainMaterial);
    terrain.frustumCulled = false; terrain.renderOrder = 0; this.scene.add(terrain);
    this.camera.matrixAutoUpdate = false;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas); this.resize(); this.updateGeometry();
  }
  private resize() {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.renderer.setSize(Math.max(1,r.width), Math.max(1,r.height), false);
    this.renderer.getDrawingBufferSize(this.material.uniforms.resolution.value);
  }
  static async sampleTerrain(viewer: any, polygon: Point[], signal: AbortSignal) {
    const C = (window as any).Cesium;
    if (!viewer.terrainProvider?.availability) throw new Error('Elevation terrain is unavailable. Water simulation needs real terrain; retry after terrain loads.');
    const west = Math.min(...polygon.map(p=>p[0])), east = Math.max(...polygon.map(p=>p[0]));
    const south = Math.min(...polygon.map(p=>p[1])), north = Math.max(...polygon.map(p=>p[1]));
    const lat = (south+north)/2, lon = (west+east)/2;
    const mx = 111320*Math.cos(lat*Math.PI/180), my = 111320;
    const spacing = Math.max(8, Math.max((east-west)*mx,(north-south)*my)/160);
    const width = Math.max(2,Math.ceil((east-west)*mx/spacing)), height = Math.max(2,Math.ceil((north-south)*my/spacing));
    const points: any[] = [];
    for(let y=0;y<=height;y++) for(let x=0;x<=width;x++) points.push(C.Cartographic.fromDegrees(west+x/width*(east-west),south+y/height*(north-south)));
    // Four workers allow Cesium to fetch independent terrain tiles together.
    // A stalled tile cannot leave the loading panel pending indefinitely.
    let next=0;
    const samplingSignal=AbortSignal.any([signal,AbortSignal.timeout(30000)]);
    const worker=async ()=> {
      while(next<points.length) {
        samplingSignal.throwIfAborted();
        const offset=next;next+=2048;
        await new Promise<void>((resolve,reject)=> {
          const abort=()=>reject(new Error('Terrain loading timed out. Retry water after the map terrain finishes loading.'));
          samplingSignal.addEventListener('abort',abort,{once:true});
          C.sampleTerrainMostDetailed(viewer.terrainProvider,points.slice(offset,offset+2048))
            .then(()=>{samplingSignal.removeEventListener('abort',abort);resolve();},(e: unknown)=>{samplingSignal.removeEventListener('abort',abort);reject(e);});
        });
      }
    };
    await Promise.all(Array.from({length:Math.min(4,Math.ceil(points.length/2048))},worker));
    signal.throwIfAborted();
    if(points.some(p=>!Number.isFinite(p.height))) throw new Error('Elevation samples are missing. Retry when terrain is available.');
    const cframe = C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(lon,lat,0));
    const inverse = C.Matrix4.inverseTransformation(cframe,new C.Matrix4());
    const frame = new THREE.Matrix4().fromArray(Array.from(cframe) as number[]);
    const corners = new Float32Array(points.length*3), heights = new Float32Array(points.length);
    points.forEach((p,i)=> {
      const local = C.Matrix4.multiplyByPoint(inverse,C.Cartographic.toCartesian(p),new C.Cartesian3());
      corners.set([local.x,local.y,local.z],i*3); heights[i]=p.height;
    });
    return {width,height,spacing,corners,heights,frame,west,east,south,north,mx,my};
  }
  static async create(viewer: any, canvas: HTMLCanvasElement, polygon: Point[], footprints: WaterFootprint[], signal: AbortSignal,
    prepared?: Awaited<ReturnType<typeof ThreeWaterLayer.sampleTerrain>>) {
    const {width,height,spacing,corners,heights,frame,west,east,south,north,mx,my}=prepared ?? await ThreeWaterLayer.sampleTerrain(viewer,polygon,signal);
    signal.throwIfAborted();
    const bed = new Float32Array(width*height), active = new Uint8Array(width*height), source = new Uint8Array(width*height);
    const project = (p: Point): Point => [(p[0]-west)*mx,(p[1]-south)*my];
    const shapes = footprints.map(f=>({...f,rings:f.rings?.map(r=>r.map(project)),line:f.line?.map(project)}));
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const i=y*width+x, a=y*(width+1)+x;
      bed[i]=(heights[a]+heights[a+1]+heights[a+width+1]+heights[a+width+2])/4;
      const geo: Point=[west+(x+.5)/width*(east-west),south+(y+.5)/height*(north-south)];
      active[i]=inRing(geo,polygon)?1:0;
      if(!active[i]) continue;
      const p=project(geo);
      source[i]=shapes.some(f=>f.rings ? inWaterPolygon(p,f.rings) : f.line?.some((b,j,line)=> j>0 && segmentDistance(p,line[j-1],b)<=Math.max(f.width/2,spacing*.55)))?1:0;
    }
    // Every selected area remains simulatable. When OSM has no mapped water
    // intersecting the polygon, seed the lowest sampled active cell as a
    // terrain basin. OSM footprints still take precedence whenever available.
    if(!source.some(Boolean)) {
      let lowest = -1;
      for(let i=0;i<bed.length;i++) {
        if(active[i] && (lowest < 0 || bed[i] < bed[lowest])) lowest=i;
      }
      if(lowest >= 0) source[lowest]=1;
    }
    return new ThreeWaterLayer(viewer,canvas,{width,height,spacing,corners,heights,frame,bed,active,source});
  }
  updateGeometry() {
    const { depth, bed, flowX, flowY } = this.model;
    // Share corner elevations between wet cells to avoid cracks between quads.
    this.surface.fill(0); this.surfaceWeights.fill(0); this.cornerFlow.fill(0); this.cornerShore.fill(0);
    for(let y=0;y<this.height;y++) for(let x=0;x<this.width;x++) {
      const i=y*this.width+x;
      if(depth[i]<.015) continue;
      const a=y*(this.width+1)+x;
      const atShore=x===0 || y===0 || x===this.width-1 || y===this.height-1 ||
        depth[i-1]<.015 || depth[i+1]<.015 || depth[i-this.width]<.015 || depth[i+this.width]<.015;
      for(const corner of [a,a+1,a+this.width+1,a+this.width+2]) {
        this.cornerShore[corner]+=atShore?1:0;
        this.surface[corner]+=bed[i]+depth[i]; this.surfaceWeights[corner]++;
        this.cornerFlow[corner*2]+=flowX[i]; this.cornerFlow[corner*2+1]+=flowY[i];
      }
    }
    for(let i=0;i<this.surface.length;i++) if(this.surfaceWeights[i]) {
      this.surface[i]/=this.surfaceWeights[i];
      this.cornerShore[i]/=this.surfaceWeights[i];
      this.cornerFlow[i*2]/=this.surfaceWeights[i]; this.cornerFlow[i*2+1]/=this.surfaceWeights[i];
    }
    let vertex=0;
    for(let y=0;y<this.height;y++) for(let x=0;x<this.width;x++) {
      const i=y*this.width+x;
      if(depth[i]<.015) continue;
      const a=y*(this.width+1)+x,b=a+1,c=a+this.width+1,d=c+1;
      for(const corner of [a,b,c,b,d,c]) {
        this.positions[vertex*3]=this.corners[corner*3];
        this.positions[vertex*3+1]=this.corners[corner*3+1];
        this.positions[vertex*3+2]=this.corners[corner*3+2]+this.surface[corner]-this.heights[corner]+.08;
        this.depths[vertex]=this.surface[corner]-this.heights[corner];
        this.shorelines[vertex]=this.cornerShore[corner];
        this.flows[vertex*2]=this.cornerFlow[corner*2]; this.flows[vertex*2+1]=this.cornerFlow[corner*2+1]; vertex++;
      }
    }
    this.geometry.setDrawRange(0,vertex);
    for(const attribute of Object.values(this.geometry.attributes)) (attribute as THREE.BufferAttribute).needsUpdate=true;
  }
  render(time: number, visible: boolean, wind = 1) {
    if(this.disposed || this.viewer.isDestroyed()) return;
    const C=(window as any).Cesium;
    // Cesium and Three.js use column-major matrices; multiplying by ENU keeps
    // metre-scale precision while following pan, tilt, orbit and zoom exactly.
    const view=new THREE.Matrix4().fromArray(Array.from(this.viewer.camera.viewMatrix) as number[]).multiply(this.frame);
    this.camera.matrix.copy(view).invert();
    this.camera.updateMatrixWorld(true);
    this.camera.position.setFromMatrixPosition(this.camera.matrixWorld);
    this.camera.projectionMatrix.fromArray(Array.from(this.viewer.camera.frustum.projectionMatrix) as number[]);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.material.uniforms.time.value=time;
    this.material.uniforms.wind.value=wind;
    this.material.uniforms.reflectionProjection.value.copy(this.camera.projectionMatrix);
    this.material.uniforms.reflectionView.value.copy(this.camera.matrixWorldInverse);
    this.renderer.clear();
    if(visible && this.viewer.scene.mode===C.SceneMode.SCENE3D) {
      // Capture during postRender while the Cesium drawing buffer is valid.
      // This samples only the map, never this water overlay (no feedback loop).
      this.sceneTexture.needsUpdate=true;
      this.renderer.render(this.scene,this.camera);
    }
  }
  dispose() {
    this.disposed=true; this.resizeObserver.disconnect();
    this.geometry.dispose(); this.terrainGeometry.dispose(); this.material.dispose(); this.terrainMaterial.dispose();
    this.sceneTexture.dispose(); this.terrainTexture.dispose();
    this.renderer.dispose();
  }
}

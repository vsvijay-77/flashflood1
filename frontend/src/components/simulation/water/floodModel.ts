/** Local-inertial shallow water routing: staggered discharge (m²/s),
 * gravity, Manning friction, wet/dry interfaces and conservative transport.
 * Based on the local-inertial formulation of Bates, Horritt & Fewtrell (2010).
 * This is an interactive approximation, not a calibrated flood forecast.
 */
export class FloodModel {
  depth: Float32Array;
  /** Cell-centred velocities in metres/second, also used to advect surface detail. */
  flowX: Float32Array;
  flowY: Float32Array;
  private dischargeX: Float64Array;
  private dischargeY: Float64Array;
  private delta: Float64Array;
  private outgoing: Float64Array;
  elapsed = 0;
  rise = 0;
  injectedVolume = 0;
  roughness = 0.035;
  width: number; height: number; spacing: number;
  bed: Float32Array; active: Uint8Array; source: Uint8Array;
  constructor(width: number, height: number, spacing: number,
    bed: Float32Array, active: Uint8Array, source: Uint8Array) {
    this.width=width; this.height=height; this.spacing=spacing;
    this.bed=bed; this.active=active; this.source=source;
    this.depth = new Float32Array(bed.length);
    this.flowX = new Float32Array(bed.length);
    this.flowY = new Float32Array(bed.length);
    this.dischargeX = new Float64Array(bed.length);
    this.dischargeY = new Float64Array(bed.length);
    this.delta = new Float64Array(bed.length);
    this.outgoing = new Float64Array(bed.length);
    this.reset();
  }
  reset() {
    this.elapsed = 0; this.rise = 0; this.injectedVolume = 0;
    this.depth.fill(0); this.flowX.fill(0); this.flowY.fill(0);
    this.dischargeX.fill(0); this.dischargeY.fill(0);
    for (let i=0; i<this.depth.length; i++) if (this.active[i] && this.source[i]) this.depth[i]=0.3;
  }
  step(duration: number, riseRate: number, maxRise: number) {
    if (!Number.isFinite(duration) || duration<=0) return;
    let remaining=duration;
    while (remaining>1e-8) {
      let maxWaveSpeed=0;
      for(let i=0;i<this.depth.length;i++) if(this.active[i]) {
        maxWaveSpeed=Math.max(maxWaveSpeed, Math.sqrt(9.81*this.depth[i])+Math.hypot(this.flowX[i],this.flowY[i]));
      }
      // CFL safety bound; a requested step is subdivided, never silently lost.
      const dt=Math.min(remaining,.2,.35*this.spacing/Math.max(maxWaveSpeed,.01));
      this.advance(dt,Math.max(0,riseRate),Math.max(0,maxRise));
      remaining-=dt;
    }
  }
  private advance(dt: number, riseRate: number, maxRise: number) {
    const g=9.81, dx=this.spacing, n=Math.max(.01,this.roughness);
    this.elapsed+=dt;
    this.rise=Math.min(maxRise,this.rise+riseRate*dt);
    for(let i=0;i<this.depth.length;i++) if(this.active[i] && this.source[i]) {
      const supplied=Math.max(0,.3+this.rise-this.depth[i]);
      this.depth[i]+=supplied; this.injectedVolume+=supplied*dx*dx;
    }
    this.delta.fill(0); this.outgoing.fill(0);
    const predict=(a: number,b: number,q: Float64Array)=> {
      if(!this.active[a] || !this.active[b]) {q[a]=0;return;}
      const ha=this.bed[a]+this.depth[a], hb=this.bed[b]+this.depth[b];
      const h=Math.max(ha,hb)-Math.max(this.bed[a],this.bed[b]);
      if(h<.001) {q[a]=0;return;}
      const friction=1+g*dt*n*n*Math.abs(q[a])/Math.pow(h,7/3);
      let discharge=(q[a]-g*h*dt*(hb-ha)/dx)/friction;
      const donor=discharge>=0?a:b;
      // Persistent momentum is allowed, but never extracts water from a dry
      // cell or crosses a dry sill above the donor free surface.
      if(this.depth[donor]<.001 || this.bed[donor]+this.depth[donor]<=Math.max(this.bed[a],this.bed[b])) discharge=0;
      q[a]=discharge;
      this.outgoing[donor]+=Math.abs(discharge)*dt/dx;
    };
    for(let y=0;y<this.height;y++) for(let x=0;x<this.width;x++) {
      const i=y*this.width+x;
      if(x+1<this.width) predict(i,i+1,this.dischargeX);
      if(y+1<this.height) predict(i,i+this.width,this.dischargeY);
    }
    const transport=(a: number,b: number,q: Float64Array)=> {
      const donor=q[a]>=0?a:b;
      q[a]*=Math.min(1,this.depth[donor]/(this.outgoing[donor]||1));
      const moved=q[a]*dt/dx;
      this.delta[a]-=moved; this.delta[b]+=moved;
    };
    for(let y=0;y<this.height;y++) for(let x=0;x<this.width;x++) {
      const i=y*this.width+x;
      if(x+1<this.width) transport(i,i+1,this.dischargeX);
      if(y+1<this.height) transport(i,i+this.width,this.dischargeY);
    }
    for(let y=0;y<this.height;y++) for(let x=0;x<this.width;x++) {
      const i=y*this.width+x;
      this.depth[i]=Math.max(0,this.depth[i]+this.delta[i]);
      const h=Math.max(.025,this.depth[i]);
      this.flowX[i]=this.depth[i]>.001 ? (this.dischargeX[i]+(x?this.dischargeX[i-1]:0))/(2*h) : 0;
      this.flowY[i]=this.depth[i]>.001 ? (this.dischargeY[i]+(y?this.dischargeY[i-this.width]:0))/(2*h) : 0;
    }
  }
}
export type Point = [number, number];
export function inRing(p: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function inWaterPolygon(p: Point, rings: Point[][]) {
  return inRing(p, rings[0]) && !rings.slice(1).some(r => inRing(p, r));
}
export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

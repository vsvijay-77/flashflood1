import { describe, expect, it } from 'vitest';
import { FloodModel, inWaterPolygon } from './floodModel';
function model(bed: number[], sources: number[], active = bed.map(()=>1)) {
  return new FloodModel(bed.length,1,15,new Float32Array(bed),new Uint8Array(active),new Uint8Array(sources));
}
describe('terrain routing',()=>{
  it('flows downhill from the source without wetting an isolated depression across a ridge',()=>{
    const m=model([2,1,0,10,-4],[1,0,0,0,0]);
    for(let i=0;i<2000;i++)m.step(.1,.05,2);
    expect(m.depth[1]).toBeGreaterThan(0);expect(m.depth[2]).toBeGreaterThan(0);
    expect(m.depth[3]).toBe(0);expect(m.depth[4]).toBe(0);
  });
  it('overtops a barrier only after the source rises above it',()=>{
    const m=model([0,1,0],[1,0,0]);
    for(let i=0;i<30;i++)m.step(.1,.05,3);
    expect(m.depth[1]).toBe(0);
    for(let i=0;i<2000;i++)m.step(.1,.05,3);
    expect(m.depth[2]).toBeGreaterThan(0);
  });
  it('conserves volume without sources and never creates negative depths',()=>{
    const m=model([8,4,0,2,0],[0,0,0,0,0]);m.depth[0]=10;
    for(let i=0;i<3000;i++)m.step(.1,0,0);
    expect(Array.from(m.depth).reduce((a,b)=>a+b,0)).toBeCloseTo(10,3);
    expect(Array.from(m.depth).every(d=>d>=0)).toBe(true);
  });
  it('respects the selected boundary and restores initial sources on reset',()=>{
    const m=model([2,0,-4],[1,0,0],[1,0,1]);
    for(let i=0;i<100;i++)m.step(.1,.5,2);
    expect(m.depth[2]).toBe(0);m.reset();
    expect(m.elapsed).toBe(0);expect(m.rise).toBe(0);expect(m.depth[0]).toBeCloseTo(.3);expect(m.depth[1]).toBe(0);
  });
  it('keeps islands out of polygon sources',()=>{
    const rings: [number,number][][]=[[[0,0],[10,0],[10,10],[0,10]],[[4,4],[6,4],[6,6],[4,6]]];
    expect(inWaterPolygon([2,2],rings)).toBe(true);expect(inWaterPolygon([5,5],rings)).toBe(false);
  });
});

describe('inertial shallow water physics',()=>{
  it('preserves a lake at rest over an uneven bed',()=>{
    const m=model([2,1,0,1,2],[0,0,0,0,0]);m.depth.set([1,2,3,2,1]);
    for(let i=0;i<500;i++)m.step(.2,0,0);
    expect(Array.from(m.depth)).toEqual([1,2,3,2,1]);
    expect(Array.from(m.flowX)).toEqual([0,0,0,0,0]);
  });
  it('Manning friction reduces the velocity of an accelerating current',()=>{
    const smooth=model([0,0,0],[0,0,0]), rough=model([0,0,0],[0,0,0]);
    smooth.depth.set([1,.3,.3]);rough.depth.set([1,.3,.3]);
    smooth.roughness=.015;rough.roughness=.15;
    for(let i=0;i<40;i++){smooth.step(.1,0,0);rough.step(.1,0,0);}
    expect(rough.flowX[0]).toBeGreaterThan(0);
    expect(rough.flowX[0]).toBeLessThan(smooth.flowX[0]);
  });
  it('retains momentum when the surface gradient becomes level',()=>{
    const m=model([0,0],[0,0]);m.depth.set([1,.5]);m.step(.1,0,0);
    m.depth.fill(.75);m.step(.1,0,0);
    expect(m.flowX[0]).toBeGreaterThan(0);
  });
  it('conserves water on a two-dimensional wet/dry front',()=>{
    const m=new FloodModel(7,7,8,new Float32Array(49),new Uint8Array(49).fill(1),new Uint8Array(49));
    m.depth[24]=15;
    for(let i=0;i<500;i++)m.step(.2,0,0);
    expect(Array.from(m.depth).reduce((a,b)=>a+b,0)).toBeCloseTo(15,3);
    expect(Array.from(m.depth).every(d=>Number.isFinite(d)&&d>=0)).toBe(true);
    expect(m.depth[23]).toBeGreaterThan(0);expect(m.depth[17]).toBeGreaterThan(0);
  });
  it('subdivides long steps and zero elapsed time leaves the state unchanged',()=>{
    const m=model([0,0],[1,0]);m.step(0,.05,2);
    expect(m.elapsed).toBe(0);expect(m.rise).toBe(0);
    m.step(2.5,.05,2);expect(m.elapsed).toBeCloseTo(2.5,8);
    expect(m.injectedVolume).toBeGreaterThan(0);
  });
});

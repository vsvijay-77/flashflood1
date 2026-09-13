import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture={elements:[{type:'way',id:1,nodes:[1,2,3,4,1],tags:{natural:'water'}},...[ [77,11],[77.01,11],[77.01,11.01],[77,11.01]].map(([lon,lat],i)=>({type:'node',id:i+1,lon,lat}))]};
const bounds=[11,77,11.01,77.01];
const response=()=>new Response(JSON.stringify(fixture),{status:200});
beforeEach(()=>{vi.resetModules();vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn(),removeItem:vi.fn()});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('fast OSM loading',()=>{
  it('shares one request and immediately reuses its successful cache',async()=>{
    const fetch=vi.fn(async()=>response());vi.stubGlobal('fetch',fetch);
    const {fetchWater}=await import('./osmWater');
    const [a,b]=await Promise.all([fetchWater(bounds,new AbortController().signal),fetchWater(bounds,new AbortController().signal)]);
    expect(a[0].rings).toBeDefined();expect(b).toEqual(a);expect(fetch).toHaveBeenCalledTimes(1);
    await fetchWater(bounds,new AbortController().signal);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('a cancelled subscriber does not cancel another viewer subscriber',async()=>{
    let finish!: (r: Response)=>void;
    vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
    const {fetchWater}=await import('./osmWater');const abort=new AbortController();
    const one=fetchWater(bounds,abort.signal).catch(e=>e.name);
    const two=fetchWater(bounds,new AbortController().signal);abort.abort();finish(response());
    expect(await one).toBe('AbortError');expect((await two).length).toBe(1);
  });
  it('uses the public mirror if the backend is unavailable',async()=>{
    const fetch=vi.fn(async(url: string)=>url.startsWith('/api')?new Response('',{status:503}):response());vi.stubGlobal('fetch',fetch);
    const {fetchWater}=await import('./osmWater');const result=fetchWater(bounds,new AbortController().signal);
    await vi.advanceTimersByTimeAsync(801);
    expect((await result).length).toBe(1);expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('never caches partial/error responses as an empty map',async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({remark:'timeout',elements:[]})));vi.stubGlobal('fetch',fetch);
    const {fetchWater}=await import('./osmWater');const result=fetchWater(bounds,new AbortController().signal).catch(e=>e.message);
    await vi.advanceTimersByTimeAsync(801);expect(await result).toContain('unavailable');
    fetch.mockImplementation(async()=>response());expect((await fetchWater(bounds,new AbortController().signal)).length).toBe(1);
  });
  it('loads persisted geometry without a network request after a reload',async()=>{
    vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({saved:Date.now(),water:[{width:5,line:[[77,11],[77.01,11.01]]}]}),setItem:vi.fn()});
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    const {fetchWater}=await import('./osmWater');expect((await fetchWater(bounds,new AbortController().signal)).length).toBe(1);expect(fetch).not.toHaveBeenCalled();
  });
});

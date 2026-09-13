import osmtogeojson from 'osmtogeojson';
import type { Point } from './floodModel';
export interface WaterFootprint { rings?: Point[][]; line?: Point[]; width: number; }
type Cached = { saved: number; water: WaterFootprint[] };
const cache = new Map<string, Cached>();
const pending = new Map<string, { controller: AbortController; promise: Promise<WaterFootprint[]>; users: number }>();
const PREFIX='dt-water:v2:';

export function parseWater(data: Parameters<typeof osmtogeojson>[0]): WaterFootprint[] {
  const geojson = osmtogeojson(data);
  const result: WaterFootprint[] = [];
  for (const f of geojson.features) {
    const tags = f.properties?.tags || f.properties || {};
    if (!(tags.natural === 'water' || ['reservoir', 'basin'].includes(tags.landuse) || ['river', 'stream', 'canal', 'riverbank'].includes(tags.waterway))) continue;
    const width = Math.max(1, Math.min(500, parseFloat(tags.width) || (tags.waterway === 'river' ? 18 : 5)));
    const g = f.geometry;
    if (g.type === 'Polygon') result.push({ rings: g.coordinates as Point[][], width });
    if (g.type === 'MultiPolygon') for (const rings of g.coordinates) result.push({ rings: rings as Point[][], width });
    if (g.type === 'LineString') result.push({ line: g.coordinates as Point[], width });
    if (g.type === 'MultiLineString') for (const line of g.coordinates) result.push({ line: line as Point[], width });
  }
  return result;
}

function readCache(key: string): WaterFootprint[] | undefined {
  let entry=cache.get(key);
  if(!entry) {
    try { entry=JSON.parse(localStorage.getItem(PREFIX+key)||'null') ?? undefined; } catch { /* Storage may be disabled. */ }
  }
  if(entry && Array.isArray(entry.water) && Number.isFinite(entry.saved) &&
    Date.now()-entry.saved<(entry.water.length?86400000:60000)) {
    cache.set(key,entry); return entry.water;
  }
}
function saveCache(key: string,water: WaterFootprint[]) {
  const entry={saved:Date.now(),water};cache.set(key,entry);
  if(cache.size>8) cache.delete(cache.keys().next().value!);
  try {
    const ownKeys=Object.keys(localStorage).filter(k=>k.startsWith(PREFIX));
    if(ownKeys.length>=5 && !ownKeys.includes(PREFIX+key)) {
      ownKeys.sort((a,b)=>(JSON.parse(localStorage.getItem(a)||'{}').saved||0)-(JSON.parse(localStorage.getItem(b)||'{}').saved||0));
      localStorage.removeItem(ownKeys[0]);
    }
    localStorage.setItem(PREFIX+key,JSON.stringify(entry));
  } catch { /* Memory cache still works when storage is full or unavailable. */ }
}
async function load(bounds: number[],signal: AbortSignal): Promise<WaterFootprint[]> {
  const [south,west,north,east]=bounds;
  const box=bounds.join(',');
  const query=`[out:json][timeout:10];(way["natural"="water"](${box});relation["natural"="water"](${box});way["landuse"~"^(reservoir|basin)$"](${box});relation["landuse"~"^(reservoir|basin)$"](${box});way["waterway"~"^(river|stream|canal|riverbank)$"](${box});relation["waterway"="riverbank"](${box}););out body;>;out skel qt;`;
  const losers=new AbortController();
  const combined=AbortSignal.any([signal,losers.signal,AbortSignal.timeout(14000)]);
  const request=async (url: string,body: BodyInit,headers?: HeadersInit)=> {
    const response=await fetch(url,{method:'POST',body,headers,signal:combined});
    if(!response.ok) throw new Error(`OSM request failed (${response.status})`);
    const data=await response.json();
    if(data.remark || !Array.isArray(data.elements)) throw new Error('OSM returned incomplete data');
    return parseWater(data);
  };
  const mirror=async ()=> {
    // Give the same-origin cache first chance. Hedge only a slow/missing backend.
    await new Promise<void>((resolve,reject)=> {
      const abort=()=>{clearTimeout(timer);reject(combined.reason);};
      const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},800);
      if(combined.aborted) abort(); else combined.addEventListener('abort',abort,{once:true});
    });
    return request('https://overpass.openstreetmap.fr/api/interpreter',new URLSearchParams({data:query}));
  };
  try {
    return await Promise.any([
      request('/api/geo/water-bodies',JSON.stringify({south,west,north,east}),{'Content-Type':'application/json'}),
      mirror(),
    ]);
  } catch {
    if(signal.aborted) throw signal.reason;
    throw new Error('OSM water is temporarily unavailable. Retry loading water; saved areas load from cache.');
  } finally { losers.abort(); }
}

export async function fetchWater(bounds: number[],signal: AbortSignal): Promise<WaterFootprint[]> {
  signal.throwIfAborted();
  if(bounds.length!==4 || !bounds.every(Number.isFinite) || bounds[0]>=bounds[2] || bounds[1]>=bounds[3]) throw new Error('Select a valid map area.');
  const key=bounds.map(n=>n.toFixed(5)).join(',');
  const saved=readCache(key);if(saved) return saved;
  let job=pending.get(key);
  if(!job || job.controller.signal.aborted) {
    const controller=new AbortController();
    const promise=load(bounds,controller.signal).then(water=>{saveCache(key,water);return water;});
    job={controller,promise,users:0};pending.set(key,job);
    const own=job;
    void promise.finally(()=>{if(pending.get(key)===own) pending.delete(key);}).catch(()=>{});
  }
  const current=job;current.users++;
  return new Promise((resolve,reject)=> {
    let settled=false;
    const release=()=> {
      if(settled)return false;
      settled=true;signal.removeEventListener('abort',abort);current.users--;
      // React StrictMode remounts may immediately subscribe to the same request.
      queueMicrotask(()=>{if(current.users===0)current.controller.abort();});
      return true;
    };
    const abort=()=>{if(release())reject(signal.reason);};
    signal.addEventListener('abort',abort,{once:true});
    current.promise.then(value=>{if(release())resolve(value);},error=>{if(release())reject(error);});
    if(signal.aborted)abort();
  });
}

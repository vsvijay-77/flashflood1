import { useEffect, useRef, useState } from 'react';
import { Waves, Play, Pause, RotateCcw, X } from 'lucide-react';
import { fetchWater } from './water/osmWater';
import { ThreeWaterLayer } from './water/ThreeWaterLayer';
import type { Point } from './water/floodModel';

export default function CesiumWaterSimulation({ viewer, polygonCoords }: { viewer: any; polygonCoords: [number,number][] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<ThreeWaterLayer | null>(null);
  const settings = useRef({ running: false, speed: 10, rate: .05, maxRise: 5, visible: true, wind: 1 });
  const [open,setOpen]=useState(true);
  const [running,setRunning]=useState(false);
  const [visible,setVisible]=useState(true);
  const [speed,setSpeed]=useState(10);
  const [maxRise,setMaxRise]=useState(5);
  const [wind,setWind]=useState(1);
  const [status,setStatus]=useState('Loading OSM water bodies…');
  const [ready,setReady]=useState(false);
  const [error,setError]=useState(false);
  const [retry,setRetry]=useState(0);
  const [stats,setStats]=useState({seconds:0,rise:0,area:0,spacing:0,count:0});
  const polygonKey=JSON.stringify(polygonCoords);
  // Begin OSM loading while Cesium is still starting; the viewer effect shares
  // this request and cached responses survive navigation and reloads.
  useEffect(()=> {
    const abort=new AbortController();
    const poly=JSON.parse(polygonKey) as Point[];
    if(poly.length>=3) {
      const bounds=[Math.min(...poly.map(p=>p[0])),Math.min(...poly.map(p=>p[1])),Math.max(...poly.map(p=>p[0])),Math.max(...poly.map(p=>p[1]))];
      void fetchWater(bounds,abort.signal).catch(()=>{});
    }
    return ()=>abort.abort();
  },[polygonKey]);
  useEffect(()=> { settings.current={running,speed,rate:.05,maxRise,visible,wind}; },[running,speed,maxRise,visible,wind]);
  useEffect(()=> {
    if(!viewer || viewer.isDestroyed() || !canvas.current) return;
    const abort=new AbortController();
    let current: ThreeWaterLayer | null=null;
    let removeRender: (()=>void) | undefined;
    setReady(false); setError(false); setRunning(false); settings.current.running=false;
    setStatus('Loading OSM water bodies…');
    setStats({seconds:0,rise:0,area:0,spacing:0,count:0});
    const poly: Point[]=(JSON.parse(polygonKey) as Point[]).map(([lat,lon])=>[lon,lat]);
    async function load() {
      try {
        const bounds=[Math.min(...poly.map(p=>p[1])),Math.min(...poly.map(p=>p[0])),Math.max(...poly.map(p=>p[1])),Math.max(...poly.map(p=>p[0]))];
        let usedTerrainSource=false;
        const [water,terrain]=await Promise.all([
          fetchWater(bounds,abort.signal).catch(()=>{
            // A selected area must still be usable during Overpass outages.
            // The terrain grid will seed its lowest cell as the source.
            usedTerrainSource=true;
            return [];
          }).then(water=>{
            abort.signal.throwIfAborted();
            setStatus(water.length ? 'OSM water found · preparing terrain…' : 'Preparing terrain source…');
            return water;
          }),
          ThreeWaterLayer.sampleTerrain(viewer,poly,abort.signal),
        ]);
        abort.signal.throwIfAborted();
        current=await ThreeWaterLayer.create(viewer,canvas.current!,poly,water,abort.signal,terrain);
        if(abort.signal.aborted) { current.dispose(); return; }
        layer.current=current; setReady(true); setStatus(usedTerrainSource ? 'Ready · terrain source' : 'Ready · OSM water');
        setStats(s=>({...s,count:water.length,spacing:current!.model.spacing}));
        let last=performance.now(),lastStats=0,accumulator=0,waveTime=0;
        removeRender=viewer.scene.postRender.addEventListener(()=> {
          if(!current) return;
          const now=performance.now(),dt=Math.min((now-last)/1000,.1);last=now;
          if(settings.current.running) {
            accumulator+=dt*settings.current.speed;
            // Bound the physics work per frame to keep camera controls responsive.
            const budgetStart=performance.now();
            while(accumulator>=.2 && performance.now()-budgetStart<8) {
              current.model.step(.2,settings.current.rate,settings.current.maxRise); accumulator-=.2;
            }
            accumulator=Math.min(accumulator,settings.current.speed*.25);
            waveTime+=dt; current.updateGeometry();
          }
          current.render(waveTime,settings.current.visible,settings.current.wind);
          if(now-lastStats>500) {
            lastStats=now;
            const model=current.model;
            let wet=0; model.depth.forEach((d,i)=>{if(d>.02&&!model.source[i])wet++;});
            setStats(s=>({...s,seconds:model.elapsed,rise:model.rise,area:wet*model.spacing**2/10000}));
          }
        });
      } catch(e) {
        if(!abort.signal.aborted) { setError(true);setStatus(e instanceof Error?e.message:'Unable to load water. Retry.');abort.abort(); }
      }
    }
    void load();
    return ()=>{abort.abort();removeRender?.();current?.dispose();if(layer.current===current)layer.current=null;};
  },[viewer,polygonKey,retry]);
  const reset=()=> {
    setRunning(false);settings.current.running=false;
    layer.current?.model.reset();layer.current?.updateGeometry();
    setStats(s=>({...s,seconds:0,rise:0,area:0}));
  };
  return <>
    <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none z-[5]" />
    <div className="absolute right-3 top-14 z-[25] max-h-[calc(100%-4.5rem)] overflow-y-auto max-w-[calc(100%-1.5rem)] text-sm text-slate-100" onKeyDown={e=>e.stopPropagation()} onKeyUp={e=>e.stopPropagation()}>
      {!open ? <button onClick={()=>setOpen(true)} className="flex items-center gap-2 rounded-lg border border-cyan-700 bg-slate-950/95 px-3 py-2"><Waves size={16}/>Water simulation</button> :
      <section aria-label="Water simulation" className="w-72 max-w-full rounded-xl border border-cyan-800/70 bg-slate-950/95 p-3 shadow-xl backdrop-blur-md">
        <div className="flex items-center justify-between gap-2"><strong className="flex items-center gap-2"><Waves size={17} className="text-cyan-400"/>3D water</strong><button aria-label="Minimize water controls" onClick={()=>setOpen(false)}><X size={16}/></button></div>
        <p role="status" className={`mt-2 text-sm ${error?'text-amber-300':'text-slate-300'}`}>{ready?(stats.count?`${stats.count} OSM water features · ${Math.round(stats.spacing)} m grid`:`Terrain basin source · ${Math.round(stats.spacing)} m grid`):status}</p>
        {error && <button className="mt-2 underline" onClick={()=>setRetry(n=>n+1)}>Retry loading water</button>}
        <div className="mt-3 flex gap-2">
          <button disabled={!ready} onClick={()=>setRunning(r=>!r)} className="flex flex-1 items-center justify-center gap-2 rounded-md bg-cyan-700 px-3 py-2 font-medium disabled:opacity-40">{running?<Pause size={16}/>:<Play size={16}/>} {running?'Pause water':stats.seconds?'Resume':'Start water'}</button>
          <button disabled={!ready} onClick={reset} className="rounded-md border border-slate-600 p-2 disabled:opacity-40" aria-label="Reset water"><RotateCcw size={16}/></button>
        </div>
        <label className="mt-3 block">Source rise limit <span className="float-right">{maxRise} m</span><input aria-label="Source rise limit" className="mt-2 w-full accent-cyan-400" type="range" min="0" max="20" step=".5" value={maxRise} onChange={e=>{setMaxRise(+e.target.value);reset();}}/></label>
        <label className="mt-2 flex items-center justify-between">Time speed<select aria-label="Water time speed" value={speed} onChange={e=>setSpeed(+e.target.value)} className="rounded border border-slate-600 bg-slate-900 px-2 py-1">{[1,10,30,60].map(n=><option key={n} value={n}>{n}×</option>)}</select></label>
        <label className="mt-3 block">Surface waves <span className="float-right text-slate-300">{wind<.4?'Calm':wind<1.3?'Breeze':'Windy'}</span><input aria-label="Surface waves" type="range" min="0" max="2" step=".1" value={wind} onChange={e=>setWind(+e.target.value)} className="mt-2 w-full accent-cyan-400"/></label>
        <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={visible} onChange={e=>setVisible(e.target.checked)}/> Show 3D water</label>
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-700 pt-2 text-center"><span>{Math.floor(stats.seconds)} s<small className="block text-xs text-slate-400">Elapsed</small></span><span>{stats.rise.toFixed(1)} m<small className="block text-xs text-slate-400">Source rise</small></span><span>{stats.area.toFixed(1)} ha<small className="block text-xs text-slate-400">Spread</small></span></div>
        <p className="mt-2 text-xs text-slate-400">Gravity, momentum and terrain friction drive the flow. Waves and foam follow the current. Changing the limit resets the simulation.</p>
        <a className="mt-1 inline-block text-xs text-cyan-400" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
      </section>}
    </div>
  </>;
}

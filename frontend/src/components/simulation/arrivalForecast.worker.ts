import { createArrivalForecast, advanceArrivalForecast, type ArrivalForecastInput } from "./arrivalForecast";

let generation = 0;
let pendingTick: ReturnType<typeof setTimeout> | undefined;

self.onmessage = (event: MessageEvent<ArrivalForecastInput>) => {
  const currentGeneration = ++generation;
  if (pendingTick !== undefined) clearTimeout(pendingTick);
  const input = event.data;
  const simulation = createArrivalForecast(input);
  let lastPublished = -Infinity;
  const tick = () => {
    if (currentGeneration !== generation) return;
    // Yield regularly so a new scenario can replace this work promptly.
    const result = advanceArrivalForecast(simulation, input, 24);
    const now = performance.now();
    if (result.complete || now - lastPublished >= 1000) {
      // Copy only when publishing; transferring the solver's own array would detach it.
      const arrivals = new Float64Array(result.arrivals);
      self.postMessage({ ...result, arrivals }, { transfer: [arrivals.buffer] });
      lastPublished = now;
    }
    if (!result.complete) pendingTick = setTimeout(tick, 0);
    else pendingTick = undefined;
  };
  tick();
};

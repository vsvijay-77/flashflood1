import { createArrivalForecast, advanceArrivalForecast, type ArrivalForecastInput } from "./arrivalForecast";
self.onmessage = (event: MessageEvent<ArrivalForecastInput>) => {
  const input = event.data;
  const simulation = createArrivalForecast(input);
  const tick = () => {
    const result = advanceArrivalForecast(simulation, input, 150);
    self.postMessage(result);
    if (!result.complete) setTimeout(tick, 0);
  };
  tick();
};

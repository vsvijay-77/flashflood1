import { planEvacuation, type EvacuationInput } from './evacuationPlanner';
self.onmessage = (event: MessageEvent<EvacuationInput>) => {
  try { self.postMessage(planEvacuation(event.data)); }
  catch { self.postMessage({ status: 'error', message: 'Unable to assess this route. Check the selected area and retry.' }); }
};

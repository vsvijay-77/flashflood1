import { indexBuildings, assessBuildings, type BuildingSample } from './buildingExposure';
let samples: BuildingSample[] = [];
self.onmessage = ({ data }) => {
  if (data.type === 'index') {
    samples = indexBuildings(data.buildings, data.grid, data.mask);
    self.postMessage({ type: 'indexed', samples });
  } else {
    self.postMessage({ type: 'assessed', revision: data.revision,
      exposures: assessBuildings(samples, data.depth, data.peaks, data.arrivals, data.predicted).sort((a, b) => (a.arrivalSeconds ?? a.predictedArrivalSeconds ?? Infinity) - (b.arrivalSeconds ?? b.predictedArrivalSeconds ?? Infinity)) });
  }
};

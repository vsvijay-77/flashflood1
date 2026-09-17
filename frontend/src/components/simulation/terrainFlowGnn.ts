import weights from "./terrainFlowGnnWeights.json";

export const terrainFlowGnnMetadata = weights;

export function predictEdgeDischarge(depth: number, slope: number, roughness: number): number {
  if (!Number.isFinite(depth) || !Number.isFinite(slope) || !Number.isFinite(roughness) || depth <= 0 || slope <= 0 || roughness <= 0) return 0;
  if (depth < 0.0001 || depth > 10 || slope < 0.00001 || slope > 2 || roughness < 0.005 || roughness > 0.15) {
    return Math.pow(depth, 5 / 3) * Math.sqrt(slope) / roughness;
  }
  const depthFeature = 2 * (Math.log(depth) - weights.featureMin[0]) / (weights.featureMax[0] - weights.featureMin[0]) - 1;
  const slopeFeature = 2 * (Math.log(slope) - weights.featureMin[1]) / (weights.featureMax[1] - weights.featureMin[1]) - 1;
  const roughnessFeature = 2 * (-Math.log(roughness) - weights.featureMin[2]) / (weights.featureMax[2] - weights.featureMin[2]) - 1;
  let output = weights.outputBias;
  for (let hidden = 0; hidden < weights.inputBias.length; hidden++) {
    const row = weights.inputWeights[hidden];
    const activation = Math.max(0, row[0] * depthFeature + row[1] * slopeFeature + row[2] * roughnessFeature + weights.inputBias[hidden]);
    output += activation * weights.outputWeights[hidden];
  }
  return Math.exp(output);
}

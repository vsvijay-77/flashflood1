import { formatHazardLeadTime, formatHazardProbability, MULTI_HAZARD_COLORS, type MultiHazardFeature } from "@/lib/multiHazard";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]!));

/** Load only API features, and retire pending loads when the area or viewer changes. */
export function addMultiHazardLayer(
  cesium: any,
  viewer: any,
  features: MultiHazardFeature[],
  onError: () => void,
): () => void {
  const source = new cesium.GeoJsonDataSource("multi-hazard-predictions");
  let cancelled = false;
  const remove = () => {
    if (!viewer.isDestroyed() && viewer.dataSources.contains(source)) {
      viewer.dataSources.remove(source, true);
      viewer.scene.requestRender();
    }
    source.entities.removeAll();
  };
  const load = async () => {
    await source.load({
      type: "FeatureCollection",
      features: features.map((feature, index) => ({ ...feature, id: `multi-hazard-${index}` })),
    }, { clampToGround: true });
    if (cancelled || viewer.isDestroyed()) {
      remove();
      return;
    }
    for (const [index, feature] of features.entries()) {
      const entity = source.entities.getById(`multi-hazard-${index}`);
      if (!entity) continue;
      const prediction = feature.properties;
      entity.name = `${prediction.node_id} · ${prediction.risk_class} multi-hazard risk`;
      entity.billboard = undefined;
      entity.point = new cesium.PointGraphics({
        pixelSize: 14,
        color: cesium.Color.fromCssColorString(MULTI_HAZARD_COLORS[prediction.risk_class]),
        outlineColor: cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      entity.description = `<table><tbody>${[
        ["Node", prediction.node_id],
        ["Flood probability", formatHazardProbability(prediction.flood_probability)],
        ["Landslide probability", formatHazardProbability(prediction.landslide_probability)],
        ["Combined risk", formatHazardProbability(prediction.combined_risk)],
        ["Confidence (calibrated correctness)", formatHazardProbability(prediction.confidence)],
        ["Lead time", formatHazardLeadTime(prediction.lead_time_minutes)],
        ["Risk class", prediction.risk_class],
        ["Model version", prediction.model_version],
        ["Prediction time", prediction.timestamp],
      ].map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</tbody></table>`;
    }
    await viewer.dataSources.add(source);
    if (cancelled || viewer.isDestroyed()) remove();
    else viewer.scene.requestRender();
  };
  void load().catch(() => {
    remove();
    if (!cancelled && !viewer.isDestroyed()) onError();
  });
  return () => {
    cancelled = true;
    remove();
  };
}

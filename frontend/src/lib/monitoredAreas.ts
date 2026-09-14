import { apiPost } from "./api";

export async function deleteMonitoredArea(area: { id: string; name: string }) {
  await apiPost("/geo/area-data/delete", { area_id: area.id });
  // Remove previous viewer versions' browser copies only after confirmed deletion.
  const safeName = area.name.replace(/\s+/g, "_");
  for (const key of Object.keys(localStorage)) {
    if ((key.startsWith("dt_networks_") || key.startsWith("dt_mesh_nodes_") ||
         key.startsWith("dt_deployed_sensors_") || key.startsWith("dt_user_activity_")) &&
        (key.includes(area.id) || key.endsWith(`_${safeName}`) || key.includes(`_${safeName}_`))) {
      localStorage.removeItem(key);
    }
  }
  localStorage.removeItem("cached_custom_areas");
  window.dispatchEvent(new CustomEvent("monitored-area-deleted", { detail: area.id }));
}

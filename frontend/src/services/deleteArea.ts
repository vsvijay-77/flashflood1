import { supabase } from "@/lib/supabase";

export async function deleteArea(id: string, name: string) {
  const { data, error } = await supabase.from("custom_areas").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("Area was not deleted. Check your access and retry.");
  // A deleted area must not be resurrected by the saved-area picker on remount.
  try {
    const areas = JSON.parse(localStorage.getItem("cached_custom_areas") || "[]");
    localStorage.setItem("cached_custom_areas", JSON.stringify(areas.filter((area: { id: string }) => area.id !== id)));
  } catch { localStorage.removeItem("cached_custom_areas"); }
  const safeName = name.replace(/\s+/g, "_");
  for (const key of Object.keys(localStorage)) {
    if (key === `dt_mesh_nodes_${safeName}` || key === `dt_user_activity_${safeName}` ||
        key === `dt_networks_${safeName}` || key.startsWith(`dt_networks_v8_${safeName}_`) || key.startsWith(`dt_networks_v9_${safeName}_`)) {
      localStorage.removeItem(key);
    }
  }
  window.dispatchEvent(new CustomEvent("area-deleted", { detail: id }));
}

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { Alert, Gateway, NetworkStats, Sensor, Zone } from "@/lib/types";

export function useNetwork() {
  const zones = useQuery({ queryKey: ["zones"], queryFn: () => apiGet<Zone[]>("/zones"), retry: false });
  const sensors = useQuery({ queryKey: ["sensors"], queryFn: () => apiGet<Sensor[]>("/sensors"), retry: false });
  const gateways = useQuery({ queryKey: ["gateways"], queryFn: () => apiGet<Gateway[]>("/gateways"), retry: false });
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => apiGet<NetworkStats>("/stats"), retry: false });
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: () => apiGet<Alert[]>("/alerts"), retry: false });
  return { zones, sensors, gateways, stats, alerts };
}

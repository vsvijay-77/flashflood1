/** Keep normal polling responsive; back off when the telemetry source is down. */
export function sensorRefetchInterval(query: { state: { error: unknown; data: unknown } }): number {
  const data = query.state.data;
  const disconnected = data !== null && typeof data === "object" && "connected" in data && data.connected === false;
  return query.state.error || disconnected ? 30_000 : 5_000;
}

export const sensorPolling = { refetchInterval: sensorRefetchInterval, retry: false } as const;

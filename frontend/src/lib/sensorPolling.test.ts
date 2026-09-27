import { expect, it } from "vitest";
import { sensorRefetchInterval } from "./sensorPolling";

it("backs off failed history queries and disconnected summaries, then resumes after recovery", () => {
  expect(sensorRefetchInterval({ state: { error: new Error("503"), data: [] } })).toBe(30_000);
  expect(sensorRefetchInterval({ state: { error: null, data: { connected: false } } })).toBe(30_000);
  expect(sensorRefetchInterval({ state: { error: null, data: { connected: true } } })).toBe(5_000);
  expect(sensorRefetchInterval({ state: { error: null, data: [] } })).toBe(5_000);
});

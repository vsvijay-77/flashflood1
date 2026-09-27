import { afterEach, describe, expect, it, vi } from "vitest";
import { forecastFrameIndex, surfaceImage, validateForecast } from "./TwinForecastHeatmap";

afterEach(() => vi.unstubAllGlobals());

describe("terrain heatmap raster", () => {
  it("places north at the top, interpolates the centre, and masks the selected polygon", () => {
    let raster: { data: Uint8ClampedArray };
    const ctx = {
      createImageData: () => ({ data: new Uint8ClampedArray(512 * 512 * 4) }),
      putImageData: (image: { data: Uint8ClampedArray }) => { raster = image; },
      globalCompositeOperation: "source-over", beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
      stroke: vi.fn(), lineWidth: 1, strokeStyle: "", fillStyle: "",
    };
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ctx, toDataURL: () => "data:image/png;base64,test" }) });
    surfaceImage([[10, 77], [11, 77], [10, 78]], [10, 11, 77, 78], [0, 0, 1, 1], 2);
    expect(Array.from(raster!.data.slice(0, 4))).toEqual([220, 38, 38, 245]);
    const bottom = 511 * 512 * 4;
    expect(Array.from(raster!.data.slice(bottom, bottom + 4))).toEqual([37, 99, 235, 60]);
    const middle = (256 * 512 + 256) * 4;
    expect(raster!.data[middle]).toBeGreaterThan(100);
    expect(ctx.globalCompositeOperation).toBe("destination-in");
    expect(ctx.moveTo.mock.calls[0][0]).toBeLessThan(0);
    expect(ctx.moveTo.mock.calls[0][1]).toBeGreaterThan(512);
    expect(ctx.lineTo.mock.calls[0][1]).toBeLessThan(0);
    expect(ctx.lineTo.mock.calls[1][0]).toBeGreaterThan(512);
    expect(ctx.closePath).toHaveBeenCalledOnce();
    expect(ctx.fill).toHaveBeenCalledOnce();
  });
});

it("does not turn dry lowlands or small hazard scores into red flood zones", () => {
  let raster: { data: Uint8ClampedArray };
  const ctx = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (image: { data: Uint8ClampedArray }) => { raster = image; } };
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ctx, toDataURL: () => "raster" }) });
  surfaceImage([], [0, 1, 0, 1], [0, 0, 0, 0], 2, [0, 10, 20, 30], 2);
  expect(Array.from(raster!.data.slice(0, 4))).toEqual([37, 99, 235, 60]);
  surfaceImage([], [0, 1, 0, 1], [0.01, 0, 0.01, 0], 2, undefined, 2);
  expect(raster!.data[0]).toBeLessThan(40);
});


it("rejects missing scores rather than displaying them as low risk", () => {
  expect(() => surfaceImage([], [0, 1, 0, 1], [0, 0, NaN, 1], 2)).toThrow("Incomplete");
  expect(() => surfaceImage([], [0, 1, 0, 1], [0, 0, 1], 2)).toThrow("Incomplete");
});

it("validates forecast frames and clamps the timeline to returned hours", () => {
  const forecast = { size: 2, mode: "experimental", source: "weather", fetched_at: "2026-09-24T12:00:00Z",
    frames: [{ time: "2026-09-24T12:00:00Z", precipitation: 1, temperature_2m: 20,
      relative_humidity_2m: 80, wind_speed_10m: 5, scores: [0, 0.1, 0.2, 0.3] }] };
  expect(validateForecast(forecast)).toBe(forecast);
  expect(() => validateForecast({ ...forecast, frames: [] })).toThrow("incomplete");
  expect(() => validateForecast({ ...forecast, frames: [{ ...forecast.frames[0], scores: [0] }] })).toThrow("incomplete");
  expect(() => validateForecast({ ...forecast, frames: [{ ...forecast.frames[0], time: "invalid" }] })).toThrow("incomplete");
  expect(() => validateForecast({ ...forecast, frames: [{ ...forecast.frames[0], scores: [0, NaN, 0, 0] }] })).toThrow("incomplete");
  expect(forecastFrameIndex(24, 12)).toBe(11);
  expect(forecastFrameIndex(-2, 12)).toBe(0);
  expect(forecastFrameIndex(NaN, 12)).toBe(0);
  expect(forecastFrameIndex(5, 0)).toBe(0);
});

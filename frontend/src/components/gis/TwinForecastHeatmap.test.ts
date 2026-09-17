import { afterEach, describe, expect, it, vi } from "vitest";
import { surfaceImage } from "./TwinForecastHeatmap";

afterEach(() => vi.unstubAllGlobals());

describe("terrain heatmap raster", () => {
  it("places north at the top, interpolates the centre, and masks the selected polygon", () => {
    let raster: { data: Uint8ClampedArray };
    const ctx = {
      createImageData: () => ({ data: new Uint8ClampedArray(512 * 512 * 4) }),
      putImageData: (image: { data: Uint8ClampedArray }) => { raster = image; },
      globalCompositeOperation: "source-over", beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
    };
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ctx, toDataURL: () => "data:image/png;base64,test" }) });
    surfaceImage([[10, 77], [11, 77], [10, 78]], [10, 11, 77, 78], [0, 0, 1, 1], 2);
    expect(Array.from(raster!.data.slice(0, 4))).toEqual([220, 38, 38, 245]);
    const bottom = 511 * 512 * 4;
    expect(Array.from(raster!.data.slice(bottom, bottom + 4))).toEqual([37, 99, 235, 0]);
    const middle = (256 * 512 + 256) * 4;
    expect(raster!.data[middle]).toBeGreaterThan(100);
    expect(ctx.globalCompositeOperation).toBe("destination-in");
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 512);
    expect(ctx.lineTo.mock.calls).toEqual([[0, 0], [512, 512]]);
    expect(ctx.closePath).toHaveBeenCalledOnce();
    expect(ctx.fill).toHaveBeenCalledOnce();
  });
});

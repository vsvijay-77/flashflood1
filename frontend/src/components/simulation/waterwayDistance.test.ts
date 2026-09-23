import { describe, expect, it } from "vitest";
import { waterwayDistances } from "./waterwayDistance";

describe("subcell channel outlines", () => {
  it("keeps the mapped channel at zero distance and increases across its banks in metres", () => {
    const mask = new Uint8Array([0, 0, 1, 0, 0, 0, 0, 1, 0, 0]);
    expect(Array.from(waterwayDistances(mask, 5, 2, 10, 20, 100)))
      .toEqual([20, 10, 0, 10, 20, 20, 10, 0, 10, 20]);
  });
  it("respects rectangular spacing and does not wrap across rows or invent empty channels", () => {
    const mask = new Uint8Array([1, 0, 0, 0, 0, 0]);
    const distances = waterwayDistances(mask, 3, 2, 3, 4, 100);
    expect(Array.from(distances)).toEqual([0, 3, 6, 4, 5, 8]);
    expect(Array.from(waterwayDistances(new Uint8Array(6), 3, 2, 3, 4, 100))).toEqual(new Array(6).fill(100));
  });
});

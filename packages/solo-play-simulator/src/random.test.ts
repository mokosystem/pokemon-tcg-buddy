import { describe, expect, test } from "bun:test";
import { createSeededRandom } from "./random.ts";

function drawMany(seed: number, count: number): number[] {
  const random = createSeededRandom(seed);
  return Array.from({ length: count }, () => random.nextFloat());
}

describe("種を指定できる乱数", () => {
  test("同じ種からは同じ乱数列が出る", () => {
    expect(drawMany(20_260_917, 100)).toEqual(drawMany(20_260_917, 100));
  });

  test("違う種からは違う乱数列が出る", () => {
    expect(drawMany(1, 100)).not.toEqual(drawMany(2, 100));
  });

  test("値は 0 以上 1 未満で、同じ値ばかりにならない", () => {
    const values = drawMany(7, 10_000);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(9900);
  });
});

describe("乱数の写し", () => {
  test("写した後は、元と写しが同じ乱数列を出す", () => {
    const random = createSeededRandom(20_260_926);
    random.nextFloat();
    const copied = random.copy();
    const fromOriginal = Array.from({ length: 50 }, () => random.nextFloat());
    const fromCopy = Array.from({ length: 50 }, () => copied.nextFloat());
    expect(fromCopy).toEqual(fromOriginal);
  });
});

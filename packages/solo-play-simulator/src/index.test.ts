import { describe, expect, test } from "bun:test";
import { packageName } from "./index.ts";

describe("packages/solo-play-simulator", () => {
  test("パッケージ名を公開している", () => {
    expect(packageName).toBe("@pokemon-tcg-buddy/solo-play-simulator");
  });
});

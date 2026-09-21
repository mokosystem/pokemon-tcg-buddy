import { describe, expect, test } from "bun:test";
import { packageName } from "./index.ts";

describe("packages/setup-rate", () => {
  test("パッケージ名を公開している", () => {
    expect(packageName).toBe("@pokemon-tcg-buddy/setup-rate");
  });
});

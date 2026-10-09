import { describe, expect, test } from "bun:test";
import { isExactVersionSpecifier } from "./verify-exact-dependency-versions.ts";

describe("依存の版の値の判定", () => {
  test.each([
    ["パッチまで書いた版", "1.5.0"],
    ["0 だけの版", "0.0.0"],
    ["プレリリースの印が付いた版", "1.0.0-beta.1"],
    ["英字だけのプレリリースの印が付いた版", "7.0.0-rc"],
    ["workspace: と *", "workspace:*"],
    ["workspace: と ^", "workspace:^"],
    ["workspace: と版", "workspace:1.0.0"],
  ])("%s(%s)を通す", (_, versionSpecifier) => {
    expect(isExactVersionSpecifier(versionSpecifier)).toBe(true);
  });

  test.each([
    ["^ の範囲", "^1.4.2"],
    ["~ の範囲", "~1.4.2"],
    [">= の範囲", ">=1.4.2"],
    ["ハイフンの範囲", "1.4.2 - 1.5.0"],
    ["|| でつないだ範囲", "1.4.2 || 1.5.0"],
    ["x の範囲", "1.4.x"],
    ["マイナーまでの版", "1.4"],
    ["メジャーだけの版", "1"],
    ["*", "*"],
    ["空の文字列", ""],
    ["latest のタグ", "latest"],
    ["npm: の別名", "npm:valibot@1.5.0"],
    ["git の参照", "git+https://github.com/open-circle/valibot.git"],
    ["GitHub の短い参照", "github:open-circle/valibot"],
    ["file の参照", "file:../valibot"],
    ["先頭に v を付けた版", "v1.5.0"],
    ["先頭に = を付けた版", "=1.5.0"],
    ["数の先頭に 0 を付けた版", "01.5.0"],
    ["ビルドメタデータが付いた版", "1.5.0+build.1"],
  ])("%s(%s)を違反にする", (_, versionSpecifier) => {
    expect(isExactVersionSpecifier(versionSpecifier)).toBe(false);
  });
});

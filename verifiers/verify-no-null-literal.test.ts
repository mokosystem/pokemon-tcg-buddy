import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dirname, "..");
const fixtureDirectory = mkdtempSync(join(tmpdir(), "verify-no-null-literal-"));

afterAll(() => {
  rmSync(fixtureDirectory, { force: true, recursive: true });
});

/** source を一時ディレクトリのファイルに書き、リポジトリの最上位の Biome の設定で lint して、終了コードとプラグインの診断の数を返す。 */
function lintWithRepositoryConfig(fileName: string, source: string) {
  const filePath = join(fixtureDirectory, fileName);
  writeFileSync(filePath, source);
  // 標準入力(--stdin-file-path)で渡さないのは、その方式ではプラグインの診断が出ないため(Issue 44、Biome 2.5.12 で確認)
  const linted = spawnSync(
    "bun",
    ["x", "biome", "lint", `--config-path=${repositoryRoot}`, filePath],
    { cwd: repositoryRoot, encoding: "utf8" }
  );
  return {
    exitCode: linted.status,
    pluginDiagnosticCount:
      linted.stderr.match(/:\d+:\d+ plugin /g)?.length ?? 0,
  };
}

describe("null のリテラルを見つけるプラグイン", () => {
  test("null を書いたファイルでは、型の位置と値の位置の両方で診断を出す", () => {
    const linted = lintWithRepositoryConfig(
      "with-null-literal.ts",
      [
        "export function findName(names: readonly string[]): string | null {",
        "  return names[0] ?? null;",
        "}",
        "",
      ].join("\n")
    );
    expect(linted.pluginDiagnosticCount).toBe(2);
    expect(linted.exitCode).toBe(1);
  });

  test("直前の行に biome-ignore lint/plugin の抑止コメントがある null には診断を出さない", () => {
    const linted = lintWithRepositoryConfig(
      "with-suppressed-null-literal.ts",
      [
        "export function readHeader(headers: Headers): string | undefined {",
        "  // biome-ignore lint/plugin: Headers.get は外部の仕様で null を返す",
        '  const value: string | null = headers.get("x-example");',
        "  return value ?? undefined;",
        "}",
        "",
      ].join("\n")
    );
    expect(linted.pluginDiagnosticCount).toBe(0);
    expect(linted.exitCode).toBe(0);
  });
});

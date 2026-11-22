/**
 * 計測のスクリプトが共有する部分のうち、引数の読み取りと、出力のファイルの名前の決め方を確かめる。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareLearnedModel,
  readCommonOptions,
  readIntegerOption,
  readPositiveNumberOption,
  readTrainingGamesOption,
  reserveMeasurementOutputBase,
  writeMeasurementOutput,
  writeMeasurementOutputAt,
} from "../scripts/measurement-process-pool.ts";

describe("数の引数の読み取り", () => {
  test("省かれた引数は undefined になる", () => {
    expect(
      readPositiveNumberOption("--max-minutes", undefined)
    ).toBeUndefined();
    expect(readIntegerOption("--max-units", undefined, 1)).toBeUndefined();
  });

  test("0 より大きい数は、小数も読む", () => {
    expect(readPositiveNumberOption("--max-minutes", "15")).toBe(15);
    expect(readPositiveNumberOption("--max-minutes", "0.5")).toBe(0.5);
  });

  test("数として読めない文字列と空の文字列は、例外になる", () => {
    for (const value of ["15m", "", " ", "abc", "Infinity"]) {
      expect(() => readPositiveNumberOption("--max-minutes", value)).toThrow(
        "--max-minutes"
      );
      expect(() => readIntegerOption("--max-units", value, 1)).toThrow(
        "--max-units"
      );
    }
  });

  test("0 以下の数は、0 より大きい数としては例外になる", () => {
    expect(() => readPositiveNumberOption("--max-minutes", "0")).toThrow(
      "--max-minutes"
    );
    expect(() => readPositiveNumberOption("--max-minutes", "-1")).toThrow(
      "--max-minutes"
    );
  });

  test("下限以上の整数を読み、下限より小さい数と小数は例外になる", () => {
    expect(readIntegerOption("--first-trial", "0", 0)).toBe(0);
    expect(readIntegerOption("--trials", "3", 1)).toBe(3);
    expect(() => readIntegerOption("--trials", "0", 1)).toThrow("--trials");
    expect(() => readIntegerOption("--trials", "1.5", 1)).toThrow("--trials");
    expect(() => readIntegerOption("--first-trial", "-1", 0)).toThrow(
      "--first-trial"
    );
  });

  test("学習の対戦の回数は 2 以上の偶数だけを読み、奇数と 0 は例外になる", () => {
    expect(readTrainingGamesOption(undefined)).toBeUndefined();
    expect(readTrainingGamesOption("2")).toBe(2);
    expect(readTrainingGamesOption("500")).toBe(500);
    for (const value of ["0", "1", "3", "501"]) {
      expect(() => readTrainingGamesOption(value)).toThrow("--training-games");
    }
  });

  test("プロセスの数は 1 以上の整数だけを読み、数でない文字列は例外になる", () => {
    expect(
      readCommonOptions({ output: "out", processes: "16" }).processCount
    ).toBe(16);
    expect(() => readCommonOptions({ output: "out", processes: "x" })).toThrow(
      "--processes"
    );
    expect(() => readCommonOptions({ output: "out", processes: "0" })).toThrow(
      "--processes"
    );
  });
});

test("学習の対戦を分けるプロセス数を変えても同じ重みになる", async () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), "policy-learning-"));
  try {
    const options = {
      deck: { deckCode: "RS3MMy-FuGPRu-MypM2X" },
      modelName: "process-order",
      outputDirectory,
      trainingGames: 8,
    };
    const single = await prepareLearnedModel({ ...options, processCount: 1 });
    const parallel = await prepareLearnedModel({ ...options, processCount: 2 });
    expect(parallel.sampleCount).toBe(single.sampleCount);
    expect(parallel.model).toEqual(single.model);
  } finally {
    rmSync(outputDirectory, { force: true, recursive: true });
  }
});

describe("出力のファイルの名前", () => {
  let outputDirectory = "";
  beforeEach(() => {
    outputDirectory = mkdtempSync(join(tmpdir(), "measurement-output-"));
  });
  afterEach(() => {
    rmSync(outputDirectory, { force: true, recursive: true });
  });

  const names = { measurementName: "measurement", settingName: "setting" };
  // 2026-11-22 01:02:03(その機械の時刻)
  const now = new Date(2026, 10, 22, 1, 2, 3);

  test("名前の先頭は秒までの時刻で、決めた名前の .json がその場でできる", () => {
    const base = reserveMeasurementOutputBase(
      { ...names, outputDirectory },
      now
    );
    expect(base).toBe(
      join(outputDirectory, "20261122-010203-measurement-setting")
    );
    expect(readdirSync(outputDirectory)).toEqual([
      "20261122-010203-measurement-setting.json",
    ]);
  });

  test("同じ時刻に同じ名前を 3 回決めると、2 回目と 3 回目は末尾に -2 と -3 が付く", () => {
    const bases = [1, 2, 3].map(() =>
      reserveMeasurementOutputBase({ ...names, outputDirectory }, now)
    );
    expect(bases).toEqual([
      join(outputDirectory, "20261122-010203-measurement-setting"),
      join(outputDirectory, "20261122-010203-measurement-setting-2"),
      join(outputDirectory, "20261122-010203-measurement-setting-3"),
    ]);
  });

  test("まだ無い出力のディレクトリは作る", () => {
    const nested = join(outputDirectory, "a", "b");
    reserveMeasurementOutputBase({ ...names, outputDirectory: nested }, now);
    expect(readdirSync(nested)).toHaveLength(1);
  });

  test("続けて 2 回書いた出力は、どちらも残る", () => {
    const paths = ["first", "second"].map((label) =>
      writeMeasurementOutput({
        ...names,
        json: { label },
        markdown: `# ${label}\n`,
        outputDirectory,
      })
    );
    expect(new Set(paths).size).toBe(2);
    expect(
      paths.map((path) => [
        JSON.parse(readFileSync(`${path}.json`, "utf8")),
        readFileSync(`${path}.md`, "utf8"),
      ])
    ).toEqual([
      [{ label: "first" }, "# first\n"],
      [{ label: "second" }, "# second\n"],
    ]);
  });

  test("決めたパスに書き直すと、同じファイルが新しい内容になる", () => {
    const base = reserveMeasurementOutputBase(
      { ...names, outputDirectory },
      now
    );
    writeMeasurementOutputAt(base, { json: { finished: 0 }, markdown: "0\n" });
    writeMeasurementOutputAt(base, { json: { finished: 1 }, markdown: "1\n" });
    expect(JSON.parse(readFileSync(`${base}.json`, "utf8"))).toEqual({
      finished: 1,
    });
    expect(readFileSync(`${base}.md`, "utf8")).toBe("1\n");
    expect(readdirSync(outputDirectory)).toHaveLength(2);
  });
});

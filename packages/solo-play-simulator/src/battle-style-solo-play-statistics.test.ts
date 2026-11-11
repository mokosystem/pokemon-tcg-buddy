/**
 * 期待値は、2026-11-12 に区間の式(ウィルソン、Tango、Newcombe のハイブリッドスコア)を Python で計算した値。
 */

import { describe, expect, test } from "bun:test";
import {
  addPairToCounts,
  addResultToTally,
  calculatePairedDifferenceInterval,
  calculateUnpairedDifferenceInterval,
  calculateWilsonInterval,
  createEmptyPairedOutcomeCounts,
  createEmptyTally,
  mergePairedOutcomeCounts,
  mergeTallies,
  type PairedOutcomeCounts,
  type ProportionInterval,
} from "./battle-style-solo-play-statistics.ts";
import type { BattleStyleSoloPlayResult } from "./engine.ts";

const DIGITS = 6;

function expectInterval(
  interval: ProportionInterval | undefined,
  lower: number,
  upper: number
): void {
  expect(interval?.lower).toBeCloseTo(lower, DIGITS);
  expect(interval?.upper).toBeCloseTo(upper, DIGITS);
}

/** 区間の幅。区間が無ければ例外にする。 */
function widthOf(interval: ProportionInterval | undefined): number {
  if (interval === undefined) {
    throw new Error("区間が無い");
  }
  return interval.upper - interval.lower;
}

function counts(
  bothOccurred: number,
  onlyBeforeOccurred: number,
  onlyAfterOccurred: number,
  neitherOccurred: number
): PairedOutcomeCounts {
  return {
    bothOccurred,
    neitherOccurred,
    onlyAfterOccurred,
    onlyBeforeOccurred,
  };
}

describe("割合の誤差の幅(ウィルソンのスコア区間)", () => {
  test("0 回 / 100 回の区間は (0, 0.036993) で、下端は 0", () => {
    const interval = calculateWilsonInterval(0, 100);
    expect(Math.abs(interval?.lower ?? 1)).toBeLessThan(1e-12);
    expect(interval?.upper).toBeCloseTo(0.036_993, DIGITS);
  });

  test("50 回 / 100 回の区間は (0.403832, 0.596168) で、0.5 を中心に左右対称", () => {
    const interval = calculateWilsonInterval(50, 100);
    expectInterval(interval, 0.403_832, 0.596_168);
    expect((interval?.lower ?? 0) + (interval?.upper ?? 0)).toBeCloseTo(1, 12);
  });

  test("回数が 0 なら区間を出さない", () => {
    expect(calculateWilsonInterval(0, 0)).toBeUndefined();
  });
});

describe("種をそろえた対の差の誤差の幅", () => {
  test("後だけ起きた対 30、前だけ 10、両方 40、どちらも 20 のとき、差 0.2、対にした区間 (0.079484, 0.316960)", () => {
    const interval = calculatePairedDifferenceInterval(counts(40, 10, 30, 20));
    expect(interval?.value).toBeCloseTo(0.2, 12);
    expectInterval(interval, 0.079_484, 0.316_96);
  });

  test("同じ数を対にしないで比べた区間は (0.064223, 0.325768) で、対にした区間より広い", () => {
    const data = counts(40, 10, 30, 20);
    const unpaired = calculateUnpairedDifferenceInterval(data);
    const paired = calculatePairedDifferenceInterval(data);
    expectInterval(unpaired, 0.064_223, 0.325_768);
    expect(widthOf(unpaired)).toBeGreaterThan(widthOf(paired));
  });

  test("前と後で結果が違う対が 0 でも、どちらの区間も幅が 0 にならない", () => {
    const data = counts(50, 0, 0, 50);
    expectInterval(
      calculatePairedDifferenceInterval(data),
      -0.036_993,
      0.036_993
    );
    expectInterval(
      calculateUnpairedDifferenceInterval(data),
      -0.136_003,
      0.136_003
    );
  });

  test("前と後の両方で出来事が 0 回でも、どちらの区間も幅が 0 にならない", () => {
    const data = counts(0, 0, 0, 100);
    expectInterval(
      calculatePairedDifferenceInterval(data),
      -0.036_993,
      0.036_993
    );
    expectInterval(
      calculateUnpairedDifferenceInterval(data),
      -0.036_993,
      0.036_993
    );
  });

  test("対の数が 0 なら区間を出さず、1 なら区間を出す", () => {
    const empty = createEmptyPairedOutcomeCounts();
    expect(calculatePairedDifferenceInterval(empty)).toBeUndefined();
    expect(calculateUnpairedDifferenceInterval(empty)).toBeUndefined();
    expectInterval(
      calculatePairedDifferenceInterval(counts(0, 0, 0, 1)),
      -0.793_451,
      0.793_451
    );
  });

  test("後だけ起きた対が 1、対の数が 1 のとき、対にした区間の上端は 1", () => {
    expect(calculatePairedDifferenceInterval(counts(0, 0, 1, 0))?.upper).toBe(
      1
    );
  });

  test("数が整数でなくても、同じ比で縮めた数として区間を出す", () => {
    const interval = calculatePairedDifferenceInterval(counts(4, 1, 3, 2));
    const scaled = calculatePairedDifferenceInterval(counts(2, 0.5, 1.5, 1));
    expect(scaled?.value).toBeCloseTo(0.2, 12);
    expect(widthOf(scaled)).toBeGreaterThan(widthOf(interval));
  });
});

describe("数えた数の足し合わせ", () => {
  const win = (ordinal: number): BattleStyleSoloPlayResult => ({
    decidedTurn: { ordinal, owner: "self" },
    events: [],
    opponentTakenPrizeCount: 2,
    outcome: "win",
    reason: "ownPrizesTaken",
    takenPrizeCount: 6,
  });
  const loss = (ordinal: number): BattleStyleSoloPlayResult => ({
    decidedTurn: { ordinal, owner: "opponent" },
    events: [],
    opponentTakenPrizeCount: 6,
    outcome: "loss",
    reason: "opponentPrizesTaken",
    takenPrizeCount: 3,
  });
  const results = [win(5), loss(6), win(5), win(7), loss(4)];
  const cost = { clones: 3, milliseconds: 1.5, trialScores: 2 };

  test("集計を 2 つに分けて数えて足した結果は、まとめて数えた結果と同じ", () => {
    const tallyOf = (items: readonly BattleStyleSoloPlayResult[]) =>
      items.reduce(
        (tally, item) => addResultToTally(tally, item, cost),
        createEmptyTally()
      );
    const whole = tallyOf(results);
    expect(
      mergeTallies(tallyOf(results.slice(0, 2)), tallyOf(results.slice(2)))
    ).toEqual(whole);
    expect(whole.wins).toBe(3);
    expect(whole.winningTurnCounts).toEqual({ "5": 2, "7": 1 });
    expect(whole.decisionReasonCounts.opponentPrizesTaken).toBe(2);
    expect(whole.totalClones).toBe(15);
  });

  test("対の数を 2 つに分けて数えて足した結果は、まとめて数えた結果と同じ", () => {
    const pairs: [boolean, boolean][] = [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
      [false, true],
    ];
    const countOf = (items: readonly [boolean, boolean][]) =>
      items.reduce(
        (total, [before, after]) => addPairToCounts(total, before, after),
        createEmptyPairedOutcomeCounts()
      );
    expect(
      mergePairedOutcomeCounts(
        countOf(pairs.slice(0, 3)),
        countOf(pairs.slice(3))
      )
    ).toEqual(countOf(pairs));
    expect(countOf(pairs)).toEqual(counts(1, 1, 2, 1));
  });
});

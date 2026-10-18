/**
 * 正しい手の局面 A〜F と 1〜10(search-positions.ts)で、探索が正しい手を選ぶかを確かめる。20 通りの並べ方での結果は
 * `bun run compare:search-evaluators 20` で出し、docs/solo-play-simulator-design.md「順 7 で決めたこと(2 セッション目)」
 * (A〜F)と「場の評価の数え漏れの修正(Issue 51)」(1〜10)に記録した。ここでは並べ方 5 通りで確かめる。今は正しい手を
 * 選べない局面は test.failing にし、選べるようになったら落ちて知らせる。
 */

import { describe, expect, test } from "bun:test";
import type { ResolvedDeclaration } from "./declaration.ts";
import {
  createNextTurnTrialEvaluator,
  createPathProgressEvaluator,
} from "./search-evaluators.ts";
import { createSearchPolicy, type Evaluator } from "./search-policy.ts";
import { playSearchPosition, SEARCH_POSITIONS } from "./search-positions.ts";

const ARRANGEMENTS = [0, 1, 2, 3, 4];

function findPosition(id: string) {
  const position = SEARCH_POSITIONS.find((entry) => entry.id === id);
  if (position === undefined) {
    throw new Error(`局面 ${id} が無い`);
  }
  return position;
}

/** 並べ方ごとに、局面のデッキの宣言で探索と評価を作り、正しい手を選んだかを並べる。 */
function playArrangements(
  id: string,
  createEvaluator: (declaration: ResolvedDeclaration) => Evaluator,
  arrangements: readonly number[]
): boolean[] {
  const position = findPosition(id);
  return arrangements.map((variation) =>
    playSearchPosition(
      position,
      createSearchPolicy(
        position.declaration,
        createEvaluator(position.declaration),
        {
          samplesForUncertainOutcome: 4,
          searchesEffectChoices: true,
          seed: 100 + variation,
        }
      ),
      1000 + variation
    )
  );
}

const pathProgress = createPathProgressEvaluator;

describe("道の揃い具合を見る評価で、正しい手の局面の正しい手を選ぶ", () => {
  // D は今は正しい手を選べないので、下で test.failing として分けて並べる
  for (const id of ["A", "B", "C", "E", "F"]) {
    const position = findPosition(id);
    test(`局面 ${id}: ${position.correctPlay}`, () => {
      expect(playArrangements(id, pathProgress, ARRANGEMENTS)).toEqual(
        ARRANGEMENTS.map(() => true)
      );
    });
  }

  // 1 手ずつ選ぶと、リーリエの決心で 8 枚引く見込みの方がエネルギーをつける見込みより大きく出て、先に使う
  test.failing(`局面 D: ${findPosition("D").correctPlay}`, () => {
    expect(playArrangements("D", pathProgress, ARRANGEMENTS)).toEqual(
      ARRANGEMENTS.map(() => true)
    );
  });
});

describe("道の揃い具合を見る評価で、Issue 51 の局面 1〜10 の正しい手を選ぶ", () => {
  // 局面 7 は Issue 51 で取り下げたため、局面の一覧(search-positions.ts)にもテストにも無い
  for (const id of ["1", "2", "3", "4", "5", "6", "8", "9", "10"]) {
    const position = findPosition(id);
    test(`局面 ${id}: ${position.correctPlay}`, () => {
      expect(playArrangements(id, pathProgress, ARRANGEMENTS)).toEqual(
        ARRANGEMENTS.map(() => true)
      );
    });
  }
});

describe("次の番を試す評価", () => {
  test("局面 E で、アクロマの執念から偉大な大樹で進化させる(その番の残りを進めて見積もる)", () => {
    const trials = (declaration: ResolvedDeclaration) =>
      createNextTurnTrialEvaluator(declaration, { trials: 4 });
    expect(playArrangements("E", trials, [0, 1])).toEqual([true, true]);
  });
});

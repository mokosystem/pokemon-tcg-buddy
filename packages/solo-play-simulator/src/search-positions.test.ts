/**
 * 題材の局面 A〜F(search-positions.ts)で、探索が正しい手を選ぶかを確かめる。20 通りの並べ方での結果は
 * `bun run compare:search-evaluators 20` で出し、docs/solo-play-simulator-design.md「順 7 で決めたこと(2 セッション目)」に記録した。
 * ここでは並べ方 5 通りで確かめる。今は正しい手を選べない局面は test.failing にし、選べるようになったら落ちて知らせる。
 */

import { describe, expect, test } from "bun:test";
import {
  createNextTurnTrialEvaluator,
  createPathProgressEvaluator,
} from "./search-evaluators.ts";
import { createSearchPolicy, type Evaluator } from "./search-policy.ts";
import {
  playSearchPosition,
  RESOLVED_MEGA_GARDEVOIR_DECLARATION,
  SEARCH_POSITIONS,
} from "./search-positions.ts";

const ARRANGEMENTS = [0, 1, 2, 3, 4];

function findPosition(id: string) {
  const position = SEARCH_POSITIONS.find((entry) => entry.id === id);
  if (position === undefined) {
    throw new Error(`局面 ${id} が無い`);
  }
  return position;
}

/** 並べ方ごとに、正しい手を選んだかを並べる。 */
function playArrangements(
  id: string,
  createEvaluator: () => Evaluator,
  arrangements: readonly number[]
): boolean[] {
  return arrangements.map((variation) =>
    playSearchPosition(
      findPosition(id),
      createSearchPolicy(
        RESOLVED_MEGA_GARDEVOIR_DECLARATION,
        createEvaluator(),
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

const pathProgress = () =>
  createPathProgressEvaluator(RESOLVED_MEGA_GARDEVOIR_DECLARATION);

describe("道の揃い具合を見る評価で、題材の局面の正しい手を選ぶ", () => {
  for (const id of ["A", "B", "C", "F"]) {
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

  // アクロマの執念を混ぜ直し 4 通りの平均で見積もるため、偉大な大樹がサイドに入った通りが多いと「番を終える」を下回る
  test.failing(`局面 E(並べ方を変えても毎回): ${findPosition("E").correctPlay}`, () => {
    expect(playArrangements("E", pathProgress, ARRANGEMENTS)).toEqual(
      ARRANGEMENTS.map(() => true)
    );
  });
});

describe("次の番を試す評価", () => {
  test("局面 E で、アクロマの執念から偉大な大樹で進化させる(その番の残りを進めて見積もる)", () => {
    const trials = () =>
      createNextTurnTrialEvaluator(RESOLVED_MEGA_GARDEVOIR_DECLARATION, {
        trials: 4,
      });
    expect(playArrangements("E", trials, [0, 1])).toEqual([true, true]);
  });
});

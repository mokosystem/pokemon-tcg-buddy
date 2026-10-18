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
  // E は Issue 51 の順 2 から選ぶ。「番を終える」を試すときはこの番の成り立っていない狙いの見込みを 0 にし、山札から
  // 探して持ってこられる重みを 0.5 から 0.4 に下げた(設計文書「場の評価の数え漏れの修正(Issue 51)」の順 2)
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
  // 局面 5・8 は、正しい手を打った番に「打てる」が成り立つため、数え漏れを直す前から選ぶ。局面 1・2・3・4・10 は Issue 51 の
  // 順 2(締め切りごとに分け、「番を終える」を試すときはこの番の成り立っていない狙いの見込みを 0 にする)から選ぶ。局面 3 は、
  // 山札から探して持ってこられる重みを 0.5 から 0.4 に下げるまで、並べ方によってリーリエの決心を選んだ。局面 1 は順 3
  // (探す手段 1 枚を道の必要なカード 1 つにだけ割り当てる)の後も選ぶ。局面 4・5 は順 4(ワザのエネルギーの見込みを置き場所と
  // タイプで数える)の後も選ぶ。局面 6 は順 5(打てる見込みに、主軸の系統をバトル場に出せる見込みを足す)から選ぶ。局面 8 は
  // 順 5 の後も選ぶ
  for (const id of ["1", "2", "3", "4", "5", "6", "8", "10"]) {
    const position = findPosition(id);
    test(`局面 ${id}: ${position.correctPlay}`, () => {
      expect(playArrangements(id, pathProgress, ARRANGEMENTS)).toEqual(
        ARRANGEMENTS.map(() => true)
      );
    });
  }

  // 今は選べない局面と、Issue 51 の表がその局面に当てた数え漏れ。数え漏れを直して選べるようになったら test に直す
  const failingPositions: readonly { id: string; omission: string }[] = [
    {
      // 数え漏れ 5: 「N 以上なら加算」の途中経過を見ないため、トラッシュに「ばけがくれ」を送っても見込みが上がらない
      id: "9",
      omission: "数え漏れ 5",
    },
  ];
  for (const { id, omission } of failingPositions) {
    const position = findPosition(id);
    test.failing(`局面 ${id}(${omission}): ${position.correctPlay}`, () => {
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

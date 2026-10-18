/**
 * 探索が山札の順とサイドの中身を知らずに手を選ぶこと(複製で先を試すときに混ぜ直しが抜けていないこと)を確かめる。
 * 見えている情報(手札、場、トラッシュ)が同じで、山札の順とサイドの中身だけが違う 2 つの状態で、探索が呼ぶ評価の値が
 * 実際の状態に手を加えるまで(または実際に引く・探すまで)すべて同じになるかで見る。混ぜ直しが抜けていれば、先を
 * 試すときに実際の山札から引くので、値が食い違う。
 */

import { describe, expect, test } from "bun:test";
import { buildRecordedCard, buildState } from "./card-test-support.ts";
import type { Card } from "./cards.ts";
import type { ResolvedDeclaration } from "./declaration.ts";
import { createSeededRandom } from "./random.ts";
import { createPathProgressEvaluator } from "./search-evaluators.ts";
import {
  createSearchPolicy,
  type Evaluator,
  type SearchPolicy,
} from "./search-policy.ts";
import {
  buildMegaCharizardSecondTurnState,
  RESOLVED_MEGA_CHARIZARD_DECLARATION,
  RESOLVED_MEGA_GARDEVOIR_DECLARATION,
  SEARCH_POSITIONS,
} from "./search-positions.ts";
import type { GameState } from "./state.ts";

const MUKU_DREW = /ムク: \d+ 枚引く/;

/**
 * 評価を呼ぶたびに値を記録する探索。stopWhen が真を返した後の評価は記録しない。評価と探索には、場面のデッキの宣言を
 * 渡す。別のデッキの宣言で評価すると、場面のデッキの狙いの見込みを通らないまま値の一致を確かめてしまうため。
 */
function createRecordingPolicy(
  declaration: ResolvedDeclaration,
  stopWhen: () => boolean
): {
  policy: SearchPolicy;
  values: number[];
} {
  const values: number[] = [];
  let stopped = false;
  const base = createPathProgressEvaluator(declaration);
  const evaluator: Evaluator = (input) => {
    const value = base(input);
    stopped ||= stopWhen();
    if (!stopped) {
      values.push(value);
    }
    return value;
  };
  return {
    policy: createSearchPolicy(declaration, evaluator, {
      samplesForUncertainOutcome: 4,
      searchesEffectChoices: true,
      seed: 20_260_927,
    }),
    values,
  };
}

/** 番の中の最初の行動を選ぶまでの評価の値(実際の状態に履歴が増えたら止める)。 */
function recordFirstTurnDecision(
  state: GameState,
  declaration: ResolvedDeclaration
): number[] {
  const eventCount = state.events.length;
  const { policy, values } = createRecordingPolicy(
    declaration,
    () => state.events.length > eventCount
  );
  policy.playTurn({ choices: policy, state });
  return values;
}

function findPosition(id: string) {
  const position = SEARCH_POSITIONS.find((entry) => entry.id === id);
  if (position === undefined) {
    throw new Error(`局面 ${id} が無い`);
  }
  return position;
}

function namesOf(cards: readonly Card[]): string[] {
  return cards.map((card) => card.name);
}

describe("探索は山札の順とサイドの中身を知らない", () => {
  test("局面 D: 山札の順が違っても、リーリエの決心で引くカードを知らずに最初の行動を選ぶ", () => {
    const { declaration } = findPosition("D");
    const left = findPosition("D").build(1000);
    const right = findPosition("D").build(1001);
    expect(namesOf(right.deck)).not.toEqual(namesOf(left.deck));
    const values = recordFirstTurnDecision(left, declaration);
    expect(values.length).toBeGreaterThan(1);
    expect(recordFirstTurnDecision(right, declaration)).toEqual(values);
  });

  test("局面 1(ドラパルトex): 山札の順が違っても、ハイパーボールとなかよしポフィンで持ってくるカードを知らずに最初の行動を選ぶ", () => {
    const { declaration } = findPosition("1");
    const left = findPosition("1").build(1000);
    const right = findPosition("1").build(1001);
    expect(namesOf(right.deck)).not.toEqual(namesOf(left.deck));
    const values = recordFirstTurnDecision(left, declaration);
    expect(values.length).toBeGreaterThan(1);
    expect(recordFirstTurnDecision(right, declaration)).toEqual(values);
  });

  test("局面 4(ばけがくれ): 山札の順が違っても、リーリエの決心で引くカードを知らずに最初の行動を選ぶ", () => {
    const { declaration } = findPosition("4");
    const left = findPosition("4").build(1000);
    const right = findPosition("4").build(1001);
    expect(namesOf(right.deck)).not.toEqual(namesOf(left.deck));
    const values = recordFirstTurnDecision(left, declaration);
    expect(values.length).toBeGreaterThan(1);
    expect(recordFirstTurnDecision(right, declaration)).toEqual(values);
  });

  test("メガリザードンの後攻 2 番目の番: 山札の順が違っても、ハイパーボール・ポケパッド・リーリエの決心で手札に来るカードを知らずに最初の行動を選ぶ", () => {
    const left = buildMegaCharizardSecondTurnState(1000);
    const right = buildMegaCharizardSecondTurnState(1001);
    expect(namesOf(right.deck)).not.toEqual(namesOf(left.deck));
    const values = recordFirstTurnDecision(
      left,
      RESOLVED_MEGA_CHARIZARD_DECLARATION
    );
    expect(values.length).toBeGreaterThan(1);
    expect(
      recordFirstTurnDecision(right, RESOLVED_MEGA_CHARIZARD_DECLARATION)
    ).toEqual(values);
  });

  test("局面 E: 偉大な大樹が山札にあってもサイドにあっても、同じ見込みで最初の行動を選ぶ", () => {
    const inDeck = findPosition("E").build(1000);
    const inPrizes = findPosition("E").build(1000);
    const treeIndex = inPrizes.deck.findIndex(
      (card) => card.name === "偉大な大樹"
    );
    const [tree] = inPrizes.deck.splice(treeIndex, 1);
    const [prize] = inPrizes.prizes.splice(0, 1, tree as Card);
    inPrizes.deck.splice(treeIndex, 0, prize as Card);
    expect(namesOf(inPrizes.prizes)).toContain("偉大な大樹");
    const { declaration } = findPosition("E");
    const values = recordFirstTurnDecision(inDeck, declaration);
    expect(recordFirstTurnDecision(inPrizes, declaration)).toEqual(values);
  });

  test("局面 10: 山札とサイドに分かれた基本超エネルギーの枚数が違っても、あふれるねがいを試す見込みが同じになり、同じ値で最初の行動を選ぶ", () => {
    // あふれるねがい(記録 048464)は山札の基本超エネルギー(049463)をベンチのポケモンそれぞれに 1 枚ずつつける。
    // サイドの基本超エネルギー以外のカードをすべて山札の基本超エネルギーと入れ替え、山札に残る基本超エネルギーを
    // ベンチのポケモンの数より少なくする。試すときに混ぜ直しが抜けていれば、つく枚数が変わり値が食い違う
    const inDeck = findPosition("10").build(1000);
    const inPrizes = findPosition("10").build(1000);
    for (let prize = 0; prize < inPrizes.prizes.length; prize += 1) {
      if (inPrizes.prizes[prize]?.name === "基本超エネルギー") {
        continue;
      }
      const energyIndex = inPrizes.deck.findIndex(
        (card) => card.name === "基本超エネルギー"
      );
      const [energy] = inPrizes.deck.splice(energyIndex, 1);
      const [other] = inPrizes.prizes.splice(prize, 1, energy as Card);
      inPrizes.deck.splice(energyIndex, 0, other as Card);
    }
    const countPsychic = (cards: readonly Card[]) =>
      cards.filter((card) => card.name === "基本超エネルギー").length;
    expect(countPsychic(inPrizes.deck)).toBeLessThan(inPrizes.bench.length);
    expect(countPsychic(inPrizes.deck)).toBeLessThan(countPsychic(inDeck.deck));
    const { declaration } = findPosition("10");
    const values = recordFirstTurnDecision(inDeck, declaration);
    expect(values.length).toBeGreaterThan(1);
    expect(recordFirstTurnDecision(inPrizes, declaration)).toEqual(values);
  });

  test("局面 B と C: ワザと対戦の準備の比べ方も、山札の順とサイドの中身によらない", () => {
    for (const id of ["B", "C"]) {
      const [left, right] = [1000, 1001].map((seed) => {
        const state = findPosition(id).build(seed);
        const { policy, values } = createRecordingPolicy(
          findPosition(id).declaration,
          () => false
        );
        findPosition(id).judge(policy, state);
        return values;
      });
      expect(right).toEqual(left);
    }
  });

  test("効果の中の選択を試すとき、選んだ後に引くカードは混ぜ直した山札から引く(ムクで捨てる枚数を選ぶ)", () => {
    const muku = buildRecordedCard("050297");
    const frillish = buildRecordedCard("047663");
    const ralts = buildRecordedCard("049714");
    const unseen = [
      "050462",
      "048464",
      "048464",
      "049445",
      "046040",
      "049463",
      "049463",
      "049463",
      "050461",
      "045934",
      "049715",
      "049712",
    ].map(buildRecordedCard);
    const build = (order: readonly number[]) => {
      const arranged = order.map((index) => unseen[index] as Card);
      const state = buildState({
        active: ralts,
        bench: [ralts, ralts, ralts, ralts, ralts],
        deck: arranged.slice(3),
        hand: [muku, frillish, frillish],
        random: createSeededRandom(1),
        turn: 2,
      });
      state.prizes.splice(0, state.prizes.length, ...arranged.slice(0, 3));
      return state;
    };
    const left = build([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const right = build([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    const record = (state: GameState) => {
      const { policy, values } = createRecordingPolicy(
        RESOLVED_MEGA_GARDEVOIR_DECLARATION,
        () => state.events.some((event) => MUKU_DREW.test(event))
      );
      policy.playTurn({ choices: policy, state });
      expect(
        state.events.some((event) => event.includes("サポート ムク"))
      ).toBe(true);
      return values;
    };
    const values = record(left);
    expect(record(right)).toEqual(values);
  });

  test("探索は実際の対戦の乱数を進めない(先を試すときは別の乱数を使う)", () => {
    const state = findPosition("B").build(1000);
    const before = createSeededRandom(1000 + 1);
    const { policy } = createRecordingPolicy(
      RESOLVED_MEGA_GARDEVOIR_DECLARATION,
      () => false
    );
    findPosition("B").judge(policy, state);
    expect(state.random.nextFloat()).toBe(before.nextFloat());
  });
});

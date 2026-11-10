/**
 * 探索の仕組み(状態を複製して手を試す、効果の中の選択を記録して再生する、見えていないカードを混ぜ直す)が残っていることを
 * 確かめる。評価はテストの中に書いた小さな関数を使う。山札の順だけが違う 2 つの状態で、探索が呼ぶ評価の値が実際の状態に
 * 手を加えるまで(または実際に引くまで)すべて同じになるかで、混ぜ直しが抜けていないことを見る。混ぜ直しが抜けていれば、
 * 先を試すときに実際の山札から引くので、値が一致しない。
 */

import { describe, expect, test } from "bun:test";
import { playOpponentTurn } from "./battle-style-solo-play-rules.ts";
import { buildRecordedCard, buildState, namesOf } from "./card-test-support.ts";
import type { Card } from "./cards.ts";
import { createSeededRandom } from "./random.ts";
import {
  createSearchPolicy,
  type Evaluator,
  type SearchPolicy,
} from "./search-policy.ts";
import type { GameState } from "./state.ts";

const MUKU_DREW = /ムク: \d+ 枚引く/;

/** 手札のカード ID の数値の合計。手札に何が来たかで値が変わるため、引いたカードを知っているかが値に出る。 */
const sumHandCardIds: Evaluator = ({ state }) =>
  state.hand.reduce((total, card) => total + Number(card.cardId), 0);

/** 評価を呼ぶたびに値を記録する探索。stopWhen が真を返した後の評価は記録しない。 */
function createRecordingPolicy(
  evaluator: Evaluator,
  stopWhen: () => boolean
): {
  policy: SearchPolicy;
  values: number[];
} {
  const values: number[] = [];
  let stopped = false;
  const recording: Evaluator = (input) => {
    const value = evaluator(input);
    stopped ||= stopWhen();
    if (!stopped) {
      values.push(value);
    }
    return value;
  };
  return {
    policy: createSearchPolicy(recording, {
      samplesForUncertainOutcome: 4,
      searchesEffectChoices: true,
      seed: 20_260_927,
    }),
    values,
  };
}

/** 番の中の最初の行動を選ぶまでの評価の値(実際の状態に履歴が増えたら止める)。 */
function recordFirstTurnDecision(state: GameState): number[] {
  const eventCount = state.events.length;
  const { policy, values } = createRecordingPolicy(
    sumHandCardIds,
    () => state.events.length > eventCount
  );
  policy.playTurn({ choices: policy, state });
  return values;
}

describe("探索は山札の順とサイドの中身を知らない", () => {
  test("山札の順が違っても、リーリエの決心で引くカードを知らずに最初の行動を選ぶ", () => {
    // リーリエの決心(049445)は手札を山札に戻して切り、引く。ラルトス(049714)、基本超エネルギー(049463)
    const ralts = buildRecordedCard("049714");
    const lillie = buildRecordedCard("049445");
    const psychicEnergy = buildRecordedCard("049463");
    const unseen = [
      "050462",
      "048464",
      "049715",
      "050461",
      "045934",
      "049712",
      "046040",
      "050467",
    ].map(buildRecordedCard);
    const build = (deck: readonly Card[]) =>
      buildState({
        active: ralts,
        deck,
        hand: [lillie, psychicEnergy, ralts],
        random: createSeededRandom(1),
        turn: 2,
      });
    const left = build(unseen);
    const right = build([...unseen].reverse());
    expect(namesOf(right.deck)).not.toEqual(namesOf(left.deck));
    const values = recordFirstTurnDecision(left);
    expect(values.length).toBeGreaterThan(1);
    expect(recordFirstTurnDecision(right)).toEqual(values);
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
      const { policy, values } = createRecordingPolicy(sumHandCardIds, () =>
        state.events.some((event) => MUKU_DREW.test(event))
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

  test("探索は実際の対戦の乱数を進めない(ワザを試して選ぶとき)", () => {
    // ドラパルトex(049264)のファントムダイブは炎と超、ジェットヘッドは無色 1 個。基本炎エネルギー(050746)と
    // 基本超エネルギー(049463)をつけて、両方を使える状態にする
    const state = buildState({
      active: buildRecordedCard("049264"),
      deck: ["050461", "049445", "049463", "050467"].map(buildRecordedCard),
      random: createSeededRandom(1001),
      turn: 2,
    });
    state.active?.energies.push(
      buildRecordedCard("050746"),
      buildRecordedCard("049463")
    );
    const usedPhantomDive: Evaluator = ({ state: evaluated }) =>
      [...evaluated.attacks.values()].includes("ファントムダイブ") ? 1 : 0;
    const { policy } = createRecordingPolicy(usedPhantomDive, () => false);
    const chosen = policy.chooseAttack({ choices: policy, state });
    expect(chosen?.attack.name).toBe("ファントムダイブ");
    expect(state.random.nextFloat()).toBe(createSeededRandom(1001).nextFloat());
  });
});

describe("探索の判断基準の、相手の番の選択", () => {
  test("相手の番にきぜつしてベンチの上限が下がると、ベンチを減らすポケモンとバトル場に出すポケモンを候補の先頭から選ぶ", () => {
    // ゼロの大空洞(048706)は場に「テラスタル」のポケモンがいればベンチの上限 8。イーブイex(049282、「テラスタル」、
    // HP 200)が相手の 3 回目の番(200)できぜつすると、上限が 5 に戻る
    const gible = buildRecordedCard("049092");
    const state = buildState({
      active: buildRecordedCard("049282"),
      bench: [gible, gible, gible, gible, gible, gible],
      random: createSeededRandom(1),
    });
    state.stadium = buildRecordedCard("048706");
    if (state.active !== undefined) {
      state.active.damage = 100;
    }
    state.opponentTurnCount = 2;
    const { policy } = createRecordingPolicy(
      () => 0,
      () => false
    );
    playOpponentTurn({ choices: policy, state });
    expect(state.active?.card.name).toBe("シロナのフカマル");
    expect(state.bench).toHaveLength(4);
  });
});

describe("探索は場のポケモンをダメカンで見分ける", () => {
  test("ダメカンの量だけが違う 2 匹から、アドレナブレインでダメカンを取り除くポケモンを選ぶとき、両方を試して相手の場のダメージが大きくなるほうを選ぶ", () => {
    // マシマシラ(049074)のアドレナブレインは、悪エネルギー(047909)がついていれば自分のポケモン 1 匹のダメカンを 3 個まで
    // 相手の場のダメージに移す。ラルトス(049714)の 2 匹は、のっているダメカン(1 個と 5 個)だけが違う
    const ralts = buildRecordedCard("049714");
    const state = buildState({
      active: buildRecordedCard("049074"),
      bench: [ralts, ralts],
      random: createSeededRandom(1),
    });
    state.active?.energies.push(buildRecordedCard("047909"));
    const [fewer, more] = state.bench;
    if (fewer === undefined || more === undefined) {
      throw new Error("ベンチのラルトスがいない");
    }
    fewer.damage = 10;
    more.damage = 50;
    const policy = createSearchPolicy(
      ({ state: evaluated }) => evaluated.opponentFieldDamage,
      { samplesForUncertainOutcome: 1, searchesEffectChoices: true, seed: 1 }
    );
    policy.playTurn({ choices: policy, state });
    expect(state.opponentFieldDamage).toBe(30);
    expect(more.damage).toBe(20);
    expect(fewer.damage).toBe(10);
  });
});

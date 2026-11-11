import { describe, expect, test } from "bun:test";
import { createFirstActionPolicy } from "./action-list-playing-policies.ts";
import { cardRecordTable } from "./card-record-table.ts";
import {
  activeOf,
  buildRecordedCard,
  buildState,
} from "./card-test-support.ts";
import { buildDeck } from "./engine.ts";
import {
  collectLearningSamplesOfTrial,
  createLearnedEvaluationTrialScorer,
  estimateWinRate,
  extractWinRateFeatures,
  type LabeledFeatureSample,
  LEARNING_OPTIONS,
  listDeckCardNames,
  trainLearnedWinRateModel,
} from "./learned-win-rate-evaluation.ts";
import { createSeededRandom } from "./random.ts";
import { RECORDED_DECKS } from "./recorded-decks.ts";

/** 1 つ目の特徴が 3 以上なら勝ち、2 つ目の特徴はどちらにも同じように散らばる記録。 */
const SEPARABLE_SAMPLES: LabeledFeatureSample[] = [
  { features: [0, 1], label: 0 },
  { features: [1, 2], label: 0 },
  { features: [2, 1], label: 0 },
  { features: [3, 2], label: 1 },
  { features: [4, 1], label: 1 },
  { features: [5, 2], label: 1 },
];

describe("学習", () => {
  test("勝ちと負けが 1 つの特徴だけで分かれる記録で学習すると、その特徴が大きいほど勝率の見積もりが大きい", () => {
    const model = trainLearnedWinRateModel(
      ["separating", "noise"],
      SEPARABLE_SAMPLES,
      LEARNING_OPTIONS
    );
    expect(estimateWinRate(model, [5, 1])).toBeGreaterThan(
      estimateWinRate(model, [0, 1])
    );
    expect(estimateWinRate(model, [5, 1])).toBeGreaterThan(0.5);
    expect(estimateWinRate(model, [0, 1])).toBeLessThan(0.5);
  });

  test("同じ記録から 2 回学習すると同じ結果になる", () => {
    const train = () =>
      trainLearnedWinRateModel(
        ["separating", "noise"],
        SEPARABLE_SAMPLES,
        LEARNING_OPTIONS
      );
    expect(train()).toEqual(train());
  });

  test("値が 1 通りしかない特徴があっても、学習は数を返す(0 で割らない)", () => {
    const model = trainLearnedWinRateModel(
      ["separating", "constant"],
      SEPARABLE_SAMPLES.map((sample) => ({
        features: [sample.features[0] ?? 0, 7],
        label: sample.label,
      })),
      LEARNING_OPTIONS
    );
    expect(model.featureScales[1]).toBe(1);
    expect([...model.weights, model.bias].every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(estimateWinRate(model, [2, 7]))).toBe(true);
  });
});

describe("盤面の特徴", () => {
  test("バトルポケモンの残りの HP と、次の相手の攻撃を受けても残るかを、骨組みの値から作る", () => {
    // シロナのフカマル(049092、HP 70)。相手の 2 回目の番の攻撃は 100(docs/solo-play-simulator-design.md「相手の番」)
    const gible = buildRecordedCard("049092");
    const state = buildState({ active: gible, hand: [gible] });
    activeOf(state).damage = 20;
    state.opponentTurnCount = 1;
    const { names, values } = extractWinRateFeatures(state, [
      "シロナのフカマル",
    ]);
    const featureValue = (name: string) => values[names.indexOf(name)];
    expect(names).toHaveLength(values.length);
    expect(featureValue("activeRemainingHp")).toBe(50);
    expect(featureValue("nextOpponentAttackDamage")).toBe(100);
    expect(featureValue("activeSurvivesNextOpponentAttack")).toBe(0);
    expect(featureValue("inPlay:シロナのフカマル")).toBe(1);
    expect(featureValue("inHand:シロナのフカマル")).toBe(1);
  });

  test("バトル場が空の状態の特徴は作らない", () => {
    expect(() => extractWinRateFeatures(buildState({}), [])).toThrow();
  });
});

describe("学習用の記録", () => {
  test("1 回の試行で、自分の番ごとの特徴に、その対戦の勝敗を正解として付ける", () => {
    const [deck] = RECORDED_DECKS;
    if (deck === undefined) {
      throw new Error("記録済みのデッキが無い");
    }
    const cards = buildDeck(cardRecordTable, deck.decklist);
    const deckCardNames = listDeckCardNames(cards);
    const samples = collectLearningSamplesOfTrial({
      cards,
      createGeneratorPolicy: () => createFirstActionPolicy(),
      deckCardNames,
      trialSeed: 3,
      wentFirst: true,
    });
    expect(samples.length).toBeGreaterThan(0);
    expect(new Set(samples.map((sample) => sample.label)).size).toBe(1);
    expect(samples[0]?.features).toHaveLength(15 + 2 * deckCardNames.length);
  });
});

describe("学習した場の評価の試しの点数", () => {
  const model = trainLearnedWinRateModel([], [], LEARNING_OPTIONS);
  const scorer = createLearnedEvaluationTrialScorer(model, [], () =>
    createFirstActionPolicy()
  );

  test("途中で勝ちが決まる複製では、勝率 1 を返す", () => {
    // 相手の場のダメージが 100 以上でサイドが残り 1 枚なら、自分の番の終わりの判定で取り切って勝つ
    // (docs/solo-play-simulator-design.md「相手の場のダメージとサイド」「勝敗」)
    const state = buildState({
      active: buildRecordedCard("049092"),
      random: createSeededRandom(1),
    });
    state.prizes.splice(1);
    state.opponentFieldDamage = 100;
    expect(
      scorer({ resumePoint: "ownTurnAttack", seed: 1, state }).winRate
    ).toBe(1);
  });

  test("途中で負けが決まる複製では、勝率 0 を返す", () => {
    // 相手のサイドが残り 1 枚で、相手の 2 回目の番(100)にシロナのフカマル(049092、HP 70)がきぜつすると、相手が取り切って
    // 負け(docs/solo-play-simulator-design.md「相手の番」「ダメージときぜつ」「勝敗」)
    const state = buildState({
      active: buildRecordedCard("049092"),
      random: createSeededRandom(1),
    });
    state.opponentRemainingPrizeCount = 1;
    state.opponentTurnCount = 1;
    expect(
      scorer({ resumePoint: "opponentTurn", seed: 1, state }).winRate
    ).toBe(0);
  });

  test("勝敗が決まらなければ、次の自分の番に 1 枚引いた時点の盤面から勝率を見積もる", () => {
    const state = buildState({
      active: buildRecordedCard("049092"),
      deck: [buildRecordedCard("049092"), buildRecordedCard("049092")],
      random: createSeededRandom(1),
    });
    // 重みがすべて 0 の学習結果は、どの盤面でも 0.5 と見積もる
    expect(
      scorer({ resumePoint: "opponentTurn", seed: 1, state }).winRate
    ).toBe(0.5);
    expect(state.turn).toBe(3);
  });
});

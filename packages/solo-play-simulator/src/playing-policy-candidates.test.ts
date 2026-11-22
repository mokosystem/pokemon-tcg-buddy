import { describe, expect, test } from "bun:test";
import { cardRecordTable } from "./card-record-table.ts";
import { buildState } from "./card-test-support.ts";
import { buildDeck } from "./engine.ts";
import {
  extractWinRateFeatures,
  LEARNING_OPTIONS,
  listDeckCardNames,
  trainLearnedWinRateModel,
} from "./learned-win-rate-evaluation.ts";
import {
  PLAYING_POLICY_SETTING_NAMES,
  PLAYING_POLICY_SETTINGS,
  type PlayingPolicyParameters,
} from "./playing-policy-candidates.ts";
import { RECORDED_DECKS, type RecordedDeck } from "./recorded-decks.ts";
import { runBattleStyleSoloPlayTrial } from "./simulate.ts";

/**
 * 判断基準ごとに 1 回ずつ回すデッキ。記録済みのデッキすべてにしているのは、デッキごとに違う部品(足す先を選ぶ効果、
 * トラッシュするエネルギーを選ぶワザなど)を、どの判断基準も勝敗まで進められることを確かめるため。
 */
function prepareTrialDeck({ decklist, name }: RecordedDeck) {
  const cards = buildDeck(cardRecordTable, decklist);
  const deckCardNames = listDeckCardNames(cards);
  const [firstCard] = cards;
  if (firstCard === undefined) {
    throw new Error(`${name} のデッキが空`);
  }
  // 候補 4 には、重みがすべて 0 の学習結果を準備として渡す
  const zeroModel = trainLearnedWinRateModel(
    extractWinRateFeatures(buildState({ active: firstCard }), deckCardNames)
      .names,
    [],
    LEARNING_OPTIONS
  );
  return { cards, deckCardNames, label: name, zeroModel };
}

/** 設定の数を 1〜2 に下げる(テストの時間を短くするため)。 */
function reduceParameters(
  parameters: PlayingPolicyParameters
): PlayingPolicyParameters {
  return Object.fromEntries(
    Object.keys(parameters).map((name) => [
      name,
      name === "maxEvaluatedSequences" ? 2 : 1,
    ])
  );
}

describe("計測する設定の一覧", () => {
  test("Issue 70 の候補と Issue 77 の改善用の設定を列挙する", () => {
    const counts = new Map<string, number>();
    for (const name of PLAYING_POLICY_SETTING_NAMES) {
      const { candidate } = PLAYING_POLICY_SETTINGS[name];
      counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      "1": 2,
      "2": 2,
      "2b": 2,
      "3": 2,
      "4": 2,
      "77": 1,
    });
  });

  for (const { cards, deckCardNames, label, zeroModel } of RECORDED_DECKS.map(
    prepareTrialDeck
  )) {
    for (const name of PLAYING_POLICY_SETTING_NAMES) {
      test(`${name}: 数を下げた判断基準で、${label} の対戦を先攻で 1 回、勝敗まで進められる`, () => {
        const setting = PLAYING_POLICY_SETTINGS[name];
        const result = runBattleStyleSoloPlayTrial({
          cards,
          createPolicy: (policySeed) =>
            setting.createPolicy(
              { deckCardNames, learnedModel: zeroModel },
              reduceParameters(setting.parameters),
              policySeed
            ),
          trialSeed: 20_261_112,
          wentFirst: true,
        });
        expect(result.decidedTurn.ordinal).toBeGreaterThanOrEqual(1);
      });
    }
  }
});

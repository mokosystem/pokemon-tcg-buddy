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
import { RECORDED_DECKS } from "./recorded-decks.ts";
import { runBattleStyleSoloPlayTrial } from "./simulate.ts";

const GARCHOMP_DECK = RECORDED_DECKS.find(
  (deck) => deck.deckCode === "RS3MMy-FuGPRu-MypM2X"
);
if (GARCHOMP_DECK === undefined) {
  throw new Error("シロナのガブリアスex のデッキが無い");
}
const CARDS = buildDeck(cardRecordTable, GARCHOMP_DECK.decklist);
const DECK_CARD_NAMES = listDeckCardNames(CARDS);
const [FIRST_CARD] = CARDS;
if (FIRST_CARD === undefined) {
  throw new Error("デッキが空");
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
  test("候補 1 が 2 通り、候補 2〜4 が 2 通りずつ、計 10 の設定がある", () => {
    expect(PLAYING_POLICY_SETTING_NAMES).toHaveLength(10);
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
    });
  });

  // 候補 4 には、重みがすべて 0 の学習結果を準備として渡す
  const zeroModel = trainLearnedWinRateModel(
    extractWinRateFeatures(buildState({ active: FIRST_CARD }), DECK_CARD_NAMES)
      .names,
    [],
    LEARNING_OPTIONS
  );
  for (const name of PLAYING_POLICY_SETTING_NAMES) {
    test(`${name}: 数を下げた判断基準で、シロナのガブリアスex デッキの対戦を先攻で 1 回、勝敗まで進められる`, () => {
      const setting = PLAYING_POLICY_SETTINGS[name];
      const result = runBattleStyleSoloPlayTrial({
        cards: CARDS,
        createPolicy: (policySeed) =>
          setting.createPolicy(
            { deckCardNames: DECK_CARD_NAMES, learnedModel: zeroModel },
            reduceParameters(setting.parameters),
            policySeed
          ),
        trialSeed: 20_261_112,
        wentFirst: true,
      });
      expect(result.decidedTurn.ordinal).toBeGreaterThanOrEqual(1);
    });
  }
});

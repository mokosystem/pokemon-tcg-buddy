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

/**
 * 判断基準ごとに 1 回ずつ回すデッキ。ドラパルトex のデッキは、足す先(相手のバトル場のダメージか相手のベンチのダメージか)
 * を選ぶカード(サマヨール 049025、ヨノワール 049026、マシマシラ 049074)を含む。
 */
const TRIAL_DECKS = [
  { deckCode: "RS3MMy-FuGPRu-MypM2X", label: "シロナのガブリアスex" },
  { deckCode: "9gngnQ-zAMw9G-96H9nn", label: "ドラパルトex" },
] as const;

function prepareTrialDeck({ deckCode, label }: (typeof TRIAL_DECKS)[number]) {
  const deck = RECORDED_DECKS.find(
    (candidate) => candidate.deckCode === deckCode
  );
  if (deck === undefined) {
    throw new Error(`${label} のデッキが無い`);
  }
  const cards = buildDeck(cardRecordTable, deck.decklist);
  const deckCardNames = listDeckCardNames(cards);
  const [firstCard] = cards;
  if (firstCard === undefined) {
    throw new Error(`${label} のデッキが空`);
  }
  // 候補 4 には、重みがすべて 0 の学習結果を準備として渡す
  const zeroModel = trainLearnedWinRateModel(
    extractWinRateFeatures(buildState({ active: firstCard }), deckCardNames)
      .names,
    [],
    LEARNING_OPTIONS
  );
  return { cards, deckCardNames, label, zeroModel };
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

  for (const { cards, deckCardNames, label, zeroModel } of TRIAL_DECKS.map(
    prepareTrialDeck
  )) {
    for (const name of PLAYING_POLICY_SETTING_NAMES) {
      test(`${name}: 数を下げた判断基準で、${label} デッキの対戦を先攻で 1 回、勝敗まで進められる`, () => {
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

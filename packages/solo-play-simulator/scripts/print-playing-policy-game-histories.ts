/**
 * 2 デッキの先攻と後攻それぞれ試行 0〜2 の 3 対戦ぶん、計 12 対戦の履歴を書く(Issue 70 の完了の定義の履歴)。種は計測と
 * 同じ基準の種。番を終えた時点で残っていた行動と、使わなかったワザも履歴に書く(unused-action-recording.ts)。候補 4 の設定では、
 * 準備(学習)を先に行う。
 *
 * bun run print:playing-policy-game-histories -- --setting <設定> --output <ディレクトリ>
 */

import { parseArgs } from "node:util";
import type { BattleStyleSoloPlayResult } from "../src/engine.ts";
import { listDeckCardNames } from "../src/learned-win-rate-evaluation.ts";
import { PLAYING_POLICY_SETTINGS } from "../src/playing-policy-candidates.ts";
import { deriveTrialSeed } from "../src/random.ts";
import { RECORDED_DECKS } from "../src/recorded-decks.ts";
import { runBattleStyleSoloPlayTrial } from "../src/simulate.ts";
import { createPolicyRecordingUnusedActions } from "../src/unused-action-recording.ts";
import { buildMeasuredDeckCards } from "./measurement-jobs.ts";
import {
  DECISION_REASON_HEADINGS,
  findTrainingGames,
  MEASURED_DECK_CODES,
  MEASUREMENT_BASE_SEEDS,
  prepareLearnedModel,
  readCommonOptions,
  readOneSettingName,
  writeMeasurementOutput,
} from "./measurement-process-pool.ts";

/** デッキ × 先攻・後攻ごとの対戦の数。 */
const TRIALS_PER_TURN_ORDER = 3;

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    output: { type: "string" },
    setting: { type: "string" },
  },
  strict: true,
});
const { outputDirectory, processCount } = readCommonOptions(values);
const settingName = readOneSettingName(values.setting);
const setting = PLAYING_POLICY_SETTINGS[settingName];

function formatGame(
  heading: string,
  result: BattleStyleSoloPlayResult
): string {
  const owner = result.decidedTurn.owner === "self" ? "自分" : "相手";
  return [
    `## ${heading}`,
    "",
    `- 勝敗: ${result.outcome === "win" ? "勝ち" : "負け"}(${DECISION_REASON_HEADINGS[result.reason]})`,
    `- 勝敗が決まった番: ${owner}の ${result.decidedTurn.ordinal} 回目の番`,
    `- 取ったサイド: 自分 ${result.takenPrizeCount} 枚、相手 ${result.opponentTakenPrizeCount} 枚`,
    "",
    "```text",
    ...result.events,
    "```",
    "",
  ].join("\n");
}

/** 候補 4 の設定なら、デッキの学習の結果を作る。学習の要らない設定は undefined。 */
async function prepareLearnedModelOfDeck(deckCode: string) {
  const trainingGames = findTrainingGames(settingName, undefined);
  if (trainingGames === undefined) {
    return;
  }
  const preparation = await prepareLearnedModel({
    deck: { deckCode },
    fileName: `learned-model-${settingName}-${deckCode}-histories.json`,
    outputDirectory,
    processCount,
    trainingGames,
  });
  return preparation.model;
}

const sections: string[] = [];
const games: {
  deckCode: string;
  result: BattleStyleSoloPlayResult;
  trialIndex: number;
  wentFirst: boolean;
}[] = [];
for (const deckCode of MEASURED_DECK_CODES) {
  const cards = buildMeasuredDeckCards({ deckCode });
  // biome-ignore lint/performance/noAwaitInLoops: 計測は 1 つずつ順に回し、前の計測が終わってから次を始める(並べると互いの時間を奪い、Issue 70 の決定事項「測る条件」の、計測のあいだにほかの重い処理を並行させない条件を破るため)
  const learnedModel = await prepareLearnedModelOfDeck(deckCode);
  const preparation = {
    deckCardNames: listDeckCardNames(cards),
    ...(learnedModel === undefined ? {} : { learnedModel }),
  };
  const deckName =
    RECORDED_DECKS.find((deck) => deck.deckCode === deckCode)?.name ?? deckCode;
  for (const [turnOrder, wentFirst, label] of [
    ["firstPlayer", true, "先攻"],
    ["secondPlayer", false, "後攻"],
  ] as const) {
    for (
      let trialIndex = 0;
      trialIndex < TRIALS_PER_TURN_ORDER;
      trialIndex += 1
    ) {
      const result = runBattleStyleSoloPlayTrial({
        cards,
        createPolicy: (policySeed) =>
          createPolicyRecordingUnusedActions(
            setting.createPolicy(preparation, setting.parameters, policySeed)
          ),
        trialSeed: deriveTrialSeed(
          MEASUREMENT_BASE_SEEDS[turnOrder],
          trialIndex
        ),
        wentFirst,
      });
      games.push({ deckCode, result, trialIndex, wentFirst });
      sections.push(
        formatGame(
          `${deckName}(${deckCode})/ ${label} / 試行 ${trialIndex}`,
          result
        )
      );
    }
  }
}
const path = writeMeasurementOutput({
  json: { games, measurement: "playing-policy-game-histories", settingName },
  markdown: [
    `# 対戦の履歴 ${settingName}`,
    "",
    `再現するコマンド: bun run print:playing-policy-game-histories -- --setting ${settingName} --output <ディレクトリ>`,
    "",
    ...sections,
  ].join("\n"),
  measurementName: "playing-policy-game-histories",
  outputDirectory,
  settingName,
});
console.log(`${path}.md`);

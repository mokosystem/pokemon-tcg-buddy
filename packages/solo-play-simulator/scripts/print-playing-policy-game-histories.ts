/**
 * 記録済みのデッキの先攻と後攻それぞれの対戦の履歴を書く(Issue 70 の完了の定義の履歴、Issue 77 の決定事項「改善の 1 回」)。
 * 番を終えた時点で残っていた行動と、使わなかったワザも履歴に書く(unused-action-recording.ts)。候補 4 の設定では、準備(学習)を
 * 先に行う。
 *
 * 種は改善用の種(GLOSSARY.md)に固定し、種を選ぶ引数は持たない。プレイングの判断基準を直すために履歴を読んでよいのは、
 * 改善用の種で回した対戦だけで、判定用の種で回した対戦の履歴は読まない決まりのため(Issue 77 の決定事項「改善の 1 回」
 * 「到達の判定の計測」)。
 *
 * bun run print:playing-policy-game-histories -- --setting <設定> [--deck <デッキコード>]…
 *   [--first-trial <番号>] [--trials <数>] [--losses-only] [--training-games <学習の対戦の回数>] [--processes <数>]
 *   --output <ディレクトリ>
 *
 * --deck を省くと、記録済みのデッキすべて。デッキ × 先攻・後攻ごとに、試行 --first-trial(既定 0)から --trials(既定 3)回を回す。
 * --losses-only を付けると、回した対戦のうち負けた対戦だけを書く(回す対戦は変わらない)。
 * --training-games は計測と同じ値を渡す。学習の記録を試行番号順に結合するので、--processes は変えてよい(既定は CPU の数)。
 */

import { parseArgs } from "node:util";
import type { BattleStyleSoloPlayResult } from "../src/engine.ts";
import { listDeckCardNames } from "../src/learned-win-rate-evaluation.ts";
import { PLAYING_POLICY_SETTINGS } from "../src/playing-policy-candidates.ts";
import { deriveTrialSeed } from "../src/random.ts";
import { runBattleStyleSoloPlayTrial } from "../src/simulate.ts";
import { createPolicyRecordingUnusedActions } from "../src/unused-action-recording.ts";
import { buildMeasuredDeckCards } from "./measurement-jobs.ts";
import {
  DECISION_REASON_HEADINGS,
  findTrainingGames,
  MEASUREMENT_BASE_SEEDS,
  prepareLearnedModel,
  readCommonOptions,
  readIntegerOption,
  readOneSettingName,
  readRecordedDecks,
  readTrainingGamesOption,
  writeMeasurementOutput,
} from "./measurement-process-pool.ts";

/** デッキ × 先攻・後攻ごとの対戦の数の既定。 */
const DEFAULT_TRIALS_PER_TURN_ORDER = 3;

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    deck: { multiple: true, type: "string" },
    "first-trial": { type: "string" },
    "losses-only": { type: "boolean" },
    output: { type: "string" },
    processes: { type: "string" },
    setting: { type: "string" },
    "training-games": { type: "string" },
    trials: { type: "string" },
  },
  strict: true,
});
const decks = readRecordedDecks(values.deck);
const { outputDirectory, processCount } = readCommonOptions(values);
const settingName = readOneSettingName(values.setting);
const setting = PLAYING_POLICY_SETTINGS[settingName];
const firstTrialIndex =
  readIntegerOption("--first-trial", values["first-trial"], 0) ?? 0;
const trialsPerTurnOrder =
  readIntegerOption("--trials", values.trials, 1) ??
  DEFAULT_TRIALS_PER_TURN_ORDER;
const writesLossesOnly = values["losses-only"] === true;
/** 候補 4 の設定なら、学習の対戦の回数(--training-games があればその値)。学習の要らない設定は undefined。 */
const trainingGames = findTrainingGames(
  settingName,
  readTrainingGamesOption(values["training-games"])
);

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

/** デッキごとの学習を使う設定なら、学習の結果を作る。 */
async function prepareLearnedModelOfDeck(deckCode: string) {
  if (trainingGames === undefined) {
    return;
  }
  const preparation = await prepareLearnedModel({
    deck: { deckCode },
    modelName: `learned-model-${settingName}-${deckCode}-histories`,
    outputDirectory,
    processCount,
    trainingGames,
  });
  return preparation.model;
}

/** 同じ履歴を出し直すコマンド。 */
const reproductionCommand = [
  "bun run print:playing-policy-game-histories --",
  `--setting ${settingName}`,
  ...(values.deck ?? []).map((deckCode) => `--deck ${deckCode}`),
  ...(values["first-trial"] === undefined
    ? []
    : [`--first-trial ${firstTrialIndex}`]),
  ...(values.trials === undefined ? [] : [`--trials ${trialsPerTurnOrder}`]),
  ...(writesLossesOnly ? ["--losses-only"] : []),
  // 学習する設定では、学習の結果を決める 2 つの値を、省かれていても書く。--processes の既定は CPU の数なので、省いたままだと、
  // CPU の数が違う機械で出し直したときに学習の結果が変わる。学習しない設定では、どちらの値も対戦を変えないので書かない
  ...(trainingGames === undefined
    ? []
    : [`--training-games ${trainingGames}`, `--processes ${processCount}`]),
  "--output <ディレクトリ>",
].join(" ");

const sections: string[] = [];
const games: {
  deckCode: string;
  result: BattleStyleSoloPlayResult;
  trialIndex: number;
  wentFirst: boolean;
}[] = [];
let playedGameCount = 0;
for (const { deckCode, name: deckName } of decks) {
  const cards = buildMeasuredDeckCards({ deckCode });
  // biome-ignore lint/performance/noAwaitInLoops: 計測は 1 つずつ順に回し、前の計測が終わってから次を始める(並べると互いの時間を奪い、Issue 70 の決定事項「測る条件」の、計測のあいだにほかの重い処理を並行させない条件を破るため)
  const learnedModel = await prepareLearnedModelOfDeck(deckCode);
  const preparation = {
    deckCardNames: listDeckCardNames(cards),
    ...(learnedModel === undefined ? {} : { learnedModel }),
  };
  for (const [turnOrder, wentFirst, label] of [
    ["firstPlayer", true, "先攻"],
    ["secondPlayer", false, "後攻"],
  ] as const) {
    for (
      let trialIndex = firstTrialIndex;
      trialIndex < firstTrialIndex + trialsPerTurnOrder;
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
      playedGameCount += 1;
      if (writesLossesOnly && result.outcome === "win") {
        continue;
      }
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
  json: {
    firstTrialIndex,
    games,
    measurement: "playing-policy-game-histories",
    playedGameCount,
    processCount,
    settingName,
    trainingGames,
    trialsPerTurnOrder,
    writesLossesOnly,
  },
  markdown: [
    `# 対戦の履歴 ${settingName}`,
    "",
    `再現するコマンド: ${reproductionCommand}`,
    "",
    `種は改善用の種。回した対戦は ${playedGameCount} 回で、書いた対戦は ${games.length} 回${writesLossesOnly ? "(負けた対戦だけ)" : ""}。`,
    "",
    ...sections,
  ].join("\n"),
  measurementName: "playing-policy-game-histories",
  outputDirectory,
  settingName,
});
console.log(`${path}.md`);

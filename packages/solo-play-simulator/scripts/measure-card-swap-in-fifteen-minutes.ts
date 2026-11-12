/**
 * カードの入れ替えの題材(measurement-process-pool.ts の CARD_SWAP_SUBJECT)を、入れ替える前と後、先攻と後攻の 4 本で
 * 15 分回し、回せた回数、勝率の差、「場に自分のポケモンがいなくなった」負けの割合の差と、95 % の誤差の幅を測る
 * (Issue 70 の決定事項「15 分の目安」「カードの入れ替えの題材」)。前と後の同じ先攻(後攻)の対戦は同じ種で、種をそろえた対になる。
 * 候補 4 は、準備(学習)の時間を含める区切りと含めない区切りの 2 つを、1 回の実行から出す。
 *
 * bun run measure:card-swap-in-fifteen-minutes -- --setting <設定> --processes <数> [--minutes <分>] --output <ディレクトリ>
 */

import { parseArgs } from "node:util";
import {
  type CardSwapMeasurementTally,
  type CardSwapTurnOrderTally,
  createEmptyCardSwapMeasurementTally,
  mergeCardSwapMeasurementTallies,
} from "../src/battle-style-solo-play-measurement.ts";
import {
  calculatePairedDifferenceInterval,
  calculateUnpairedDifferenceInterval,
  calculateWilsonInterval,
} from "../src/battle-style-solo-play-statistics.ts";
import {
  PLAYING_POLICY_SETTINGS,
  type PlayingPolicySettingName,
} from "../src/playing-policy-candidates.ts";
import {
  CARD_SWAP_SUBJECT,
  measureNowEpochMilliseconds,
} from "./measurement-jobs.ts";
import {
  calculateCutoff,
  describeMeasurementEnvironment,
  describePreparation,
  findTrainingGames,
  formatDifference,
  formatEnvironmentLines,
  formatProportion,
  formatTableHeader,
  formatTableRow,
  type LearningPreparation,
  MEASUREMENT_BASE_SEEDS,
  prepareLearnedModel,
  readCommonOptions,
  readSettingNames,
  runMeasurementWorkers,
  summarizeTally,
  writeMeasurementOutput,
} from "./measurement-process-pool.ts";

const DEFAULT_MINUTES = 15;

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    minutes: { type: "string" },
    output: { type: "string" },
    processes: { type: "string" },
    setting: { multiple: true, type: "string" },
  },
  strict: true,
});
const { outputDirectory, processCount } = readCommonOptions(values);
const minutes =
  values.minutes === undefined ? DEFAULT_MINUTES : Number(values.minutes);

/** 先攻か後攻の 1 本の、表に載せる数字。 */
function summarizeTurnOrder(tally: CardSwapTurnOrderTally) {
  const pairs = tally.before.games;
  return {
    after: summarizeTally(tally.after),
    before: summarizeTally(tally.before),
    noOwnPokemonLossDifferencePaired: calculatePairedDifferenceInterval(
      tally.noOwnPokemonLosses
    ),
    noOwnPokemonLossDifferenceUnpaired: calculateUnpairedDifferenceInterval(
      tally.noOwnPokemonLosses
    ),
    noOwnPokemonLossShareAfter: calculateWilsonInterval(
      tally.after.decisionReasonCounts.noOwnPokemonInPlay,
      tally.after.games
    ),
    noOwnPokemonLossShareBefore: calculateWilsonInterval(
      tally.before.decisionReasonCounts.noOwnPokemonInPlay,
      pairs
    ),
    pairs,
    winRateDifferencePaired: calculatePairedDifferenceInterval(tally.wins),
    winRateDifferenceUnpaired: calculateUnpairedDifferenceInterval(tally.wins),
  };
}

function summarizeCutoff(tally: CardSwapMeasurementTally) {
  return {
    firstPlayer: summarizeTurnOrder(tally.firstPlayer),
    games:
      tally.firstPlayer.before.games * 2 + tally.secondPlayer.before.games * 2,
    secondPlayer: summarizeTurnOrder(tally.secondPlayer),
    units: tally.firstPlayer.before.games,
  };
}

/** 候補 4 なら、入れ替える前と後のデッキで学習する。準備の始まりと 2 つの学習の結果を返す。 */
async function prepare(settingName: PlayingPolicySettingName) {
  const trainingGames = findTrainingGames(settingName, undefined);
  if (trainingGames === undefined) {
    return;
  }
  const startedAt = measureNowEpochMilliseconds();
  const before = await prepareLearnedModel({
    deck: { deckCode: CARD_SWAP_SUBJECT.deckCode },
    fileName: `learned-model-${settingName}-card-swap-before.json`,
    outputDirectory,
    processCount,
    trainingGames,
  });
  const after = await prepareLearnedModel({
    deck: CARD_SWAP_SUBJECT,
    fileName: `learned-model-${settingName}-card-swap-after.json`,
    outputDirectory,
    processCount,
    trainingGames,
  });
  return { after, before, startedAt, trainingGames };
}

function formatMarkdown(
  settingName: PlayingPolicySettingName,
  cutoffLabels: readonly string[],
  summaries: readonly ReturnType<typeof summarizeCutoff>[],
  environment: ReturnType<typeof describeMeasurementEnvironment>,
  preparations: readonly LearningPreparation[]
): string {
  const rows = summaries.flatMap((summary, index) =>
    (
      [
        ["先攻", summary.firstPlayer],
        ["後攻", summary.secondPlayer],
      ] as const
    ).map(([label, side]) =>
      formatTableRow([
        settingName,
        cutoffLabels[index] ?? "",
        label,
        `${summary.units}(${summary.games} 対戦)`,
        formatProportion(side.before.winRate),
        formatProportion(side.after.winRate),
        formatDifference(side.winRateDifferencePaired),
        formatDifference(side.winRateDifferenceUnpaired),
        formatDifference(side.noOwnPokemonLossDifferencePaired),
        formatDifference(side.noOwnPokemonLossDifferenceUnpaired),
      ])
    )
  );
  return [
    `# カードの入れ替えの計測 ${settingName}(${minutes} 分)`,
    "",
    formatEnvironmentLines(environment),
    ...(preparations.length === 0
      ? []
      : [
          `- 準備の時間: 記録を集めた時間 ${(describePreparation(preparations).collectMilliseconds / 1000).toFixed(1)} 秒、学習の時間 ${(describePreparation(preparations).trainMilliseconds / 1000).toFixed(1)} 秒`,
        ]),
    "",
    formatTableHeader([
      "設定",
      "区切り",
      "先攻・後攻",
      "回せた単位",
      "前の勝率",
      "後の勝率",
      "勝率の差(対にした)",
      "勝率の差(対にしない)",
      "場に自分のポケモンがいなくなった負けの割合の差(対にした)",
      "同(対にしない)",
    ]),
    ...rows,
    "",
  ].join("\n");
}

for (const settingName of readSettingNames(values.setting)) {
  // biome-ignore lint/performance/noAwaitInLoops: 計測は 1 つずつ順に回し、前の計測が終わってから次を始める(並べると互いの時間を奪い、Issue 70 の決定事項「測る条件」の、計測のあいだにほかの重い処理を並行させない条件を破るため)
  const preparation = await prepare(settingName);
  const measureStartedAt = measureNowEpochMilliseconds();
  const cutoffs =
    preparation === undefined
      ? [calculateCutoff(measureStartedAt, minutes)]
      : [
          calculateCutoff(preparation.startedAt, minutes),
          calculateCutoff(measureStartedAt, minutes),
        ];
  const cutoffLabels =
    preparation === undefined
      ? [`${minutes} 分`]
      : ["準備を含む", "準備を含まない"];
  const reports = await runMeasurementWorkers(
    {
      baseSeeds: MEASUREMENT_BASE_SEEDS,
      cutoffsEpochMilliseconds: cutoffs,
      kind: "measureCardSwap",
      settingName,
      ...(preparation === undefined
        ? {}
        : {
            afterLearnedModelPath: preparation.after.modelPath,
            beforeLearnedModelPath: preparation.before.modelPath,
          }),
    },
    processCount
  );
  const outcomes = reports.flatMap((report) =>
    report.kind === "measureCardSwap" ? [report.outcome] : []
  );
  const talliesAtCutoffs = cutoffs.map((_, index) =>
    outcomes
      .map(
        (outcome) =>
          outcome.talliesAtCutoffs[index] ??
          createEmptyCardSwapMeasurementTally()
      )
      .reduce(
        mergeCardSwapMeasurementTallies,
        createEmptyCardSwapMeasurementTally()
      )
  );
  const summaries = talliesAtCutoffs.map(summarizeCutoff);
  const environment = describeMeasurementEnvironment(processCount);
  const preparations =
    preparation === undefined ? [] : [preparation.before, preparation.after];
  const path = writeMeasurementOutput({
    json: {
      candidate: PLAYING_POLICY_SETTINGS[settingName].candidate,
      cardSwapSubject: CARD_SWAP_SUBJECT,
      cutoffLabels,
      cutoffsEpochMilliseconds: cutoffs,
      discardedUnits: outcomes.reduce(
        (total, outcome) => total + outcome.discardedUnits,
        0
      ),
      environment,
      measurement: "card-swap-in-fifteen-minutes",
      measureStartedAt,
      minutes,
      parameters: PLAYING_POLICY_SETTINGS[settingName].parameters,
      preparation:
        preparation === undefined
          ? undefined
          : {
              ...describePreparation(preparations),
              startedAt: preparation.startedAt,
              trainingGames: preparation.trainingGames,
            },
      settingName,
      summaries,
      talliesAtCutoffs,
    },
    markdown: formatMarkdown(
      settingName,
      cutoffLabels,
      summaries,
      environment,
      preparations
    ),
    measurementName: "card-swap-in-fifteen-minutes",
    outputDirectory,
    settingName,
  });
  console.log(`${settingName}: ${path}.json`);
}

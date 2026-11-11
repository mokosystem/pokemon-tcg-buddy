/**
 * 1 デッキを先攻・後攻で回し、設定ごとの勝率と誤差の幅、サイドを取り切った番の分布、負けた理由の内訳、1 回の対戦の時間を
 * 測る(Issue 70 の決定事項「測るもの」)。1 単位は先攻 1 回と後攻 1 回。
 *
 * bun run measure:playing-policy-win-rates -- --setting <設定> --deck <デッキコード> --processes <数> --max-minutes <分>
 *   --max-units <単位の数> [--training-games <学習の対戦の回数>] --output <ディレクトリ>
 */

import { parseArgs } from "node:util";
import {
  createEmptyDeckMeasurementTally,
  mergeDeckMeasurementTallies,
} from "../src/battle-style-solo-play-measurement.ts";
import {
  PLAYING_POLICY_SETTINGS,
  type PlayingPolicySettingName,
} from "../src/playing-policy-candidates.ts";
import { measureNowEpochMilliseconds } from "./measurement-jobs.ts";
import {
  calculateCutoff,
  describeMeasurementEnvironment,
  describePreparation,
  findTrainingGames,
  formatDeckMeasurementMarkdown,
  type LearningPreparation,
  MEASUREMENT_BASE_SEEDS,
  prepareLearnedModel,
  readCommonOptions,
  readSettingNames,
  runMeasurementWorkers,
  summarizeTally,
  writeMeasurementOutput,
} from "./measurement-process-pool.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    deck: { type: "string" },
    "max-minutes": { type: "string" },
    "max-units": { type: "string" },
    output: { type: "string" },
    processes: { type: "string" },
    setting: { multiple: true, type: "string" },
    "training-games": { type: "string" },
  },
  strict: true,
});

const deckCode = values.deck;
if (deckCode === undefined) {
  throw new Error("--deck にデッキコードを渡す");
}
const { outputDirectory, processCount } = readCommonOptions(values);
const maxMinutes =
  values["max-minutes"] === undefined
    ? undefined
    : Number(values["max-minutes"]);
const maxUnits =
  values["max-units"] === undefined ? undefined : Number(values["max-units"]);
if (maxMinutes === undefined && maxUnits === undefined) {
  throw new Error("--max-minutes か --max-units の少なくとも一方を渡す");
}
const trainingGamesOverride =
  values["training-games"] === undefined
    ? undefined
    : Number(values["training-games"]);

async function prepare(
  settingName: PlayingPolicySettingName
): Promise<LearningPreparation | undefined> {
  const trainingGames = findTrainingGames(settingName, trainingGamesOverride);
  return trainingGames === undefined
    ? undefined
    : await prepareLearnedModel({
        deck: { deckCode: deckCode as string },
        fileName: `learned-model-${settingName}-${deckCode}-${trainingGames}.json`,
        outputDirectory,
        processCount,
        trainingGames,
      });
}

for (const settingName of readSettingNames(values.setting)) {
  // biome-ignore lint/performance/noAwaitInLoops: 計測は 1 つずつ順に回し、前の計測が終わってから次を始める(並べると互いの時間を奪い、Issue 70 の決定事項「測る条件」の、計測のあいだにほかの重い処理を並行させない条件を破るため)
  const preparation = await prepare(settingName);
  const startedAt = measureNowEpochMilliseconds();
  const reports = await runMeasurementWorkers(
    {
      baseSeeds: MEASUREMENT_BASE_SEEDS,
      cutoffsEpochMilliseconds: [calculateCutoff(startedAt, maxMinutes)],
      deckCode,
      kind: "measureDeck",
      ...(maxUnits === undefined ? {} : { maxUnits }),
      ...(preparation === undefined
        ? {}
        : { learnedModelPath: preparation.modelPath }),
      settingName,
    },
    processCount
  );
  const wallMilliseconds = measureNowEpochMilliseconds() - startedAt;
  const outcomes = reports.flatMap((report) =>
    report.kind === "measureDeck" ? [report.outcome] : []
  );
  const tally = outcomes
    .map(
      (outcome) =>
        outcome.talliesAtCutoffs[0] ?? createEmptyDeckMeasurementTally()
    )
    .reduce(mergeDeckMeasurementTallies, createEmptyDeckMeasurementTally());
  const environment = describeMeasurementEnvironment(processCount);
  const path = writeMeasurementOutput({
    json: {
      candidate: PLAYING_POLICY_SETTINGS[settingName].candidate,
      deckCode,
      discardedUnits: outcomes.reduce(
        (total, outcome) => total + outcome.discardedUnits,
        0
      ),
      environment,
      maxMinutes,
      maxUnits,
      measurement: "playing-policy-win-rates",
      parameters: PLAYING_POLICY_SETTINGS[settingName].parameters,
      preparation:
        preparation === undefined
          ? undefined
          : {
              ...describePreparation([preparation]),
              trainingGames: findTrainingGames(
                settingName,
                trainingGamesOverride
              ),
            },
      settingName,
      summaries: {
        firstPlayer: summarizeTally(tally.firstPlayer),
        secondPlayer: summarizeTally(tally.secondPlayer),
      },
      tally,
      wallMilliseconds,
    },
    markdown: formatDeckMeasurementMarkdown({
      candidate: PLAYING_POLICY_SETTINGS[settingName].candidate,
      environment,
      preparationSeconds:
        preparation === undefined
          ? undefined
          : (preparation.collectMilliseconds + preparation.trainMilliseconds) /
            1000,
      settingLabel: settingName,
      tally,
      title: `勝率の計測 ${settingName}(デッキ ${deckCode})`,
      trialsColumnLabel: "1 回の対戦の試しの回数",
    }),
    measurementName: `playing-policy-win-rates-${deckCode}`,
    outputDirectory,
    settingName,
  });
  console.log(`${settingName}: ${path}.json`);
}

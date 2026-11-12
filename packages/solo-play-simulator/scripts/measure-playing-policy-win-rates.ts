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
  type DeckMeasurementTally,
  mergeDeckMeasurementTallies,
} from "../src/battle-style-solo-play-measurement.ts";
import {
  PLAYING_POLICY_SETTINGS,
  type PlayingPolicySettingName,
} from "../src/playing-policy-candidates.ts";
import { measureNowEpochMilliseconds } from "./measurement-jobs.ts";
import {
  calculateCutoff,
  DECISION_REASON_HEADINGS,
  describeMeasurementEnvironment,
  describePreparation,
  findTrainingGames,
  formatEnvironmentLines,
  formatMilliseconds,
  formatPercent,
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

function formatMarkdown(
  settingName: PlayingPolicySettingName,
  tally: DeckMeasurementTally,
  preparation: LearningPreparation | undefined,
  environment: ReturnType<typeof describeMeasurementEnvironment>
): string {
  const first = summarizeTally(tally.firstPlayer);
  const second = summarizeTally(tally.secondPlayer);
  const games = tally.firstPlayer.games + tally.secondPlayer.games;
  const meanOf = (total: (side: typeof tally.firstPlayer) => number) =>
    games === 0
      ? Number.NaN
      : (total(tally.firstPlayer) + total(tally.secondPlayer)) / games;
  const turnOrders = [
    ["先攻", tally.firstPlayer],
    ["後攻", tally.secondPlayer],
  ] as const;
  const turns = [
    ...new Set(
      turnOrders.flatMap(([, side]) => Object.keys(side.winningTurnCounts))
    ),
  ].sort((left, right) => Number(left) - Number(right));
  return [
    `# 勝率の計測 ${settingName}(デッキ ${deckCode})`,
    "",
    formatEnvironmentLines(environment),
    "",
    formatTableHeader([
      "設定",
      "候補",
      "先攻 勝率",
      "後攻 勝率",
      "回数(先攻 / 後攻)",
      "1 回の対戦の時間(ms)",
      "1 回の対戦の試しの回数",
      "準備の時間(秒)",
    ]),
    formatTableRow([
      settingName,
      PLAYING_POLICY_SETTINGS[settingName].candidate,
      formatProportion(first.winRate),
      formatProportion(second.winRate),
      `${first.games} / ${second.games}`,
      formatMilliseconds(meanOf((side) => side.totalGameMilliseconds)),
      formatMilliseconds(meanOf((side) => side.totalTrialScores)),
      preparation === undefined
        ? "—"
        : (
            (preparation.collectMilliseconds + preparation.trainMilliseconds) /
            1000
          ).toFixed(1),
    ]),
    "",
    "負けた理由の内訳(すべての対戦に対する割合)",
    "",
    formatTableHeader([
      "先攻・後攻",
      ...Object.values(DECISION_REASON_HEADINGS),
    ]),
    ...turnOrders.map(([label, side]) =>
      formatTableRow([
        label,
        ...Object.keys(DECISION_REASON_HEADINGS).map((reason) =>
          side.games === 0
            ? "—"
            : formatPercent(
                side.decisionReasonCounts[
                  reason as keyof typeof DECISION_REASON_HEADINGS
                ] / side.games
              )
        ),
      ])
    ),
    "",
    "サイドを取り切った自分の番の分布(すべての対戦に対する割合)",
    "",
    ...(turns.length === 0
      ? ["勝った対戦が無い。"]
      : [
          formatTableHeader([
            "先攻・後攻",
            ...turns.map((turn) => `${turn} 番`),
          ]),
          ...turnOrders.map(([label, side]) =>
            formatTableRow([
              label,
              ...turns.map((turn) =>
                side.games === 0
                  ? "—"
                  : formatPercent(
                      (side.winningTurnCounts[turn] ?? 0) / side.games
                    )
              ),
            ])
          ),
        ]),
    "",
  ].join("\n");
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
    markdown: formatMarkdown(settingName, tally, preparation, environment),
    measurementName: `playing-policy-win-rates-${deckCode}`,
    outputDirectory,
    settingName,
  });
  console.log(`${settingName}: ${path}.json`);
}

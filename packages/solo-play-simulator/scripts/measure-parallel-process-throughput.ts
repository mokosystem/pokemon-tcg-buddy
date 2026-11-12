/**
 * 並べて回すプロセスの数ごとに、カードの入れ替えの題材(1 単位 4 対戦)を決まった秒数回し、1 秒あたりの対戦の数を測る
 * (Issue 70 の決定事項「15 分の目安」の、並べて回す効き目)。区切りまでに終わった単位だけを数える。
 *
 * bun run measure:parallel-process-throughput -- --setting <設定> --process-counts 1,2,4,8 --seconds-per-count 60
 *   --output <ディレクトリ>
 */

import { parseArgs } from "node:util";
import {
  createEmptyCardSwapMeasurementTally,
  mergeCardSwapMeasurementTallies,
} from "../src/battle-style-solo-play-measurement.ts";
import { measureNowEpochMilliseconds } from "./measurement-jobs.ts";
import {
  describeMeasurementEnvironment,
  findTrainingGames,
  formatEnvironmentLines,
  formatTableHeader,
  formatTableRow,
  MEASUREMENT_BASE_SEEDS,
  readCommonOptions,
  readSettingNames,
  runMeasurementWorkers,
  writeMeasurementOutput,
} from "./measurement-process-pool.ts";

/** 1 単位の対戦の数(入れ替える前と後 × 先攻と後攻)。 */
const GAMES_PER_UNIT = 4;

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    output: { type: "string" },
    "process-counts": { type: "string" },
    "seconds-per-count": { type: "string" },
    setting: { multiple: true, type: "string" },
  },
  strict: true,
});
const { outputDirectory } = readCommonOptions({ output: values.output });
const processCounts = (values["process-counts"] ?? "1").split(",").map(Number);
const secondsPerCount = Number(values["seconds-per-count"] ?? "60");

for (const settingName of readSettingNames(values.setting)) {
  if (findTrainingGames(settingName, undefined) !== undefined) {
    // 準備(学習)の時間を、並べる効き目の比べに混ぜないため、学習の要る設定は測らない
    throw new Error(
      `${settingName} は準備の要る設定なので、この計測では測らない`
    );
  }
  const rows: {
    gamesPerSecond: number;
    processCount: number;
    discardedUnits: number;
    units: number;
  }[] = [];
  for (const processCount of processCounts) {
    const startedAt = measureNowEpochMilliseconds();
    // biome-ignore lint/performance/noAwaitInLoops: 計測は 1 つずつ順に回し、前の計測が終わってから次を始める(並べると互いの時間を奪い、Issue 70 の決定事項「測る条件」の、計測のあいだにほかの重い処理を並行させない条件を破るため)
    const reports = await runMeasurementWorkers(
      {
        baseSeeds: MEASUREMENT_BASE_SEEDS,
        cutoffsEpochMilliseconds: [startedAt + secondsPerCount * 1000],
        kind: "measureCardSwap",
        settingName,
      },
      processCount
    );
    const outcomes = reports.flatMap((report) =>
      report.kind === "measureCardSwap" ? [report.outcome] : []
    );
    const units = outcomes
      .map(
        (outcome) =>
          outcome.talliesAtCutoffs[0] ?? createEmptyCardSwapMeasurementTally()
      )
      .reduce(
        mergeCardSwapMeasurementTallies,
        createEmptyCardSwapMeasurementTally()
      ).firstPlayer.before.games;
    rows.push({
      discardedUnits: outcomes.reduce(
        (total, outcome) => total + outcome.discardedUnits,
        0
      ),
      gamesPerSecond: (units * GAMES_PER_UNIT) / secondsPerCount,
      processCount,
      units,
    });
    console.log(`${settingName} × ${processCount} プロセス: ${units} 単位`);
  }
  const baseline = rows.find((row) => row.processCount === 1)?.gamesPerSecond;
  const environment = describeMeasurementEnvironment(
    Math.max(...processCounts)
  );
  const path = writeMeasurementOutput({
    json: {
      environment,
      measurement: "parallel-process-throughput",
      rows: rows.map((row) => ({
        ...row,
        ratioToOneProcess:
          baseline === undefined || baseline === 0
            ? undefined
            : row.gamesPerSecond / baseline,
      })),
      secondsPerCount,
      settingName,
    },
    markdown: [
      `# 並べて回す効き目 ${settingName}(各 ${secondsPerCount} 秒)`,
      "",
      formatEnvironmentLines(environment),
      "",
      formatTableHeader([
        "設定",
        "プロセスの数",
        "1 秒あたりの対戦の数",
        "1 プロセスに対する倍率",
      ]),
      ...rows.map((row) =>
        formatTableRow([
          settingName,
          String(row.processCount),
          row.gamesPerSecond.toFixed(2),
          baseline === undefined || baseline === 0
            ? "—"
            : (row.gamesPerSecond / baseline).toFixed(2),
        ])
      ),
      "",
    ].join("\n"),
    measurementName: "parallel-process-throughput",
    outputDirectory,
    settingName,
  });
  console.log(`${settingName}: ${path}.json`);
}

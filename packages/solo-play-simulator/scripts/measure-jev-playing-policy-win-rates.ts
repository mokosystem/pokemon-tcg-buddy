/**
 * 候補 5(Jev に番の中の行動とワザを 1 手ずつ選ばせる判断基準)の勝率と誤差の幅、サイドを取り切った番の分布、負けた理由の
 * 内訳、1 回の対戦の時間を、デッキごとに先攻・後攻で測る(Issue 70 の決定事項「候補」の 5。15 分の目安と入れ替えの題材は
 * 測らない)。1 単位は先攻 1 回と後攻 1 回。
 *
 * API キーは、暗号化してリポジトリに置いた最上位の .env から dotenvx run が復号して、環境変数 TYPESAFE_API_KEY として渡す
 * (パッケージのスクリプト measure:jev-playing-policy-win-rates が dotenvx run を通して起動する)。並べて起こす子のプロセスは、
 * 親の環境変数をそのまま受け取る。
 *
 * bun run measure:jev-playing-policy-win-rates -- --deck <デッキコード> [--deck …] --processes <数> --max-units <単位の数>
 *   --output <ディレクトリ>
 */

import { parseArgs } from "node:util";
import {
  createEmptyDeckMeasurementTally,
  mergeDeckMeasurementTallies,
} from "../src/battle-style-solo-play-measurement.ts";
import { JEV_MODEL } from "../src/jev-playing-policy.ts";
import { measureNowEpochMilliseconds } from "./measurement-jobs.ts";
import {
  describeMeasurementEnvironment,
  formatDeckMeasurementMarkdown,
  MEASUREMENT_BASE_SEEDS,
  readCommonOptions,
  runMeasurementWorkers,
  summarizeTally,
  writeMeasurementOutput,
} from "./measurement-process-pool.ts";

const SETTING_LABEL = "jev";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    deck: { multiple: true, type: "string" },
    "max-units": { type: "string" },
    output: { type: "string" },
    processes: { type: "string" },
  },
  strict: true,
});

// 最上位のディレクトリで Bun を直接起動すると、Bun が最上位の .env を自動で読み、暗号文のままの値が入るため、
// 値が無いときに加えて encrypted: で始まるときも止める
const apiKey = process.env.TYPESAFE_API_KEY;
if (apiKey === undefined || apiKey === "" || apiKey.startsWith("encrypted:")) {
  throw new Error(
    "TYPESAFE_API_KEY が無い。dotenvx run を通して起動していない(bun run measure:jev-playing-policy-win-rates を使う)"
  );
}
const deckCodes = values.deck ?? [];
if (deckCodes.length === 0) {
  throw new Error("--deck にデッキコードを 1 つ以上渡す");
}
if (values["max-units"] === undefined) {
  throw new Error("--max-units に単位の数を渡す");
}
const maxUnits = Number(values["max-units"]);
const { outputDirectory, processCount } = readCommonOptions(values);

for (const deckCode of deckCodes) {
  const startedAt = measureNowEpochMilliseconds();
  // biome-ignore lint/performance/noAwaitInLoops: 計測は 1 つずつ順に回し、前の計測が終わってから次を始める(並べると互いの時間を奪い、Issue 70 の決定事項「測る条件」の、計測のあいだにほかの重い処理を並行させない条件を破るため)
  const reports = await runMeasurementWorkers(
    {
      baseSeeds: MEASUREMENT_BASE_SEEDS,
      deckCode,
      kind: "measureJevDeck",
      maxUnits,
    },
    processCount
  );
  const wallMilliseconds = measureNowEpochMilliseconds() - startedAt;
  const jevReports = reports.flatMap((report) =>
    report.kind === "measureJevDeck" ? [report] : []
  );
  const tally = jevReports
    .map(
      (report) =>
        report.outcome.talliesAtCutoffs[0] ?? createEmptyDeckMeasurementTally()
    )
    .reduce(mergeDeckMeasurementTallies, createEmptyDeckMeasurementTally());
  const usage = {
    firstInputTokensByProcess: jevReports.map(
      (report) => report.usage.firstInputTokens
    ),
    inputTokens: jevReports.reduce(
      (total, report) => total + report.usage.inputTokens,
      0
    ),
    maxInputTokens: Math.max(
      0,
      ...jevReports.map((report) => report.usage.maxInputTokens)
    ),
    requests: jevReports.reduce(
      (total, report) => total + report.usage.requests,
      0
    ),
  };
  const environment = describeMeasurementEnvironment(processCount);
  const path = writeMeasurementOutput({
    json: {
      candidate: "5",
      deckCode,
      environment,
      jevModel: JEV_MODEL,
      maxUnits,
      measurement: "jev-playing-policy-win-rates",
      settingName: SETTING_LABEL,
      summaries: {
        firstPlayer: summarizeTally(tally.firstPlayer),
        secondPlayer: summarizeTally(tally.secondPlayer),
      },
      tally,
      usage,
      wallMilliseconds,
    },
    markdown: [
      formatDeckMeasurementMarkdown({
        candidate: "5",
        environment,
        preparationSeconds: undefined,
        settingLabel: `${SETTING_LABEL}(${JEV_MODEL})`,
        tally,
        title: `候補 5(Jev)の勝率の計測(デッキ ${deckCode})`,
        trialsColumnLabel: "1 回の対戦の問い合わせの回数",
      }),
      `問い合わせ ${usage.requests} 回、入力のトークン ${usage.inputTokens}(1 回の最大 ${usage.maxInputTokens})`,
      "",
    ].join("\n"),
    measurementName: `jev-playing-policy-win-rates-${deckCode}`,
    outputDirectory,
    settingName: SETTING_LABEL,
  });
  console.log(`${deckCode}: ${path}.json`);
}

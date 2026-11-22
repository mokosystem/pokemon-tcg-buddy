/**
 * 記録済みのデッキを 1 つずつ順に先攻・後攻で回し、設定ごとの勝率と誤差の幅、サイドを取り切った番の分布、負けた理由の内訳、
 * 1 回の対戦の時間を測る(Issue 70 の決定事項「測るもの」、Issue 77 の決定事項「到達の判定の計測」)。1 単位は先攻 1 回と
 * 後攻 1 回。デッキごとの結果に加えて、設定ごとに、測ったデッキをまとめた表を書く。
 *
 * 対戦の履歴は書かない。判定用の種で回した対戦は集計の数字だけを見る決まり(Issue 77 の決定事項「到達の判定の計測」)を保つため。
 *
 * bun run measure:playing-policy-win-rates -- --setting <設定> [--setting <設定>]… [--deck <デッキコード>]…
 *   [--seeds improvement|judgment] --processes <数> [--max-minutes <分>] [--max-units <単位の数>]
 *   [--cutoff-includes-preparation] [--training-games <学習の対戦の回数>] --output <ディレクトリ>
 *
 * --deck を省くと、記録済みのデッキすべてを recorded-decks.ts の並びの順に測る。--seeds を省くと改善用の種。
 * --cutoff-includes-preparation を付けると、区切りの 0 を、そのデッキの準備(学習の対戦と学習)を始めた時刻にする。
 * --max-units を渡すと、試行 0 から決まった数までを 1 回ずつ回すので、コードを変える前と後を同じ種の同じ対戦で測れる。
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
import type { RecordedDeck } from "../src/recorded-decks.ts";
import {
  type MeasurementWorkerJob,
  type MeasurementWorkerReport,
  measureNowEpochMilliseconds,
} from "./measurement-jobs.ts";
import {
  calculateCutoff,
  type DeckMeasurementSummaryEntry,
  describeMeasurementEnvironment,
  describePreparation,
  findTrainingGames,
  formatDeckMeasurementMarkdown,
  formatDeckMeasurementSummaryMarkdown,
  formatSeedsLine,
  type LearningPreparation,
  prepareLearnedModel,
  readCommonOptions,
  readIntegerOption,
  readPositiveNumberOption,
  readRecordedDecks,
  readSeedPurpose,
  readSettingNames,
  readTrainingGamesOption,
  reserveMeasurementOutputBase,
  runMeasurementWorkers,
  summarizeTally,
  writeMeasurementOutput,
  writeMeasurementOutputAt,
} from "./measurement-process-pool.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "cutoff-includes-preparation": { type: "boolean" },
    deck: { multiple: true, type: "string" },
    "max-minutes": { type: "string" },
    "max-units": { type: "string" },
    output: { type: "string" },
    processes: { type: "string" },
    seeds: { type: "string" },
    setting: { multiple: true, type: "string" },
    "training-games": { type: "string" },
  },
  strict: true,
});

const decks = readRecordedDecks(values.deck);
const seeds = readSeedPurpose(values.seeds);
const settingNames = readSettingNames(values.setting);
const { outputDirectory, processCount } = readCommonOptions(values);
const maxMinutes = readPositiveNumberOption(
  "--max-minutes",
  values["max-minutes"]
);
const maxUnits = readIntegerOption("--max-units", values["max-units"], 1);
if (maxMinutes === undefined && maxUnits === undefined) {
  throw new Error("--max-minutes か --max-units の少なくとも一方を渡す");
}
const cutoffIncludesPreparation =
  values["cutoff-includes-preparation"] === true;
if (cutoffIncludesPreparation && maxMinutes === undefined) {
  throw new Error(
    "--cutoff-includes-preparation は --max-minutes と併せて渡す"
  );
}
const trainingGamesOverride = readTrainingGamesOption(values["training-games"]);

/** 区切りを、計測の条件の箇条書きの 1 行にする。 */
function formatCutoffLine(): string {
  if (maxMinutes === undefined) {
    return "- 区切り: 時間では区切らない";
  }
  const cutoffStart = cutoffIncludesPreparation
    ? "デッキごとの準備を始めた時刻から数え、準備の時間を含む"
    : "準備が終わって計測を始めた時刻から数え、準備の時間を含まない";
  return `- 区切り: 1 デッキ ${maxMinutes} 分(${cutoffStart})。区切りの後に終わった単位は数えない`;
}

/** 種の用途、区切り、設定が学習するときの学習の対戦の回数を、計測の条件の箇条書きの行にする。 */
function formatConditionLines(settingName: PlayingPolicySettingName): string[] {
  const trainingGames = findTrainingGames(settingName, trainingGamesOverride);
  return [
    formatSeedsLine(seeds),
    formatCutoffLine(),
    ...(maxUnits === undefined
      ? []
      : [`- 単位の数の上限: ${maxUnits}(試行 0 から順に 1 回ずつ回す)`]),
    "- 1 単位は先攻 1 回と後攻 1 回",
    ...(trainingGames === undefined
      ? []
      : [`- 学習の対戦の回数: ${trainingGames}`]),
  ];
}

async function prepare(
  settingName: PlayingPolicySettingName,
  deckCode: string
): Promise<LearningPreparation | undefined> {
  const trainingGames = findTrainingGames(settingName, trainingGamesOverride);
  return trainingGames === undefined
    ? undefined
    : await prepareLearnedModel({
        deck: { deckCode },
        modelName: `learned-model-${settingName}-${deckCode}-${trainingGames}`,
        outputDirectory,
        processCount,
        settingName,
        trainingGames,
      });
}

/** 1 デッキの計測の仕事。cutoffStartedAt は区切りの 0 にする時刻。 */
function buildMeasureDeckJob(
  settingName: PlayingPolicySettingName,
  deckCode: string,
  cutoffStartedAt: number,
  preparation: LearningPreparation | undefined
): MeasurementWorkerJob {
  return {
    baseSeeds: seeds.baseSeeds,
    cutoffsEpochMilliseconds: [calculateCutoff(cutoffStartedAt, maxMinutes)],
    deckCode,
    kind: "measureDeck",
    ...(maxUnits === undefined ? {} : { maxUnits }),
    ...(preparation === undefined
      ? {}
      : { learnedModelPath: preparation.modelPath }),
    settingName,
  };
}

/** プロセスごとの結果を、区切りまでに終わった単位の集計と、区切りの後に終わって捨てた単位の数にまとめる。 */
function mergeMeasureDeckReports(reports: readonly MeasurementWorkerReport[]): {
  readonly discardedUnits: number;
  readonly tally: DeckMeasurementTally;
} {
  const outcomes = reports.flatMap((report) =>
    report.kind === "measureDeck" ? [report.outcome] : []
  );
  return {
    discardedUnits: outcomes.reduce(
      (total, outcome) => total + outcome.discardedUnits,
      0
    ),
    tally: outcomes
      .map(
        (outcome) =>
          outcome.talliesAtCutoffs[0] ?? createEmptyDeckMeasurementTally()
      )
      .reduce(mergeDeckMeasurementTallies, createEmptyDeckMeasurementTally()),
  };
}

/** 準備の時間と記録の数を、出力に残す形にする。準備の無い設定は undefined。 */
function describePreparationOfSetting(
  settingName: PlayingPolicySettingName,
  preparation: LearningPreparation | undefined
) {
  return preparation === undefined
    ? undefined
    : {
        ...describePreparation([preparation]),
        trainingGames: findTrainingGames(settingName, trainingGamesOverride),
      };
}

/** 1 デッキの計測の結果。まとめに足す 1 行ぶんと、デッキごとのファイルのパス。 */
interface MeasuredDeck {
  readonly entry: DeckMeasurementSummaryEntry;
  readonly path: string;
  readonly wallMilliseconds: number;
}

/** 1 デッキを準備してから測り、デッキごとのファイルを書く。 */
async function measureDeck(
  settingName: PlayingPolicySettingName,
  deck: RecordedDeck
): Promise<MeasuredDeck> {
  const { deckCode } = deck;
  const preparationStartedAt = measureNowEpochMilliseconds();
  const preparation = await prepare(settingName, deckCode);
  const startedAt = measureNowEpochMilliseconds();
  const reports = await runMeasurementWorkers(
    buildMeasureDeckJob(
      settingName,
      deckCode,
      cutoffIncludesPreparation ? preparationStartedAt : startedAt,
      preparation
    ),
    processCount
  );
  const wallMilliseconds = measureNowEpochMilliseconds() - startedAt;
  const { discardedUnits, tally } = mergeMeasureDeckReports(reports);
  // 準備を始めてから計測を始めるまでの秒。準備の無い設定は持たない
  const preparationSeconds =
    preparation === undefined
      ? undefined
      : (startedAt - preparationStartedAt) / 1000;
  const environment = describeMeasurementEnvironment(processCount);
  const { candidate, parameters } = PLAYING_POLICY_SETTINGS[settingName];
  const path = writeMeasurementOutput({
    json: {
      candidate,
      cutoffIncludesPreparation,
      deckCode,
      deckName: deck.name,
      discardedUnits,
      environment,
      maxMinutes,
      maxUnits,
      measurement: "playing-policy-win-rates",
      parameters,
      preparation: describePreparationOfSetting(settingName, preparation),
      preparationSeconds,
      seeds: { baseSeeds: seeds.baseSeeds, purpose: seeds.purpose },
      settingName,
      summaries: {
        firstPlayer: summarizeTally(tally.firstPlayer),
        secondPlayer: summarizeTally(tally.secondPlayer),
      },
      tally,
      wallMilliseconds,
    },
    markdown: formatDeckMeasurementMarkdown({
      candidate,
      conditionLines: formatConditionLines(settingName),
      environment,
      preparationSeconds,
      settingLabel: settingName,
      tally,
      title: `勝率の計測 ${settingName}(${deck.name}、デッキ ${deckCode})`,
      trialsColumnLabel: "1 回の対戦の試しの回数",
    }),
    measurementName: `playing-policy-win-rates-${deckCode}`,
    outputDirectory,
    settingName,
  });
  return {
    entry: { deckCode, deckName: deck.name, preparationSeconds, tally },
    path,
    wallMilliseconds,
  };
}

/**
 * 測り終えたデッキのまとめを、決まったパスに書く(書き直す)。まとめを読めば同じ計測をやり直せるよう、対戦の結果を変える
 * 引数(種、区切り、単位の数の上限、学習の対戦の回数)をすべて書く。
 */
function writeSummaryOfFinishedDecks(options: {
  readonly environment: ReturnType<typeof describeMeasurementEnvironment>;
  readonly finished: readonly MeasuredDeck[];
  readonly settingName: PlayingPolicySettingName;
  readonly summaryBase: string;
}): void {
  const { environment, finished, settingName, summaryBase } = options;
  writeMeasurementOutputAt(summaryBase, {
    json: {
      cutoffIncludesPreparation,
      decks: finished.map(({ entry, path, wallMilliseconds }) => ({
        deckCode: entry.deckCode,
        deckName: entry.deckName,
        outputPath: `${path}.json`,
        preparationSeconds: entry.preparationSeconds,
        summaries: {
          firstPlayer: summarizeTally(entry.tally.firstPlayer),
          secondPlayer: summarizeTally(entry.tally.secondPlayer),
        },
        units: entry.tally.firstPlayer.games,
        wallMilliseconds,
      })),
      environment,
      maxMinutes,
      maxUnits,
      measurement: "playing-policy-win-rates-summary",
      requestedDeckCodes: decks.map((requested) => requested.deckCode),
      seeds: { baseSeeds: seeds.baseSeeds, purpose: seeds.purpose },
      settingName,
      trainingGames: findTrainingGames(settingName, trainingGamesOverride),
    },
    markdown: formatDeckMeasurementSummaryMarkdown({
      conditionLines: [
        ...formatConditionLines(settingName),
        `- 測り終えたデッキ: ${finished.length} / ${decks.length}`,
      ],
      entries: finished.map(({ entry }) => entry),
      environment,
      title: `勝率の計測のまとめ ${settingName}`,
    }),
  });
}

for (const settingName of settingNames) {
  // まとめのパスは、最初のデッキを始める前に 1 度だけ決める。デッキが終わるたびに同じパスへ書き直すので、計測が途中で
  // 止まっても、終わったデッキの行が残る。書くたびにパスを決めると、時刻の違う名前のまとめがデッキの数だけできてしまう
  const summaryBase = reserveMeasurementOutputBase({
    measurementName: "playing-policy-win-rates-summary",
    outputDirectory,
    settingName,
  });
  const environment = describeMeasurementEnvironment(processCount);
  const finished: MeasuredDeck[] = [];
  writeSummaryOfFinishedDecks({
    environment,
    finished,
    settingName,
    summaryBase,
  });
  for (const deck of decks) {
    // biome-ignore lint/performance/noAwaitInLoops: 計測は 1 つずつ順に回し、前の計測が終わってから次を始める(並べると互いの時間を奪い、Issue 70 の決定事項「測る条件」と Issue 77 の決定事項「到達の判定の計測」の、計測のあいだにほかの重い処理を並行させない条件を破るため)
    const measured = await measureDeck(settingName, deck);
    finished.push(measured);
    console.log(`${settingName} ${deck.deckCode}: ${measured.path}.json`);
    writeSummaryOfFinishedDecks({
      environment,
      finished,
      settingName,
      summaryBase,
    });
  }
  console.log(`${settingName} のまとめ: ${summaryBase}.md`);
}

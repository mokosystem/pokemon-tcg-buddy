/**
 * Issue 70 の計測スクリプトが共有する部分。プロセスを並べて起こして結果を集める、計測の定数、候補 4 の準備(学習)、
 * 出力のファイルと表の書き方。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "bun";
import type {
  DeckMeasurementTally,
  TurnOrderBaseSeeds,
} from "../src/battle-style-solo-play-measurement.ts";
import {
  type BattleStyleSoloPlayTally,
  calculateWilsonInterval,
  type ProportionInterval,
} from "../src/battle-style-solo-play-statistics.ts";
import {
  LEARNING_OPTIONS,
  type LearnedWinRateModel,
  listDeckCardNames,
  listWinRateFeatureNames,
  trainLearnedWinRateModel,
} from "../src/learned-win-rate-evaluation.ts";
import {
  isPlayingPolicySettingName,
  PLAYING_POLICY_SETTINGS,
  type PlayingPolicySettingName,
} from "../src/playing-policy-candidates.ts";
import type { BattleStyleSoloPlayDecisionReason } from "../src/state.ts";
import {
  buildMeasuredDeckCards,
  type LearningDeck,
  type MeasurementWorkerJob,
  type MeasurementWorkerReport,
  measureNowEpochMilliseconds,
  type TrialIndexAssignment,
} from "./measurement-jobs.ts";

/** 計測の基準の種(Issue 70 の実装計画「7.2 種」)。 */
export const MEASUREMENT_BASE_SEEDS: TurnOrderBaseSeeds = {
  firstPlayer: 20_261_201,
  secondPlayer: 20_261_202,
};

/** 候補 4 の学習用の記録の基準の種。計測で回す対戦と同じ対戦を学習に使わないため、計測と別にする。 */
const LEARNING_BASE_SEEDS: TurnOrderBaseSeeds = {
  firstPlayer: 20_261_211,
  secondPlayer: 20_261_212,
};

/** Issue 69 で記録を見直し、Issue 70 で計測する 2 デッキ。 */
export const MEASURED_DECK_CODES = [
  "RS3MMy-FuGPRu-MypM2X",
  "9gngnQ-zAMw9G-96H9nn",
] as const;

const WORKER_SCRIPT_PATH = fileURLToPath(
  new URL("./playing-policy-measurement-worker.ts", import.meta.url)
);

/** プロセスを processCount 個起こし、i 番目のプロセスに試行の番号 i、i + processCount、… を担当させ、全員の結果を集める。 */
export async function runMeasurementWorkers(
  job: MeasurementWorkerJob,
  processCount: number
): Promise<MeasurementWorkerReport[]> {
  const workers = Array.from({ length: processCount }, (_, workerIndex) => {
    const assignment: TrialIndexAssignment = {
      firstTrialIndex: workerIndex,
      trialIndexStride: processCount,
    };
    return spawn(
      [
        process.execPath,
        WORKER_SCRIPT_PATH,
        JSON.stringify({ ...job, ...assignment }),
      ],
      { stderr: "inherit", stdout: "pipe" }
    );
  });
  return await Promise.all(
    workers.map(async (worker) => {
      const [output, exitCode] = await Promise.all([
        worker.stdout.text(),
        worker.exited,
      ]);
      if (exitCode !== 0) {
        throw new Error(`計測のプロセスが終了コード ${exitCode} で止まった`);
      }
      return JSON.parse(output) as MeasurementWorkerReport;
    })
  );
}

/** 候補 4 の準備の結果と、その時間。 */
export interface LearningPreparation {
  readonly collectMilliseconds: number;
  readonly model: LearnedWinRateModel;
  readonly modelPath: string;
  readonly sampleCount: number;
  readonly trainMilliseconds: number;
}

/**
 * 候補 4 の準備。学習用の記録を processCount 個のプロセスで集め、親のプロセスで学習して、学習の結果を outputDirectory に
 * JSON で書く(子のプロセスにはパスを渡す。ファイルを読むのは scripts/ だけ)。
 */
export async function prepareLearnedModel(options: {
  readonly deck: LearningDeck;
  readonly outputDirectory: string;
  readonly fileName: string;
  readonly processCount: number;
  readonly trainingGames: number;
}): Promise<LearningPreparation> {
  const collectStartedAt = measureNowEpochMilliseconds();
  const reports = await runMeasurementWorkers(
    {
      baseSeeds: LEARNING_BASE_SEEDS,
      deck: options.deck,
      kind: "collectLearningSamples",
      trainingGames: options.trainingGames,
    },
    options.processCount
  );
  const samples = reports.flatMap((report) =>
    report.kind === "collectLearningSamples" ? report.samples : []
  );
  const trainStartedAt = measureNowEpochMilliseconds();
  const model = trainLearnedWinRateModel(
    listWinRateFeatureNames(
      listDeckCardNames(buildMeasuredDeckCards(options.deck))
    ),
    samples,
    LEARNING_OPTIONS
  );
  const trainFinishedAt = measureNowEpochMilliseconds();
  mkdirSync(options.outputDirectory, { recursive: true });
  const modelPath = join(options.outputDirectory, options.fileName);
  writeFileSync(modelPath, `${JSON.stringify(model)}\n`);
  return {
    collectMilliseconds: trainStartedAt - collectStartedAt,
    model,
    modelPath,
    sampleCount: samples.length,
    trainMilliseconds: trainFinishedAt - trainStartedAt,
  };
}

/** 計測の条件として結果に添えるもの(Issue 70 の決定事項「測る条件」の 4 つ目)。 */
export function describeMeasurementEnvironment(processCount: number) {
  const cpus = os.cpus();
  const commit = spawnSync(["git", "rev-parse", "HEAD"])
    .stdout.toString()
    .trim();
  return {
    bunVersion: process.versions.bun,
    commit,
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model ?? "",
    measuredAt: new Date().toISOString(),
    processCount,
  };
}

/** 出力のファイル名の先頭(<YYYYMMDD-HHMM>)。 */
function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** 計測ごとに <YYYYMMDD-HHMM>-<計測の名前>-<設定の名前>.json と同じ名前の .md を書き、書いたパスを返す。 */
export function writeMeasurementOutput(options: {
  readonly outputDirectory: string;
  readonly measurementName: string;
  readonly settingName: string;
  readonly json: unknown;
  readonly markdown: string;
}): string {
  mkdirSync(options.outputDirectory, { recursive: true });
  const base = join(
    options.outputDirectory,
    `${formatTimestamp(new Date())}-${options.measurementName}-${options.settingName}`
  );
  writeFileSync(
    `${base}.json`,
    `${JSON.stringify(options.json, undefined, 2)}\n`
  );
  writeFileSync(`${base}.md`, options.markdown);
  return base;
}

/** 割合を百分率の小数 1 桁で書く。 */
function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

/** 割合と区間を「12.3 %(10.1〜14.8)」の形で書く。区間が無ければ「—(回数 0)」。 */
export function formatProportion(
  interval: ProportionInterval | undefined
): string {
  if (interval === undefined) {
    return "—(回数 0)";
  }
  return `${formatPercent(interval.value)}(${(interval.lower * 100).toFixed(1)}〜${(interval.upper * 100).toFixed(1)})`;
}

function formatSignedPoints(value: number): string {
  const points = (value * 100).toFixed(1);
  return value >= 0 ? `+${points}` : points;
}

/** 差と区間を「+2.1 pt(-0.4〜+4.6)」の形で書く。区間が無ければ「—(回数 0)」。 */
export function formatDifference(
  interval: ProportionInterval | undefined
): string {
  if (interval === undefined) {
    return "—(回数 0)";
  }
  return `${formatSignedPoints(interval.value)} pt(${formatSignedPoints(interval.lower)}〜${formatSignedPoints(interval.upper)})`;
}

/** ミリ秒を有効数字 3 桁で書く。 */
function formatMilliseconds(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(3)).toString() : "—";
}

/** 表の 1 行。 */
export function formatTableRow(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/** 表の見出しと区切りの行。 */
export function formatTableHeader(cells: readonly string[]): string {
  return `${formatTableRow(cells)}\n${formatTableRow(cells.map(() => "---"))}`;
}

/** 計測の条件を、表の上に書く箇条書きにする。 */
export function formatEnvironmentLines(
  environment: ReturnType<typeof describeMeasurementEnvironment>
): string {
  return [
    `- 計測した日時: ${environment.measuredAt}`,
    `- コミット: ${environment.commit}`,
    `- Bun: ${environment.bunVersion}`,
    `- 並べたプロセスの数: ${environment.processCount}`,
    `- CPU: ${environment.cpuModel}(${environment.cpuCount} 個)`,
  ].join("\n");
}

/** 1 本の集計から、表に載せる数字(勝率と区間、負けた理由と取り切った番の割合、1 回の対戦の平均)を求める。 */
export function summarizeTally(tally: BattleStyleSoloPlayTally) {
  const share = (count: number) =>
    tally.games === 0 ? undefined : count / tally.games;
  return {
    decisionReasonShares: Object.fromEntries(
      Object.entries(tally.decisionReasonCounts).map(([reason, count]) => [
        reason,
        share(count),
      ])
    ),
    games: tally.games,
    meanClonesPerGame: share(tally.totalClones),
    meanGameMilliseconds: share(tally.totalGameMilliseconds),
    meanTrialScoresPerGame: share(tally.totalTrialScores),
    winningTurnShares: Object.fromEntries(
      Object.entries(tally.winningTurnCounts).map(([turn, count]) => [
        turn,
        share(count),
      ])
    ),
    winRate: calculateWilsonInterval(tally.wins, tally.games),
    wins: tally.wins,
  };
}

/** 共通の引数のうち、プロセスの数(既定は CPU の数)と出力のディレクトリ(必ず渡す)を読む。 */
export function readCommonOptions(values: {
  readonly output?: string | undefined;
  readonly processes?: string | undefined;
}): { readonly outputDirectory: string; readonly processCount: number } {
  if (values.output === undefined) {
    throw new Error("--output に出力のディレクトリを渡す");
  }
  return {
    outputDirectory: values.output,
    processCount:
      values.processes === undefined
        ? navigator.hardwareConcurrency
        : Number(values.processes),
  };
}

/** --setting に渡された名前を、設定の名前として読む。 */
export function readSettingNames(
  values: readonly string[] | undefined
): PlayingPolicySettingName[] {
  if (values === undefined || values.length === 0) {
    throw new Error("--setting に設定の名前を 1 つ以上渡す");
  }
  return values.map((name) => {
    if (!isPlayingPolicySettingName(name)) {
      throw new Error(`設定の名前 ${name} は無い`);
    }
    return name;
  });
}

/** 勝敗が決まった理由の表の見出し。 */
export const DECISION_REASON_HEADINGS: Readonly<
  Record<BattleStyleSoloPlayDecisionReason, string>
> = {
  cannotDrawAtTurnStart: "山札を引けなかった",
  noOwnPokemonInPlay: "場に自分のポケモンがいなくなった",
  opponentPrizesTaken: "相手がサイドを取り切った",
  ownPrizesTaken: "自分がサイドを取り切った(勝ち)",
};

/**
 * 期限の時刻。JSON に Infinity を書けない(null になる)ため、期限の無い計測は Number.MAX_SAFE_INTEGER を期限にする。
 */
export function calculateCutoff(
  startedAt: number,
  minutes: number | undefined
) {
  return minutes === undefined
    ? Number.MAX_SAFE_INTEGER
    : startedAt + minutes * 60_000;
}

/** 候補 4 の設定なら、学習の対戦の回数を返す(override があればそれ)。学習が要らない設定は undefined。 */
export function findTrainingGames(
  settingName: PlayingPolicySettingName,
  override: number | undefined
): number | undefined {
  const { trainingGamesPerDeck } =
    PLAYING_POLICY_SETTINGS[settingName].parameters;
  return trainingGamesPerDeck === undefined
    ? undefined
    : (override ?? trainingGamesPerDeck);
}

/** 準備の時間と記録の数を、出力に残す形にする。 */
export function describePreparation(
  preparations: readonly LearningPreparation[]
) {
  return {
    collectMilliseconds: preparations.reduce(
      (total, preparation) => total + preparation.collectMilliseconds,
      0
    ),
    modelPaths: preparations.map((preparation) => preparation.modelPath),
    sampleCounts: preparations.map((preparation) => preparation.sampleCount),
    trainMilliseconds: preparations.reduce(
      (total, preparation) => total + preparation.trainMilliseconds,
      0
    ),
  };
}

/** --setting に渡された 1 つの名前を、設定の名前として読む。 */
export function readOneSettingName(
  value: string | undefined
): PlayingPolicySettingName {
  const [name] = readSettingNames(value === undefined ? undefined : [value]);
  if (name === undefined) {
    throw new Error("--setting に設定の名前を渡す");
  }
  return name;
}

/** 1 デッキの計測(先攻と後攻)の結果を、設計文書に貼る表にする。 */
export function formatDeckMeasurementMarkdown(options: {
  readonly candidate: string;
  readonly environment: ReturnType<typeof describeMeasurementEnvironment>;
  /** 候補 4 の準備の時間(秒)。準備の無い設定は undefined。 */
  readonly preparationSeconds: number | undefined;
  readonly settingLabel: string;
  readonly tally: DeckMeasurementTally;
  readonly title: string;
  /** 1 回の対戦あたりの試しの回数の列の見出し(候補 5 では問い合わせの回数)。 */
  readonly trialsColumnLabel: string;
}): string {
  const { environment, tally } = options;
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
    `# ${options.title}`,
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
      options.trialsColumnLabel,
      "準備の時間(秒)",
    ]),
    formatTableRow([
      options.settingLabel,
      options.candidate,
      formatProportion(first.winRate),
      formatProportion(second.winRate),
      `${first.games} / ${second.games}`,
      formatMilliseconds(meanOf((side) => side.totalGameMilliseconds)),
      formatMilliseconds(meanOf((side) => side.totalTrialScores)),
      options.preparationSeconds === undefined
        ? "—"
        : options.preparationSeconds.toFixed(1),
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

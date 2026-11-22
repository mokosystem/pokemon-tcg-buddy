/**
 * 計測のスクリプトが共有する部分(Issue 70、Issue 77)。プロセスを並べて起こして結果を集める、計測の定数(種)、引数の読み取り、
 * 候補 4 の準備(学習)、出力のファイルと表の書き方。
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
import { RECORDED_DECKS, type RecordedDeck } from "../src/recorded-decks.ts";
import type { BattleStyleSoloPlayDecisionReason } from "../src/state.ts";
import {
  buildMeasuredDeckCards,
  type LearningDeck,
  type MeasurementWorkerJob,
  type MeasurementWorkerReport,
  measureNowEpochMilliseconds,
  type TrialIndexAssignment,
} from "./measurement-jobs.ts";

/**
 * 改善用の種(GLOSSARY.md)の基準の種。Issue 70 の計測と同じ値。プレイングの判断基準を直すために履歴を読んでよいのは、
 * この種で回した対戦だけである(Issue 77 の決定事項「改善の 1 回」)。
 */
export const MEASUREMENT_BASE_SEEDS: TurnOrderBaseSeeds = {
  firstPlayer: 20_261_201,
  secondPlayer: 20_261_202,
};

/**
 * 判定用の種(GLOSSARY.md)の基準の種(Issue 77 の決定事項「到達の判定の計測」)。この種で回した対戦は集計の数字だけを見て、
 * 個々の対戦の履歴は読まない。履歴を書くスクリプト(print-playing-policy-game-histories.ts)からは選べないようにしてある。
 */
const JUDGMENT_BASE_SEEDS: TurnOrderBaseSeeds = {
  firstPlayer: 20_261_221,
  secondPlayer: 20_261_222,
};

/**
 * 候補 4 の学習用の記録の基準の種。計測で回す対戦と同じ対戦を学習に使わないため、計測と別にする。準備が乱数を使うときは
 * 判定用の種とも改善用の種とも違う基準の種を使う、という Issue 77 の決定事項「到達の判定の計測」も、この値で満たしている。
 */
const LEARNING_BASE_SEEDS: TurnOrderBaseSeeds = {
  firstPlayer: 20_261_211,
  secondPlayer: 20_261_212,
};

const SEED_PURPOSES = {
  improvement: { baseSeeds: MEASUREMENT_BASE_SEEDS, label: "改善用の種" },
  judgment: { baseSeeds: JUDGMENT_BASE_SEEDS, label: "判定用の種" },
} as const;

/** 計測に使う種の用途と、その基準の種。 */
export interface MeasurementSeeds {
  readonly baseSeeds: TurnOrderBaseSeeds;
  readonly label: string;
  readonly purpose: keyof typeof SEED_PURPOSES;
}

/** --seeds に渡された値(improvement か judgment。省くと improvement)を、種の用途と基準の種として読む。 */
export function readSeedPurpose(value: string | undefined): MeasurementSeeds {
  const purpose = value ?? "improvement";
  if (purpose !== "improvement" && purpose !== "judgment") {
    throw new Error(
      `--seeds には improvement か judgment を渡す(${purpose} は無い)`
    );
  }
  return { ...SEED_PURPOSES[purpose], purpose };
}

/** 種の用途と基準の種を、計測の条件の箇条書きの 1 行にする。 */
export function formatSeedsLine(seeds: MeasurementSeeds): string {
  return `- 種: ${seeds.label}(基準の種は先攻 ${seeds.baseSeeds.firstPlayer}、後攻 ${seeds.baseSeeds.secondPlayer})`;
}

/**
 * --deck に渡されたデッキコード(何回でも渡せる)を、渡した順の記録済みのデッキとして読む。省くと、記録済みのデッキすべてを
 * recorded-decks.ts の並びの順に返す。記録済みのデッキに無いデッキコードは、プロセスを起こす前に分かるよう、ここで例外を投げる。
 */
export function readRecordedDecks(
  values: readonly string[] | undefined
): readonly RecordedDeck[] {
  if (values === undefined || values.length === 0) {
    return RECORDED_DECKS;
  }
  return values.map((deckCode) => {
    const deck = RECORDED_DECKS.find(
      (candidate) => candidate.deckCode === deckCode
    );
    if (deck === undefined) {
      throw new Error(`記録済みのデッキに ${deckCode} が無い`);
    }
    return deck;
  });
}

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
 *
 * 学習の結果のファイルは <YYYYMMDD-HHMMSS>-<modelName>.json で、既にあるファイルは上書きしない。計測の結果は使った学習の
 * 結果のパスを持つので、同じ出力のディレクトリで後から学習し直しても、前の計測が指すファイルの中身が変わらないようにする。
 */
export async function prepareLearnedModel(options: {
  readonly deck: LearningDeck;
  readonly outputDirectory: string;
  /** 学習の結果のファイルの名前のうち、時刻と拡張子を除いた部分。 */
  readonly modelName: string;
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
  const modelPath = `${reserveTimestampedJsonBase(options.outputDirectory, options.modelName, new Date())}.json`;
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

/** 出力のファイル名の先頭(<YYYYMMDD-HHMMSS>)。 */
function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * <ディレクトリ>/<YYYYMMDD-HHMMSS>-<名前> というパス(拡張子を除いた部分)を now の時刻で決め、その名前の空の .json を作って、
 * 後から名前を決める実行が同じパスを選ばないようにする。同じ名前の .json が既にあれば、末尾に -2、-3、… を付けた、
 * まだ無い名前にする。
 *
 * 既にある名前のときに例外を投げて止めないのは、名前を決めるのが計測や学習を終えた後で、止めると終えた結果を捨てることになるため。
 */
function reserveTimestampedJsonBase(
  directory: string,
  name: string,
  now: Date
): string {
  mkdirSync(directory, { recursive: true });
  const timestampedName = `${formatTimestamp(now)}-${name}`;
  for (let ordinal = 1; ; ordinal += 1) {
    const base = join(
      directory,
      ordinal === 1 ? timestampedName : `${timestampedName}-${ordinal}`
    );
    try {
      // 「無ければ作る」を 1 回の操作にする(flag の wx)。あるかを調べてから作ると、調べてから作るまでのあいだに、ほかの実行が
      // 同じ名前を作りうる
      writeFileSync(`${base}.json`, "", { flag: "wx" });
      return base;
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      ) {
        throw error;
      }
    }
  }
}

/**
 * 計測の出力のパスのうち拡張子を除いた部分(<出力のディレクトリ>/<YYYYMMDD-HHMMSS>-<計測の名前>-<設定の名前>)を now の時刻で
 * 決めて、ほかの実行が同じパスを選ばないようにする(reserveTimestampedJsonBase)。
 */
export function reserveMeasurementOutputBase(
  options: {
    readonly outputDirectory: string;
    readonly measurementName: string;
    readonly settingName: string;
  },
  now: Date = new Date()
): string {
  return reserveTimestampedJsonBase(
    options.outputDirectory,
    `${options.measurementName}-${options.settingName}`,
    now
  );
}

/**
 * 決まったパス(reserveMeasurementOutputBase の結果)に .json と .md を書く。同じパスに何度も書けば上書きになる。途中まで
 * 終わった分で書き直していく出力(複数のデッキのまとめ)は、パスを 1 度だけ決めてからこの関数で書く。
 */
export function writeMeasurementOutputAt(
  base: string,
  output: { readonly json: unknown; readonly markdown: string }
): void {
  writeFileSync(
    `${base}.json`,
    `${JSON.stringify(output.json, undefined, 2)}\n`
  );
  writeFileSync(`${base}.md`, output.markdown);
}

/**
 * 計測ごとに <YYYYMMDD-HHMMSS>-<計測の名前>-<設定の名前>.json と同じ名前の .md を書き、書いたパス(拡張子を除く)を返す。
 * 既にあるファイルは上書きせず、別の名前で書く(reserveMeasurementOutputBase)。
 */
export function writeMeasurementOutput(options: {
  readonly outputDirectory: string;
  readonly measurementName: string;
  readonly settingName: string;
  readonly json: unknown;
  readonly markdown: string;
}): string {
  const base = reserveMeasurementOutputBase(options);
  writeMeasurementOutputAt(base, options);
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

/**
 * 引数に渡された文字列を数として読む。数として読めない文字列(「15m」など)は例外にする。Number は読めない文字列を NaN に、
 * 空の文字列を 0 にして返すだけで、そのまま計測に渡すと、区切りの時刻が NaN になって対戦を 1 回も回さない計測が、
 * 正常に終わった結果として書かれるため。
 */
function parseOptionAsNumber(name: string, value: string): number {
  const parsed = value.trim() === "" ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} には数を渡す(「${value}」は数として読めない)`);
  }
  return parsed;
}

/** 引数に渡された文字列を、0 より大きい数として読む(小数も読む)。省かれた引数は undefined。 */
export function readPositiveNumberOption(
  name: string,
  value: string | undefined
): number | undefined {
  if (value === undefined) {
    return;
  }
  const parsed = parseOptionAsNumber(name, value);
  if (parsed <= 0) {
    throw new Error(`${name} には 0 より大きい数を渡す(${value} は渡せない)`);
  }
  return parsed;
}

/** 引数に渡された文字列を、minimum 以上の整数として読む。省かれた引数は undefined。 */
export function readIntegerOption(
  name: string,
  value: string | undefined,
  minimum: number
): number | undefined {
  if (value === undefined) {
    return;
  }
  const parsed = parseOptionAsNumber(name, value);
  if (!(Number.isInteger(parsed) && parsed >= minimum)) {
    throw new Error(
      `${name} には ${minimum} 以上の整数を渡す(${value} は渡せない)`
    );
  }
  return parsed;
}

/**
 * --training-games に渡された値を、学習の対戦の回数として読む。2 以上の偶数だけを受け付ける。学習の対戦は先攻と後攻を
 * 渡した回数の半分ずつ回すので、奇数を受け付けると、回した対戦が渡した回数より 1 回少ないのに、出力には渡した回数が残る。
 */
export function readTrainingGamesOption(
  value: string | undefined
): number | undefined {
  const trainingGames = readIntegerOption("--training-games", value, 2);
  if (trainingGames !== undefined && trainingGames % 2 !== 0) {
    throw new Error(
      `--training-games には 2 以上の偶数を渡す(${value} は渡せない)`
    );
  }
  return trainingGames;
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
      readIntegerOption("--processes", values.processes, 1) ??
      navigator.hardwareConcurrency,
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
  /** 計測の条件の箇条書きに足す行(種の用途、区切りなど)。 */
  readonly conditionLines?: readonly string[];
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
    ...(options.conditionLines ?? []),
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

/** 複数のデッキのまとめの 1 行ぶん。1 デッキの計測(先攻と後攻)の結果。 */
export interface DeckMeasurementSummaryEntry {
  readonly deckCode: string;
  readonly deckName: string;
  /** 準備を始めてから計測を始めるまでの秒。準備の無い設定は undefined。 */
  readonly preparationSeconds: number | undefined;
  readonly tally: DeckMeasurementTally;
}

/**
 * 複数のデッキの計測の結果を、設計文書に貼る 2 つの表(勝率と、負けた理由の内訳)にまとめる。勝率の表はデッキごとに 1 行、
 * 負けた理由の表はデッキごとに先攻と後攻の 2 行。「回せた単位」は区切りまでに終わった単位の数(先攻の対戦の数と同じ)。
 */
export function formatDeckMeasurementSummaryMarkdown(options: {
  readonly conditionLines: readonly string[];
  readonly entries: readonly DeckMeasurementSummaryEntry[];
  readonly environment: ReturnType<typeof describeMeasurementEnvironment>;
  readonly title: string;
}): string {
  const lossReasons: readonly BattleStyleSoloPlayDecisionReason[] = [
    "opponentPrizesTaken",
    "noOwnPokemonInPlay",
    "cannotDrawAtTurnStart",
  ];
  return [
    `# ${options.title}`,
    "",
    formatEnvironmentLines(options.environment),
    ...options.conditionLines,
    "",
    formatTableHeader([
      "デッキ",
      "デッキコード",
      "先攻 勝率",
      "後攻 勝率",
      "回せた単位",
      "準備の時間(秒)",
      "1 回の対戦の時間(ms)",
    ]),
    ...options.entries.map(
      ({ deckCode, deckName, preparationSeconds, tally }) => {
        const games = tally.firstPlayer.games + tally.secondPlayer.games;
        return formatTableRow([
          deckName,
          `\`${deckCode}\``,
          formatProportion(summarizeTally(tally.firstPlayer).winRate),
          formatProportion(summarizeTally(tally.secondPlayer).winRate),
          String(tally.firstPlayer.games),
          preparationSeconds === undefined
            ? "—"
            : preparationSeconds.toFixed(1),
          formatMilliseconds(
            games === 0
              ? Number.NaN
              : (tally.firstPlayer.totalGameMilliseconds +
                  tally.secondPlayer.totalGameMilliseconds) /
                  games
          ),
        ]);
      }
    ),
    "",
    "負けた理由の内訳(すべての対戦に対する割合)",
    "",
    formatTableHeader([
      "デッキ",
      "先攻・後攻",
      ...lossReasons.map((reason) => DECISION_REASON_HEADINGS[reason]),
    ]),
    ...options.entries.flatMap(({ deckName, tally }) =>
      (
        [
          ["先攻", tally.firstPlayer],
          ["後攻", tally.secondPlayer],
        ] as const
      ).map(([label, side]) =>
        formatTableRow([
          deckName,
          label,
          ...lossReasons.map((reason) =>
            side.games === 0
              ? "—"
              : formatPercent(side.decisionReasonCounts[reason] / side.games)
          ),
        ])
      )
    ),
    "",
  ].join("\n");
}

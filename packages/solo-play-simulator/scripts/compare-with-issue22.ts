/**
 * #22 の 4 デッキを探索(道の揃い具合を見る評価)で回し、狙いごとの成立率を #22 の規則ファイルの成立率と比べる
 * (Issue 27 の順 8、答え合わせ)。乱数の種は 20260917(#22 の検証の記録と同じ)。パッケージのディレクトリで次のように
 * 実行する(デッキの名前、先攻・後攻それぞれの試行回数、履歴を出す狙いの名前の一部・番・件数)。
 *
 *   bun run compare:issue22-rates mega-charizard 20000
 *   bun run compare:issue22-rates dragapult 2000 ファントムダイブ 3 5
 *
 * 失敗の要因の内訳は、宣言から導いた狙いのもの(主軸が場にいないときは、宣言の道のうちいちばん揃っている道の
 * 足りないカードと置き場所。declaration.ts の explainPathShortfall)。
 */

import { cardRecordTable } from "../src/card-record-table.ts";
import type { Card } from "../src/cards.ts";
import {
  type ResolvedDeclaration,
  resolveDeclaration,
} from "../src/declaration.ts";
import {
  buildDeck,
  type GameResult,
  type Goal,
  type PlayingPolicy,
  runGame,
} from "../src/engine.ts";
import { ISSUE22_DECKS } from "../src/issue22-decks.ts";
import { createSeededRandom } from "../src/random.ts";
import { createPathProgressEvaluator } from "../src/search-evaluators.ts";
import { createSearchPolicy } from "../src/search-policy.ts";
import {
  formatPercent,
  formatSummary,
  SimulationSummary,
} from "../src/simulate.ts";
import {
  ISSUE22_COMPARISON_TARGETS,
  type Issue22Rate,
} from "./issue22-comparison-targets.ts";
import { SAMPLES_FOR_UNCERTAIN_OUTCOME } from "./search-evaluator-choices.ts";

const SEED = 20_260_917;
const SEARCH_SEED = 1;
/** 2 万回のときの割合の揺れ(95 % の範囲、ポイント)。答え合わせの基準(Issue 27 の決定事項)。 */
const TOLERANCE_POINTS = 0.7;

// ---- 対戦の履歴 ----

function listNames(names: readonly Card[]): string {
  return names.map((card) => card.name).join("、");
}

/**
 * 履歴を読むときのため、番の行動の前に手札を、最初の番にはサイドの中身も履歴に書く。履歴に書くだけで、選ぶ手と
 * 乱数の進み方は変えない。
 */
function withHandRecords(policy: PlayingPolicy): PlayingPolicy {
  return {
    ...policy,
    playTurn: (context) => {
      const { state } = context;
      if (state.turn === 1) {
        state.record(`(サイド: ${listNames(state.prizes)})`);
      }
      state.record(`(手札: ${listNames(state.hand)})`);
      policy.playTurn(context);
    },
  };
}

interface TraceRequest {
  readonly count: number;
  readonly goalPart: string;
  readonly turn: number;
}

function parseTraceRequest(argv: readonly string[]): TraceRequest | null {
  const [goalPart, turn, count] = argv;
  if (goalPart === undefined) {
    return null;
  }
  return { count: Number(count ?? "3"), goalPart, turn: Number(turn ?? "3") };
}

/** 狙いが turn の番までに成立しなかったか。 */
function hasFailedByTurn(
  result: GameResult,
  goalName: string,
  turn: number
): boolean {
  const firstTurn = result.goalFirstTurn.get(goalName);
  return firstTurn === null || (firstTurn !== undefined && firstTurn > turn);
}

/** 履歴を出す狙いが、指定の番までに成立しなかった対戦なら、その履歴の行を返す。 */
function formatTraceIfFailed(
  result: GameResult,
  goals: readonly Goal[],
  request: TraceRequest,
  trial: number
): string[] | null {
  const tracedGoal = goals.find((goal) => goal.name.includes(request.goalPart));
  if (
    tracedGoal === undefined ||
    !hasFailedByTurn(result, tracedGoal.name, request.turn)
  ) {
    return null;
  }
  return [
    `#### 試行 ${trial}(${tracedGoal.name} が ${request.turn} 番目の番までに成立しなかった)`,
    "",
    ...result.events.map((event) => `    ${event}`),
    "",
  ];
}

/** 履歴を求められていて件数に余裕があれば、成立しなかった対戦の履歴を traces に足す。 */
function collectTrace(
  traces: string[][],
  result: GameResult,
  goals: readonly Goal[],
  request: TraceRequest | null,
  trial: number
): void {
  if (request === null || traces.length >= request.count) {
    return;
  }
  const trace = formatTraceIfFailed(result, goals, request, trial);
  if (trace !== null) {
    traces.push(trace);
  }
}

// ---- 比較の表 ----

function formatPoints(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatComparison(
  rates: readonly Issue22Rate[],
  firstSummary: SimulationSummary,
  secondSummary: SimulationSummary
): string {
  const lines = [
    "| 狙い | 番 | 探索(先攻) | #22(先攻) | 差 | 探索(後攻) | #22(後攻) | 差 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const rate of rates) {
    const cells = (
      [
        [firstSummary, rate.firstPercent],
        [secondSummary, rate.secondPercent],
      ] as const
    ).map(([summary, expected]) => {
      const actual = summary.rate(rate.goal, rate.turn) * 100;
      const difference = actual - expected;
      const mark = Math.abs(difference) <= TOLERANCE_POINTS ? "" : " ※";
      return `${actual.toFixed(1)} % | ${expected.toFixed(1)} % | ${formatPoints(difference)}${mark}`;
    });
    lines.push(
      `| ${rate.goal} | ${rate.turn}${rate.isDeadline ? "(締め切り)" : ""} | ${cells.join(" | ")} |`
    );
  }
  lines.push(
    "",
    `※ は差が ±${TOLERANCE_POINTS} ポイント(2 万回の揺れ)を超えたもの。`
  );
  return lines.join("\n");
}

// ---- 実行 ----

interface SideOptions {
  readonly deckCards: readonly Card[];
  readonly goals: readonly Goal[];
  readonly resolved: ResolvedDeclaration;
  readonly traceRequest: TraceRequest | null;
  readonly trials: number;
  readonly wentFirst: boolean;
}

/** 先攻か後攻の一方を trials 回回して集計を出力し、集計を返す。 */
function runSide(options: SideOptions): SimulationSummary {
  const { goals, resolved, traceRequest, trials, wentFirst } = options;
  const policy = createSearchPolicy(
    resolved,
    createPathProgressEvaluator(resolved),
    {
      samplesForUncertainOutcome: SAMPLES_FOR_UNCERTAIN_OUTCOME,
      searchesEffectChoices: true,
      seed: SEARCH_SEED,
    }
  );
  const playingPolicy =
    traceRequest === null ? policy : withHandRecords(policy);
  const random = createSeededRandom(SEED);
  const maxTurn = Math.max(...resolved.deadlines);
  const summary = new SimulationSummary(
    trials,
    wentFirst,
    maxTurn,
    goals.map((goal) => goal.name)
  );
  const traces: string[][] = [];
  const started = performance.now();
  for (let trial = 1; trial <= trials; trial += 1) {
    const result = runGame({
      cards: options.deckCards,
      goals,
      maxTurn,
      policy: playingPolicy,
      random,
      wentFirst,
    });
    summary.tallyGame(result);
    collectTrace(traces, result, goals, traceRequest, trial);
  }
  const seconds = (performance.now() - started) / 1000;
  console.log(
    formatSummary(
      summary,
      goals.flatMap((goal) =>
        resolved.deadlines.map((turn) => ({ goal: goal.name, turn }))
      )
    )
  );
  console.log(
    `所要時間 ${seconds.toFixed(1)} 秒、引き直し ${formatPercent(summary.mulliganGames / trials)}\n`
  );
  for (const trace of traces) {
    console.log(trace.join("\n"));
  }
  return summary;
}

/** デッキの名前から、答え合わせの相手と 60 枚の内容を引く。 */
function findComparisonTarget(deckName: string) {
  const target = ISSUE22_COMPARISON_TARGETS[deckName];
  if (target === undefined) {
    throw new Error(
      `デッキの名前を渡す(${Object.keys(ISSUE22_COMPARISON_TARGETS).join("、")})`
    );
  }
  const deck = ISSUE22_DECKS.find(
    (entry) => entry.deckCode === target.deckCode
  );
  if (deck === undefined) {
    throw new Error(`デッキ ${target.deckCode} が無い`);
  }
  return { deck, target };
}

function main(argv: readonly string[]): void {
  const { deck, target } = findComparisonTarget(argv[0] ?? "");
  const trials = Number(argv[1] ?? "20000");
  const resolved = resolveDeclaration(target.declaration, cardRecordTable);
  const sideOptions = {
    deckCards: buildDeck(cardRecordTable, deck.decklist),
    goals: [...target.measuredGoals, ...resolved.goals],
    resolved,
    traceRequest: parseTraceRequest(argv.slice(2)),
    trials,
  };
  console.log(
    `## ${deck.name}(${deck.deckCode})、道の揃い具合を見る評価、先攻・後攻 ${trials} 回ずつ(乱数の種 ${SEED})\n`
  );
  const firstSummary = runSide({ ...sideOptions, wentFirst: true });
  const secondSummary = runSide({ ...sideOptions, wentFirst: false });
  console.log("### #22 の規則ファイルとの比較\n");
  console.log(formatComparison(target.rates, firstSummary, secondSummary));
}

main(process.argv.slice(2));

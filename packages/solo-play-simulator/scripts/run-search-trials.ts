/**
 * 探索(道の揃い具合を見る評価)で先攻か後攻を回し、集計と、求められていれば成立しなかった対戦の履歴を出す。#22 との
 * 答え合わせ(compare-with-issue22.ts)と変更案の比較(compare-variants-with-issue22.ts)が同じ乱数の種と探索の設定で
 * 回すため、ここにまとめる。
 */

import { cardRecordTable } from "../src/card-record-table.ts";
import type { Card } from "../src/cards.ts";
import type { ResolvedDeclaration } from "../src/declaration.ts";
import {
  buildDeck,
  type GameResult,
  type Goal,
  type PlayingPolicy,
  runGame,
} from "../src/engine.ts";
import type { RecordedDeck } from "../src/issue22-decks.ts";
import { createSeededRandom } from "../src/random.ts";
import { createPathProgressEvaluator } from "../src/search-evaluators.ts";
import { createSearchPolicy } from "../src/search-policy.ts";
import {
  type Deadline,
  formatPercent,
  formatSummary,
  SimulationSummary,
} from "../src/simulate.ts";
import { SAMPLES_FOR_UNCERTAIN_OUTCOME } from "./search-evaluator-choices.ts";

/** 対戦の乱数の種。#22 の検証の記録と同じ。 */
export const SEED = 20_260_917;
/** 探索の乱数の種。 */
const SEARCH_SEED = 1;

/** ポイントの差を符号付きで書く。 */
export function formatPoints(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

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

/** 道具の引数のデッキの名前 deckName で targets を引く。無ければ、渡せる名前を添えて投げる。 */
export function findDeckTargetByName<Target>(
  targets: Readonly<Record<string, Target>>,
  deckName: string
): Target {
  const target = targets[deckName];
  if (target === undefined) {
    throw new Error(`デッキの名前を渡す(${Object.keys(targets).join("、")})`);
  }
  return target;
}

export interface TraceRequest {
  readonly count: number;
  readonly goalPart: string;
  readonly turn: number;
}

export function parseTraceRequest(
  argv: readonly string[]
): TraceRequest | undefined {
  const [goalPart, turn, count] = argv;
  if (goalPart === undefined) {
    return undefined;
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
  return firstTurn === undefined || firstTurn > turn;
}

/** 履歴を出す狙いが、指定の番までに成立しなかった対戦なら、その履歴の行を返す。 */
function formatTraceIfFailed(
  result: GameResult,
  goals: readonly Goal[],
  request: TraceRequest,
  trial: number
): string[] | undefined {
  const tracedGoal = goals.find((goal) => goal.name.includes(request.goalPart));
  if (
    tracedGoal === undefined ||
    !hasFailedByTurn(result, tracedGoal.name, request.turn)
  ) {
    return undefined;
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
  request: TraceRequest | undefined,
  trial: number
): void {
  if (request === undefined || traces.length >= request.count) {
    return;
  }
  const trace = formatTraceIfFailed(result, goals, request, trial);
  if (trace !== undefined) {
    traces.push(trace);
  }
}

// ---- 実行 ----

/**
 * 答え合わせの探索。道の揃い具合を見る評価、混ぜ直しを変えて試す回数 4、効果の中の選択は候補を試す、探索の乱数の種 1
 * (docs/solo-play-simulator-design.md「答え合わせ(Issue 27 の順 8)」の「回し方」)。探索は自分の乱数を持つため、
 * 先攻・後攻や変更案ごとに作り直す。
 */
export function createTrialSearchPolicy(
  resolved: ResolvedDeclaration
): PlayingPolicy {
  return createSearchPolicy(resolved, createPathProgressEvaluator(resolved), {
    samplesForUncertainOutcome: SAMPLES_FOR_UNCERTAIN_OUTCOME,
    searchesEffectChoices: true,
    seed: SEARCH_SEED,
  });
}

export interface SearchTrialSideOptions {
  readonly deckCards: readonly Card[];
  readonly goals: readonly Goal[];
  readonly resolved: ResolvedDeclaration;
  /** 集計の表に出す狙いと番。 */
  readonly summaryDeadlines: readonly Deadline[];
  readonly traceRequest: TraceRequest | undefined;
  readonly trials: number;
  readonly wentFirst: boolean;
}

/** 先攻か後攻の一方を trials 回回して集計を出力し、集計を返す。 */
function runSearchTrialsOfSide(
  options: SearchTrialSideOptions
): SimulationSummary {
  const { goals, resolved, traceRequest, trials, wentFirst } = options;
  const policy = createTrialSearchPolicy(resolved);
  const playingPolicy =
    traceRequest === undefined ? policy : withHandRecords(policy);
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
  console.log(formatSummary(summary, options.summaryDeadlines));
  console.log(
    `所要時間 ${seconds.toFixed(1)} 秒、引き直し ${formatPercent(summary.mulliganGames / trials)}\n`
  );
  for (const trace of traces) {
    console.log(trace.join("\n"));
  }
  return summary;
}

/** deck の見出しを出し、先攻と後攻を trials 回ずつ回して、それぞれの集計を返す。 */
export function runSearchTrialsOfBothSides(
  deck: RecordedDeck,
  options: Omit<SearchTrialSideOptions, "deckCards" | "wentFirst">
): {
  readonly firstSummary: SimulationSummary;
  readonly secondSummary: SimulationSummary;
} {
  console.log(
    `## ${deck.name}(${deck.deckCode})、道の揃い具合を見る評価、先攻・後攻 ${options.trials} 回ずつ(乱数の種 ${SEED})\n`
  );
  const sideOptions = {
    ...options,
    deckCards: buildDeck(cardRecordTable, deck.decklist),
  };
  return {
    firstSummary: runSearchTrialsOfSide({ ...sideOptions, wentFirst: true }),
    secondSummary: runSearchTrialsOfSide({ ...sideOptions, wentFirst: false }),
  };
}

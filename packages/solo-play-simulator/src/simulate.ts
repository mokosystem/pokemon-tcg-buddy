/**
 * 乱数試行を繰り返し、締め切りごとの成立率と失敗の要因を集計する。
 * 枚数を変えた比較は同じ種で回し、差を変更の効果として読めるようにする。
 */

import type { Card } from "./cards.ts";
import {
  applyVariant,
  buildDeck,
  type CardTable,
  type Decklist,
  type DeckVariant,
  type GameResult,
  type Goal,
  type PlayingPolicy,
  runGame,
} from "./engine.ts";
import { createSeededRandom } from "./random.ts";

/** 締め切り。狙いの名前と、何番目の自分の番までか。 */
export interface Deadline {
  readonly goal: string;
  readonly turn: number;
}

/** 名前 → 回数。 */
export type Tally = Map<string, number>;

function countUp(tally: Tally, key: string): void {
  tally.set(key, (tally.get(key) ?? 0) + 1);
}

/** 回数の多い順。同数は先に数え始めた順のまま。 */
function sortByCountDescending(tally: Tally): [string, number][] {
  return [...tally].sort((left, right) => right[1] - left[1]);
}

export class SimulationSummary {
  readonly trials: number;
  readonly wentFirst: boolean;
  readonly maxTurn: number;
  /** 狙いごとの、各番までに成立した回数(累計)。添字 0 が 1 番目の番。 */
  readonly achievedByTurn = new Map<string, number[]>();
  /** 狙いごと、番ごとの、失敗の要因 → 回数。 */
  readonly failureTally = new Map<string, Map<number, Tally>>();
  /** 番ごとの、使ったワザ → 回数。 */
  readonly attackTally = new Map<number, Tally>();
  /** 引き直しが 1 回以上起きた対戦の数。 */
  mulliganGames = 0;

  constructor(
    trials: number,
    wentFirst: boolean,
    maxTurn: number,
    goalNames: readonly string[]
  ) {
    this.trials = trials;
    this.wentFirst = wentFirst;
    this.maxTurn = maxTurn;
    for (const goalName of goalNames) {
      this.achievedByTurn.set(goalName, new Array<number>(maxTurn).fill(0));
      this.failureTally.set(goalName, newTallyPerTurn(maxTurn));
    }
    for (const [turn, tally] of newTallyPerTurn(maxTurn)) {
      this.attackTally.set(turn, tally);
    }
  }

  /** 狙いが締め切りの番までに成立した割合(0 以上 1 以下)。 */
  rate(goalName: string, deadline: number): number {
    const achieved = this.achievedByTurn.get(goalName);
    if (achieved === undefined) {
      throw new Error(`狙い ${goalName} は集計に無い`);
    }
    const count = achieved[deadline - 1];
    if (count === undefined) {
      throw new Error(
        `締め切り ${deadline} は進めた番の数 ${this.maxTurn} を超えている`
      );
    }
    return count / this.trials;
  }

  tallyGame(outcome: GameResult): void {
    if (outcome.mulligans > 0) {
      this.mulliganGames += 1;
    }
    for (const [goalName, firstTurn] of outcome.goalFirstTurn) {
      this.tallyGoal(
        goalName,
        firstTurn,
        outcome.failureLabels.get(goalName) ?? new Map()
      );
    }
    for (const [turn, attack] of outcome.attacks) {
      countUp(tallyForTurn(this.attackTally, turn), attack);
    }
  }

  private tallyGoal(
    goalName: string,
    firstTurn: number | null,
    failureLabels: ReadonlyMap<number, string>
  ): void {
    const achieved = this.achievedByTurn.get(goalName);
    const failures = this.failureTally.get(goalName);
    if (achieved === undefined || failures === undefined) {
      throw new Error(`狙い ${goalName} は集計に無い`);
    }
    if (firstTurn !== null) {
      for (let turn = firstTurn; turn <= this.maxTurn; turn += 1) {
        achieved[turn - 1] = (achieved[turn - 1] ?? 0) + 1;
      }
    }
    for (const [turn, label] of failureLabels) {
      countUp(tallyForTurn(failures, turn), label);
    }
  }
}

function tallyForTurn(perTurn: Map<number, Tally>, turn: number): Tally {
  let tally = perTurn.get(turn);
  if (tally === undefined) {
    tally = new Map();
    perTurn.set(turn, tally);
  }
  return tally;
}

function newTallyPerTurn(maxTurn: number): Map<number, Tally> {
  const perTurn = new Map<number, Tally>();
  for (let turn = 1; turn <= maxTurn; turn += 1) {
    perTurn.set(turn, new Map());
  }
  return perTurn;
}

export interface SimulationOptions {
  readonly cards: readonly Card[];
  readonly goals: readonly Goal[];
  readonly maxTurn: number;
  readonly policy: PlayingPolicy;
  readonly seed: number;
  readonly trials: number;
  readonly wentFirst: boolean;
}

export function simulate(options: SimulationOptions): SimulationSummary {
  const random = createSeededRandom(options.seed);
  const summary = new SimulationSummary(
    options.trials,
    options.wentFirst,
    options.maxTurn,
    options.goals.map((goal) => goal.name)
  );
  for (let trial = 0; trial < options.trials; trial += 1) {
    summary.tallyGame(
      runGame({
        cards: options.cards,
        goals: options.goals,
        maxTurn: options.maxTurn,
        policy: options.policy,
        random,
        wentFirst: options.wentFirst,
      })
    );
  }
  return summary;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

function sideLabel(wentFirst: boolean): string {
  return wentFirst ? "先攻" : "後攻";
}

function turnColumns(maxTurn: number): number[] {
  return Array.from({ length: maxTurn }, (_, index) => index + 1);
}

/** 集計を Markdown の表と箇条書きにする。締め切りの内訳は deadlines に挙げた狙いだけ出す。 */
export function formatSummary(
  summary: SimulationSummary,
  deadlines: readonly Deadline[]
): string {
  const turns = turnColumns(summary.maxTurn);
  const lines = [
    `### ${sideLabel(summary.wentFirst)}(試行 ${summary.trials} 回)`,
    "",
    `| 狙い | ${turns.map((turn) => `${turn} 番目の番まで`).join(" | ")} |`,
    `| --- |${" --- |".repeat(summary.maxTurn)}`,
  ];
  for (const goalName of summary.achievedByTurn.keys()) {
    const cells = turns
      .map((turn) => formatPercent(summary.rate(goalName, turn)))
      .join(" | ");
    lines.push(`| ${goalName} | ${cells} |`);
  }
  lines.push(
    "",
    `引き直し(たねポケモンが無い初手)が起きた対戦: ${formatPercent(summary.mulliganGames / summary.trials)}`,
    ""
  );
  for (const [turn, tally] of summary.attackTally) {
    if (tally.size > 0) {
      const parts = sortByCountDescending(tally)
        .map(
          ([name, count]) => `${name} ${formatPercent(count / summary.trials)}`
        )
        .join(", ");
      lines.push(`- ${turn} 番目の番に使ったワザ: ${parts}`);
    }
  }
  lines.push("");
  for (const deadline of deadlines) {
    const tally = summary.failureTally.get(deadline.goal)?.get(deadline.turn);
    if (tally === undefined) {
      throw new Error(
        `締め切り ${deadline.goal}(${deadline.turn} 番目まで)は集計に無い`
      );
    }
    const failed = [...tally.values()].reduce(
      (total, count) => total + count,
      0
    );
    if (failed === 0) {
      continue;
    }
    lines.push(
      `**${deadline.goal}(${deadline.turn} 番目の番まで)が成立しなかった ${formatPercent(failed / summary.trials)} の内訳**`,
      ""
    );
    for (const [label, count] of sortByCountDescending(tally)) {
      lines.push(`- ${label}: ${formatPercent(count / summary.trials)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export interface VariantComparisonOptions {
  readonly cardTable: CardTable;
  readonly deadlines: readonly Deadline[];
  readonly decklist: Decklist;
  readonly goals: readonly Goal[];
  readonly maxTurn: number;
  readonly policy: PlayingPolicy;
  readonly seed: number;
  readonly trials: number;
  readonly variants: readonly DeckVariant[];
}

export interface VariantRate {
  readonly deadline: Deadline;
  /** 変更なしとの差(ポイントではなく割合)。変更なしの行では 0。 */
  readonly diffFromBase: number;
  readonly rate: number;
}

export interface VariantComparisonRow {
  readonly isBase: boolean;
  readonly label: string;
  readonly rates: readonly VariantRate[];
}

export interface VariantComparison {
  readonly deadlines: readonly Deadline[];
  readonly rows: readonly VariantComparisonRow[];
  readonly trials: number;
  readonly wentFirst: boolean;
}

const BASE_VARIANT: DeckVariant = { changes: {}, label: "変更なし" };

/** 変更なしと各変更案を、先攻・後攻それぞれ同じ乱数の種で比較する。 */
export function compareVariants(
  options: VariantComparisonOptions
): VariantComparison[] {
  const variants = [BASE_VARIANT, ...options.variants];
  return [true, false].map((wentFirst) => {
    let base: SimulationSummary | null = null;
    const rows = variants.map((variant) => {
      const summary = simulate({
        cards: buildDeck(
          options.cardTable,
          applyVariant(options.decklist, variant)
        ),
        goals: options.goals,
        maxTurn: options.maxTurn,
        policy: options.policy,
        seed: options.seed,
        trials: options.trials,
        wentFirst,
      });
      base ??= summary;
      const baseSummary = base;
      return {
        isBase: variant === BASE_VARIANT,
        label: variant.label,
        rates: options.deadlines.map((deadline) => {
          const rate = summary.rate(deadline.goal, deadline.turn);
          return {
            deadline,
            diffFromBase: rate - baseSummary.rate(deadline.goal, deadline.turn),
            rate,
          };
        }),
      };
    });
    return {
      deadlines: options.deadlines,
      rows,
      trials: options.trials,
      wentFirst,
    };
  });
}

function formatDiffPoints(diff: number): string {
  const points = diff * 100;
  return `${points >= 0 ? "+" : ""}${points.toFixed(1)}`;
}

export function formatVariantComparison(
  comparisons: readonly VariantComparison[]
): string {
  const lines: string[] = [];
  for (const comparison of comparisons) {
    lines.push(
      `### 枚数を変えたときの比較(${sideLabel(comparison.wentFirst)}、試行 ${comparison.trials} 回)`,
      "",
      `| 変更 | ${comparison.deadlines.map((deadline) => `${deadline.goal}(${deadline.turn} 番目まで)`).join(" | ")} |`,
      `| --- |${" --- |".repeat(comparison.deadlines.length)}`
    );
    for (const row of comparison.rows) {
      const cells = row.rates.map((entry) =>
        row.isBase
          ? formatPercent(entry.rate)
          : `${formatPercent(entry.rate)} (${formatDiffPoints(entry.diffFromBase)})`
      );
      lines.push(`| ${row.label} | ${cells.join(" | ")} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export interface CalculationPremise {
  /** 計算の前提(相手の行動を含めない、など)。出力の先頭に必ず出す。 */
  readonly assumptions: readonly string[];
  readonly deckCode: string;
  readonly title: string;
}

export function formatAssumptions(premise: CalculationPremise): string {
  return [
    `## ${premise.title}`,
    "",
    `デッキコード: ${premise.deckCode}`,
    "",
    "### 計算の前提",
    "",
    ...premise.assumptions.map((assumption) => `- ${assumption}`),
    "",
  ].join("\n");
}

/**
 * #22 の枚数の変更案(issue22-comparison-targets.ts の variants、4 デッキで 38 案)を探索(道の揃い具合を見る評価)で
 * 回し、変更なしとの差を #22 の規則ファイルの差と並べる(Issue 51 の変更案の比較)。一致は目標にせず、ずれた案を
 * 手順の癖か探索の癖かを切り分ける材料にする。乱数の種と探索の設定は答え合わせ(compare-with-issue22.ts)と同じ。
 * パッケージのディレクトリで次のように実行する(デッキの名前、先攻・後攻それぞれの試行回数)。
 *
 *   bun run compare:issue22-variant-rates mega-gardevoir 20000
 */

import { cardRecordTable } from "../src/card-record-table.ts";
import {
  compareVariants,
  type Deadline,
  type VariantComparison,
  type VariantComparisonRow,
  type VariantRate,
} from "../src/simulate.ts";
import {
  ALLOWED_SHORTFALL_POINTS,
  type Issue22ComparisonTarget,
  type Issue22Rate,
  NOISE_POINTS,
  parseIssue22ComparisonArguments,
} from "./issue22-comparison-targets.ts";
import {
  createTrialSearchPolicy,
  formatPoints,
  SEED,
} from "./run-search-trials.ts";

/**
 * ずれの判定。向きは、両方の差が 2 万回の揺れ(NOISE_POINTS)を超えて符号が逆のときだけ数える。大きさは、探索の差と
 * #22 の差の開きが Issue 51 の完了の物差しの幅(ALLOWED_SHORTFALL_POINTS)を超えたもの。
 */

/** 変更案の rates に出てくる狙いと番の組を、重ねずに並べる。 */
function listVariantDeadlines(target: Issue22ComparisonTarget): Deadline[] {
  const deadlines: Deadline[] = [];
  for (const { rates } of target.variants) {
    for (const { goal, turn } of rates) {
      if (
        !deadlines.some((entry) => entry.goal === goal && entry.turn === turn)
      ) {
        deadlines.push({ goal, turn });
      }
    }
  }
  return deadlines;
}

function findRate(
  rates: readonly Issue22Rate[],
  deadline: Deadline
): Issue22Rate | undefined {
  return rates.find(
    (rate) => rate.goal === deadline.goal && rate.turn === deadline.turn
  );
}

function requireBaseRate(
  rates: readonly Issue22Rate[],
  deadline: Deadline
): Issue22Rate {
  const rate = findRate(rates, deadline);
  if (rate === undefined) {
    throw new Error(
      `#22 の変更なしの成立率が無い(${deadline.goal}、${deadline.turn} 番目の番)`
    );
  }
  return rate;
}

function selectSidePercent(rate: Issue22Rate, wentFirst: boolean): number {
  return wentFirst ? rate.firstPercent : rate.secondPercent;
}

/** 両方の差が揺れを超えていて、向きが逆か。 */
function isOppositeDirection(
  searchPoints: number,
  issue22Points: number
): boolean {
  return (
    Math.min(Math.abs(searchPoints), Math.abs(issue22Points)) > NOISE_POINTS &&
    Math.sign(searchPoints) !== Math.sign(issue22Points)
  );
}

function describeGap(searchPoints: number, issue22Points: number): string {
  return [
    ...(isOppositeDirection(searchPoints, issue22Points) ? ["向き"] : []),
    ...(Math.abs(searchPoints - issue22Points) > ALLOWED_SHORTFALL_POINTS
      ? ["大きさ"]
      : []),
  ].join("、");
}

/** 変更案 1 つの狙いと番 1 つの行。#22 の変更案にその狙いと番の成立率が無ければ行を出さない。 */
function formatVariantLines(
  target: Issue22ComparisonTarget,
  row: VariantComparisonRow,
  variantRates: readonly Issue22Rate[],
  { deadline, diffFromBase }: VariantRate,
  wentFirst: boolean
): string[] {
  const variantRate = findRate(variantRates, deadline);
  if (variantRate === undefined) {
    return [];
  }
  const baseRate = requireBaseRate(target.rates, deadline);
  const searchPoints = diffFromBase * 100;
  const issue22Points =
    selectSidePercent(variantRate, wentFirst) -
    selectSidePercent(baseRate, wentFirst);
  return [
    `| ${row.label} | ${deadline.goal} | ${deadline.turn} | ${formatPoints(searchPoints)} | ${formatPoints(issue22Points)} | ${describeGap(searchPoints, issue22Points)} |`,
  ];
}

function formatSide(
  target: Issue22ComparisonTarget,
  comparison: VariantComparison
): string {
  const variantRows = comparison.rows.filter((row) => !row.isBase);
  return [
    `### ${comparison.wentFirst ? "先攻" : "後攻"}(試行 ${comparison.trials} 回)`,
    "",
    "| 変更案 | 狙い | 番 | 探索の差 | #22 の差 | ずれ |",
    "| --- | --- | --- | --- | --- | --- |",
    ...variantRows.flatMap((row, index) => {
      // 変更なしを除いた行は target.variants と同じ並び(compareVariants が渡した順)
      const variantRates = target.variants[index]?.rates ?? [];
      return row.rates.flatMap((entry) =>
        formatVariantLines(
          target,
          row,
          variantRates,
          entry,
          comparison.wentFirst
        )
      );
    }),
  ].join("\n");
}

function main(argv: readonly string[]): void {
  const { deck, resolved, target, trials } =
    parseIssue22ComparisonArguments(argv);
  console.log(
    `## ${deck.name}(${deck.deckCode})、変更案 ${target.variants.length} 案、道の揃い具合を見る評価、先攻・後攻 ${trials} 回ずつ(乱数の種 ${SEED})\n`
  );
  const started = performance.now();
  const comparisons = compareVariants({
    createPolicy: () => createTrialSearchPolicy(resolved),
    deadlines: listVariantDeadlines(target),
    decklist: deck.decklist,
    goals: [...target.measuredGoals, ...resolved.goals],
    maxTurn: Math.max(...resolved.deadlines),
    recordTable: cardRecordTable,
    seed: SEED,
    trials,
    variants: target.variants.map((entry) => entry.variant),
  });
  for (const comparison of comparisons) {
    console.log(formatSide(target, comparison));
    console.log("");
  }
  console.log(
    `ずれ: 向きは両方の差が ±${NOISE_POINTS} ポイントを超えて符号が逆のもの、大きさは差の開きが ${ALLOWED_SHORTFALL_POINTS} ポイントを超えたもの。`
  );
  console.log(
    `所要時間 ${((performance.now() - started) / 1000).toFixed(1)} 秒`
  );
}

main(process.argv.slice(2));

/**
 * #22 の 4 デッキを探索(道の揃い具合を見る評価)で回し、狙いごとの成立率を #22 の規則ファイルの成立率と比べる
 * (Issue 27 の順 8、答え合わせ)。乱数の種は 20260917(#22 の検証の記録と同じ)。パッケージのディレクトリで次のように
 * 実行する(デッキの名前、先攻・後攻それぞれの試行回数、履歴を出す狙いの名前の一部・番・件数)。
 *
 *   bun run compare:issue22-rates mega-charizard 20000
 *   bun run compare:issue22-rates dragapult 2000 ファントムダイブ 3 5
 *
 * 失敗の要因の内訳は、宣言から導いた狙いのもの(主軸が場にいないときは、宣言の道のうちいちばん揃っている道の
 * 足りないカードと置き場所。declaration.ts の explainPathShortfall)。比較の表には Issue 51 の完了の物差しの判定(▼)を出す。
 */

import type { SimulationSummary } from "../src/simulate.ts";
import {
  ALLOWED_SHORTFALL_POINTS,
  type Issue22Rate,
  NOISE_POINTS,
  parseIssue22ComparisonArguments,
} from "./issue22-comparison-targets.ts";
import {
  formatPoints,
  parseTraceRequest,
  runSearchTrialsOfBothSides,
} from "./run-search-trials.ts";

/** 完了の物差しで判定する番。 */
const JUDGED_TURNS: readonly number[] = [2, 3];

// ---- 比較の表 ----

/** 比較の表の 1 欄(探索、#22、差)。差が揺れを超えたら ※、完了の物差しを下回ったら ▼ を付ける。 */
function formatComparisonCell(
  actual: number,
  expected: number,
  isShortfall: boolean
): string {
  const difference = actual - expected;
  const mark = Math.abs(difference) <= NOISE_POINTS ? "" : " ※";
  return `${actual.toFixed(1)} % | ${expected.toFixed(1)} % | ${formatPoints(difference)}${mark}${isShortfall ? " ▼" : ""}`;
}

/**
 * #22 の成立率と並べた表。判定する行(宣言から導いた狙いの 2・3 番目の番)で #22 − ALLOWED_SHORTFALL_POINTS を
 * 下回った欄に ▼ を付ける。測るだけの狙いは探索が目指さないため判定しない。
 */
function formatComparison(
  rates: readonly Issue22Rate[],
  declaredGoalNames: ReadonlySet<string>,
  firstSummary: SimulationSummary,
  secondSummary: SimulationSummary
): string {
  const isJudgedRate = (rate: Issue22Rate) =>
    declaredGoalNames.has(rate.goal) && JUDGED_TURNS.includes(rate.turn);
  let shortfallCells = 0;
  const lines = [
    "| 狙い | 番 | 探索(先攻) | #22(先攻) | 差 | 探索(後攻) | #22(後攻) | 差 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const rate of rates) {
    const isJudged = isJudgedRate(rate);
    const cells = (
      [
        [firstSummary, rate.firstPercent],
        [secondSummary, rate.secondPercent],
      ] as const
    ).map(([summary, expected]) => {
      const actual = summary.rate(rate.goal, rate.turn) * 100;
      const isShortfall =
        isJudged && actual - expected < -ALLOWED_SHORTFALL_POINTS;
      shortfallCells += Number(isShortfall);
      return formatComparisonCell(actual, expected, isShortfall);
    });
    lines.push(
      `| ${rate.goal} | ${rate.turn}${rate.isDeadline ? "(締め切り)" : ""} | ${cells.join(" | ")} |`
    );
  }
  // 先攻と後攻の 2 欄ずつ
  const judgedCells = rates.filter(isJudgedRate).length * 2;
  lines.push(
    "",
    `※ は差が ±${NOISE_POINTS} ポイント(2 万回の揺れ)を超えたもの。`,
    `▼ は宣言の狙いの 2・3 番目の番で、#22 の成立率から ${ALLOWED_SHORTFALL_POINTS} ポイントを超えて下回ったもの(Issue 51 の完了の物差し)。下回った欄: ${shortfallCells} 個(判定した欄 ${judgedCells} 個)`
  );
  return lines.join("\n");
}

// ---- 実行 ----

function main(argv: readonly string[]): void {
  const { deck, resolved, target, trials } =
    parseIssue22ComparisonArguments(argv);
  const goals = [...target.measuredGoals, ...resolved.goals];
  const { firstSummary, secondSummary } = runSearchTrialsOfBothSides(deck, {
    goals,
    resolved,
    summaryDeadlines: goals.flatMap((goal) =>
      resolved.deadlines.map((turn) => ({ goal: goal.name, turn }))
    ),
    traceRequest: parseTraceRequest(argv.slice(2)),
    trials,
  });
  console.log("### #22 の規則ファイルとの比較\n");
  console.log(
    formatComparison(
      target.rates,
      new Set(resolved.goals.map((goal) => goal.name)),
      firstSummary,
      secondSummary
    )
  );
}

main(process.argv.slice(2));

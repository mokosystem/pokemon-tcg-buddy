/**
 * 題材の局面 A〜F(src/search-positions.ts)で、評価ごとに正しい手を選べた回数を数える(Issue 27 の順 7、1 つ目の危うさ)。
 * 局面ごとに、山札とサイドの並べ方と探索の乱数の種を変えて variations 回試す。パッケージのディレクトリで次のように実行する。
 *
 *   bun run compare:search-evaluators 20
 *   bun run compare:search-evaluators 20 path-progress,next-turn-trials
 */

import { createSearchPolicy } from "../src/search-policy.ts";
import {
  playSearchPosition,
  RESOLVED_MEGA_GARDEVOIR_DECLARATION,
  SEARCH_POSITIONS,
} from "../src/search-positions.ts";
import {
  parseEvaluatorNames,
  SAMPLES_FOR_UNCERTAIN_OUTCOME,
  SEARCH_EVALUATORS,
} from "./search-evaluator-choices.ts";

const variations = Number(process.argv[2] ?? "20");
const names = parseEvaluatorNames(process.argv[3]);

console.log(
  `| 評価 | ${SEARCH_POSITIONS.map((position) => position.id).join(" | ")} |`
);
console.log(`| --- |${" --- |".repeat(SEARCH_POSITIONS.length)}`);
for (const name of names) {
  const choice = SEARCH_EVALUATORS[name];
  if (choice === undefined) {
    continue;
  }
  const cells = SEARCH_POSITIONS.map((position) => {
    let correct = 0;
    const started = performance.now();
    for (let variation = 0; variation < variations; variation += 1) {
      const policy = createSearchPolicy(
        RESOLVED_MEGA_GARDEVOIR_DECLARATION,
        choice.create(RESOLVED_MEGA_GARDEVOIR_DECLARATION),
        {
          samplesForUncertainOutcome: SAMPLES_FOR_UNCERTAIN_OUTCOME,
          searchesEffectChoices: true,
          seed: 100 + variation,
        }
      );
      if (playSearchPosition(position, policy, 1000 + variation)) {
        correct += 1;
      }
    }
    const milliseconds = (performance.now() - started) / variations;
    return `${correct}/${variations}(${milliseconds.toFixed(0)} ms)`;
  });
  console.log(`| ${choice.label} | ${cells.join(" | ")} |`);
}

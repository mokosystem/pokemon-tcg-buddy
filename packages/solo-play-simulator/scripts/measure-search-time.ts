/**
 * 探索で成立率を計算したときの所要時間と、1 回の試行あたりの複製と評価の回数を測る(Issue 27 の順 7、2 つ目の危うさ)。
 * デッキは開発責任者のメガサーナイトex(xG8Kax-DHob4e-84xcca)、乱数の種は 20260917(#22 の検証の記録と同じ)。
 * パッケージのディレクトリで次のように実行する(評価の名前、先攻・後攻それぞれの試行回数)。
 *
 *   bun run measure:search-time path-progress 20000
 */

import { cardRecordTable } from "../src/card-record-table.ts";
import { resolveDeclaration } from "../src/declaration.ts";
import { buildDeck } from "../src/engine.ts";
import {
  ISSUE22_DECKS,
  MEGA_GARDEVOIR_DECLARATION,
} from "../src/issue22-decks.ts";
import { createSearchPolicy } from "../src/search-policy.ts";
import { formatSummary, simulate } from "../src/simulate.ts";
import {
  parseEvaluatorNames,
  SAMPLES_FOR_UNCERTAIN_OUTCOME,
  SEARCH_EVALUATORS,
} from "./search-evaluator-choices.ts";

const SEED = 20_260_917;
const SEARCH_SEED = 1;

const deck = ISSUE22_DECKS.find(
  (entry) => entry.deckCode === "xG8Kax-DHob4e-84xcca"
);
if (deck === undefined) {
  throw new Error("メガサーナイトex のデッキが無い");
}
const [evaluatorName] = parseEvaluatorNames(process.argv[2]);
const evaluatorChoice = SEARCH_EVALUATORS[evaluatorName ?? ""];
if (evaluatorName === undefined || evaluatorChoice === undefined) {
  throw new Error("評価の名前を 1 つ渡す");
}
const trials = Number(process.argv[3] ?? "20000");
const declaration = resolveDeclaration(
  MEGA_GARDEVOIR_DECLARATION,
  cardRecordTable
);
const cards = buildDeck(cardRecordTable, deck.decklist);
const maxTurn = Math.max(...declaration.deadlines);

console.log(
  `## ${evaluatorChoice.label}、先攻・後攻 ${trials} 回ずつ(乱数の種 ${SEED})\n`
);
let totalMilliseconds = 0;
for (const wentFirst of [true, false]) {
  const policy = createSearchPolicy(
    declaration,
    evaluatorChoice.create(declaration),
    {
      samplesForUncertainOutcome: SAMPLES_FOR_UNCERTAIN_OUTCOME,
      searchesEffectChoices: true,
      seed: SEARCH_SEED,
    }
  );
  const started = performance.now();
  const summary = simulate({
    cards,
    goals: declaration.goals,
    maxTurn,
    policy,
    seed: SEED,
    trials,
    wentFirst,
  });
  const milliseconds = performance.now() - started;
  totalMilliseconds += milliseconds;
  console.log(
    formatSummary(
      summary,
      declaration.goals.map((goal) => ({ goal: goal.name, turn: maxTurn }))
    )
  );
  console.log(
    `所要時間 ${(milliseconds / 1000).toFixed(1)} 秒(1 回あたり ${(milliseconds / trials).toFixed(2)} ms)、1 回あたりの複製 ${(policy.statistics.clones / trials).toFixed(0)} 回、評価 ${(policy.statistics.evaluations / trials).toFixed(0)} 回\n`
  );
}
console.log(`先攻・後攻の合計 ${(totalMilliseconds / 1000).toFixed(1)} 秒`);

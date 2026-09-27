/**
 * 計測と局面の比べ方で使う、評価の名前と作り方の表。名前はコマンドの引数に使う。
 */

import type { ResolvedDeclaration } from "../src/declaration.ts";
import {
  createGoalOnlyEvaluator,
  createNextTurnTrialEvaluator,
  createPathProgressEvaluator,
} from "../src/search-evaluators.ts";
import type { Evaluator } from "../src/search-policy.ts";

export const SEARCH_EVALUATORS: Readonly<
  Record<
    string,
    {
      readonly create: (declaration: ResolvedDeclaration) => Evaluator;
      readonly label: string;
    }
  >
> = {
  "goals-only": {
    create: createGoalOnlyEvaluator,
    label: "その番の狙いだけを見る評価",
  },
  "next-turn-trials": {
    create: (declaration) =>
      createNextTurnTrialEvaluator(declaration, { trials: 4 }),
    label: "次の番を試す評価(4 回)",
  },
  "path-progress": {
    create: createPathProgressEvaluator,
    label: "道の揃い具合を見る評価",
  },
};

/** 探索の設定。混ぜ直しを変えて試す回数は 4 回、効果の中の選択は候補を試して選ぶ。 */
export const SAMPLES_FOR_UNCERTAIN_OUTCOME = 4;

export function parseEvaluatorNames(argument: string | undefined): string[] {
  const names =
    argument === undefined
      ? Object.keys(SEARCH_EVALUATORS)
      : argument.split(",");
  for (const name of names) {
    if (!(name in SEARCH_EVALUATORS)) {
      throw new Error(
        `評価の名前 ${name} は無い(${Object.keys(SEARCH_EVALUATORS).join("、")})`
      );
    }
  }
  return names;
}

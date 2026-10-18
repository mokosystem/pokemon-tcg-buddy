/**
 * 探索の評価(docs/solo-play-simulator-design.md「宣言と探索(Issue 27 の順 7)」の評価の候補)。どれも「宣言の狙い
 * (3 段 × 締め切り)の成立確率の合計」を見積もる。判定がまだ済んでいない締め切りについて、狙いが今の場で成り立って
 * いれば 1、成り立っていなければ評価ごとの見積もりを足す。
 *
 * - その番の狙いだけを見る評価: 成り立っていなければ 0。1 番先を見ない基準
 * - 道の揃い具合を見る評価: 成り立っていなければ、主軸への道の必要なカードの揃い具合、ワザのエネルギー、ダメージの
 *   下限までの距離から 0 以上 1 未満の見込みを締め切りごとに出す。1 番先を数え上げだけで見る。見込みは
 *   goal-prospects.ts で出す
 * - 次の番を試す評価: 見えていないカードを混ぜ直した複製で、その番の残りと次の番を軽い探索で進めて数える
 */

import { resolveEndOfTurnTriggers } from "./card-effects.ts";
import type { ResolvedDeclaration } from "./declaration.ts";
import type { EffectChoices } from "./effect-choices.ts";
import { type PlayingPolicy, useAttacksOfTurn } from "./engine.ts";
import { GoalProspects } from "./goal-prospects.ts";
import { SeededRandom } from "./random.ts";
import {
  createSearchPolicy,
  type EvaluationInput,
  type Evaluator,
  type TurnStage,
} from "./search-policy.ts";
import type { GameState } from "./state.ts";

/** 判定がまだ済んでいない締め切り(fromTurn の番より前でないもの)。今成り立っている狙いは、この数だけ成立確率の合計に効く。 */
function listOpenDeadlines(
  declaration: ResolvedDeclaration,
  fromTurn: number
): number[] {
  return declaration.deadlines.filter((deadline) => deadline >= fromTurn);
}

/** その番の狙いだけを見る評価。今の場で成り立っている狙いの数 × 判定がまだ済んでいない締め切りの数。 */
export function createGoalOnlyEvaluator(
  declaration: ResolvedDeclaration
): Evaluator {
  return ({ fromTurn, state }) =>
    listOpenDeadlines(declaration, fromTurn).length *
    declaration.goals.filter((goal) => goal.isAchieved(state)).length;
}

// ---- 道の揃い具合を見る評価 ----

function sumScores(scores: readonly number[]): number {
  return scores.reduce((total, score) => total + score, 0);
}

/**
 * 道の揃い具合を見る評価。判定がまだ済んでいない締め切りごとに、狙いの段ごとの点(GoalProspects の scoreGoals)を
 * 出して合計する。見込みが締め切りによって違う(この番に間に合う進化の元だけを数える、など)ため、1 つの締め切りの
 * 点を締め切りの数倍にしない。
 */
export function createPathProgressEvaluator(
  declaration: ResolvedDeclaration
): Evaluator {
  return (input) => {
    const openDeadlines = listOpenDeadlines(declaration, input.fromTurn);
    if (openDeadlines.length === 0) {
      return 0;
    }
    const prospects = new GoalProspects(declaration, input);
    return openDeadlines.reduce(
      (total, deadline) => total + sumScores(prospects.scoreGoals(deadline)),
      0
    );
  };
}

// ---- 次の番を試す評価 ----

export interface NextTurnTrialOptions {
  /** 1 回の評価で試す回数。 */
  readonly trials: number;
}

/**
 * 次の番を試す評価。見えていないカードを混ぜ直した複製で、その番の残りと次の番を、道の揃い具合を見る評価の軽い探索
 * (効果の中の選択は候補の先頭から選び、結果が見えていないカードで決まる行動も 1 回だけ試す)で進め、trials 回の
 * 平均をとる。進めた番までの締め切りは、その番の終わり(ワザを使う前)に狙いが成り立ったかで 1 か 0、進めた番より
 * 後の締め切りは、進めた最後の番の終わりの場で道の揃い具合を見る評価の点を使う(2026-09-27 に開発責任者と決定)。
 */
export function createNextTurnTrialEvaluator(
  declaration: ResolvedDeclaration,
  options: NextTurnTrialOptions
): Evaluator {
  const lastDeadline = Math.max(...declaration.deadlines);
  return (input) => {
    const openDeadlines = listOpenDeadlines(declaration, input.fromTurn);
    if (openDeadlines.length === 0) {
      return 0;
    }
    const lastTurn = Math.min(input.fromTurn + 1, lastDeadline);
    const seedRandom = new SeededRandom(input.seed);
    let total = 0;
    for (let trial = 0; trial < options.trials; trial += 1) {
      const result = playTrialTurns(
        declaration,
        input,
        lastTurn,
        seedRandom.nextSeed()
      );
      result.firstAchievedTurns.forEach((firstTurn, index) => {
        for (const deadline of openDeadlines) {
          if (firstTurn !== undefined && firstTurn <= deadline) {
            total += 1;
          } else if (deadline > lastTurn) {
            total += result.leafScores.get(deadline)?.[index] ?? 0;
          }
        }
      });
    }
    return total / options.trials;
  };
}

/**
 * 見えていないカードを混ぜ直した複製で、fromTurn の番から lastTurn の番までを軽い探索で進める。狙いごとに最初に
 * 成り立った番と、lastTurn より後の締め切りごとの、最後の番の終わりの道の揃い具合を見る評価の点を返す。
 */
function playTrialTurns(
  declaration: ResolvedDeclaration,
  { fromTurn, stage, state, statistics }: EvaluationInput,
  lastTurn: number,
  trialSeed: number
): {
  firstAchievedTurns: (number | undefined)[];
  leafScores: Map<number, number[]>;
} {
  const rollout = createSearchPolicy(
    declaration,
    createPathProgressEvaluator(declaration),
    {
      samplesForUncertainOutcome: 1,
      searchesEffectChoices: false,
      seed: trialSeed,
    }
  );
  const copy = state.clone(new SeededRandom(trialSeed));
  statistics.clones += 1;
  copy.remixUnseenCards();
  const context = { choices: rollout, state: copy };
  const firstAchievedTurns = declaration.goals.map(
    (): number | undefined => undefined
  );
  let isPlayable = beginTrialTurn(copy, fromTurn, stage);
  for (let turn = fromTurn; isPlayable && turn <= lastTurn; turn += 1) {
    // 「番を終える」を試すときは、その番の行動をもう行わない
    if (turn > fromTurn || stage !== "actionsDone") {
      rollout.playTurn(context);
    }
    declaration.goals.forEach((goal, index) => {
      if (firstAchievedTurns[index] === undefined && goal.isAchieved(copy)) {
        firstAchievedTurns[index] = turn;
      }
    });
    if (turn < lastTurn) {
      isPlayable = finishTrialTurn(context, rollout);
    }
  }
  statistics.clones += rollout.statistics.clones;
  statistics.evaluations += rollout.statistics.evaluations;
  // 山札が尽きて試しが lastTurn の前で止まったときも、葉の場の番から数える。どちらでも lastTurn より後の締め切りは
  // 葉の場の番より後になる
  const prospects = new GoalProspects(declaration, {
    fromTurn: copy.turn,
    seed: trialSeed,
    stage: "actionsDone",
    state: copy,
    statistics,
  });
  return {
    firstAchievedTurns,
    leafScores: new Map(
      declaration.deadlines
        .filter((deadline) => deadline > lastTurn)
        .map((deadline) => [deadline, prospects.scoreGoals(deadline)])
    ),
  };
}

/**
 * 試しの番の終わり(ワザ、番の終わりの効果)を行い、次の番を始める。山札が無くて始められなければ偽。ワザは runGame と
 * 同じく、2 回目を使える効果(「おまつりおんど」)があれば 2 回目も選ばせる。
 */
function finishTrialTurn(
  context: { readonly choices: EffectChoices; readonly state: GameState },
  rollout: PlayingPolicy
): boolean {
  useAttacksOfTurn(context, rollout);
  resolveEndOfTurnTriggers(context);
  if (context.state.deck.length === 0) {
    return false;
  }
  context.state.beginTurn();
  return true;
}

/** 試しを fromTurn の番の中から始められるようにする。準備の後なら番を始め、番の最初の 1 枚を引く前なら引く。 */
function beginTrialTurn(
  state: GameState,
  fromTurn: number,
  stage: TurnStage
): boolean {
  if (state.turn < fromTurn) {
    if (state.deck.length === 0) {
      return false;
    }
    state.beginTurn();
    return true;
  }
  if (stage === "beforeDraw") {
    if (state.deck.length === 0) {
      return false;
    }
    state.draw(1);
  }
  return true;
}

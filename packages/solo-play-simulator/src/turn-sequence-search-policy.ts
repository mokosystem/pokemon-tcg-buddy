/**
 * Issue 70 の候補 3: 番の中の手の並びをまとめて探す探索。1 手ずつ選ぶ探索(候補 2)は、それぞれの行動を「その後は軽い手順で
 * 進める」前提で比べるため、2 手を続けて行ったときだけ得をする手を拾えない。番の中でこの後に行う手の並びまで含めて比べ、
 * 順番で得をする手を拾う。
 */

import type { EffectContext } from "./effect-choices.ts";
import { firstCandidateChoices } from "./effect-choices.ts";
import {
  listAvailableActions,
  type PlayerAction,
  performAction,
} from "./player-actions.ts";
import { SeededRandom } from "./random.ts";
import {
  compareTrialScores,
  listDistinctActions,
  pickBestCandidate,
  type SearchPolicy,
  type TrialScore,
  type TrialScorer,
  type TrialScoreTieBreak,
} from "./search-policy.ts";
import type { GameState } from "./state.ts";

export interface TurnSequenceSearchOptions {
  /** 点数を出す節の数の上限(設定の「調べる並びの数」)。根も 1 つに数える。 */
  readonly maxEvaluatedSequences: number;
  /** 1 つの節の点数を出す試しの回数。 */
  readonly samplesPerSequence: number;
  readonly scoreTrial: TrialScorer;
  readonly seed: number;
  readonly tieBreak: TrialScoreTieBreak;
}

/** 番の中で同じことを繰り返していないかの歯止め。search-policy.ts と同じ考え方。 */
const MAX_ACTIONS_PER_TURN = 100;

/**
 * 根から見た手の並びと、その並びを行った後の複製。複製の中の場のポケモンは参照が変わるため、行動は PlayerAction の形
 * (場の何番目か)のまま持つ。
 */
interface SequenceNode {
  readonly actions: readonly PlayerAction[];
  expanded: boolean;
  readonly score: TrialScore;
  readonly state: GameState;
}

/** base の playTurn だけを、番の中の手の並びを探す形に差し替えたプレイングの判断基準を返す。 */
export function createTurnSequenceSearchPolicy(
  base: SearchPolicy,
  options: TurnSequenceSearchOptions
): SearchPolicy {
  const searchRandom = new SeededRandom(options.seed);
  const { statistics } = base;

  const cloneWithRandom = (state: GameState): GameState => {
    statistics.clones += 1;
    return state.clone(new SeededRandom(searchRandom.nextSeed()));
  };

  /** 節の点数。節の状態から「番を終える」ときの点数を、混ぜ直しを変えて samplesPerSequence 回試した平均。 */
  const scoreNode = (state: GameState): TrialScore => {
    let winRate = 0;
    let prizeDifference = 0;
    for (let sample = 0; sample < options.samplesPerSequence; sample += 1) {
      const seed = searchRandom.nextSeed();
      statistics.clones += 1;
      const trial = state.clone(new SeededRandom(seed));
      trial.remixUnseenCards();
      statistics.trialScores += 1;
      const score = options.scoreTrial({
        resumePoint: "ownTurnAttack",
        seed,
        state: trial,
      });
      winRate += score.winRate;
      prizeDifference += score.prizeDifference;
    }
    const count = Math.max(options.samplesPerSequence, 1);
    return {
      prizeDifference: prizeDifference / count,
      winRate: winRate / count,
    };
  };

  /** まだ広げていない節のうち、点数がいちばん高いもの(並べば先に作った節)。 */
  const findNodeToExpand = (
    nodes: readonly SequenceNode[]
  ): SequenceNode | undefined => {
    const candidates = nodes.filter(
      (node) => !node.expanded && node.state.decision === undefined
    );
    return candidates.length === 0
      ? undefined
      : pickBestCandidate(candidates, (node) => node.score, options.tieBreak);
  };

  /**
   * 今の状態から点数がいちばん高い並びを探し、その最初の行動を返す。いちばん高いのが今の状態のまま番を終えることなら
   * undefined を返す。並びの中の行動の効果の中の選択は候補の先頭から選ぶ。
   */
  const chooseFirstActionOfBestSequence = (
    state: GameState
  ): PlayerAction | undefined => {
    const root = cloneWithRandom(state);
    root.remixUnseenCards();
    const nodes: SequenceNode[] = [
      { actions: [], expanded: false, score: scoreNode(root), state: root },
    ];
    for (
      let node = findNodeToExpand(nodes);
      node !== undefined && nodes.length < options.maxEvaluatedSequences;
      node = findNodeToExpand(nodes)
    ) {
      node.expanded = true;
      const parent = node;
      const context = { choices: firstCandidateChoices, state: parent.state };
      for (const action of listDistinctActions(
        parent.state,
        listAvailableActions(context)
      )) {
        if (nodes.length >= options.maxEvaluatedSequences) {
          break;
        }
        if (action.kind === "endTurn") {
          continue;
        }
        const child = cloneWithRandom(parent.state);
        performAction({ choices: firstCandidateChoices, state: child }, action);
        nodes.push({
          actions: [...parent.actions, action],
          expanded: false,
          score: scoreNode(child),
          state: child,
        });
      }
    }
    const best = nodes.reduce((left, right) =>
      compareTrialScores(right.score, left.score, options.tieBreak) > 0
        ? right
        : left
    );
    return best.actions[0];
  };

  return {
    ...base,
    playTurn: (context: EffectContext) => {
      for (let count = 0; count < MAX_ACTIONS_PER_TURN; count += 1) {
        if (listAvailableActions(context).length === 1) {
          return;
        }
        const action = chooseFirstActionOfBestSequence(context.state);
        if (action === undefined) {
          return;
        }
        base.performTurnAction(context, action);
      }
      throw new Error("1 つの番の行動が多すぎる(同じ行動を繰り返している)");
    },
  };
}

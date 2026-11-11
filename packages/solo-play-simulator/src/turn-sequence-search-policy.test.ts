import { describe, expect, test } from "bun:test";
import {
  activeOf,
  buildRecordedCard,
  buildState,
} from "./card-test-support.ts";
import { createSeededRandom } from "./random.ts";
import { createSearchPolicy, type TrialScorer } from "./search-policy.ts";
import type { GameState } from "./state.ts";
import { createTurnSequenceSearchPolicy } from "./turn-sequence-search-policy.ts";

// シロナのフカマル(049092)、シロナのガバイト(049093。シロナのフカマルから進化する)、基本闘エネルギー(049464)。
// バトルポケモンは番 0 に出したもので、2 回目の自分の番なので進化できる(docs/pokemon-tcg/basic-rules.md 77 行)
const GIBLE = buildRecordedCard("049092");
const GABITE = buildRecordedCard("049093");
const FIGHTING_ENERGY = buildRecordedCard("049464");

function buildEvolveAndAttachState(): GameState {
  return buildState({
    active: GIBLE,
    hand: [GABITE, FIGHTING_ENERGY],
    random: createSeededRandom(1),
    turn: 2,
  });
}

/** バトルポケモンが進化していて、エネルギーが 1 個以上ついている状態のときだけ勝率 1。 */
const evolvedWithEnergy: TrialScorer = ({ state }) => ({
  prizeDifference: 0,
  winRate:
    state.active !== undefined &&
    state.active.underneath.length > 0 &&
    state.active.energies.length > 0
      ? 1
      : 0,
});

function createBase(scoreTrial: TrialScorer) {
  return createSearchPolicy({
    samplesPerCandidate: 1,
    scoreTrial,
    searchesEffectChoices: true,
    seed: 1,
    tieBreak: "prizeDifference",
  });
}

describe("番の中の手の並びの探索", () => {
  test("調べる並びの数が 1 なら、今の状態だけを調べて番を終える", () => {
    const state = buildEvolveAndAttachState();
    const policy = createTurnSequenceSearchPolicy(
      createBase(evolvedWithEnergy),
      {
        maxEvaluatedSequences: 1,
        samplesPerSequence: 1,
        scoreTrial: evolvedWithEnergy,
        seed: 1,
        tieBreak: "prizeDifference",
      }
    );
    policy.playTurn({ choices: policy, state });
    expect(state.hand).toHaveLength(2);
    expect(policy.statistics.trialScores).toBe(1);
  });

  test("2 手を続けて行ったときだけ点数が上がる場で、並びを探す探索は 2 手を行い、1 手ずつ選ぶ探索は番を終える", () => {
    const sequenceState = buildEvolveAndAttachState();
    const sequencePolicy = createTurnSequenceSearchPolicy(
      createBase(evolvedWithEnergy),
      {
        maxEvaluatedSequences: 8,
        samplesPerSequence: 1,
        scoreTrial: evolvedWithEnergy,
        seed: 1,
        tieBreak: "prizeDifference",
      }
    );
    sequencePolicy.playTurn({ choices: sequencePolicy, state: sequenceState });
    expect(activeOf(sequenceState).card).toBe(GABITE);
    expect(activeOf(sequenceState).energies).toEqual([FIGHTING_ENERGY]);

    const stepState = buildEvolveAndAttachState();
    const stepPolicy = createBase(evolvedWithEnergy);
    stepPolicy.playTurn({ choices: stepPolicy, state: stepState });
    expect(activeOf(stepState).card).toBe(GIBLE);
    expect(activeOf(stepState).energies).toEqual([]);
  });
});

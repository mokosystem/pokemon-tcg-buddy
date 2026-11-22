/**
 * Issue 70 で計測するプレイングの判断基準の設定の一覧。設定の名前は計測スクリプトの引数と設計文書の表に使う。
 * 候補 2〜4 は、設定(先を試す回数など)を 2 通りずつ測る(Issue 70 の決定事項「候補」)。
 */

import {
  createFirstActionPolicy,
  createPlayoutActionPolicy,
  createRandomActionPolicy,
} from "./action-list-playing-policies.ts";
import { calculateAttackDamage } from "./attack-damage.ts";
import { listUsableAttacksOfActive } from "./card-effects.ts";
import { CardCategory } from "./card-record-schema.ts";
import { isEnergy } from "./cards.ts";
import { listAttackCandidatesWithCosts } from "./continuous-effects.ts";
import { type EffectContext, firstCandidateChoices } from "./effect-choices.ts";
import type { PlayingPolicy } from "./engine.ts";
import {
  createLearnedEvaluationTrialScorer,
  type LearnedWinRateModel,
} from "./learned-win-rate-evaluation.ts";
import {
  listAvailableActions,
  listAvailableHandActions,
  performAction,
} from "./player-actions.ts";
import { createPlayoutTrialScorer } from "./playout-trial-scorers.ts";
import { createSeededRandom, derivePolicySeed } from "./random.ts";
import {
  createSearchPolicy,
  type TrialScore,
  type TrialScorer,
  type TrialScoreTieBreak,
} from "./search-policy.ts";
import {
  type GameState,
  listUnpaidCost,
  type PokemonInPlay,
  PRIZE_COUNT,
} from "./state.ts";
import { createTurnSequenceSearchPolicy } from "./turn-sequence-search-policy.ts";

/** 計測する設定の名前。設計文書の表と計測スクリプトの引数に使う。 */
export type PlayingPolicySettingName =
  | "prize-progress-search"
  | "first-action"
  | "random-action"
  | "playout-win-rate-8"
  | "playout-win-rate-32"
  | "playout-prize-tie-break-8"
  | "playout-prize-tie-break-32"
  | "turn-sequence-32"
  | "turn-sequence-128"
  | "learned-evaluation-500"
  | "learned-evaluation-2000";

/** 設定の数。設定ごとに使う欄だけを持つ。 */
export interface PlayingPolicyParameters {
  /** 調べる並びの数(候補 3)。 */
  readonly maxEvaluatedSequences?: number;
  /** 候補の手 1 つを何回試すか(候補 2、2b、4)。 */
  readonly samplesPerCandidate?: number;
  /** 1 つの並びの試し回しの回数(候補 3)。 */
  readonly samplesPerSequence?: number;
  /** デッキごとの学習の対戦の回数(候補 4)。 */
  readonly trainingGamesPerDeck?: number;
}

/** デッキごとの準備の結果。learnedModel は学習が要る設定(候補 4)だけが持つ。 */
export interface PlayingPolicyPreparation {
  /** デッキの 60 枚の並びで最初に出てきた順のカードの名前。候補 4 の盤面の特徴に使う。 */
  readonly deckCardNames: readonly string[];
  readonly learnedModel?: LearnedWinRateModel;
}

export interface PlayingPolicySetting {
  /** Issue 70 の候補の番号("1"、"2"、"2b"、"3"、"4")。 */
  readonly candidate: string;
  /**
   * 準備が済んだデッキの情報と数から、試行ごとのプレイングの判断基準を作る。テストは数を 1〜2 に下げて渡し、
   * 計測は parameters をそのまま渡す。
   */
  readonly createPolicy: (
    preparation: PlayingPolicyPreparation,
    parameters: PlayingPolicyParameters,
    policySeed: number
  ) => PlayingPolicy;
  /** 計測で使う数。 */
  readonly parameters: PlayingPolicyParameters;
}

/** 候補 4 の 1 つの候補の手を試す回数(Issue 70 の実装計画「5.4」で決めた値。値を変えて比べた計測は無い)。 */
const LEARNED_EVALUATION_SAMPLES_PER_CANDIDATE = 4;
/** 候補 3 の 1 つの並びの試し回しの回数。 */
const TURN_SEQUENCE_SAMPLES_PER_SEQUENCE = 8;
/** 候補 3 が、ワザと効果の中の選択などを任せる候補 2b の試す回数。 */
const TURN_SEQUENCE_BASE_SAMPLES_PER_CANDIDATE = 8;

const playoutTrialScorer = createPlayoutTrialScorer(createPlayoutActionPolicy);

function chooseEnergyForAttack(context: EffectContext, seed: number) {
  const { state } = context;
  if (state.active === undefined) {
    return;
  }
  let bestGain = 0;
  const actions = listAvailableHandActions(context, isEnergy).filter(
    (action) => action.kind === "attachEnergy"
  );
  if (actions.length === 0) {
    return;
  }
  let best: (typeof actions)[number] | undefined;
  const potentials = state
    .listPokemonInPlay()
    .map((pokemon) => estimateAttackPotential(state, pokemon));
  for (const action of actions) {
    const trial = state.clone(createSeededRandom(seed));
    trial.remixUnseenCards();
    performAction({ choices: context.choices, state: trial }, action);
    const target = trial.listPokemonInPlay()[action.targetIndex];
    const before = potentials[action.targetIndex];
    if (target === undefined || before === undefined) {
      continue;
    }
    const gain =
      (estimateAttackPotential(trial, target) - before) /
      (action.targetIndex === 0 ? 1 : 2);
    if (gain > bestGain) {
      bestGain = gain;
      best = action;
    }
  }
  return best;
}
function estimateAttackPotential(
  state: GameState,
  pokemon: PokemonInPlay
): number {
  const { candidates, units } = listAttackCandidatesWithCosts(state, pokemon);
  return Math.max(
    0,
    ...candidates.map(
      ({ cost, usable }) =>
        (calculateAttackDamage(state, pokemon, usable.attack) ?? 0) /
        (1 + listUnpaidCost(cost, units).length) ** 2
    )
  );
}

function createPrizeProgressPlayout(seed: number): PlayingPolicy {
  const playout = createPlayoutActionPolicy(seed);
  return {
    ...playout,
    choosePokemonToPromoteAfterKnockOut: (state, candidates) => {
      const most = Math.max(
        ...candidates.map((pokemon) => pokemon.energies.length)
      );
      return playout.choosePokemonToPromoteAfterKnockOut(
        state,
        candidates.filter((pokemon) => pokemon.energies.length === most)
      );
    },
    playTurn: (context) => {
      const energyAbility = listAvailableActions(context, "skipRetreat").find(
        (action) => {
          if (action.kind !== "useAbility") {
            return false;
          }
          const card =
            context.state.listPokemonInPlay()[action.pokemonIndex]?.card;
          if (card?.record.category !== CardCategory.Pokemon) {
            return false;
          }
          const effect = card.record.abilities.find(
            (entry) => entry.name === action.abilityName
          )?.translation;
          return (
            effect?.kind === "activatedInPlay" &&
            effect.effect.steps.some(
              (step) => step.operation === "attachEnergyFromHand"
            )
          );
        }
      );
      if (energyAbility !== undefined) {
        performAction(context, energyAbility);
      }
      const energy = chooseEnergyForAttack(context, seed);
      if (energy !== undefined) {
        performAction(context, energy);
      }
      const trigger = listAvailableHandActions(
        context,
        (card) =>
          card.record.category === CardCategory.Pokemon &&
          card.record.abilities.some(
            (ability) =>
              ability.translation?.kind === "triggeredWhenPlacedOnBenchFromHand"
          )
      ).find((action) => action.kind === "placeOnBench");
      if (trigger !== undefined) {
        performAction(context, trigger);
      }
      playout.playTurn(context);
    },
  };
}

const playToDecision = createPlayoutTrialScorer(createPrizeProgressPlayout);

/** 勝てる試し回しが少ない局面でも、場が空になって早く負ける手より、自分がサイドを取り進める手を選ぶ。 */
const scoreOneContinuation: TrialScorer = (input) => {
  const score = playToDecision(input);
  const damage = input.state.opponentFieldDamage;
  const partial =
    score.winRate === 0 && (damage.active > 0 || damage.bench > 0) ? 0.5 : 0;
  const progress =
    (PRIZE_COUNT - input.state.prizes.length + partial) / PRIZE_COUNT;
  return { ...score, winRate: (score.winRate + progress) / 2 };
};

const scorePrizeProgress: TrialScorer = (input) => {
  let { seed } = input;
  const trials: TrialScore[] = [];
  for (let i = 0; i < 3; i += 1) {
    seed = derivePolicySeed(seed);
    const trial = input.state.clone(createSeededRandom(seed));
    trials.push(scoreOneContinuation({ ...input, seed, state: trial }));
  }
  const first = scoreOneContinuation(input);
  return trials.reduce(
    (best, trial) => (trial.winRate > best.winRate ? trial : best),
    first
  );
};
function requireParameter(
  parameters: PlayingPolicyParameters,
  name: keyof PlayingPolicyParameters
): number {
  const value = parameters[name];
  if (value === undefined) {
    throw new Error(`設定の数 ${name} が無い`);
  }
  return value;
}

/** 試しの点数で 1 手ずつ選ぶ探索(候補 2、2b、4)を作る。 */
function createOneStepSearch(
  scoreTrial: TrialScorer,
  samplesPerCandidate: number,
  tieBreak: TrialScoreTieBreak,
  policySeed: number
) {
  return createSearchPolicy({
    samplesPerCandidate,
    scoreTrial,
    searchesEffectChoices: true,
    seed: policySeed,
    tieBreak,
  });
}

function createPlayoutSetting(
  candidate: string,
  samplesPerCandidate: number,
  tieBreak: TrialScoreTieBreak
): PlayingPolicySetting {
  return {
    candidate,
    createPolicy: (_, parameters, policySeed) =>
      createOneStepSearch(
        playoutTrialScorer,
        requireParameter(parameters, "samplesPerCandidate"),
        tieBreak,
        policySeed
      ),
    parameters: { samplesPerCandidate },
  };
}

function createTurnSequenceSetting(
  maxEvaluatedSequences: number
): PlayingPolicySetting {
  return {
    candidate: "3",
    createPolicy: (_, parameters, policySeed) =>
      createTurnSequenceSearchPolicy(
        createOneStepSearch(
          playoutTrialScorer,
          requireParameter(parameters, "samplesPerCandidate"),
          "prizeDifference",
          policySeed
        ),
        {
          maxEvaluatedSequences: requireParameter(
            parameters,
            "maxEvaluatedSequences"
          ),
          samplesPerSequence: requireParameter(
            parameters,
            "samplesPerSequence"
          ),
          scoreTrial: playoutTrialScorer,
          seed: derivePolicySeed(policySeed),
          tieBreak: "prizeDifference",
        }
      ),
    parameters: {
      maxEvaluatedSequences,
      samplesPerCandidate: TURN_SEQUENCE_BASE_SAMPLES_PER_CANDIDATE,
      samplesPerSequence: TURN_SEQUENCE_SAMPLES_PER_SEQUENCE,
    },
  };
}

function createLearnedEvaluationSetting(
  trainingGamesPerDeck: number
): PlayingPolicySetting {
  return {
    candidate: "4",
    createPolicy: (preparation, parameters, policySeed) => {
      const { learnedModel } = preparation;
      if (learnedModel === undefined) {
        throw new Error("学習した場の評価の設定に、学習の結果が渡されていない");
      }
      return createOneStepSearch(
        createLearnedEvaluationTrialScorer(
          learnedModel,
          preparation.deckCardNames,
          createPlayoutActionPolicy
        ),
        requireParameter(parameters, "samplesPerCandidate"),
        "none",
        policySeed
      );
    },
    parameters: {
      samplesPerCandidate: LEARNED_EVALUATION_SAMPLES_PER_CANDIDATE,
      trainingGamesPerDeck,
    },
  };
}

export const PLAYING_POLICY_SETTINGS: Readonly<
  Record<PlayingPolicySettingName, PlayingPolicySetting>
> = {
  "first-action": {
    candidate: "1",
    createPolicy: () => createFirstActionPolicy(),
    parameters: {},
  },
  "learned-evaluation-500": createLearnedEvaluationSetting(500),
  "learned-evaluation-2000": createLearnedEvaluationSetting(2000),
  "playout-prize-tie-break-8": createPlayoutSetting("2b", 8, "prizeDifference"),
  "playout-prize-tie-break-32": createPlayoutSetting(
    "2b",
    32,
    "prizeDifference"
  ),
  "playout-win-rate-8": createPlayoutSetting("2", 8, "none"),
  "playout-win-rate-32": createPlayoutSetting("2", 32, "none"),
  "prize-progress-search": {
    candidate: "77",
    createPolicy: (preparation, parameters, policySeed) => {
      const { learnedModel } = preparation;
      if (learnedModel === undefined) {
        throw new Error("学習した場の評価がない");
      }
      const predict = createLearnedEvaluationTrialScorer(
        learnedModel,
        preparation.deckCardNames,
        createPrizeProgressPlayout
      );
      const scoreWithModel: TrialScorer = (input) => {
        const copy = input.state.clone(createSeededRandom(input.seed));
        const modelScore = predict({ ...input, state: copy });
        const outcome = scorePrizeProgress(input);
        return {
          ...outcome,
          winRate: (7 * outcome.winRate + modelScore.winRate) / 8,
        };
      };
      const base = createOneStepSearch(
        scoreWithModel,
        requireParameter(parameters, "samplesPerCandidate"),
        "prizeDifference",
        policySeed
      );
      const trialRandom = createSeededRandom(derivePolicySeed(policySeed));
      return {
        ...base,
        playTurn(context) {
          base.playTurn(context);
          if (listUsableAttacksOfActive(context).length > 0) {
            return;
          }
          const energy = chooseEnergyForAttack(
            { choices: firstCandidateChoices, state: context.state },
            trialRandom.nextSeed()
          );
          if (energy !== undefined) {
            base.performTurnAction(context, energy);
            base.playTurn(context);
          }
        },
      };
    },
    parameters: { samplesPerCandidate: 64, trainingGamesPerDeck: 500 },
  },
  "random-action": {
    candidate: "1",
    createPolicy: (_, __, policySeed) => createRandomActionPolicy(policySeed),
    parameters: {},
  },
  "turn-sequence-32": createTurnSequenceSetting(32),
  "turn-sequence-128": createTurnSequenceSetting(128),
};

/** 設定の名前の一覧(計測の表の並び)。 */
export const PLAYING_POLICY_SETTING_NAMES: readonly PlayingPolicySettingName[] =
  [
    "first-action",
    "random-action",
    "playout-win-rate-8",
    "playout-win-rate-32",
    "playout-prize-tie-break-8",
    "playout-prize-tie-break-32",
    "turn-sequence-32",
    "turn-sequence-128",
    "learned-evaluation-500",
    "learned-evaluation-2000",
    "prize-progress-search",
  ];
/** 盤面を学習する対戦の手順。比較元の設定は Issue 70 の計測時と同じ手順を使う。 */
export function selectLearningSampleGenerator(
  settingName: PlayingPolicySettingName
): PlayingPolicySettingName {
  return settingName === "prize-progress-search"
    ? "playout-prize-tie-break-32"
    : "playout-prize-tie-break-8";
}

export function isPlayingPolicySettingName(
  name: string
): name is PlayingPolicySettingName {
  return (PLAYING_POLICY_SETTING_NAMES as readonly string[]).includes(name);
}

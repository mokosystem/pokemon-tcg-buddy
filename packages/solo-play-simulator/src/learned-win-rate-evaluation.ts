/**
 * Issue 70 の候補 4: 対戦の記録から、盤面を見て勝率を見積もる場の評価(GLOSSARY.md)を学習させ、試し回しを対戦の終わりまで
 * 進める代わりに使う。学習はロジスティック回帰を自分で書く。特徴の数が数十で、学習は勾配法の繰り返しで短く書け、依存を
 * 足すと骨組みが実行環境に依存しない方針(docs/solo-play-simulator-design.md「README『提供形態』との関係」)に合うかを
 * 依存ごとに確かめる必要があるため。
 */

import { calculateAttackDamage } from "./attack-damage.ts";
import { calculateOpponentAttackDamage } from "./battle-style-solo-play-rules.ts";
import { listUsableAttacksOfActive } from "./card-effects.ts";
import type { Card } from "./cards.ts";
import { calculateMaxHp } from "./continuous-effects.ts";
import { firstCandidateChoices } from "./effect-choices.ts";
import { advanceBattleStyleSoloPlay, type PlayingPolicy } from "./engine.ts";
import { derivePolicySeed } from "./random.ts";
import type { TrialScorer } from "./search-policy.ts";
import { runBattleStyleSoloPlayTrial } from "./simulate.ts";
import { type GameState, PRIZE_COUNT } from "./state.ts";

/** デッキの 60 枚の並びで最初に出てきた順のカードの名前。盤面の特徴のカードの名前の並びに使う。 */
export function listDeckCardNames(cards: readonly Card[]): string[] {
  return [...new Set(cards.map((card) => card.name))];
}

/**
 * 盤面の特徴の名前と値。自分の番に 1 枚引いた後の状態から作る。deckCardNames はデッキの 60 枚の並びで最初に出てきた順の
 * カードの名前(listDeckCardNames)。ルールの値は骨組みの関数から借りる。
 */
export function extractWinRateFeatures(
  state: GameState,
  deckCardNames: readonly string[]
): { readonly names: readonly string[]; readonly values: readonly number[] } {
  const { active } = state;
  if (active === undefined) {
    // 相手の番にバトルポケモンがきぜつしたら、プレイングの判断基準が選んだベンチポケモンを出すか、場にポケモンが
    // いなくなって負けで対戦が終わる(docs/solo-play-simulator-design.md「ダメージときぜつ」「勝敗」)ため、来ない
    throw new Error("バトル場が空の状態の特徴は作らない");
  }
  const nextOpponentAttackDamage = calculateOpponentAttackDamage(
    state.opponentTurnCount + 1
  );
  const activeRemainingHp = calculateMaxHp(state, active) - active.damage;
  const usableAttackDamages = listUsableAttacksOfActive({
    choices: firstCandidateChoices,
    state,
  }).map(({ attack }) => calculateAttackDamage(state, active, attack) ?? 0);
  const inPlay = state.listPokemonInPlay();
  const features: [string, number][] = [
    ["ownRemainingPrizes", state.prizes.length],
    ["opponentRemainingPrizes", state.opponentRemainingPrizeCount],
    ["opponentFieldDamage", state.opponentFieldDamage],
    ["ownTurn", state.turn],
    ["nextOpponentAttackDamage", nextOpponentAttackDamage],
    ["activeRemainingHp", activeRemainingHp],
    // きぜつは受けたダメージの合計が最大 HP 以上になったとき(docs/solo-play-simulator-design.md「ダメージときぜつ」)
    [
      "activeSurvivesNextOpponentAttack",
      activeRemainingHp > nextOpponentAttackDamage ? 1 : 0,
    ],
    ["pokemonInPlay", inPlay.length],
    ["benchPokemon", state.bench.length],
    [
      "energiesInPlay",
      inPlay.reduce((total, pokemon) => total + pokemon.energies.length, 0),
    ],
    ["activeEnergies", active.energies.length],
    ["activeMaxAttackDamage", Math.max(0, ...usableAttackDamages)],
    ["handCards", state.hand.length],
    ["deckCards", state.deck.length],
    ["discardCards", state.discard.length],
    ...deckCardNames.map((name): [string, number] => [
      `inPlay:${name}`,
      state.countInPlay(name),
    ]),
    ...deckCardNames.map((name): [string, number] => [
      `inHand:${name}`,
      state.countInHand(name),
    ]),
  ];
  return {
    names: features.map(([name]) => name),
    values: features.map(([, value]) => value),
  };
}

export interface LabeledFeatureSample {
  readonly features: readonly number[];
  /** その対戦で勝てば 1、負ければ 0。 */
  readonly label: 0 | 1;
}

export interface LearnedWinRateModel {
  readonly bias: number;
  readonly featureMeans: readonly number[];
  readonly featureNames: readonly string[];
  /** 特徴ごとの標準偏差。0 の特徴(値が 1 通りしかない特徴)は 1 として割る。 */
  readonly featureScales: readonly number[];
  readonly weights: readonly number[];
}

export interface LogisticRegressionOptions {
  readonly iterations: number;
  readonly l2Penalty: number;
  readonly learningRate: number;
}

/**
 * 計測で使う学習の設定。試作の固定値で、値を変えて比べた計測は無い(Issue 70 では値を変えて比べない)。
 */
export const LEARNING_OPTIONS: LogisticRegressionOptions = {
  iterations: 300,
  l2Penalty: 0.001,
  learningRate: 0.5,
};

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function standardize(
  features: readonly number[],
  means: readonly number[],
  scales: readonly number[]
): number[] {
  return features.map(
    (value, index) => (value - (means[index] ?? 0)) / (scales[index] ?? 1)
  );
}

function calculateMeansAndScales(
  featureCount: number,
  samples: readonly LabeledFeatureSample[]
): { means: number[]; scales: number[] } {
  const count = Math.max(samples.length, 1);
  const means = Array.from(
    { length: featureCount },
    (_, index) =>
      samples.reduce(
        (total, sample) => total + (sample.features[index] ?? 0),
        0
      ) / count
  );
  const scales = means.map((mean, index) => {
    const variance =
      samples.reduce(
        (total, sample) => total + ((sample.features[index] ?? 0) - mean) ** 2,
        0
      ) / count;
    return variance > 0 ? Math.sqrt(variance) : 1;
  });
  return { means, scales };
}

/** 特徴をそろえて(平均を引き、標準偏差で割る)、全件の勾配で重みを更新する。乱数を使わないので、同じ記録からは同じ結果になる。 */
export function trainLearnedWinRateModel(
  featureNames: readonly string[],
  samples: readonly LabeledFeatureSample[],
  options: LogisticRegressionOptions
): LearnedWinRateModel {
  const { means, scales } = calculateMeansAndScales(
    featureNames.length,
    samples
  );
  const standardized = samples.map((sample) =>
    standardize(sample.features, means, scales)
  );
  const weights = featureNames.map(() => 0);
  let bias = 0;
  const count = Math.max(samples.length, 1);
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    const weightGradients = featureNames.map(() => 0);
    let biasGradient = 0;
    standardized.forEach((features, sampleIndex) => {
      const error =
        sigmoid(
          bias +
            features.reduce(
              (total, value, index) => total + value * (weights[index] ?? 0),
              0
            )
        ) - (samples[sampleIndex]?.label ?? 0);
      biasGradient += error;
      features.forEach((value, index) => {
        weightGradients[index] = (weightGradients[index] ?? 0) + error * value;
      });
    });
    weights.forEach((weight, index) => {
      weights[index] =
        weight -
        options.learningRate *
          ((weightGradients[index] ?? 0) / count + options.l2Penalty * weight);
    });
    bias -= (options.learningRate * biasGradient) / count;
  }
  return {
    bias,
    featureMeans: means,
    featureNames,
    featureScales: scales,
    weights,
  };
}

export function estimateWinRate(
  model: LearnedWinRateModel,
  features: readonly number[]
): number {
  const standardized = standardize(
    features,
    model.featureMeans,
    model.featureScales
  );
  return sigmoid(
    model.bias +
      standardized.reduce(
        (total, value, index) => total + value * (model.weights[index] ?? 0),
        0
      )
  );
}

/** 試行 1 回を回し、自分の番に 1 枚引いた時点ごとの特徴に、その対戦の勝敗を正解として付けて返す。 */
export function collectLearningSamplesOfTrial(options: {
  readonly cards: readonly Card[];
  readonly deckCardNames: readonly string[];
  readonly createGeneratorPolicy: (policySeed: number) => PlayingPolicy;
  readonly trialSeed: number;
  readonly wentFirst: boolean;
}): LabeledFeatureSample[] {
  const featuresAtTurns: (readonly number[])[] = [];
  const result = runBattleStyleSoloPlayTrial({
    cards: options.cards,
    createPolicy: (policySeed) => {
      const generator = options.createGeneratorPolicy(policySeed);
      return {
        ...generator,
        playTurn: (context) => {
          featuresAtTurns.push(
            extractWinRateFeatures(context.state, options.deckCardNames).values
          );
          generator.playTurn(context);
        },
      };
    },
    trialSeed: options.trialSeed,
    wentFirst: options.wentFirst,
  });
  const label = result.outcome === "win" ? 1 : 0;
  return featuresAtTurns.map((features) => ({ features, label }));
}

/**
 * 学習した場の評価で 1 回の試しの点数を出す。複製を軽い手順(試し回しと同じ手順)で、自分の番の終わりの判定、相手の番、
 * 次の自分の番に 1 枚引くところまで進め、そこで勝率を見積もる。途中で勝敗が決まれば、勝ちは 1、負けは 0 にする。
 * 取ったサイドの差は止めた時点の値(比べ方には使わない設定で使う)。
 */
export function createLearnedEvaluationTrialScorer(
  model: LearnedWinRateModel,
  deckCardNames: readonly string[],
  createPlayoutPolicy: (seed: number) => PlayingPolicy
): TrialScorer {
  return ({ resumePoint, seed, state }) => {
    const playoutPolicy = createPlayoutPolicy(derivePolicySeed(seed));
    const stoppedAt = advanceBattleStyleSoloPlay(
      { choices: playoutPolicy, state },
      playoutPolicy,
      resumePoint,
      "ownTurnActions"
    );
    const prizeDifference = calculateTakenPrizeDifference(state);
    if (stoppedAt === undefined) {
      return {
        prizeDifference,
        winRate: state.decision?.reason === "ownPrizesTaken" ? 1 : 0,
      };
    }
    return {
      prizeDifference,
      winRate: estimateWinRate(
        model,
        extractWinRateFeatures(state, deckCardNames).values
      ),
    };
  };
}

/** 取ったサイドの差を、残りの枚数から求める。自分が取った枚数 - 相手が取った枚数。 */
function calculateTakenPrizeDifference(state: GameState): number {
  return (
    PRIZE_COUNT -
    state.prizes.length -
    (PRIZE_COUNT - state.opponentRemainingPrizeCount)
  );
}

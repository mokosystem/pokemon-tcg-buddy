/**
 * プレイヤーの行動(トレーナーズを使う、特性を使う、エネルギーをつける、にげる、ワザを使う)を、
 * カードの記録にある効果の翻訳とともに実行する。プレイングの判断基準(PlayingPolicy)はこの関数で行動する。
 *
 * 翻訳が無いカードは、カードを使う基本処理(トラッシュする、場に出す、つける)だけが起きる
 * (docs/setup-rate-design.md「翻訳が無いカードと計算の前提」)。
 */

import { CardCategory } from "./card-record-schema.ts";
import type { Card } from "./cards.ts";
import { areConditionsMet, type EffectSource } from "./conditions.ts";
import {
  calculateRetreatCost,
  isAbilityNegated,
  listEnergyUnits,
  listUsableAttacks,
  resolveEnergyProvision,
  toEnergyUnits,
  type UsableAttack,
} from "./continuous-effects.ts";
import type { EffectContext } from "./effect-choices.ts";
import {
  canStartEffect,
  findCardEffects,
  resolveAttachedFromHandTriggers,
  runEffect,
  wouldLeaveFieldEmpty,
} from "./effect-operations.ts";
import {
  canPayCost,
  type GameState,
  IllegalMove,
  type PokemonInPlay,
} from "./state.ts";

// ---- トレーナーズ ----

/** グッズ・サポート・スタジアムを手札から使えるか。基本ルールの制限と、翻訳の使える条件の両方を見る。 */
export function canPlayTrainerFromHand(
  context: EffectContext,
  card: Card
): boolean {
  const { state } = context;
  if (!state.hand.includes(card)) {
    return false;
  }
  const source: EffectSource = { card, pokemon: null };
  const effectsAreUsable = findCardEffects(card, "whenPlayed").every(
    (cardEffect) => canStartEffect(state, cardEffect.effect, source, card)
  );
  switch (card.category) {
    case CardCategory.Goods:
      return effectsAreUsable;
    case CardCategory.Supporter:
      return state.canUseSupporter() && effectsAreUsable;
    case CardCategory.Stadium:
      return !state.hasPlayedStadium && state.stadium?.name !== card.name;
    default:
      return false;
  }
}

/** グッズ・サポートを使う、またはスタジアムを出す。グッズとサポートは基本処理の後に効果の翻訳を実行する。 */
export function playTrainerFromHand(context: EffectContext, card: Card): void {
  if (!canPlayTrainerFromHand(context, card)) {
    throw new IllegalMove(`${card.name} は今使えない`);
  }
  const { state } = context;
  switch (card.category) {
    case CardCategory.Goods:
      state.useGoods(card);
      break;
    case CardCategory.Supporter:
      state.useSupporter(card);
      break;
    default:
      state.playStadium(card);
      return;
  }
  for (const cardEffect of findCardEffects(card, "whenPlayed")) {
    runEffect(context, cardEffect.effect, { card, pokemon: null }, card.name);
  }
}

export function attachToolFromHand(
  context: EffectContext,
  card: Card,
  target: PokemonInPlay
): void {
  context.state.attachToolFromHand(card, target);
}

export function canUseStadiumEffect(context: EffectContext): boolean {
  const { state } = context;
  const { stadium } = state;
  if (stadium === null || state.hasUsedStadiumEffect) {
    return false;
  }
  const effects = findCardEffects(stadium, "activatedOncePerTurn");
  return (
    effects.length > 0 &&
    effects.every((cardEffect) =>
      canStartEffect(
        state,
        cardEffect.effect,
        { card: stadium, pokemon: null },
        null
      )
    )
  );
}

/** 場のスタジアムの「自分の番ごとに 1 回」の効果を使う。 */
export function useStadiumEffect(context: EffectContext): void {
  const { stadium } = context.state;
  if (stadium === null || !canUseStadiumEffect(context)) {
    throw new IllegalMove("スタジアムの効果は今使えない");
  }
  context.state.hasUsedStadiumEffect = true;
  context.state.record(`スタジアムの効果 ${stadium.name}`);
  for (const cardEffect of findCardEffects(stadium, "activatedOncePerTurn")) {
    runEffect(
      context,
      cardEffect.effect,
      { card: stadium, pokemon: null },
      stadium.name
    );
  }
}

// ---- 特性 ----

function findAbilityTranslation(card: Card, abilityName: string) {
  if (card.record.category !== CardCategory.Pokemon) {
    return null;
  }
  return (
    card.record.abilities.find((ability) => ability.name === abilityName)
      ?.translation ?? null
  );
}

function markAbilityUsed(
  state: GameState,
  pokemon: PokemonInPlay | null,
  abilityName: string
): void {
  pokemon?.abilitiesUsedThisTurn.add(abilityName);
  state.abilityNamesUsedThisTurn.push(abilityName);
  state.record(`特性 ${abilityName}`);
}

/** 場のポケモンの、使うことを選ぶ特性(番に 1 回など)を今使えるか。 */
export function canUseAbility(
  context: EffectContext,
  pokemon: PokemonInPlay,
  abilityName: string
): boolean {
  const { state } = context;
  const translation = findAbilityTranslation(pokemon.card, abilityName);
  if (
    translation?.kind !== "activatedInPlay" ||
    !state.listPokemonInPlay().includes(pokemon) ||
    isAbilityNegated(state, pokemon)
  ) {
    return false;
  }
  const isUsedUp =
    (translation.usageLimit === "oncePerTurnPerPokemon" &&
      pokemon.abilitiesUsedThisTurn.has(abilityName)) ||
    (translation.usageLimit === "oncePerTurnPerAbilityName" &&
      state.abilityNamesUsedThisTurn.includes(abilityName));
  return (
    !isUsedUp &&
    canStartEffect(
      state,
      translation.effect,
      { card: pokemon.card, pokemon },
      null
    )
  );
}

export function useAbility(
  context: EffectContext,
  pokemon: PokemonInPlay,
  abilityName: string
): void {
  const translation = findAbilityTranslation(pokemon.card, abilityName);
  if (
    translation?.kind !== "activatedInPlay" ||
    !canUseAbility(context, pokemon, abilityName)
  ) {
    throw new IllegalMove(`${pokemon.name} の特性 ${abilityName} は今使えない`);
  }
  markAbilityUsed(context.state, pokemon, abilityName);
  runEffect(
    context,
    translation.effect,
    { card: pokemon.card, pokemon },
    abilityName
  );
}

/**
 * 手札にあるカードの特性(ファイアローex の「エキサイトダイブ」)を今使えるか。手札のカードの特性は、
 * 場のポケモンの特性を無くす効果を受けない(公式 Q&A「ロケット団の監視塔」、2026-09-23 確認)。
 */
export function canUseAbilityFromHand(
  context: EffectContext,
  card: Card,
  abilityName: string
): boolean {
  const translation = findAbilityTranslation(card, abilityName);
  return (
    translation?.kind === "activatedFromHand" &&
    context.state.hand.includes(card) &&
    canStartEffect(
      context.state,
      translation.effect,
      { card, pokemon: null },
      card
    )
  );
}

export function useAbilityFromHand(
  context: EffectContext,
  card: Card,
  abilityName: string
): void {
  const translation = findAbilityTranslation(card, abilityName);
  if (
    translation?.kind !== "activatedFromHand" ||
    !canUseAbilityFromHand(context, card, abilityName)
  ) {
    throw new IllegalMove(`${card.name} の特性 ${abilityName} は今使えない`);
  }
  markAbilityUsed(context.state, null, abilityName);
  runEffect(context, translation.effect, { card, pokemon: null }, abilityName);
}

/**
 * 手札のたねポケモンをベンチに出す。「手札からベンチに出したとき」の特性があり使えるなら、使うかを問い合わせる。
 * 対戦の準備でベンチに出したとき(engine.ts の setupGame)はきっかけにならない(公式 Q&A「ニャースex」、2026-09-23 確認)。
 */
export function placeBasicPokemonOnBenchFromHand(
  context: EffectContext,
  card: Card
): PokemonInPlay {
  const { state } = context;
  const pokemon = state.placeOnBench(card, { from: "hand" });
  if (card.record.category !== CardCategory.Pokemon) {
    return pokemon;
  }
  for (const ability of card.record.abilities) {
    const { translation } = ability;
    if (
      translation?.kind === "triggeredWhenPlacedOnBenchFromHand" &&
      !isAbilityNegated(state, pokemon) &&
      canStartEffect(state, translation.effect, { card, pokemon }, null) &&
      context.choices.choosesToApplyOptionalEffect(state, ability.name)
    ) {
      markAbilityUsed(state, pokemon, ability.name);
      runEffect(context, translation.effect, { card, pokemon }, ability.name);
    }
  }
  return pokemon;
}

// ---- エネルギー、進化、にげる ----

/** 手札からエネルギーをつける(1 番に 1 回)。「手札からつけたとき」の効果(テレパス超エネルギー)を続けて実行する。 */
export function attachEnergyFromHandToPokemon(
  context: EffectContext,
  energy: Card,
  target: PokemonInPlay
): void {
  context.state.attachEnergyFromHand(energy, target);
  resolveAttachedFromHandTriggers(context, energy, target);
}

export function evolvePokemonFromHand(
  context: EffectContext,
  target: PokemonInPlay,
  card: Card
): void {
  if (!context.state.canEvolve(target, card)) {
    throw new IllegalMove(`${target.name} を ${card.name} に進化させられない`);
  }
  context.state.evolve(target, card, { from: "hand" });
}

function sumEnergyUnits(
  state: GameState,
  pokemon: PokemonInPlay,
  energies: readonly Card[]
): number {
  return energies.reduce(
    (total, energy) =>
      total +
      toEnergyUnits(resolveEnergyProvision(state, pokemon, energy)).length,
    0
  );
}

/**
 * にげる。トラッシュするエネルギーは、にげるエネルギーの数に足り、どの 1 枚を除いても足りなくなる組にする
 * (1 枚で 3 個ぶんとして働くエネルギーのように、ちょうどにならない組は許す)。
 */
export function retreatActive(
  context: EffectContext,
  benchPokemon: PokemonInPlay,
  energiesToDiscard: readonly Card[]
): void {
  const { state } = context;
  const { active } = state;
  if (active === null) {
    throw new IllegalMove("バトル場にポケモンがいない");
  }
  const cost = calculateRetreatCost(state, active);
  const paid = sumEnergyUnits(state, active, energiesToDiscard);
  const isMinimal = energiesToDiscard.every(
    (energy) => paid - sumEnergyUnits(state, active, [energy]) < cost
  );
  if (paid < cost || !isMinimal) {
    throw new IllegalMove(
      `にげるエネルギー ${cost} 個に対して ${paid} 個ぶんをトラッシュしようとした`
    );
  }
  state.retreat(benchPokemon, energiesToDiscard);
}

// ---- ワザ ----

/**
 * バトルポケモンが今使えるワザ(エネルギーが足り、先攻の最初の番ではなく、効果の使える条件を満たすもの)。
 * 効果で自分の場のポケモンがいなくなるワザ(場がニャースex だけのときの「しっぽをまく」)は含めない(wouldLeaveFieldEmpty)。
 */
export function listUsableAttacksOfActive(
  context: EffectContext
): UsableAttack[] {
  const { state } = context;
  const { active } = state;
  if (active === null || !state.canAttack()) {
    return [];
  }
  const units = listEnergyUnits(state, active);
  const source: EffectSource = { card: active.card, pokemon: active };
  return listUsableAttacks(state, active).filter(
    ({ attack }) =>
      canPayCost(attack.cost, units) &&
      (attack.effect === null ||
        (areConditionsMet(state, attack.effect.useConditions, source) &&
          !wouldLeaveFieldEmpty(state, attack.effect)))
  );
}

/** バトルポケモンでワザを使い、ダメージ以外の効果の翻訳を実行する。ダメージは相手がいないため与えない。 */
export function useAttack(context: EffectContext, attackName: string): void {
  const { state } = context;
  const { active } = state;
  const usable = listUsableAttacksOfActive(context).find(
    (candidate) => candidate.attack.name === attackName
  );
  if (active === null || usable === undefined) {
    throw new IllegalMove(`ワザ ${attackName} は今使えない`);
  }
  state.attacks.set(state.turn, attackName);
  state.record(`ワザ ${attackName}`);
  const { effect } = usable.attack;
  if (effect !== null) {
    runEffect(
      context,
      effect,
      { card: active.card, pokemon: active },
      attackName
    );
  }
}

/** 自分の番の終わりに自動で起きる効果(イグニッションエネルギーのトラッシュ)を実行する。 */
export function resolveEndOfTurnTriggers(context: EffectContext): void {
  for (const pokemon of context.state.listPokemonInPlay()) {
    for (const energy of [...pokemon.energies]) {
      for (const cardEffect of findCardEffects(
        energy,
        "triggeredAtEndOfOwnTurn"
      )) {
        const source: EffectSource = { card: energy, pokemon };
        if (
          areConditionsMet(
            context.state,
            cardEffect.effect.useConditions,
            source
          )
        ) {
          runEffect(
            context,
            cardEffect.effect,
            source,
            `番の終わり ${energy.name}`
          );
        }
      }
    }
  }
}

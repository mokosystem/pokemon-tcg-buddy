import { calculateAttackDamage } from "./attack-damage.ts";
import { listUsableAttacksOfActive } from "./card-effects.ts";
import { CardCategory } from "./card-record-schema.ts";
import { type Card, isBasicPokemon, isEnergy } from "./cards.ts";
import { type EffectContext, firstCandidateChoices } from "./effect-choices.ts";
import {
  type ActionOf,
  listAvailableHandActions,
  listAvailableRetreatActions,
  type PlayerAction,
  performAction,
} from "./player-actions.ts";
import { createSeededRandom } from "./random.ts";

function canEnterBenchByAbility(card: Card): boolean {
  return (
    card.record.category === CardCategory.Pokemon &&
    card.record.abilities.some(
      ({ translation }) =>
        translation?.kind === "activatedFromHand" &&
        translation.effect.steps.some(
          ({ operation }) => operation === "placeSelfOnBenchFromHand"
        )
    )
  );
}

function copyForAttack(context: EffectContext, seed: number): EffectContext {
  const state = context.state.clone(createSeededRandom(seed));
  return { choices: firstCandidateChoices, state };
}

function strongestUsableAttack(context: EffectContext): number {
  const { active } = context.state;
  if (active === undefined) {
    return 0;
  }
  return Math.max(
    0,
    ...listUsableAttacksOfActive(context).map(
      ({ attack }) => calculateAttackDamage(context.state, active, attack) ?? 0
    )
  );
}

function compareActiveAttachments(context: EffectContext, seed: number) {
  let damage = strongestUsableAttack(context);
  let energy: ActionOf<"attachEnergy"> | undefined;
  for (const action of listAvailableHandActions(context, isEnergy)) {
    if (action.kind !== "attachEnergy" || action.targetIndex !== 0) {
      continue;
    }
    const trial = copyForAttack(context, seed);
    performAction(trial, action);
    const nextDamage = strongestUsableAttack(trial);
    if (nextDamage > damage) {
      damage = nextDamage;
      energy = action;
    }
  }
  return { damage, energy };
}

function chooseHandAttackerAction(
  context: EffectContext,
  seed: number
): PlayerAction | undefined {
  const { state } = context;
  const inHand = state.hand.some(canEnterBenchByAbility);
  if (
    state.hasRetreated ||
    !state.canAttack() ||
    !(
      inHand ||
      state.bench.some((pokemon) => canEnterBenchByAbility(pokemon.card))
    )
  ) {
    return undefined;
  }
  const start = copyForAttack(context, seed);
  start.state.remixUnseenCards();
  let bestDamage = compareActiveAttachments(start, seed).damage;
  let choice: PlayerAction | undefined;
  const compareRetreats = (prepared: EffectContext, first?: PlayerAction) => {
    for (const retreat of listAvailableRetreatActions(prepared.state)) {
      const target = prepared.state.bench[retreat.benchIndex];
      if (target === undefined || !canEnterBenchByAbility(target.card)) {
        continue;
      }
      const trial = copyForAttack(prepared, seed);
      performAction(trial, retreat);
      const { damage } = compareActiveAttachments(trial, seed);
      if (damage > bestDamage) {
        bestDamage = damage;
        choice = first ?? retreat;
      }
    }
  };
  compareRetreats(start);
  if (inHand) {
    const compareAbilities = (
      prepared: EffectContext,
      first?: PlayerAction
    ) => {
      const abilities = listAvailableHandActions(
        prepared,
        canEnterBenchByAbility
      ).filter((action) => action.kind === "useAbilityFromHand");
      for (const ability of abilities) {
        const trial = copyForAttack(prepared, seed);
        performAction(trial, ability);
        compareRetreats(trial, first ?? ability);
      }
    };
    compareAbilities(start);
    if (choice !== undefined) {
      return choice;
    }
    for (const action of listAvailableHandActions(start, isBasicPokemon)) {
      if (action.kind === "placeOnBench") {
        const trial = copyForAttack(start, seed);
        performAction(trial, action);
        compareAbilities(trial, action);
        compareRetreats(trial, action);
      }
    }
  }
  return choice;
}

/** 試し回しで、手札から特性で出せるポケモンに交代して今の番のワザが強くなるとき、その準備を進める。 */
export function playHandAttacker(context: EffectContext, seed: number): void {
  let action = chooseHandAttackerAction(context, seed);
  while (action !== undefined) {
    performAction(context, action);
    if (action.kind === "retreat") {
      const trial = copyForAttack(context, seed);
      trial.state.remixUnseenCards();
      const { energy } = compareActiveAttachments(trial, seed);
      if (energy !== undefined) {
        performAction(context, energy);
      }
      return;
    }
    action = chooseHandAttackerAction(context, seed);
  }
}

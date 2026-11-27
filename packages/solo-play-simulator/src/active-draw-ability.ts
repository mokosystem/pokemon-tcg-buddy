import { canUseAbility } from "./card-effects.ts";
import { CardCategory, type Effect } from "./card-record-schema.ts";
import type { EffectContext } from "./effect-choices.ts";
import type { ActionOf } from "./player-actions.ts";
import type { PokemonInPlay } from "./state.ts";

function canDrawWithoutEmptyingDeck(effect: Effect, deckSize: number): boolean {
  const [step] = effect.steps;
  return (
    !effect.isOptional &&
    effect.steps.length === 1 &&
    step?.operation === "drawCards" &&
    step.count.kind === "fixed" &&
    deckSize > step.count.value
  );
}

function chooseDrawOfPokemon(
  context: EffectContext,
  pokemon: PokemonInPlay,
  pokemonIndex: number,
  requiresActivePosition: boolean
): ActionOf<"useAbility"> | undefined {
  if (pokemon.card.record.category !== CardCategory.Pokemon) {
    return;
  }
  for (const ability of pokemon.card.record.abilities) {
    const { translation } = ability;
    if (
      translation?.kind === "activatedInPlay" &&
      canDrawWithoutEmptyingDeck(
        translation.effect,
        context.state.deck.length
      ) &&
      (!requiresActivePosition ||
        translation.effect.useConditions.some(
          ({ condition }) => condition === "selfIsActive"
        )) &&
      canUseAbility(context, pokemon, ability.name)
    ) {
      return { abilityName: ability.name, kind: "useAbility", pokemonIndex };
    }
  }
}

/** バトル場を離れると使えなくなり、山札を引く以外の処理がない特性を選ぶ。 */
export function chooseActiveDraw(
  context: EffectContext
): ActionOf<"useAbility"> | undefined {
  const { active, decision } = context.state;
  if (decision === undefined && active !== undefined) {
    return chooseDrawOfPokemon(context, active, 0, true);
  }
}

/** 番の行動を終える直前に、使えるままのドロー特性があれば山札から引く。 */
export function chooseDrawBeforeEndingTurn(
  context: EffectContext
): ActionOf<"useAbility"> | undefined {
  if (context.state.decision !== undefined) {
    return;
  }
  for (const [index, pokemon] of context.state.listPokemonInPlay().entries()) {
    const draw = chooseDrawOfPokemon(context, pokemon, index, false);
    if (draw !== undefined) {
      return draw;
    }
  }
}

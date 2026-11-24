import { canUseAbility } from "./card-effects.ts";
import { CardCategory } from "./card-record-schema.ts";
import type { EffectContext } from "./effect-choices.ts";
import type { ActionOf } from "./player-actions.ts";

/** バトル場を離れると使えなくなり、山札を引く以外の処理がない特性を選ぶ。 */
export function chooseActiveDraw(
  context: EffectContext
): ActionOf<"useAbility"> | undefined {
  const { active } = context.state;
  if (
    context.state.decision !== undefined ||
    active?.card.record.category !== CardCategory.Pokemon
  ) {
    return undefined;
  }
  for (const ability of active.card.record.abilities) {
    const { translation } = ability;
    if (
      translation?.kind !== "activatedInPlay" ||
      translation.effect.isOptional
    ) {
      continue;
    }
    const { steps, useConditions } = translation.effect;
    const [step] = steps;
    if (
      steps.length === 1 &&
      step?.operation === "drawCards" &&
      step.count.kind === "fixed" &&
      context.state.deck.length > step.count.value &&
      useConditions.some(({ condition }) => condition === "selfIsActive") &&
      canUseAbility(context, active, ability.name)
    ) {
      return { abilityName: ability.name, kind: "useAbility", pokemonIndex: 0 };
    }
  }
  return undefined;
}

import { CardCategory } from "./card-record-schema.ts";
import { findCardEffects } from "./effect-operations.ts";
import type { ActionOf, PlayerAction } from "./player-actions.ts";

export function onlySwitchesWithBench(
  action: PlayerAction
): action is ActionOf<"playTrainer"> {
  if (
    action.kind !== "playTrainer" ||
    action.card.category !== CardCategory.Goods
  ) {
    return false;
  }
  const effects = findCardEffects(action.card, "whenPlayed");
  return (
    effects.length === 1 &&
    effects.every(({ effect }) => {
      const [step] = effect.steps;
      return (
        !effect.isOptional &&
        effect.steps.length === 1 &&
        step?.operation === "switchActiveWithBench" &&
        step.benchFilter === undefined
      );
    })
  );
}

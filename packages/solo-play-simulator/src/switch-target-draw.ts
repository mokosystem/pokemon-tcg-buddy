import { chooseActiveDraw } from "./active-draw-ability.ts";
import { listUsableAttacksOfActive } from "./card-effects.ts";
import { firstCandidateChoices } from "./effect-choices.ts";
import {
  listAvailableRetreatActions,
  performAction,
} from "./player-actions.ts";
import { createSeededRandom } from "./random.ts";
import type { GameState, PokemonInPlay } from "./state.ts";

function compareSwitchTarget(
  state: GameState,
  target: PokemonInPlay,
  seed: number
) {
  const trial = state.clone(createSeededRandom(seed));
  trial.remixUnseenCards();
  const previous = trial.active;
  const pivot = trial.bench[state.bench.indexOf(target)];
  if (previous === undefined || pivot === undefined) {
    return;
  }
  trial.switchActive(pivot);
  const context = { choices: firstCandidateChoices, state: trial };
  const draw = chooseActiveDraw(context);
  const canAttack = listUsableAttacksOfActive(context).length > 0;
  if (draw !== undefined) {
    performAction(context, draw);
  }
  const canReturn = listAvailableRetreatActions(trial).some(
    (action) =>
      action.energiesToDiscard.length === 0 &&
      trial.bench[action.benchIndex] === previous
  );
  return { canAttack, canDraw: draw !== undefined, canReturn };
}

/** 選んだ交代先でワザもドローも使えず元に戻れる場面で、先に引いて戻れる交代先が1匹なら選ぶ。 */
export function drawsBeforeFreeRetreat(
  state: GameState,
  candidates: readonly PokemonInPlay[],
  chosenIndex: number,
  seed: number | undefined
): number | undefined {
  const chosen = candidates[chosenIndex];
  if (
    chosen === undefined ||
    seed === undefined ||
    candidates.length < 2 ||
    listUsableAttacksOfActive({ choices: firstCandidateChoices, state })
      .length > 0
  ) {
    return undefined;
  }
  const selected = compareSwitchTarget(state, chosen, seed);
  if (!selected?.canReturn || selected.canAttack || selected.canDraw) {
    return undefined;
  }
  const draws = candidates.flatMap((target, index) => {
    if (target === chosen) {
      return [];
    }
    const alternative = compareSwitchTarget(state, target, seed);
    return alternative?.canDraw && alternative.canReturn ? [index] : [];
  });
  return draws.length === 1 ? draws[0] : undefined;
}

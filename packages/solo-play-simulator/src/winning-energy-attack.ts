import { takePrizesForOpponentFieldDamage } from "./battle-style-solo-play-rules.ts";
import { listUsableAttacksOfActive, useAttack } from "./card-effects.ts";
import { type BasicOperation, CardCategory } from "./card-record-schema.ts";
import type { Card } from "./cards.ts";
import { type EffectChoices, firstCandidateChoices } from "./effect-choices.ts";
import { findCardEffects } from "./effect-operations.ts";
import {
  type ActionOf,
  listAvailableHandActions,
  listAvailableRetreatActions,
  performAction,
} from "./player-actions.ts";
import { createSeededRandom } from "./random.ts";
import type { GameState } from "./state.ts";

function hasEnergyOperation(
  card: Card,
  operation: BasicOperation["operation"]
): boolean {
  return findCardEffects(card, "whenPlayed").some(
    ({ effect }) =>
      effect.steps.length === 1 && effect.steps[0]?.operation === operation
  );
}

function basicEnergyType(card: Card): string {
  return card.provision?.kind === "type" ? card.provision.type : "";
}

function choicesForAttacker(targetIndex: number): EffectChoices {
  return {
    ...firstCandidateChoices,
    chooseCards(state, request) {
      const heldTypes = new Set(
        state.hand
          .filter((card) => card.category === CardCategory.BasicEnergy)
          .map(basicEnergyType)
      );
      const candidates = request.candidates.toSorted(
        (a, b) =>
          Number(heldTypes.has(basicEnergyType(b))) -
            Number(heldTypes.has(basicEnergyType(a))) ||
          basicEnergyType(a).localeCompare(basicEnergyType(b))
      );
      return firstCandidateChoices.chooseCards(state, {
        ...request,
        candidates,
      });
    },
    choosePokemon(state, request) {
      const target = state.listPokemonInPlay()[targetIndex];
      const candidates = request.candidates.toSorted(
        (a, b) => Number(b === target) - Number(a === target)
      );
      return candidates.slice(0, request.maxCount);
    },
  };
}

function winningAttackIndex(
  state: GameState,
  seed: number
): number | undefined {
  const context = { choices: firstCandidateChoices, state };
  for (const [index, attack] of listUsableAttacksOfActive(context).entries()) {
    if (
      attack.attack.damage.kind !== "fixed" ||
      attack.attack.effect !== undefined
    ) {
      continue;
    }
    const trial = state.clone(createSeededRandom(seed));
    const trialContext = { choices: firstCandidateChoices, state: trial };
    const candidate = listUsableAttacksOfActive(trialContext)[index];
    if (candidate === undefined) {
      continue;
    }
    useAttack(trialContext, candidate);
    takePrizesForOpponentFieldDamage(trial);
    if (trial.decision?.reason === "ownPrizesTaken") {
      return index;
    }
  }
  return undefined;
}

function energyTrainer(
  state: GameState,
  operation: BasicOperation["operation"]
) {
  return listAvailableHandActions(
    { choices: firstCandidateChoices, state },
    (card) => hasEnergyOperation(card, operation)
  ).find((action) => action.kind === "playTrainer");
}

function attachAndRetreat(
  state: GameState,
  targetIndex: number,
  attachment: ActionOf<"attachEnergy"> | undefined
): void {
  const choices = choicesForAttacker(targetIndex);
  const context = { choices, state };
  if (attachment !== undefined) {
    performAction(context, attachment);
  }
  const fromDiscard = energyTrainer(
    state,
    "attachEnergyFromDiscardToEachChosenPokemon"
  );
  if (fromDiscard !== undefined) {
    performAction(context, fromDiscard);
  }
  const retreat = listAvailableRetreatActions(state).find(
    (action) => action.benchIndex + 1 === targetIndex
  );
  if (retreat !== undefined) {
    performAction(context, retreat);
  }
}

function finishWithVisibleEnergy(
  state: GameState,
  targetIndex: number,
  seed: number
): number | undefined {
  const available = listAvailableHandActions(
    { choices: firstCandidateChoices, state },
    (card) => card.category === CardCategory.BasicEnergy
  );
  const attachments = available.filter(
    (a): a is ActionOf<"attachEnergy"> =>
      a.kind === "attachEnergy" && a.targetIndex === targetIndex
  );
  for (const attachment of [undefined, ...attachments]) {
    const trial = state.clone(createSeededRandom(seed));
    trial.remixUnseenCards();
    attachAndRetreat(trial, targetIndex, attachment);
    const winner = winningAttackIndex(trial, seed);
    if (winner !== undefined) {
      attachAndRetreat(state, targetIndex, attachment);
      return winner;
    }
  }
  return undefined;
}

/** 相手の残りサイドが1枚なら、山札で探すエネルギーと手札・トラッシュのエネルギーを同じ攻撃に使って取り切れるかを試す。 */
export function prepareWinningEnergyAttack(
  state: GameState,
  seed: number
): number | undefined {
  if (state.opponentRemainingPrizeCount !== 1 || !state.canAttack()) {
    return undefined;
  }
  const search = energyTrainer(state, "searchDeckIntoHandAndAttachRest");
  if (search === undefined) {
    return undefined;
  }
  const start = state.clone(createSeededRandom(seed));
  start.remixUnseenCards();
  const ready = winningAttackIndex(start, seed);
  if (ready !== undefined) {
    return ready;
  }
  for (const targetIndex of start.listPokemonInPlay().keys()) {
    const trial = start.clone(createSeededRandom(seed));
    const choices = choicesForAttacker(targetIndex);
    performAction({ choices, state: trial }, search);
    if (finishWithVisibleEnergy(trial, targetIndex, seed) !== undefined) {
      performAction({ choices, state }, search);
      // 実際に探すとサイドに必要なエネルギーがある場合もある。手札と場から使える手を選び直す。
      return finishWithVisibleEnergy(state, targetIndex, seed);
    }
  }
  return undefined;
}

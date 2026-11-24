import { createFirstActionPolicy } from "./action-list-playing-policies.ts";
import { listUsableAttacksOfActive } from "./card-effects.ts";
import { type Card, isEnergy } from "./cards.ts";
import { firstCandidateChoices } from "./effect-choices.ts";
import { advanceBattleStyleSoloPlay } from "./engine.ts";
import { listAvailableHandActions, performAction } from "./player-actions.ts";
import { createSeededRandom } from "./random.ts";
import type { GameState } from "./state.ts";

function canAttackNextTurn(
  state: GameState,
  seed: number,
  searched?: Card
): boolean {
  const next = state.clone(createSeededRandom(seed));
  next.shuffleUnknownDeckOrder();
  if (searched !== undefined) {
    next.takeFromDeckToHand(searched);
  }
  const knownEnergy = new Set(next.hand.filter(isEnergy));
  const policy = {
    ...createFirstActionPolicy(),
    chooseAttack: () => undefined,
  };
  const context = { choices: policy, state: next };
  advanceBattleStyleSoloPlay(
    context,
    policy,
    "ownTurnAttack",
    "ownTurnActions"
  );
  if (next.decision !== undefined) {
    return false;
  }
  if (listUsableAttacksOfActive(context).length > 0) {
    return true;
  }
  // 次の番のドローやサイドから偶然エネルギーが来ることを前提にしない。
  const attachments = listAvailableHandActions(context, (card) =>
    knownEnergy.has(card)
  );
  for (const action of attachments) {
    if (action.kind !== "attachEnergy" || action.targetIndex !== 0) {
      continue;
    }
    const trial = {
      choices: firstCandidateChoices,
      state: next.clone(createSeededRandom(seed)),
    };
    performAction(trial, action);
    if (listUsableAttacksOfActive(trial).length > 0) {
      return true;
    }
  }
  return false;
}

/** 山札を探せるワザのあと、手札だけでは次の番に攻撃できないとき、攻撃を可能にするエネルギーを探す。 */
export function energiesForNextAttack(
  state: GameState,
  candidates: readonly Card[],
  seed: number
): Set<Card> {
  const energies = new Set(candidates.filter(isEnergy));
  if (energies.size === 0 || canAttackNextTurn(state, seed)) {
    return new Set();
  }
  return new Set(
    [...energies].filter((card) => canAttackNextTurn(state, seed, card))
  );
}

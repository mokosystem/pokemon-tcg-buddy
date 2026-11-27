import { chooseActiveDraw } from "./active-draw-ability.ts";
import { calculateAttackDamage } from "./attack-damage.ts";
import { listUsableAttacksOfActive } from "./card-effects.ts";
import { CardCategory } from "./card-record-schema.ts";
import { type EffectContext, firstCandidateChoices } from "./effect-choices.ts";
import { findCardEffects } from "./effect-operations.ts";
import {
  type ActionOf,
  listAvailableRetreatActions,
  type PlayerAction,
  performAction,
} from "./player-actions.ts";
import { createSeededRandom } from "./random.ts";

function onlySwitches(action: PlayerAction): action is ActionOf<"playTrainer"> {
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

function drawsWithSupporter(action: PlayerAction): boolean {
  return (
    action.kind === "playTrainer" &&
    action.card.category === CardCategory.Supporter &&
    findCardEffects(action.card, "whenPlayed").some(
      ({ effect }) =>
        !effect.isOptional &&
        effect.steps.some(
          (step) =>
            step.operation === "drawCards" ||
            (step.operation === "branchOnCondition" &&
              step.stepsWhenMet.some((s) => s.operation === "drawCards") &&
              step.stepsOtherwise.some((s) => s.operation === "drawCards"))
        )
    )
  );
}

/** 引くサポートを使えるなら、どの交代先でも今のワザを失うグッズは手札が変わった後で比べ直す。 */
export function deferSwitchBeforeDrawing(
  context: EffectContext,
  actions: readonly PlayerAction[],
  seed: number
): readonly PlayerAction[] {
  const item = actions.find(onlySwitches);
  const { state } = context;
  const { active } = state;
  if (
    item === undefined ||
    active === undefined ||
    !actions.some(drawsWithSupporter) ||
    !listUsableAttacksOfActive(context).some(
      ({ attack }) => (calculateAttackDamage(state, active, attack) ?? 0) > 0
    )
  ) {
    return actions;
  }
  for (const index of state.bench.keys()) {
    const trial = state.clone(createSeededRandom(seed));
    trial.remixUnseenCards();
    const target = trial.bench[index];
    const trialContext: EffectContext = {
      choices: {
        ...firstCandidateChoices,
        choosePokemon: (_state, request) =>
          request.candidates.filter((p) => p === target),
      },
      state: trial,
    };
    performAction(trialContext, item);
    if (
      listUsableAttacksOfActive(trialContext).length > 0 ||
      chooseActiveDraw(trialContext) !== undefined ||
      listAvailableRetreatActions(trial).some(
        (a) => a.energiesToDiscard.length === 0
      )
    ) {
      return actions;
    }
  }
  return actions.filter((action) => !onlySwitches(action));
}

import { expect, test } from "bun:test";
import { useAttack } from "./card-effects.ts";
import {
  activeOf,
  buildRecordedCard,
  buildState,
} from "./card-test-support.ts";
import { createSeededRandom } from "./random.ts";
import { createSearchPolicy, type TrialScorer } from "./search-policy.ts";

function useAttackWithSearch(
  deckIds: string[],
  scoreTrial: TrialScorer,
  knownTopCount = 0
) {
  const state = buildState({
    active: buildRecordedCard("050400"),
    deck: deckIds.map(buildRecordedCard),
    random: createSeededRandom(17),
  });
  state.knownDeckTopCount = knownTopCount;
  activeOf(state).energies.push(buildRecordedCard("049452"));
  const policy = createSearchPolicy({
    prefersOptionalDeckSearch: true,
    samplesPerCandidate: 1,
    scoreTrial,
    searchesEffectChoices: true,
    seed: 17,
    tieBreak: "none",
  });
  const context = { choices: policy, state };
  const attack = policy.chooseAttack(context);
  if (attack === undefined) {
    throw new Error("ワザを選ばなかった");
  }
  useAttack(context, attack);
  return state;
}

test("費用のない山札の探索では、候補の先頭を取ると評価が下がるときも、後ろの2枚の組を比べる", () => {
  const state = useAttackWithSearch(
    ["050746", "050746", "048351", "050423"],
    ({ state: trial }) => {
      const pair = ["048351", "050423"].every((id) =>
        trial.hand.some((card) => card.cardId === id)
      );
      const withoutPair = trial.hand.length === 0 ? 0.8 : 0.3;
      const withAttack = pair ? 1 : withoutPair;
      return {
        prizeDifference: 0,
        winRate: trial.attacks.has(trial.turn) ? withAttack : 0,
      };
    }
  );
  expect(state.hand.map((card) => card.cardId).sort()).toEqual([
    "048351",
    "050423",
  ]);
});

test("山札の上が分かるときや山札が少ないときは、探さない手も比べられる", () => {
  const scoreTrial: TrialScorer = ({ state }) => ({
    prizeDifference: 0,
    winRate: state.attacks.has(state.turn) && state.hand.length === 0 ? 1 : 0,
  });
  const knownTop = useAttackWithSearch(
    ["050746", "050746", "048351", "050423"],
    scoreTrial,
    1
  );
  expect(knownTop.hand).toHaveLength(0);
  expect(knownTop.knownDeckTopCount).toBe(1);
  const smallDeck = useAttackWithSearch(["048351", "050423"], scoreTrial);
  expect(smallDeck.hand).toHaveLength(0);
  expect(smallDeck.deck).toHaveLength(2);
});

test("次の番にも攻撃を続けられるエネルギーと、残りの候補から評価の高い1枚を探す", () => {
  const state = useAttackWithSearch(
    ["048351", "050423", "049452", "050746"],
    ({ state: trial }) => {
      const hasCharmander = trial.hand.some((card) => card.cardId === "048351");
      const hasRareCandy = trial.hand.some((card) => card.cardId === "050423");
      const score = Number(hasCharmander) * 0.5 + Number(hasRareCandy) * 0.3;
      return {
        prizeDifference: 0,
        winRate: trial.attacks.has(trial.turn) ? 0.1 + score : 0,
      };
    }
  );
  expect(state.hand.map((card) => card.cardId).sort()).toEqual([
    "048351",
    "049452",
  ]);
});

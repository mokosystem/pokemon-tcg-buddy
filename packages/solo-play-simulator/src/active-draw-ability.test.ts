import { expect, test } from "bun:test";
import { chooseActiveDraw } from "./active-draw-ability.ts";
import {
  buildContext,
  buildRecordedCard,
  buildState,
} from "./card-test-support.ts";
import { createSeededRandom } from "./random.ts";
import { createSearchPolicy, type TrialScoringInput } from "./search-policy.ts";

test("2枚引くより番を終える評価が高くても、バトル場のドロー特性を使ってから次の手を選ぶ", () => {
  const front = buildRecordedCard("047847");
  const fire = buildRecordedCard("050746");
  const state = buildState({
    active: front,
    deck: [fire, fire, fire],
    random: createSeededRandom(23),
  });
  const original = state.clone(createSeededRandom(23));
  const options = {
    samplesPerCandidate: 1,
    scoreTrial: ({ state: trial }: TrialScoringInput) => ({
      prizeDifference: 0,
      winRate: trial.hand.length === 0 ? 1 : 0,
    }),
    searchesEffectChoices: true,
    seed: 17,
    tieBreak: "none" as const,
  };
  const baseline = createSearchPolicy(options);
  baseline.playTurn({ choices: baseline, state: original });
  expect(original.hand).toHaveLength(0);
  expect(original.deck).toHaveLength(3);

  const policy = createSearchPolicy({
    ...options,
    chooseBeforeSearch: chooseActiveDraw,
  });
  policy.playTurn({ choices: policy, state });
  expect(state.hand).toEqual([fire, fire]);
  expect(state.deck).toHaveLength(1);
  expect(chooseActiveDraw(buildContext(state))).toBeUndefined();
});

test("引くと山札が空になる局面は、探索で番を終える手と比べられる", () => {
  const front = buildRecordedCard("047847");
  const fire = buildRecordedCard("050746");
  const state = buildState({ active: front, deck: [fire, fire] });
  expect(chooseActiveDraw(buildContext(state))).toBeUndefined();
});

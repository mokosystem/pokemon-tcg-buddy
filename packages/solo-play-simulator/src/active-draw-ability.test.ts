import { expect, test } from "bun:test";
import {
  chooseActiveDraw,
  chooseDrawBeforeEndingTurn,
} from "./active-draw-ability.ts";
import {
  buildContext,
  buildRecordedCard,
  buildState,
} from "./card-test-support.ts";
import { listAvailableAbilityActions } from "./player-actions.ts";
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

test("番の行動を終える直前にベンチの特性で3枚引き、その中のエネルギーを使う", () => {
  const front = buildRecordedCard("048351");
  const bench = buildRecordedCard("049205");
  const fire = buildRecordedCard("050746");
  const state = buildState({
    active: front,
    bench: [bench],
    deck: [fire, fire, fire, fire],
    random: createSeededRandom(23),
  });
  expect(chooseDrawBeforeEndingTurn(buildContext(state))).toBeUndefined();
  state.opponentTurnCount = 2;
  state.latestOpponentTurnWithOwnKnockOut = 2;
  const context = buildContext(state);
  expect(listAvailableAbilityActions(context)).toContainEqual({
    abilityName: "さかてにとる",
    kind: "useAbility",
    pokemonIndex: 1,
  });
  const emptyAfterDraw = state.clone(createSeededRandom(23));
  emptyAfterDraw.deck.pop();
  expect(
    chooseDrawBeforeEndingTurn(buildContext(emptyAfterDraw))
  ).toBeUndefined();
  const options = {
    samplesPerCandidate: 1,
    scoreTrial: ({ state: trial }: TrialScoringInput) => ({
      prizeDifference: 0,
      winRate: Number(
        trial.hand.length === 0 || trial.active?.energies.length === 1
      ),
    }),
    searchesEffectChoices: true,
    seed: 17,
    tieBreak: "none" as const,
  };
  const before = state.clone(createSeededRandom(23));
  const base = createSearchPolicy(options);
  base.playTurn({ choices: base, state: before });
  expect(before.deck).toHaveLength(4);
  const policy = createSearchPolicy({
    ...options,
    chooseBeforeEndingTurn: chooseDrawBeforeEndingTurn,
  });
  policy.playTurn({ choices: policy, state });
  expect(state.deck).toHaveLength(1);
  expect(state.active?.energies).toEqual([fire]);
  expect(state.hand).toHaveLength(2);
});

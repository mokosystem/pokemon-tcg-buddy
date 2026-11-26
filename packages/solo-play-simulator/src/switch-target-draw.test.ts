import { expect, test } from "bun:test";
import { chooseActiveDraw } from "./active-draw-ability.ts";
import {
  activeOf,
  benchAt,
  buildContext,
  buildRecordedCard,
  buildState,
} from "./card-test-support.ts";
import {
  listAvailableRetreatActions,
  performAction,
} from "./player-actions.ts";
import { createSeededRandom } from "./random.ts";
import { createSearchPolicy } from "./search-policy.ts";
import { onlySwitchesWithBench } from "./switch-goods.ts";
import { drawsBeforeFreeRetreat } from "./switch-target-draw.ts";

const original = buildRecordedCard("048358");
const free = buildRecordedCard("049524");
const draw = buildRecordedCard("047847");
const fire = buildRecordedCard("050746");
const item = buildRecordedCard("050744");

function switchState(deckSize = 4) {
  return buildState({
    active: original,
    bench: [free, draw],
    deck: Array.from({ length: deckSize }, () => fire),
    hand: [item],
    random: createSeededRandom(23),
    turn: 1,
    wentFirst: false,
  });
}

test("グッズの交代先で2枚引き、元のバトルポケモンへにげる", () => {
  for (const enabled of [false, true]) {
    const state = switchState();
    const previous = activeOf(state);
    const policy = createSearchPolicy({
      ...(enabled ? { prefersDrawAtSwitch: true } : {}),
      samplesPerCandidate: 1,
      scoreTrial: ({ state: trial }) => ({
        prizeDifference: 0,
        winRate: trial.active?.card === free ? 1 : 0,
      }),
      searchesEffectChoices: true,
      seed: 17,
      tieBreak: "none",
    });
    const context = buildContext(state);
    policy.performTurnAction(context, { card: item, kind: "playTrainer" });
    expect(activeOf(state).card).toBe(enabled ? draw : free);
    expect(state.hand).toHaveLength(0);
    if (enabled) {
      const action = chooseActiveDraw(context);
      if (!action) {
        throw new Error("選んだ交代先で引けない");
      }
      performAction(context, action);
      expect(state.hand).toEqual([fire, fire]);
      const retreat = listAvailableRetreatActions(state).find(
        (a) =>
          a.energiesToDiscard.length === 0 &&
          state.bench[a.benchIndex] === previous
      );
      if (!retreat) {
        throw new Error("元のバトルポケモンへにげられない");
      }
      performAction(context, retreat);
      expect(state.active).toBe(previous);
    }
  }
});

test("元のバトルポケモンか選んだ交代先がワザを使えるなら選択を保つ", () => {
  const state = switchState();
  activeOf(state).energies.push(fire, fire, fire);
  expect(drawsBeforeFreeRetreat(state, state.bench, 0, 17)).toBeUndefined();
  const other = buildState({
    active: original,
    bench: [original, free, draw],
    deck: [fire, fire, fire],
  });
  benchAt(other, 0).energies.push(fire, fire, fire);
  expect(drawsBeforeFreeRetreat(other, other.bench, 0, 17)).toBeUndefined();
});

test("引くと山札が空になる場合と、この番ににげた場合は交代先を保つ", () => {
  const state = switchState(2);
  expect(drawsBeforeFreeRetreat(state, state.bench, 0, 17)).toBeUndefined();
  const alreadyRetreated = switchState();
  alreadyRetreated.hasRetreated = true;
  expect(
    drawsBeforeFreeRetreat(alreadyRetreated, alreadyRetreated.bench, 0, 17)
  ).toBeUndefined();
});

test("すでにドロー特性を選んでいる場合と引いて戻れる候補が複数の場合は探索の選択を保つ", () => {
  const state = switchState();
  expect(drawsBeforeFreeRetreat(state, state.bench, 1, 17)).toBeUndefined();
  const multiple = buildState({
    active: original,
    bench: [free, draw, draw],
    deck: [fire, fire, fire],
  });
  expect(
    drawsBeforeFreeRetreat(multiple, multiple.bench, 0, 17)
  ).toBeUndefined();
});

test("自分のベンチと入れ替えるだけのグッズを判別する", () => {
  expect(onlySwitchesWithBench({ card: item, kind: "playTrainer" })).toBe(true);
  expect(
    onlySwitchesWithBench({
      card: buildRecordedCard("050468"),
      kind: "playTrainer",
    })
  ).toBe(false);
  expect(onlySwitchesWithBench({ kind: "endTurn" })).toBe(false);
});

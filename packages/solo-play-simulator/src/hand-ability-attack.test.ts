import { expect, test } from "bun:test";
import {
  buildContext,
  buildRecordedCard,
  buildState,
  useAttackNamed,
} from "./card-test-support.ts";
import { playHandAttacker } from "./hand-ability-attack.ts";

test("手札の特性を使えるようにたねポケモンを出し、その番に交代して攻撃する", () => {
  const attacker = buildRecordedCard("050400");
  const energy = buildRecordedCard("049452");
  const state = buildState({
    active: buildRecordedCard("048351"),
    deck: [buildRecordedCard("050423"), buildRecordedCard("050746")],
    hand: [buildRecordedCard("047847"), attacker, energy],
    turn: 1,
    wentFirst: false,
  });
  const context = buildContext(state);
  playHandAttacker(context, 17);
  expect(state.active?.card).toBe(attacker);
  expect(state.active?.energies).toEqual([energy]);
  useAttackNamed(context, "かぎづめハント");
  expect(state.opponentFieldDamage.active).toBe(150);
});

test("交代してもその番にワザを使えない場合は、エネルギーとにげる機会を残す", () => {
  const active = buildRecordedCard("048351");
  const state = buildState({
    active,
    bench: [buildRecordedCard("047847")],
    hand: [buildRecordedCard("050400"), buildRecordedCard("050746")],
    turn: 1,
    wentFirst: false,
  });
  playHandAttacker(buildContext(state), 17);
  expect(state.active?.card).toBe(active);
  expect(state.hand).toHaveLength(2);
  expect(state.hasRetreated).toBe(false);
  expect(state.hasAttachedEnergy).toBe(false);
});

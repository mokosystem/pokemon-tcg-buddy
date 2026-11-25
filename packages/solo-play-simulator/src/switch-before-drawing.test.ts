import { expect, test } from "bun:test";
import { takePrizesForOpponentFieldDamage } from "./battle-style-solo-play-rules.ts";
import { placeBasicPokemonOnBenchFromHand } from "./card-effects.ts";
import {
  activeOf,
  benchAt,
  buildContext,
  buildRecordedCard,
  buildState,
  useAttackNamed,
} from "./card-test-support.ts";
import type { Card } from "./cards.ts";
import { listAvailableActions, performAction } from "./player-actions.ts";
import { deferSwitchBeforeDrawing } from "./switch-before-drawing.ts";

function buildSwitchDecision() {
  const fire = buildRecordedCard("050478");
  const water = buildRecordedCard("050479");
  const lightning = buildRecordedCard("050480");
  const attacker = buildRecordedCard("050396");
  const item = buildRecordedCard("049602");
  const supporter = buildRecordedCard("050468");
  const transfer = buildRecordedCard("049354");
  const state = buildState({
    active: attacker,
    bench: [
      attacker,
      buildRecordedCard("049694"),
      buildRecordedCard("048543"),
      buildRecordedCard("048636"),
    ],
    deck: [transfer, fire, fire, fire, fire, fire, fire],
    hand: [supporter, item],
    turn: 4,
    wentFirst: false,
  });
  state.hasAttachedEnergy = true;
  activeOf(state).energies.push(water, fire, lightning);
  benchAt(state, 0).energies.push(lightning, fire);
  benchAt(state, 2).energies.push(fire);
  benchAt(state, 3).damage = 200;
  return { context: buildContext(state), item, supporter, transfer, water };
}

test("攻撃できるバトルポケモンからどの控えに交代してもワザを失うとき、引く前のグッズだけを見送る", () => {
  const { context, item, water } = buildSwitchDecision();
  const actions = listAvailableActions(context);
  const isItem = (action: (typeof actions)[number]) =>
    action.kind === "playTrainer" && action.card === item;
  expect(actions.some(isItem)).toBe(true);
  expect(deferSwitchBeforeDrawing(context, actions, 17)).toEqual(
    actions.filter((a) => !isItem(a))
  );
  expect(context.state.events).toEqual([]);
  expect(context.state.hand).toContain(item);
  benchAt(context.state, 0).energies.push(water);
  const prepared = listAvailableActions(context);
  expect(deferSwitchBeforeDrawing(context, prepared, 17)).toBe(prepared);
});

test("引くサポートをもう使えないときは入れ替えるグッズも比べる", () => {
  const { context } = buildSwitchDecision();
  context.state.hasUsedSupporter = true;
  const actions = listAvailableActions(context);
  expect(deferSwitchBeforeDrawing(context, actions, 17)).toBe(actions);
});

test("引いてから交代できる控えがいるとき、グッズを探索の候補に残す", () => {
  const { context } = buildSwitchDecision();
  const { state } = context;
  const pivot = buildRecordedCard("047847");
  const support = buildRecordedCard("049524");
  state.hand.push(pivot, support);
  state.bench.splice(1);
  placeBasicPokemonOnBenchFromHand(context, pivot);
  placeBasicPokemonOnBenchFromHand(context, support);
  const actions = listAvailableActions(context);
  expect(deferSwitchBeforeDrawing(context, actions, 17)).toBe(actions);
});

test("バトル場でダメージを与えるワザを使えないとき、先にグッズを使う手も比較する", () => {
  const { context } = buildSwitchDecision();
  activeOf(context.state).energies.splice(0);
  const actions = listAvailableActions(context);
  expect(deferSwitchBeforeDrawing(context, actions, 17)).toBe(actions);
});

test("先に引いてエネルギーを移すと、同じグッズで交代して最後のワザまで選べる", () => {
  const { context, item, supporter, transfer } = buildSwitchDecision();
  const { state } = context;
  const nextAttacker = benchAt(state, 0);
  const candidates = () =>
    deferSwitchBeforeDrawing(context, listAvailableActions(context), 17);
  const play = (card: Card) => {
    const action = candidates().find(
      (a) => a.kind === "playTrainer" && a.card === card
    );
    if (action === undefined) {
      throw new Error(`${card.name}を探索の候補から選べない`);
    }
    performAction(context, action);
  };
  play(supporter);
  expect(state.hand).toHaveLength(8);
  play(transfer);
  play(item);
  expect(activeOf(state)).toBe(nextAttacker);
  const ability = candidates().find(
    (a) => a.kind === "useAbility" && a.abilityName === "こんじきのほのお"
  );
  if (ability === undefined) {
    throw new Error("ベンチに基本炎エネルギーをつけられない");
  }
  performAction(context, ability);
  useAttackNamed(context, "ストームエメラルダ");
  takePrizesForOpponentFieldDamage(state);
  expect(state.prizes).toHaveLength(3);
});

import { expect, test } from "bun:test";
import { takePrizesForOpponentFieldDamage } from "./battle-style-solo-play-rules.ts";
import { listUsableAttacksOfActive, useAttack } from "./card-effects.ts";
import {
  activeOf,
  benchAt,
  buildContext,
  buildRecordedCard,
  buildState,
} from "./card-test-support.ts";
import { prepareWinningEnergyAttack } from "./winning-energy-attack.ts";

function buildLastTurn() {
  const fire = buildRecordedCard("050746");
  const lightning = buildRecordedCard("047906");
  const state = buildState({
    active: buildRecordedCard("050400"),
    bench: [
      buildRecordedCard("047847"),
      buildRecordedCard("049282"),
      buildRecordedCard("050396"),
    ],
    deck: [
      ...Array.from({ length: 6 }, () => fire),
      ...Array.from({ length: 6 }, () => lightning),
    ],
    discard: [lightning, lightning],
    hand: [buildRecordedCard("049412"), buildRecordedCard("048671"), fire],
  });
  activeOf(state).energies.push(fire, lightning);
  benchAt(state, 0).energies.push(fire);
  state.prizes.splice(3);
  state.opponentRemainingPrizeCount = 1;
  return state;
}

test("山札・手札・トラッシュのエネルギーを同じ攻撃に使い、最後の3枚を取る", () => {
  const state = buildLastTurn();
  const index = prepareWinningEnergyAttack(state, 17);
  const context = buildContext(state);
  const attack =
    index === undefined ? undefined : listUsableAttacksOfActive(context)[index];
  expect(attack?.attack.name).toBe("ストームエメラルダ");
  if (attack === undefined) {
    throw new Error("準備したワザを使えない");
  }
  useAttack(context, attack);
  expect(state.opponentFieldDamage.active).toBe(350);
  takePrizesForOpponentFieldDamage(state);
  expect(state.decision?.reason).toBe("ownPrizesTaken");
});

test("サイドを取り切る手がないとき、山札を切ったり実際の手札や場を動かしたりしない", () => {
  const state = buildLastTurn();
  state.discard.splice(0);
  const before = [...state.hand];
  const deck = [...state.deck];
  expect(prepareWinningEnergyAttack(state, 17)).toBeUndefined();
  expect(state.hand).toEqual(before);
  expect(state.deck).toEqual(deck);
  expect(state.events).toHaveLength(0);
});

test("山札を探して雷がすべてサイドにあると分かったら、つける手とにげる手を通常の探索に残す", () => {
  const state = buildLastTurn();
  const lightning = state.deck.at(-1);
  if (lightning === undefined) {
    throw new Error("基本雷エネルギーが無い");
  }
  state.deck = state.deck.filter((card) => card !== lightning);
  state.prizes.fill(lightning);
  expect(prepareWinningEnergyAttack(state, 17)).toBeUndefined();
  expect(state.discard.some((card) => card.name === "アカマツ")).toBe(true);
  expect(state.hasRetreated).toBe(false);
  expect(state.hasAttachedEnergy).toBe(false);
});

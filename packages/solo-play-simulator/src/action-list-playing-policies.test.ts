/**
 * 手を選ばない 2 つのプレイングの判断基準が、バトルポケモンがきぜつした後にどのベンチポケモンを出すかと、試し回しの
 * 軽い手順が何を選ぶかを確かめる。
 */

import { describe, expect, test } from "bun:test";
import {
  createFirstActionPolicy,
  createPlayoutActionPolicy,
  createRandomActionPolicy,
} from "./action-list-playing-policies.ts";
import { knockOutOwnPokemon } from "./battle-style-solo-play-rules.ts";
import { cardRecordTable } from "./card-record-table.ts";
import {
  activeOf,
  buildRecordedCard,
  buildState,
} from "./card-test-support.ts";
import {
  buildDeck,
  type PlayingPolicy,
  runBattleStyleSoloPlayGame,
} from "./engine.ts";
import { listAvailableActions } from "./player-actions.ts";
import { createSeededRandom } from "./random.ts";
import { RECORDED_DECKS } from "./recorded-decks.ts";

// シロナのフカマル(049092)、ラルトス(049714)、シロナのロゼリア(048748)。いずれもたねポケモン
const GIBLE = buildRecordedCard("049092");
const RALTS = buildRecordedCard("049714");
const BUDEW = buildRecordedCard("048748");
// 基本闘エネルギー(049464)。シロナのフカマルのワザ「いわとばし」は闘 1 個、にげるエネルギーは 1
const FIGHTING_ENERGY = buildRecordedCard("049464");

/** バトルポケモンがきぜつしたとき、policy がバトル場に出したのがベンチの何番目だったか(ベンチは 3 匹)。 */
function promotedBenchIndex(policy: PlayingPolicy): number {
  const state = buildState({ active: GIBLE, bench: [RALTS, BUDEW, GIBLE] });
  const bench = [...state.bench];
  knockOutOwnPokemon({ choices: policy, state }, activeOf(state));
  return bench.indexOf(activeOf(state));
}

describe("手を選ばない手順がきぜつした後に出すベンチポケモン", () => {
  test("手を選ばず順に使う手順は、きぜつした後にベンチの先頭を出す", () => {
    expect(promotedBenchIndex(createFirstActionPolicy())).toBe(0);
  });

  test("乱数で選ぶ手順は、きぜつした後に出すベンチポケモンを乱数で選ぶ", () => {
    const indices = Array.from({ length: 20 }, (_, seed) =>
      promotedBenchIndex(createRandomActionPolicy(seed + 1))
    );
    for (const index of indices) {
      expect([0, 1, 2]).toContain(index);
    }
    expect(new Set(indices).size).toBeGreaterThanOrEqual(2);
  });
});

describe("試し回しの軽い手順", () => {
  test("にげるだけが残るときは、にげずに番を終える", () => {
    const state = buildState({ active: GIBLE, bench: [RALTS] });
    activeOf(state).energies.push(FIGHTING_ENERGY);
    const context = { choices: createFirstActionPolicy(), state };
    expect(listAvailableActions(context).map((action) => action.kind)).toEqual([
      "retreat",
      "endTurn",
    ]);
    createPlayoutActionPolicy(1).playTurn(context);
    expect(state.hasRetreated).toBe(false);
    expect(activeOf(state).card).toBe(GIBLE);
  });

  test("番を終えるのは、番を終えるとにげる以外に選べる行動が無くなったとき", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const state = buildState({
        active: GIBLE,
        hand: [RALTS, BUDEW, FIGHTING_ENERGY],
      });
      const policy = createPlayoutActionPolicy(seed);
      const context = { choices: policy, state };
      policy.playTurn(context);
      expect(
        listAvailableActions(context)
          .map((action) => action.kind)
          .filter((kind) => kind !== "endTurn" && kind !== "retreat")
      ).toEqual([]);
      expect(state.bench).toHaveLength(2);
      expect(state.hasAttachedEnergy).toBe(true);
    }
  });

  test("使えるワザがあれば必ず使う", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const state = buildState({ active: GIBLE });
      activeOf(state).energies.push(FIGHTING_ENERGY);
      const policy = createPlayoutActionPolicy(seed);
      expect(policy.chooseAttack({ choices: policy, state })?.attack.name).toBe(
        "いわとばし"
      );
    }
  });

  test("同じ種なら、同じ対戦で同じ行動を選ぶ", () => {
    const [deck] = RECORDED_DECKS;
    if (deck === undefined) {
      throw new Error("記録済みのデッキが無い");
    }
    const cards = buildDeck(cardRecordTable, deck.decklist);
    const play = () =>
      runBattleStyleSoloPlayGame({
        cards,
        policy: createPlayoutActionPolicy(20_261_112),
        random: createSeededRandom(5),
        wentFirst: true,
      });
    expect(play()).toEqual(play());
  });
});

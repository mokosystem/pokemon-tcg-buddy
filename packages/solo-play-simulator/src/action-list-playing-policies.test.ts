/**
 * 手を選ばない 2 つのプレイングの判断基準が、バトルポケモンがきぜつした後にどのベンチポケモンを出すかを確かめる。
 */

import { describe, expect, test } from "bun:test";
import {
  createFirstActionPolicy,
  createRandomActionPolicy,
} from "./action-list-playing-policies.ts";
import { knockOutOwnPokemon } from "./battle-style-solo-play-rules.ts";
import {
  activeOf,
  buildRecordedCard,
  buildState,
} from "./card-test-support.ts";
import type { PlayingPolicy } from "./engine.ts";

// シロナのフカマル(049092)、ラルトス(049714)、シロナのロゼリア(048748)。いずれもたねポケモン
const GIBLE = buildRecordedCard("049092");
const RALTS = buildRecordedCard("049714");
const BUDEW = buildRecordedCard("048748");

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

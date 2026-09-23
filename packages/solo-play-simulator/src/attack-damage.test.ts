import { describe, expect, test } from "bun:test";
import { calculateAttackDamage } from "./attack-damage.ts";
import type { Attack } from "./card-record-schema.ts";
import { buildRecordedCard, buildState } from "./card-test-support.ts";
import type { Card } from "./cards.ts";

function findAttack(card: Card, name: string): Attack {
  const attack =
    card.record.category === "ポケモン"
      ? card.record.attacks.find((candidate) => candidate.name === name)
      : undefined;
  if (attack === undefined) {
    throw new Error(`${card.name} にワザ ${name} が無い`);
  }
  return attack;
}

const GARDEVOIR = buildRecordedCard("048464");
const RALTS = buildRecordedCard("049714");
const DHELMISE = buildRecordedCard("050308");
const CHARIZARD_X = buildRecordedCard("048353");
const DRAGAPULT = buildRecordedCard("049264");
const KANGASKHAN = buildRecordedCard("047847");
const PSYCHIC_ENERGY = buildRecordedCard("049463");
const TELEPATH_ENERGY = buildRecordedCard("049712");
const LEGACY_ENERGY = buildRecordedCard("049457");
const FIRE_ENERGY = buildRecordedCard("050746");
const IGNITION_ENERGY = buildRecordedCard("049452");

describe("ワザのダメージ", () => {
  test("メガシンフォニアは、自分のポケモン全員についている超エネルギーの数×50(すべてのタイプとして働くものも数える)", () => {
    const state = buildState({ active: GARDEVOIR, bench: [RALTS, RALTS] });
    const [first, second] = state.bench;
    state.active?.energies.push(PSYCHIC_ENERGY, TELEPATH_ENERGY);
    first?.energies.push(PSYCHIC_ENERGY, FIRE_ENERGY);
    second?.energies.push(LEGACY_ENERGY, PSYCHIC_ENERGY);
    expect(
      calculateAttackDamage(state, findAttack(GARDEVOIR, "メガシンフォニア"))
    ).toBe(5 * 50);
  });

  test("むねんのイカリは、トラッシュに特性「ばけがくれ」を持つポケモンが 4 枚以上なら 30 に 140 を足す", () => {
    const bakegakure = ["050224", "050225", "050250", "050251"].map(
      buildRecordedCard
    );
    const attack = findAttack(DHELMISE, "むねんのイカリ");
    const three = buildState({
      active: DHELMISE,
      discard: bakegakure.slice(1),
    });
    expect(calculateAttackDamage(three, attack)).toBe(30);
    const four = buildState({ active: DHELMISE, discard: bakegakure });
    expect(calculateAttackDamage(four, attack)).toBe(170);
  });

  test("インフェルノX は、自分の場の炎エネルギー(すべてのタイプとして働くものも数える)を全部トラッシュしたときの値(枚数×90)で求める", () => {
    const state = buildState({ active: CHARIZARD_X, bench: [RALTS, RALTS] });
    const [first, second] = state.bench;
    state.active?.energies.push(FIRE_ENERGY, FIRE_ENERGY, IGNITION_ENERGY);
    first?.energies.push(FIRE_ENERGY);
    second?.energies.push(LEGACY_ENERGY, PSYCHIC_ENERGY);
    expect(
      calculateAttackDamage(state, findAttack(CHARIZARD_X, "インフェルノX"))
    ).toBe(4 * 90);
  });

  test("固定のダメージはそのまま、コインで決まる上乗せは含めず、ダメージの無いワザは null", () => {
    const state = buildState({ active: DRAGAPULT });
    expect(
      calculateAttackDamage(state, findAttack(DRAGAPULT, "ファントムダイブ"))
    ).toBe(200);
    expect(
      calculateAttackDamage(state, findAttack(KANGASKHAN, "マシンガンコンボ"))
    ).toBe(200);
    expect(
      calculateAttackDamage(state, findAttack(GARDEVOIR, "あふれるねがい"))
    ).toBeNull();
  });
});

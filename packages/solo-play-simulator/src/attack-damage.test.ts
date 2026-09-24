import { describe, expect, test } from "bun:test";
import { calculateAttackDamage } from "./attack-damage.ts";
import type { Attack } from "./card-record-schema.ts";
import {
  activeOf,
  buildRecordedCard,
  buildState,
} from "./card-test-support.ts";
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
const CYNTHIAS_SPIRITOMB = buildRecordedCard("049968");
const CYNTHIAS_ROSERADE = buildRecordedCard("047366");
const TERAPAGOS = buildRecordedCard("049346");
const MEGA_EXCADRILL = buildRecordedCard("050321");
const STEEL_ENERGY = buildRecordedCard("030578");

describe("ワザのダメージ", () => {
  test("マキシマムドリルは、ワザを使うポケモンのエネルギーが 5 個以上なら 200 に 130 を足す(個数で数える)", () => {
    const attack = findAttack(MEGA_EXCADRILL, "マキシマムドリル");
    const four = buildState({ active: MEGA_EXCADRILL, bench: [RALTS] });
    four.active?.energies.push(
      ...Array.from({ length: 4 }, () => STEEL_ENERGY)
    );
    four.bench[0]?.energies.push(STEEL_ENERGY);
    expect(calculateAttackDamage(four, activeOf(four), attack)).toBe(200);
    const withIgnition = buildState({ active: MEGA_EXCADRILL });
    withIgnition.active?.energies.push(
      STEEL_ENERGY,
      STEEL_ENERGY,
      STEEL_ENERGY,
      IGNITION_ENERGY
    );
    expect(
      calculateAttackDamage(withIgnition, activeOf(withIgnition), attack)
    ).toBe(330);
  });

  test("ユニオンビートは、自分のベンチポケモンの数×30", () => {
    const attack = findAttack(TERAPAGOS, "ユニオンビート");
    const threeOnBench = buildState({
      active: TERAPAGOS,
      bench: [RALTS, RALTS, GARDEVOIR],
    });
    expect(
      calculateAttackDamage(threeOnBench, activeOf(threeOnBench), attack)
    ).toBe(3 * 30);
    const noBench = buildState({ active: TERAPAGOS });
    expect(calculateAttackDamage(noBench, activeOf(noBench), attack)).toBe(0);
  });

  test("メガシンフォニアは、自分のポケモン全員についている超エネルギーの数×50(すべてのタイプとして働くものも数える)", () => {
    const state = buildState({ active: GARDEVOIR, bench: [RALTS, RALTS] });
    const [first, second] = state.bench;
    state.active?.energies.push(PSYCHIC_ENERGY, TELEPATH_ENERGY);
    first?.energies.push(PSYCHIC_ENERGY, FIRE_ENERGY);
    second?.energies.push(LEGACY_ENERGY, PSYCHIC_ENERGY);
    expect(
      calculateAttackDamage(
        state,
        activeOf(state),
        findAttack(GARDEVOIR, "メガシンフォニア")
      )
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
    expect(calculateAttackDamage(three, activeOf(three), attack)).toBe(30);
    const four = buildState({ active: DHELMISE, discard: bakegakure });
    expect(calculateAttackDamage(four, activeOf(four), attack)).toBe(170);
  });

  test("インフェルノX は、自分の場の炎エネルギー(すべてのタイプとして働くものも数える)を全部トラッシュしたときの値(枚数×90)で求める", () => {
    const state = buildState({ active: CHARIZARD_X, bench: [RALTS, RALTS] });
    const [first, second] = state.bench;
    state.active?.energies.push(FIRE_ENERGY, FIRE_ENERGY, IGNITION_ENERGY);
    first?.energies.push(FIRE_ENERGY);
    second?.energies.push(LEGACY_ENERGY, PSYCHIC_ENERGY);
    expect(
      calculateAttackDamage(
        state,
        activeOf(state),
        findAttack(CHARIZARD_X, "インフェルノX")
      )
    ).toBe(4 * 90);
  });

  test("固定のダメージはそのまま、コインで決まる上乗せは含めず、ダメージの無いワザは null", () => {
    const state = buildState({ active: DRAGAPULT });
    expect(
      calculateAttackDamage(
        state,
        activeOf(state),
        findAttack(DRAGAPULT, "ファントムダイブ")
      )
    ).toBe(200);
    expect(
      calculateAttackDamage(
        state,
        activeOf(state),
        findAttack(KANGASKHAN, "マシンガンコンボ")
      )
    ).toBe(200);
    expect(
      calculateAttackDamage(
        state,
        activeOf(state),
        findAttack(GARDEVOIR, "あふれるねがい")
      )
    ).toBeNull();
  });

  test("基本のダメージが 0 なら、ダメージを増やす効果を足さない", () => {
    const state = buildState({
      active: CYNTHIAS_SPIRITOMB,
      bench: [CYNTHIAS_ROSERADE],
    });
    state.increaseAttackDamageThisTurn({
      amount: 30,
      attackerFilter: { pokemonTypes: ["dark"] },
    });
    expect(
      calculateAttackDamage(
        state,
        activeOf(state),
        findAttack(CYNTHIAS_SPIRITOMB, "レイジングカース")
      )
    ).toBe(0);
  });
});

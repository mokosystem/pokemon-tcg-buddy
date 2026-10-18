import { describe, expect, test } from "bun:test";
import { buildRecordedCard, buildState } from "./card-test-support.ts";
import {
  resolveEnergyProvisionWhenAttached,
  toEnergyUnits,
} from "./continuous-effects.ts";
import { PokemonInPlay } from "./state.ts";

// ラルトス(たね)、メガサーナイトex(2進化)、ドラパルトex(2進化)。記録 049714、048464、049264
const RALTS = buildRecordedCard("049714");
const MEGA_GARDEVOIR = buildRecordedCard("048464");
const DRAGAPULT_EX = buildRecordedCard("049264");
// プリズムエネルギー(たねポケモンについている間、すべてのタイプ 1 個。それ以外は無色 1 個)。記録 049455
const PRISM_ENERGY = buildRecordedCard("049455");
// イグニッションエネルギー(進化ポケモンについている間、無色 3 個。それ以外は無色 1 個)。記録 049452
const IGNITION_ENERGY = buildRecordedCard("049452");

describe("手札か山札のエネルギーをつけたとしたら供給するもの", () => {
  test("プリズムエネルギーは、たねポケモンにつけたとすればすべてのタイプ 1 個、2進化ポケモンにつけたとすれば無色 1 個を供給する", () => {
    const state = buildState({ active: RALTS, bench: [MEGA_GARDEVOIR] });
    const { active } = state;
    const [megaGardevoir] = state.bench;
    if (active === undefined || megaGardevoir === undefined) {
      throw new Error("場が組めていない");
    }
    expect(
      toEnergyUnits(
        resolveEnergyProvisionWhenAttached(state, active, PRISM_ENERGY)
      )
    ).toEqual(["any"]);
    expect(
      toEnergyUnits(
        resolveEnergyProvisionWhenAttached(state, megaGardevoir, PRISM_ENERGY)
      )
    ).toEqual(["colorless"]);
  });

  test("イグニッションエネルギーは、進化ポケモンにつけたとすれば無色 3 個、たねポケモンにつけたとすれば無色 1 個を供給する", () => {
    const state = buildState({ active: DRAGAPULT_EX, bench: [RALTS] });
    const { active } = state;
    const [ralts] = state.bench;
    if (active === undefined || ralts === undefined) {
      throw new Error("場が組めていない");
    }
    expect(
      toEnergyUnits(
        resolveEnergyProvisionWhenAttached(state, active, IGNITION_ENERGY)
      )
    ).toEqual(["colorless", "colorless", "colorless"]);
    expect(
      toEnergyUnits(
        resolveEnergyProvisionWhenAttached(state, ralts, IGNITION_ENERGY)
      )
    ).toEqual(["colorless"]);
  });

  test("場にいない主軸につけたとしても、主軸の進化の段階で供給を数える", () => {
    const state = buildState({ active: RALTS });
    const detachedMegaGardevoir = new PokemonInPlay(MEGA_GARDEVOIR, 2);
    expect(
      toEnergyUnits(
        resolveEnergyProvisionWhenAttached(
          state,
          detachedMegaGardevoir,
          IGNITION_ENERGY
        )
      )
    ).toEqual(["colorless", "colorless", "colorless"]);
    expect(
      toEnergyUnits(
        resolveEnergyProvisionWhenAttached(
          state,
          detachedMegaGardevoir,
          PRISM_ENERGY
        )
      )
    ).toEqual(["colorless"]);
  });
});

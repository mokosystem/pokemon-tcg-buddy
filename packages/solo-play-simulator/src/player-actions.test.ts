import { describe, expect, test } from "bun:test";
import { buildRecordedCard, buildState } from "./card-test-support.ts";
import { firstCandidateChoices } from "./effect-choices.ts";
import {
  describeAction,
  listAvailableActions,
  type PlayerAction,
  performAction,
} from "./player-actions.ts";
import type { GameState } from "./state.ts";

const RALTS = buildRecordedCard("049714");
const KIRLIA = buildRecordedCard("049715");
const PSYCHIC_ENERGY = buildRecordedCard("049463");
const TELEPATH_ENERGY = buildRecordedCard("049712");
const LILLIE = buildRecordedCard("049445");
const SWITCH = buildRecordedCard("049602");
const MEOWTH = buildRecordedCard("049694");

function describeAll(state: GameState): string[] {
  return listAvailableActions({ choices: firstCandidateChoices, state }).map(
    (action) => describeAction(state, action)
  );
}

describe("今できる行動の一覧", () => {
  test("手札の同じカードは 1 つにまとめ、場のポケモンごとに分け、最後は番を終える(エネルギーの無いラルトスはにげられない)", () => {
    const state = buildState({
      active: RALTS,
      bench: [RALTS],
      deck: [PSYCHIC_ENERGY],
      hand: [KIRLIA, KIRLIA, PSYCHIC_ENERGY, RALTS],
    });
    expect(describeAll(state)).toEqual([
      "ラルトス を キルリア に進化させる",
      "ラルトス を キルリア に進化させる",
      "基本超エネルギー を ラルトス につける",
      "基本超エネルギー を ラルトス につける",
      "ラルトス をベンチに出す",
      "番を終える",
    ]);
  });

  test("使えないサポート、つけ終えたエネルギー、出したばかりのポケモンの進化は並べない", () => {
    const state = buildState({
      active: RALTS,
      hand: [LILLIE, PSYCHIC_ENERGY, KIRLIA],
      turn: 1,
      wentFirst: true,
    });
    state.hasAttachedEnergy = true;
    expect(describeAll(state)).toEqual(["番を終える"]);
  });

  test("にげるときにトラッシュするエネルギーは、足りてどの 1 枚を除いても足りなくなる組だけを並べる", () => {
    const state = buildState({ active: MEOWTH, bench: [RALTS] });
    const { active } = state;
    if (active === null) {
      throw new Error("バトル場が空");
    }
    active.energies.push(PSYCHIC_ENERGY, PSYCHIC_ENERGY, TELEPATH_ENERGY);
    const retreats = listAvailableActions({
      choices: firstCandidateChoices,
      state,
    }).filter(
      (action): action is Extract<PlayerAction, { kind: "retreat" }> =>
        action.kind === "retreat"
    );
    expect(
      retreats.map((action) =>
        action.energiesToDiscard.map((energy) => energy.name)
      )
    ).toEqual([["テレパス超エネルギー"], ["基本超エネルギー"]]);
  });

  test("一覧の行動を行うと、指した場のポケモンに行う", () => {
    const state = buildState({
      active: RALTS,
      bench: [RALTS],
      deck: [PSYCHIC_ENERGY],
      hand: [PSYCHIC_ENERGY, SWITCH],
    });
    performAction(
      { choices: firstCandidateChoices, state },
      { card: PSYCHIC_ENERGY, kind: "attachEnergy", targetIndex: 1 }
    );
    expect(state.bench[0]?.energies).toEqual([PSYCHIC_ENERGY]);
    expect(state.active?.energies).toEqual([]);
  });
});

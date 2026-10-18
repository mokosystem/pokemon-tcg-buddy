import { describe, expect, test } from "bun:test";
import { buildRecordedCard, buildState } from "./card-test-support.ts";
import type { Card } from "./cards.ts";
import type { DeadlineTiming } from "./deadline-timing.ts";
import {
  assignDeckFetchSources,
  countUnseenByRecord,
  type FetchRoute,
  listDeckFetchRelays,
  listDeckFetchSources,
} from "./deck-fetch-sources.ts";
import type { GameState } from "./state.ts";

// ハイパーボール(山札からポケモン 1 枚を手札に加える)、なかよしポフィン(山札から HP 70 以下のたねポケモンを 2 枚まで
// ベンチに出す)、アクロマの執念(山札からスタジアム 1 枚とエネルギー 1 枚を手札に加える)、ひふきやろう(山札の
// 基本炎エネルギーを手札に加える)、ニャースex(手札からベンチに出したとき、山札からサポートを手札に加える)。
// 記録 050461、048675、045934、048418、049694
const HYPER_BALL = buildRecordedCard("050461");
const NEST_POFFIN = buildRecordedCard("048675");
const ACHROMA = buildRecordedCard("045934");
const FIRE_BREATHER = buildRecordedCard("048418");
const MEOWTH_EX = buildRecordedCard("049694");
// ドロンチ(1進化)、ドラパルトex(2進化)、偉大な大樹(スタジアム)、基本超エネルギー、基本炎エネルギー。記録 049263、
// 049264、046040、049463、050746
const DRAKLOAK = buildRecordedCard("049263");
const DRAGAPULT_EX = buildRecordedCard("049264");
const GRAND_TREE = buildRecordedCard("046040");
const PSYCHIC_ENERGY = buildRecordedCard("049463");
const FIRE_ENERGY = buildRecordedCard("050746");

/** state の手札と場の探す手段と見えていないカード全部で、cards のそれぞれを持ってくる必要のあるものとして割り当てる。 */
function assignFor(
  state: GameState,
  cards: readonly Card[],
  timing: DeadlineTiming
): FetchRoute[] {
  const unseen = countUnseenByRecord(state);
  return assignDeckFetchSources(
    cards.map((card) => ({ candidates: [card.record] })),
    listDeckFetchSources(state, timing, new Map()),
    listDeckFetchRelays(state, timing, unseen),
    unseen,
    timing
  ).map(({ route }) => route);
}

describe("探す手段の割り当て", () => {
  test("手札のハイパーボール 1 枚は、同じ道の 2 つの必要なカード(ドロンチとドラパルトex)の一方にしか割り当てない", () => {
    const state = buildState({
      deck: [DRAKLOAK, DRAGAPULT_EX],
      hand: [HYPER_BALL],
    });
    expect([
      ["oneStep", "drawOnly"],
      ["drawOnly", "oneStep"],
    ]).toContainEqual(assignFor(state, [DRAKLOAK, DRAGAPULT_EX], "laterTurn"));
  });

  test("なかよしポフィンは HP 70 以下のたねポケモンにしか割り当てず、1進化のドロンチは引くしかない", () => {
    const state = buildState({ deck: [DRAKLOAK], hand: [NEST_POFFIN] });
    expect(assignFor(state, [DRAKLOAK], "laterTurn")).toEqual(["drawOnly"]);
  });

  // サポートは 1 回の番に 1 枚(docs/pokemon-tcg/basic-rules.md 75 行)
  test("この番の締め切りでは、サポートの探す手段を 2 枚目からは数えず、次の番の締め切りでは 2 枚とも数える", () => {
    const state = buildState({
      deck: [GRAND_TREE, PSYCHIC_ENERGY],
      hand: [ACHROMA, ACHROMA],
    });
    const thisTurn = assignFor(state, [GRAND_TREE, PSYCHIC_ENERGY], "thisTurn");
    expect(thisTurn.filter((route) => route === "oneStep")).toHaveLength(1);
    expect(thisTurn.filter((route) => route === "drawOnly")).toHaveLength(1);
    expect(assignFor(state, [GRAND_TREE, PSYCHIC_ENERGY], "laterTurn")).toEqual(
      ["oneStep", "oneStep"]
    );
  });

  test("この番にサポートを使った後は、手札のサポートをこの番の探す手段に数えず、次の番の探す手段には数える", () => {
    const state = buildState({ deck: [PSYCHIC_ENERGY], hand: [ACHROMA] });
    state.hasUsedSupporter = true;
    expect(listDeckFetchSources(state, "thisTurn", new Map())).toHaveLength(0);
    expect(listDeckFetchSources(state, "laterTurn", new Map())).toHaveLength(1);
  });

  test("道の必要なカードとして手札から数えた枚数は、探す手段に数えない", () => {
    const state = buildState({ hand: [HYPER_BALL, HYPER_BALL] });
    expect(
      listDeckFetchSources(
        state,
        "laterTurn",
        new Map([[HYPER_BALL.record, 1]])
      )
    ).toHaveLength(1);
  });

  test("2 段で持ってくるときも、1 段目の探す手段を 1 枚消費する", () => {
    // 手札のニャースex 1 枚で、山札のアクロマの執念を 1 段で持ってくるか、アクロマの執念を中継にして基本超エネルギーを
    // 2 段で持ってくるかのどちらか一方しかできない
    const state = buildState({
      deck: [ACHROMA, ACHROMA, PSYCHIC_ENERGY],
      hand: [MEOWTH_EX],
    });
    expect(assignFor(state, [PSYCHIC_ENERGY], "laterTurn")).toEqual([
      "twoSteps",
    ]);
    expect(assignFor(state, [PSYCHIC_ENERGY, ACHROMA], "laterTurn")).toEqual([
      "drawOnly",
      "oneStep",
    ]);
  });

  test("見えていないカードの同じ 1 枚を、2 つの要るものの持ってくる先にしない", () => {
    const state = buildState({
      deck: [FIRE_ENERGY],
      hand: [FIRE_BREATHER, FIRE_BREATHER],
    });
    expect([
      ["oneStep", "noCopyLeft"],
      ["noCopyLeft", "oneStep"],
    ]).toContainEqual(
      assignFor(state, [FIRE_ENERGY, FIRE_ENERGY], "laterTurn")
    );
  });

  // サポートは 1 回の番に 1 枚(docs/pokemon-tcg/basic-rules.md 75 行)。手札に来たとしたら使えるかは骨組みの
  // canPlayTrainerIfInHand で見る
  test("この番にサポートを使った後は、2 段の中継のサポートもこの番には数えない", () => {
    // ほかに基本超エネルギーを持ってこられる探す手段が無い場。手札のニャースex → 山札のアクロマの執念 → 基本超エネルギー
    const state = buildState({
      deck: [ACHROMA, PSYCHIC_ENERGY],
      hand: [MEOWTH_EX],
    });
    expect(assignFor(state, [PSYCHIC_ENERGY], "thisTurn")).toEqual([
      "twoSteps",
    ]);
    state.hasUsedSupporter = true;
    expect(assignFor(state, [PSYCHIC_ENERGY], "thisTurn")).toEqual([
      "drawOnly",
    ]);
    expect(assignFor(state, [PSYCHIC_ENERGY], "laterTurn")).toEqual([
      "twoSteps",
    ]);
  });
});

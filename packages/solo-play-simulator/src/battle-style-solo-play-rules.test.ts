/**
 * 対戦風の一人回しのルール(相手の攻撃、ダメージときぜつ、相手の場のダメージとサイド、勝敗)を確かめる。決まりの出典は
 * docs/solo-play-simulator-design.md「対戦風の一人回し」。きぜつとサイドの基本ルールは docs/pokemon-tcg/basic-rules.md
 * 「きぜつと勝敗」。
 */

import { describe, expect, test } from "bun:test";
import {
  addDamageToOpponentField,
  calculateOpponentAttackDamage,
  knockOutOwnPokemon,
  knockOutOwnPokemonAtOrAboveMaxHp,
  playOpponentTurn,
  takePrizesForOpponentFieldDamage,
} from "./battle-style-solo-play-rules.ts";
import { evolvePokemonFromHand } from "./card-effects.ts";
import {
  activeOf,
  benchAt,
  buildContext,
  buildRecordedCard,
  buildState,
  namesOf,
} from "./card-test-support.ts";
import type { Card } from "./cards.ts";
import { listAvailableActions, performAction } from "./player-actions.ts";
import { STURDY_BASIC } from "./sample-cards.ts";
import { IllegalMove, type PokemonInPlay } from "./state.ts";

// シロナのフカマル(たね、HP 70、ルールを持たない)、シロナのガバイト(1進化、HP 100)。記録 049092、049093
const GIBLE = buildRecordedCard("049092");
const GABITE = buildRecordedCard("049093");
// シロナのガブリアスex(ポケモンex)、メガサーナイトex(メガシンカex)。記録 047381、048464
const GARCHOMP_EX = buildRecordedCard("047381");
const MEGA_GARDEVOIR = buildRecordedCard("048464");
// ラルトス(たね、HP 70)。記録 049714
const RALTS = buildRecordedCard("049714");
// 基本闘エネルギー(049464)、ふうせん(にげるエネルギーを減らすポケモンのどうぐ。HP は変えない。050464)
const FIGHTING_ENERGY = buildRecordedCard("049464");
const BALLOON = buildRecordedCard("050464");
// ゼロの大空洞(場に「テラスタル」のポケモンがいればベンチの上限 8。記録 048706)、イーブイex(「テラスタル」、HP 200、
// ポケモンex。記録 049282)
const ZERO_CAVERN = buildRecordedCard("048706");
const EEVEE_EX = buildRecordedCard("049282");

/** 相手の番を、opponentTurnOrdinal 回目として 1 回行う。 */
function playOpponentTurnAt(
  state: ReturnType<typeof buildState>,
  opponentTurnOrdinal: number,
  context = buildContext(state)
): void {
  state.opponentTurnCount = opponentTurnOrdinal - 1;
  playOpponentTurn(context);
}

describe("相手の攻撃", () => {
  test("相手の 1 回目の番は 0、2 回目は 100、3 回目は 200、4 回目以降は 300 のダメージになる", () => {
    expect([1, 2, 3, 4, 5, 6].map(calculateOpponentAttackDamage)).toEqual([
      0, 100, 200, 300, 300, 300,
    ]);
  });

  test("相手の攻撃はバトルポケモンだけが受け、ベンチポケモンは受けない", () => {
    const state = buildState({ active: STURDY_BASIC, bench: [GIBLE] });
    playOpponentTurnAt(state, 4);
    expect(activeOf(state).damage).toBe(300);
    expect(benchAt(state, 0).damage).toBe(0);
  });
});

describe("ダメージときぜつ", () => {
  test("バトルポケモンが受けたダメージの合計が HP 以上になるときぜつし、ついているカードごとトラッシュされる", () => {
    const state = buildState({ active: GIBLE, bench: [RALTS] });
    const gible = activeOf(state);
    gible.energies.push(FIGHTING_ENERGY);
    gible.tool = BALLOON;
    playOpponentTurnAt(state, 2);
    expect(state.listPokemonInPlay()).not.toContain(gible);
    expect(namesOf(state.discard)).toEqual([
      "シロナのフカマル",
      "基本闘エネルギー",
      "ふうせん",
    ]);
  });

  test("ルールを持たないポケモン(シロナのフカマル 049092)がきぜつすると相手はサイドを 1 枚、ポケモンex(シロナのガブリアスex 047381)は 2 枚、メガシンカex(メガサーナイトex 048464)は 3 枚取る", () => {
    const taken = [GIBLE, GARCHOMP_EX, MEGA_GARDEVOIR].map((card) => {
      const state = buildState({ active: card, bench: [RALTS] });
      knockOutOwnPokemon(buildContext(state), activeOf(state));
      return 6 - state.opponentRemainingPrizeCount;
    });
    expect(taken).toEqual([1, 2, 3]);
  });

  test("HP に届かないダメージはダメカンとして残り、きぜつしない", () => {
    const state = buildState({ active: STURDY_BASIC });
    playOpponentTurnAt(state, 2);
    expect(activeOf(state).damage).toBe(100);
    expect(activeOf(state).card).toBe(STURDY_BASIC);
    expect(state.opponentRemainingPrizeCount).toBe(6);
  });

  test("進化してもダメカンを引き継ぎ、進化した後の HP で相手の攻撃によるきぜつを判定する", () => {
    // ダメカンを引き継ぐのは docs/pokemon-tcg/basic-rules.md 82 行。ダメカン 5 個(50)がのったシロナのフカマルを
    // シロナのガバイト(HP 100)に進化させ、相手の 2 回目の番の 100 で合計 150 になる
    const state = buildState({ active: GIBLE, bench: [RALTS], hand: [GABITE] });
    const pokemon = activeOf(state);
    pokemon.damage = 50;
    evolvePokemonFromHand(buildContext(state), pokemon, GABITE);
    expect(activeOf(state)).toBe(pokemon);
    expect(pokemon.damage).toBe(50);
    knockOutOwnPokemonAtOrAboveMaxHp(buildContext(state));
    expect(activeOf(state)).toBe(pokemon);
    playOpponentTurnAt(state, 2);
    expect(state.listPokemonInPlay()).not.toContain(pokemon);
    expect(namesOf(state.discard)).toEqual([
      "シロナのガバイト",
      "シロナのフカマル",
    ]);
  });

  test("HP 以上のダメージがのったポケモンがバトル場とベンチに 1 匹ずついると、両方きぜつして相手はサイドを 2 枚取り、バトル場に出すベンチポケモンの候補には残りのベンチポケモンだけが渡される", () => {
    const state = buildState({ active: GIBLE, bench: [GIBLE, RALTS] });
    activeOf(state).damage = 70;
    benchAt(state, 0).damage = 70;
    const offered: (readonly PokemonInPlay[])[] = [];
    knockOutOwnPokemonAtOrAboveMaxHp(
      buildContext(state, {
        choosePokemonToPromoteAfterKnockOut: (_, candidates) => {
          offered.push(candidates);
          return candidates[0] as PokemonInPlay;
        },
      })
    );
    expect(state.opponentRemainingPrizeCount).toBe(4);
    expect(offered.map((candidates) => namesOf(candidates))).toEqual([
      ["ラルトス"],
    ]);
    expect(activeOf(state).name).toBe("ラルトス");
    expect(state.bench).toEqual([]);
  });

  test("バトルポケモンがきぜつすると、プレイングの判断基準が選んだベンチポケモン(ベンチの 2 番目を選ぶ判断基準)がバトル場に出る", () => {
    const state = buildState({ active: GIBLE, bench: [GIBLE, RALTS, GIBLE] });
    const second = benchAt(state, 1);
    playOpponentTurnAt(
      state,
      2,
      buildContext(state, {
        choosePokemonToPromoteAfterKnockOut: (_, candidates) =>
          candidates[1] as PokemonInPlay,
      })
    );
    expect(activeOf(state)).toBe(second);
    expect(state.bench).toHaveLength(2);
  });

  test("ゼロの大空洞が働いているときに「テラスタル」のポケモンがきぜつしてベンチの上限が下がると、ベンチをトラッシュしてからバトル場に出す", () => {
    // トラッシュしてから出す順は公式 Q&A「ゼロの大空洞」(effect-operations.ts の returnToZone のコメント)
    const state = buildState({
      active: EEVEE_EX,
      bench: [GIBLE, GIBLE, GIBLE, RALTS, RALTS, RALTS],
    });
    state.stadium = ZERO_CAVERN;
    activeOf(state).damage = 100;
    playOpponentTurnAt(state, 3);
    expect(activeOf(state).card).not.toBe(EEVEE_EX);
    expect(state.bench).toHaveLength(4);
    expect(state.opponentRemainingPrizeCount).toBe(4);
    const trimmed = state.events.findIndex((event) =>
      event.includes("ベンチの シロナのフカマル をトラッシュ")
    );
    const promoted = state.events.findIndex((event) =>
      event.includes("バトル場に出す")
    );
    expect(trimmed).toBeGreaterThanOrEqual(0);
    expect(trimmed).toBeLessThan(promoted);
  });
});

describe("相手の場のダメージとサイド", () => {
  test("1 回の対戦の中で、70 を与えた番はサイドを取らずに 70 が残り、次の番に 130 を足すと 2 枚取って 0 に戻り、270 を足すと 2 枚取って余りは残らず、300 を足すと残りの 2 枚をすべて取って勝つ", () => {
    const state = buildState({ active: STURDY_BASIC });
    const playOwnTurnDealing = (amount: number) => {
      addDamageToOpponentField(state, amount, "ワザ");
      takePrizesForOpponentFieldDamage(state);
      return {
        fieldDamage: state.opponentFieldDamage,
        prizes: state.prizes.length,
      };
    };
    expect(playOwnTurnDealing(70)).toEqual({ fieldDamage: 70, prizes: 6 });
    expect(playOwnTurnDealing(130)).toEqual({ fieldDamage: 0, prizes: 4 });
    expect(playOwnTurnDealing(270)).toEqual({ fieldDamage: 0, prizes: 2 });
    expect(state.decision).toBeUndefined();
    expect(playOwnTurnDealing(300)).toEqual({ fieldDamage: 0, prizes: 0 });
    expect(state.decision?.reason).toBe("ownPrizesTaken");
  });

  test("自分の番の終わりの判定で、相手の場のダメージが 100 未満ならサイドを取らずに持ち越す", () => {
    const state = buildState({ active: STURDY_BASIC });
    addDamageToOpponentField(state, 99, "ワザ");
    takePrizesForOpponentFieldDamage(state);
    expect(state.prizes).toHaveLength(6);
    expect(state.opponentFieldDamage).toBe(99);
  });

  test("取ったサイドのカードはサイドから手札に移り、サイドと手札の合計の枚数は変わらない", () => {
    const state = buildState({ active: STURDY_BASIC });
    const prizes: Card[] = [
      "049092",
      "049093",
      "047381",
      "049714",
      "049464",
      "049398",
    ].map(buildRecordedCard);
    state.prizes.splice(0, state.prizes.length, ...prizes);
    addDamageToOpponentField(state, 100, "ワザ");
    takePrizesForOpponentFieldDamage(state);
    const [taken] = state.hand;
    expect(state.hand).toHaveLength(1);
    expect(prizes).toContain(taken as Card);
    expect(state.prizes).not.toContain(taken as Card);
    expect(state.prizes.length + state.hand.length).toBe(6);
  });
});

describe("勝敗", () => {
  test("自分の場の最後の 1 匹がきぜつし、同時に相手がサイドを取り切ったときは、理由を相手がサイドを取り切ったにする", () => {
    const state = buildState({ active: GIBLE });
    state.opponentRemainingPrizeCount = 1;
    playOpponentTurnAt(state, 2);
    expect(state.listPokemonInPlay()).toEqual([]);
    expect(state.decision).toEqual({
      decidedTurn: { ordinal: 2, owner: "opponent" },
      reason: "opponentPrizesTaken",
    });
  });

  test("勝敗が決まった後は、今できる行動は番を終えるだけになる", () => {
    const state = buildState({ active: GIBLE, hand: [RALTS] });
    playOpponentTurnAt(state, 2);
    expect(state.decision?.reason).toBe("noOwnPokemonInPlay");
    const context = buildContext(state);
    expect(listAvailableActions(context)).toEqual([{ kind: "endTurn" }]);
    expect(() =>
      performAction(context, { card: RALTS, kind: "placeOnBench" })
    ).toThrow(IllegalMove);
  });
});

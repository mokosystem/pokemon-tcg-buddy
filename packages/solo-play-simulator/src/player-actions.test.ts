import { describe, expect, test } from "bun:test";
import {
  beginOwnTurn,
  playOpponentTurn,
} from "./battle-style-solo-play-rules.ts";
import {
  benchAt,
  buildContext,
  buildRecordedCard,
  buildState,
  useAttackNamed,
} from "./card-test-support.ts";
import { firstCandidateChoices } from "./effect-choices.ts";
import {
  canRetreatActive,
  describeAction,
  listAvailableAbilityActions,
  listAvailableActions,
  listAvailableHandActions,
  listAvailableRetreatActions,
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
  test("後攻の最初の番にシアノからエキサイトダイブ、交代、かぎづめハントまで選べる", () => {
    const cyano = buildRecordedCard("046442");
    const ignition = buildRecordedCard("049452");
    const talonflame = buildRecordedCard("050400");
    const kangaskhan = buildRecordedCard("047847");
    const candy = buildRecordedCard("050423");
    const fire = buildRecordedCard("050746");
    const state = buildState({
      active: buildRecordedCard("048351"),
      deck: [kangaskhan, talonflame, candy, fire],
      hand: [cyano, ignition],
      turn: 1,
      wentFirst: false,
    });
    const context = { choices: firstCandidateChoices, state };
    const choose = (action: PlayerAction) => {
      expect(listAvailableActions(context)).toContainEqual(action);
      performAction(context, action);
    };

    choose({ card: cyano, kind: "playTrainer" });
    choose({ card: kangaskhan, kind: "placeOnBench" });
    choose({
      abilityName: "エキサイトダイブ",
      card: talonflame,
      kind: "useAbilityFromHand",
    });
    choose({ card: ignition, kind: "attachEnergy", targetIndex: 2 });
    choose({ benchIndex: 1, energiesToDiscard: [], kind: "retreat" });
    useAttackNamed(context, "かぎづめハント");

    expect(state.opponentFieldDamage.active).toBe(150);
    expect(state.hand).toEqual(expect.arrayContaining([candy, fire]));
  });

  test("きぜつ後にメガガルーラexを前に出し、次の番に2枚引いて、エネルギーを使わずに攻撃役へ交代できる", () => {
    const kangaskhan = buildRecordedCard("047847");
    const latias = buildRecordedCard("049524");
    const talonflame = buildRecordedCard("050400");
    const fire = buildRecordedCard("050746");
    const state = buildState({
      active: buildRecordedCard("048351"),
      bench: [kangaskhan, latias, talonflame],
      deck: [fire, fire, fire, fire, fire],
    });
    const attacker = benchAt(state, 2);
    attacker.energies.push(fire, fire);
    state.opponentTurnCount = 2;
    const context = buildContext(state, {
      choosePokemonToPromoteAfterKnockOut: (_, candidates) => {
        expect(candidates.map((pokemon) => pokemon.card)).toEqual([
          kangaskhan,
          latias,
          talonflame,
        ]);
        return benchAt(state, 0);
      },
    });
    playOpponentTurn(context);
    expect(state.active?.card).toBe(kangaskhan);
    beginOwnTurn(state);
    const draw = {
      abilityName: "おつかいダッシュ",
      kind: "useAbility",
      pokemonIndex: 0,
    } as const;
    expect(listAvailableActions(context)).toContainEqual(draw);
    const beforeDraw = state.hand.length;
    performAction(context, draw);
    expect(state.hand).toHaveLength(beforeDraw + 2);
    expect(listAvailableActions(context)).not.toContainEqual(draw);
    const retreat = {
      benchIndex: state.bench.indexOf(attacker),
      energiesToDiscard: [],
      kind: "retreat",
    } as const;
    expect(listAvailableRetreatActions(state)).toContainEqual(retreat);
    performAction(context, retreat);
    useAttackNamed(context, "かぎづめハント");
    expect(state.opponentFieldDamage.active).toBe(150);
  });

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
    if (active === undefined) {
      throw new Error("バトル場が空");
    }
    active.energies.push(PSYCHIC_ENERGY, PSYCHIC_ENERGY, TELEPATH_ENERGY);
    const context = { choices: firstCandidateChoices, state };
    const all = listAvailableActions(context);
    expect(listAvailableActions(context, "skipRetreat")).toEqual(
      all.filter((action) => action.kind !== "retreat")
    );
    const retreats = all.filter(
      (action): action is Extract<PlayerAction, { kind: "retreat" }> =>
        action.kind === "retreat"
    );
    expect(listAvailableRetreatActions(state)).toEqual(retreats);
    expect(
      retreats.map((action) =>
        action.energiesToDiscard.map((energy) => energy.name)
      )
    ).toEqual([["テレパス超エネルギー"], ["基本超エネルギー"]]);
  });

  test("にげるエネルギーが0なら、エネルギーをトラッシュせずに各ベンチポケモンを選べる", () => {
    const state = buildState({
      active: MEOWTH,
      bench: [buildRecordedCard("046248"), RALTS],
    });
    state.active?.energies.push(PSYCHIC_ENERGY, PSYCHIC_ENERGY);
    expect(listAvailableRetreatActions(state)).toEqual([
      { benchIndex: 0, energiesToDiscard: [], kind: "retreat" },
      { benchIndex: 1, energiesToDiscard: [], kind: "retreat" },
    ]);
    state.decision = {
      decidedTurn: { ordinal: 3, owner: "opponent" },
      reason: "opponentPrizesTaken",
    };
    expect(listAvailableRetreatActions(state)).toEqual([]);
  });

  test("場の特性を選ぶときも全行動と同じ順で並び、勝敗が決まれば空になる", () => {
    const state = buildState({
      active: buildRecordedCard("048358"),
      bench: [buildRecordedCard("048353")],
      hand: [buildRecordedCard("050746")],
    });
    const context = { choices: firstCandidateChoices, state };
    const abilities = listAvailableAbilityActions(context);
    expect(abilities).toEqual([
      { abilityName: "エキサイトターボ", kind: "useAbility", pokemonIndex: 0 },
    ]);
    expect(abilities).toEqual(
      listAvailableActions(context).filter(
        (action) => action.kind === "useAbility"
      )
    );
    state.decision = {
      decidedTurn: { ordinal: 3, owner: "opponent" },
      reason: "opponentPrizesTaken",
    };
    expect(listAvailableAbilityActions(context)).toEqual([]);
  });

  test("特定の手札だけを調べても同じ手が同じ順で並び、勝敗が決まれば空になる", () => {
    const state = buildState({
      active: RALTS,
      bench: [RALTS],
      hand: [KIRLIA, PSYCHIC_ENERGY, PSYCHIC_ENERGY, RALTS],
    });
    const context = { choices: firstCandidateChoices, state };
    const energy = () =>
      listAvailableHandActions(context, (card) => card === PSYCHIC_ENERGY);
    expect(energy()).toEqual(
      listAvailableActions(context).filter(
        (action) => action.kind === "attachEnergy"
      )
    );
    state.decision = {
      decidedTurn: { ordinal: 3, owner: "opponent" },
      reason: "opponentPrizesTaken",
    };
    expect(energy()).toEqual([]);
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

describe("にげられるか", () => {
  // にげるのは 1 回の番に 1 回まで。にげるエネルギーの分のエネルギーをトラッシュする(docs/pokemon-tcg/basic-rules.md 79 行)。
  // ニャースex はにげる 1(記録 049694)
  test("にげるエネルギーを払えないバトルポケモンはにげられず、払えればにげられる", () => {
    const state = buildState({ active: MEOWTH, bench: [RALTS] });
    expect(canRetreatActive(state)).toBe(false);
    state.active?.energies.push(PSYCHIC_ENERGY);
    expect(canRetreatActive(state)).toBe(true);
  });

  test("この番にもうにげたら、にげるエネルギーを払えてもにげられない", () => {
    const state = buildState({ active: MEOWTH, bench: [RALTS] });
    state.active?.energies.push(PSYCHIC_ENERGY);
    state.hasRetreated = true;
    expect(canRetreatActive(state)).toBe(false);
  });

  test("ベンチにポケモンがいなければ、にげるエネルギーを払えてもにげられない", () => {
    const state = buildState({ active: MEOWTH });
    state.active?.energies.push(PSYCHIC_ENERGY);
    expect(canRetreatActive(state)).toBe(false);
  });
});

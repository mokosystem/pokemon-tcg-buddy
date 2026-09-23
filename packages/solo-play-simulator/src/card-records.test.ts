/**
 * 効果の翻訳ごとに、記録を骨組みで実行して、カードの効果どおりに場が動くことを確かめる。
 * 翻訳した記録はすべてここにテストを持つ(最後のテストで検査する)。
 */

import { describe, expect, test } from "bun:test";
import {
  attachEnergyFromHandToPokemon,
  attachToolFromHand,
  canPlayTrainerFromHand,
  canUseAbility,
  canUseAbilityFromHand,
  canUseStadiumEffect,
  listUsableAttacksOfActive,
  placeBasicPokemonOnBenchFromHand,
  playTrainerFromHand,
  resolveEndOfTurnTriggers,
  retreatActive,
  useAbility,
  useAbilityFromHand,
  useAttack,
  useStadiumEffect,
} from "./card-effects.ts";
import { cardRecordTable } from "./card-record-table.ts";
import {
  activeOf,
  benchAt,
  buildContext,
  buildRecordedCard,
  buildState,
  namesOf,
  pickCardsByName,
} from "./card-test-support.ts";
import { calculateRetreatCost, listEnergyUnits } from "./continuous-effects.ts";
import { setupGame } from "./engine.ts";
import { IllegalMove } from "./state.ts";

const RALTS = buildRecordedCard("049714");
const KIRLIA = buildRecordedCard("049715");
const GARDEVOIR = buildRecordedCard("048464");
const LATIAS = buildRecordedCard("046248");
const MEOWTH = buildRecordedCard("049694");
const MEW = buildRecordedCard("050669");
const CHARMANDER = buildRecordedCard("048351");
const CHARMELEON = buildRecordedCard("049481");
const CHARIZARD_X = buildRecordedCard("048353");
const ORICORIO = buildRecordedCard("048358");
const KANGASKHAN = buildRecordedCard("047847");
const TALONFLAME = buildRecordedCard("050400");
const DHELMISE = buildRecordedCard("050308");
const SHUPPET = buildRecordedCard("050250");
const BANETTE = buildRecordedCard("050251");
const DUDUNSPARCE = buildRecordedCard("045203");
const DUNSPARCE = buildRecordedCard("047086");
const DREEPY = buildRecordedCard("049262");
const DRAKLOAK = buildRecordedCard("049263");
const DRAGAPULT = buildRecordedCard("049264");
const DUSKULL = buildRecordedCard("049024");
const FEZANDIPITI = buildRecordedCard("049205");
const RARE_CANDY = buildRecordedCard("050462");
const SWITCH = buildRecordedCard("049602");
const ULTRA_BALL = buildRecordedCard("050461");
const POFFIN = buildRecordedCard("048675");
const NIGHT_STRETCHER = buildRecordedCard("048681");
const POKEPAD = buildRecordedCard("050424");
const ENERGY_RETRIEVAL = buildRecordedCard("049352");
const SCOOP_UP_CYCLONE = buildRecordedCard("049380");
const POKEGEAR = buildRecordedCard("049376");
const BALLOON = buildRecordedCard("050464");
const BOSS = buildRecordedCard("050467");
const ACHROMA = buildRecordedCard("045934");
const LILLIE = buildRecordedCard("049445");
const TOUKO = buildRecordedCard("048694");
const CYANO = buildRecordedCard("046442");
const HIKARI = buildRecordedCard("050428");
const FIRE_STOKER = buildRecordedCard("048418");
const SUGURI = buildRecordedCard("047894");
const MUKU = buildRecordedCard("050297");
const AKAMATSU = buildRecordedCard("049412");
const GREAT_TREE = buildRecordedCard("046040");
const JAMMING_TOWER = buildRecordedCard("047214");
const PRISM_TOWER = buildRecordedCard("050164");
const ROCKET_WATCHTOWER = buildRecordedCard("048711");
const PSYCHIC_ENERGY = buildRecordedCard("049463");
const FIRE_ENERGY = buildRecordedCard("050746");
const DARK_ENERGY = buildRecordedCard("047909");
const TELEPATH_ENERGY = buildRecordedCard("049712");
const IGNITION_ENERGY = buildRecordedCard("049452");
const LEGACY_ENERGY = buildRecordedCard("049457");

/** テストを持つ翻訳の名前。describe を読み込む時点で集まる。 */
const testedTranslations = new Set<string>();

function describeTranslation(name: string, body: () => void): void {
  testedTranslations.add(name);
  describe(name, body);
}

function repeat<T>(card: T, count: number): T[] {
  return Array.from({ length: count }, () => card);
}

describeTranslation("メガサーナイトex", () => {
  test("あふれるねがいは、ベンチのポケモン全員に山札から基本超エネルギーを 1 枚ずつつける", () => {
    const state = buildState({
      active: GARDEVOIR,
      bench: [RALTS, KIRLIA],
      deck: [PSYCHIC_ENERGY, FIRE_ENERGY, PSYCHIC_ENERGY, PSYCHIC_ENERGY],
    });
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    useAttack(buildContext(state), "あふれるねがい");
    expect(namesOf(benchAt(state, 0).energies)).toEqual(["基本超エネルギー"]);
    expect(namesOf(benchAt(state, 1).energies)).toEqual(["基本超エネルギー"]);
    expect(state.deck).toHaveLength(2);
  });
});

describeTranslation("キルリア", () => {
  test("コールサインは山札からポケモンを 3 枚まで手札に加える", () => {
    const state = buildState({
      active: KIRLIA,
      deck: [RALTS, PSYCHIC_ENERGY, RALTS, GARDEVOIR, LATIAS],
    });
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    useAttack(buildContext(state), "コールサイン");
    expect(namesOf(state.hand)).toEqual([
      "ラルトス",
      "ラルトス",
      "メガサーナイトex",
    ]);
    expect(namesOf(state.deck).sort()).toEqual(
      ["ラティアスex", "基本超エネルギー"].sort()
    );
  });
});

describeTranslation("ラルトス", () => {
  test("もってくるは山札を 1 枚引く", () => {
    const state = buildState({ active: RALTS, deck: [KIRLIA, RALTS] });
    activeOf(state).energies.push(FIRE_ENERGY);
    useAttack(buildContext(state), "もってくる");
    expect(namesOf(state.hand)).toEqual(["キルリア"]);
  });
});

describeTranslation("ラティアスex", () => {
  test("スカイラインは、場にいる間、自分のたねポケモン全員のにげるエネルギーを 0 にし、進化ポケモンには働かない", () => {
    const state = buildState({
      active: CHARMANDER,
      bench: [LATIAS, CHARMELEON],
    });
    activeOf(state).energies.push(FIRE_ENERGY);
    expect(calculateRetreatCost(state, activeOf(state))).toBe(0);
    expect(calculateRetreatCost(state, benchAt(state, 0))).toBe(0);
    expect(calculateRetreatCost(state, benchAt(state, 1))).toBe(1);
    state.bench.splice(0, 1);
    expect(calculateRetreatCost(state, activeOf(state))).toBe(2);
  });
});

describeTranslation("ニャースex", () => {
  test("手札からベンチに出したとき、使うことを選べば山札からサポートを 1 枚手札に加える", () => {
    const state = buildState({
      active: RALTS,
      deck: [PSYCHIC_ENERGY, LILLIE],
      hand: [MEOWTH],
    });
    placeBasicPokemonOnBenchFromHand(buildContext(state), MEOWTH);
    expect(namesOf(state.hand)).toEqual(["リーリエの決心"]);
    expect(state.abilityNamesUsedThisTurn).toEqual(["おくのてキャッチ"]);
  });

  test("同じ番に名前に「おくのて」とつく特性を使っていたら、2 匹目では使えない", () => {
    const state = buildState({
      active: RALTS,
      deck: [LILLIE, TOUKO],
      hand: [MEOWTH, MEOWTH],
    });
    const context = buildContext(state);
    placeBasicPokemonOnBenchFromHand(context, MEOWTH);
    placeBasicPokemonOnBenchFromHand(context, MEOWTH);
    expect(namesOf(state.hand)).toEqual(["リーリエの決心"]);
  });

  test("対戦の準備でベンチに出したときは使えない", () => {
    const state = buildState({
      deck: [...repeat(MEOWTH, 3), ...repeat(RALTS, 4), ...repeat(LILLIE, 20)],
    });
    state.turn = 0;
    setupGame(state, {
      chooseActiveAtSetup: () => RALTS,
      chooseBenchAtSetup: (basics) =>
        basics.filter((card) => card.name === "ニャースex"),
    });
    expect(state.countInPlay("ニャースex")).toBeGreaterThan(0);
    expect(state.abilityNamesUsedThisTurn).toEqual([]);
    expect(state.countInHand("リーリエの決心")).toBe(
      7 - state.listPokemonInPlay().length - state.countInHand("ラルトス")
    );
  });

  test("しっぽをまくは自身をついているカードごと手札に戻し、ベンチのポケモンをバトル場に出す。場が空になるなら使えない", () => {
    const state = buildState({ active: MEOWTH, bench: [RALTS] });
    activeOf(state).energies.push(...repeat(DARK_ENERGY, 3));
    useAttack(buildContext(state), "しっぽをまく");
    expect(namesOf(state.hand)).toEqual([
      "ニャースex",
      "基本悪エネルギー",
      "基本悪エネルギー",
      "基本悪エネルギー",
    ]);
    expect(activeOf(state).name).toBe("ラルトス");

    const alone = buildState({ active: MEOWTH });
    activeOf(alone).energies.push(...repeat(DARK_ENERGY, 3));
    expect(() => useAttack(buildContext(alone), "しっぽをまく")).toThrow(
      IllegalMove
    );
  });
});

describeTranslation("ミュウex", () => {
  test("きおくのらせんで、ベンチのポケモンが持つワザを自身のエネルギーで使え、効果はミュウex を持ち主として起きる", () => {
    const state = buildState({
      active: MEW,
      bench: [GARDEVOIR, RALTS],
      deck: [PSYCHIC_ENERGY, PSYCHIC_ENERGY],
    });
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    const context = buildContext(state);
    expect(
      listUsableAttacksOfActive(context).map((usable) => usable.attack.name)
    ).toEqual([
      "テレポートブレイク",
      "あふれるねがい",
      "メガシンフォニア",
      "もってくる",
      "ずつき",
    ]);
    useAttack(context, "あふれるねがい");
    expect(namesOf(benchAt(state, 0).energies)).toEqual(["基本超エネルギー"]);
    expect(namesOf(benchAt(state, 1).energies)).toEqual(["基本超エネルギー"]);
  });

  test("テレポートブレイクは、のぞむならベンチポケモンと入れ替える", () => {
    const state = buildState({ active: MEW, bench: [RALTS] });
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    useAttack(
      buildContext(state, { choosesToApplyOptionalEffect: () => false }),
      "テレポートブレイク"
    );
    expect(activeOf(state).name).toBe("ミュウex");
    state.attacks.clear();
    useAttack(buildContext(state), "テレポートブレイク");
    expect(activeOf(state).name).toBe("ラルトス");
  });
});

describeTranslation("ヒトカゲ", () => {
  test("みがるは、エネルギーがついていなければにげるエネルギーを 0 にする", () => {
    const state = buildState({ active: CHARMANDER, bench: [RALTS] });
    expect(calculateRetreatCost(state, activeOf(state))).toBe(0);
    activeOf(state).energies.push(FIRE_ENERGY);
    expect(calculateRetreatCost(state, activeOf(state))).toBe(2);
  });
});

describeTranslation("オドリドリex", () => {
  test("エキサイトターボは、炎タイプのメガシンカex が場にいれば何回でも、手札の基本炎エネルギーをベンチの炎ポケモンにつける", () => {
    const state = buildState({
      active: ORICORIO,
      bench: [CHARIZARD_X, CHARMANDER],
      hand: [FIRE_ENERGY, FIRE_ENERGY, PSYCHIC_ENERGY],
    });
    const context = buildContext(state);
    const oricorio = activeOf(state);
    useAbility(context, oricorio, "エキサイトターボ");
    useAbility(context, oricorio, "エキサイトターボ");
    expect(namesOf(benchAt(state, 0).energies)).toEqual([
      "基本炎エネルギー",
      "基本炎エネルギー",
    ]);
    expect(state.hasAttachedEnergy).toBe(false);
    expect(canUseAbility(context, oricorio, "エキサイトターボ")).toBe(false);
  });

  test("炎タイプのメガシンカex が場にいなければ使えない", () => {
    const state = buildState({
      active: ORICORIO,
      bench: [CHARMANDER],
      hand: [FIRE_ENERGY],
    });
    expect(
      canUseAbility(buildContext(state), activeOf(state), "エキサイトターボ")
    ).toBe(false);
  });
});

describeTranslation("メガガルーラex", () => {
  test("おつかいダッシュは、バトル場にいれば 2 枚引き、同じ名前の特性は番に 1 回", () => {
    const state = buildState({
      active: KANGASKHAN,
      bench: [KANGASKHAN],
      deck: repeat(PSYCHIC_ENERGY, 5),
    });
    const context = buildContext(state);
    expect(canUseAbility(context, benchAt(state, 0), "おつかいダッシュ")).toBe(
      false
    );
    useAbility(context, activeOf(state), "おつかいダッシュ");
    expect(state.hand).toHaveLength(2);
    state.switchActive(benchAt(state, 0));
    expect(canUseAbility(context, activeOf(state), "おつかいダッシュ")).toBe(
      false
    );
  });
});

describeTranslation("ファイアローex", () => {
  test("エキサイトダイブは、無色タイプのメガシンカex が場にいれば手札から 2進化のままベンチに出す", () => {
    const state = buildState({ active: RALTS, hand: [TALONFLAME] });
    const context = buildContext(state);
    expect(canUseAbilityFromHand(context, TALONFLAME, "エキサイトダイブ")).toBe(
      false
    );
    state.bench.push(...buildState({ bench: [KANGASKHAN] }).bench);
    useAbilityFromHand(context, TALONFLAME, "エキサイトダイブ");
    expect(benchAt(state, 1).name).toBe("ファイアローex");
    expect(benchAt(state, 1).card.stage).toBe("2進化");
  });

  test("かぎづめハントは、のぞむなら山札から好きなカードを 2 枚まで手札に加え、選ぶなら 1 枚以上選ぶ", () => {
    const state = buildState({
      active: TALONFLAME,
      deck: [RARE_CANDY, LILLIE, FIRE_ENERGY],
    });
    activeOf(state).energies.push(IGNITION_ENERGY);
    useAttack(
      buildContext(state, {
        chooseCards: pickCardsByName(["ふしぎなアメ", "リーリエの決心"]),
      }),
      "かぎづめハント"
    );
    expect(namesOf(state.hand)).toEqual(["ふしぎなアメ", "リーリエの決心"]);

    const noPick = buildState({ active: TALONFLAME, deck: [RARE_CANDY] });
    activeOf(noPick).energies.push(IGNITION_ENERGY);
    expect(() =>
      useAttack(
        buildContext(noPick, { chooseCards: () => [] }),
        "かぎづめハント"
      )
    ).toThrow(IllegalMove);
  });
});

describeTranslation("ジュペッタ", () => {
  test("にんぎょうキャッチは、のぞむなら山札から好きなカードを 1 枚手札に加え、見たら必ず 1 枚選ぶ", () => {
    const state = buildState({ active: BANETTE, deck: [MUKU, DHELMISE] });
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    useAttack(
      buildContext(state, { chooseCards: pickCardsByName(["ダダリン"]) }),
      "にんぎょうキャッチ"
    );
    expect(namesOf(state.hand)).toEqual(["ダダリン"]);

    const noPick = buildState({ active: BANETTE, deck: [MUKU] });
    activeOf(noPick).energies.push(PSYCHIC_ENERGY);
    expect(() =>
      useAttack(
        buildContext(noPick, { chooseCards: () => [] }),
        "にんぎょうキャッチ"
      )
    ).toThrow(IllegalMove);
  });
});

describeTranslation("ノココッチ", () => {
  test("にげあしドローは 3 枚引いてから、自身をついているカードごと山札に戻し、バトル場ならベンチから出す", () => {
    const state = buildState({
      active: DUDUNSPARCE,
      bench: [SHUPPET],
      deck: repeat(PSYCHIC_ENERGY, 4),
    });
    activeOf(state).underneath.push(DUNSPARCE);
    activeOf(state).energies.push(DARK_ENERGY);
    useAbility(buildContext(state), activeOf(state), "にげあしドロー");
    expect(state.hand).toHaveLength(3);
    expect(activeOf(state).name).toBe("カゲボウズ");
    expect(state.countInDeck("ノココッチ")).toBe(1);
    expect(state.countInDeck("ノコッチ")).toBe(1);
    expect(state.countInDeck("基本悪エネルギー")).toBe(1);
  });

  test("場がノココッチだけのときと、山札が 0 枚のときは使えない", () => {
    const alone = buildState({
      active: DUDUNSPARCE,
      deck: repeat(PSYCHIC_ENERGY, 4),
    });
    expect(
      canUseAbility(buildContext(alone), activeOf(alone), "にげあしドロー")
    ).toBe(false);
    const emptyDeck = buildState({ active: SHUPPET, bench: [DUDUNSPARCE] });
    expect(
      canUseAbility(
        buildContext(emptyDeck),
        benchAt(emptyDeck, 0),
        "にげあしドロー"
      )
    ).toBe(false);
  });
});

describeTranslation("ノコッチ", () => {
  test("いれかわるは、自身をベンチポケモンと入れ替える", () => {
    const state = buildState({ active: DUNSPARCE, bench: [SHUPPET] });
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    useAttack(buildContext(state), "いれかわる");
    expect(activeOf(state).name).toBe("カゲボウズ");
    expect(benchAt(state, 0).name).toBe("ノコッチ");
  });
});

describeTranslation("ドロンチ", () => {
  test("ていさつしれいは、山札の上から 2 枚見て 1 枚を手札に加え、残りを山札の下に戻し、番に 1 回", () => {
    const state = buildState({
      active: DRAKLOAK,
      deck: [LILLIE, RARE_CANDY, DRAGAPULT],
    });
    const context = buildContext(state, {
      chooseCards: pickCardsByName(["ふしぎなアメ"]),
    });
    useAbility(context, activeOf(state), "ていさつしれい");
    expect(namesOf(state.hand)).toEqual(["ふしぎなアメ"]);
    expect(namesOf(state.deck)).toEqual(["ドラパルトex", "リーリエの決心"]);
    expect(canUseAbility(context, activeOf(state), "ていさつしれい")).toBe(
      false
    );
  });
});

describeTranslation("ヨマワル", () => {
  test("むかえにいくは、トラッシュのヨマワルを 3 枚までベンチに出す", () => {
    const state = buildState({
      active: DUSKULL,
      bench: [RALTS, RALTS, RALTS],
      discard: [DUSKULL, DUSKULL, DUSKULL, RALTS],
    });
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    useAttack(buildContext(state), "むかえにいく");
    expect(state.countInPlay("ヨマワル")).toBe(3);
    expect(state.countInDiscard("ヨマワル")).toBe(1);
  });
});

describeTranslation("ふしぎなアメ", () => {
  test("この番より前に出したたねポケモンを、手札の同じ系統の 2進化ポケモンに進化させる", () => {
    const state = buildState({ active: RALTS, hand: [RARE_CANDY, GARDEVOIR] });
    playTrainerFromHand(buildContext(state), RARE_CANDY);
    expect(activeOf(state).name).toBe("メガサーナイトex");
    expect(namesOf(activeOf(state).underneath)).toEqual(["ラルトス"]);
  });

  test("最初の番、出したばかりのたねポケモン、系統の違う 2進化ポケモンには使えない", () => {
    const firstTurn = buildState({
      active: RALTS,
      hand: [RARE_CANDY, GARDEVOIR],
      turn: 1,
    });
    expect(canPlayTrainerFromHand(buildContext(firstTurn), RARE_CANDY)).toBe(
      false
    );
    const otherLine = buildState({
      active: RALTS,
      hand: [RARE_CANDY, CHARIZARD_X],
    });
    expect(canPlayTrainerFromHand(buildContext(otherLine), RARE_CANDY)).toBe(
      false
    );
    const fresh = buildState({ hand: [RARE_CANDY, GARDEVOIR, RALTS] });
    fresh.active = null;
    fresh.placeActiveFromHand(RALTS);
    expect(canPlayTrainerFromHand(buildContext(fresh), RARE_CANDY)).toBe(false);
  });
});

describeTranslation("ポケモンいれかえ", () => {
  test("バトルポケモンをベンチポケモンと入れ替え、ベンチにいなければ使えない", () => {
    const state = buildState({
      active: RALTS,
      bench: [KIRLIA],
      hand: [SWITCH, SWITCH],
    });
    const context = buildContext(state);
    playTrainerFromHand(context, SWITCH);
    expect(activeOf(state).name).toBe("キルリア");
    state.bench.splice(0, 1);
    expect(canPlayTrainerFromHand(context, SWITCH)).toBe(false);
  });
});

describeTranslation("ハイパーボール", () => {
  test("手札を 2 枚トラッシュして、山札からポケモンを 1 枚手札に加える", () => {
    const state = buildState({
      active: RALTS,
      deck: [LILLIE, GARDEVOIR],
      hand: [ULTRA_BALL, PSYCHIC_ENERGY, FIRE_ENERGY, LILLIE],
    });
    playTrainerFromHand(
      buildContext(state, {
        chooseCards: pickCardsByName([
          "基本超エネルギー",
          "基本炎エネルギー",
          "メガサーナイトex",
        ]),
      }),
      ULTRA_BALL
    );
    expect(namesOf(state.hand)).toEqual(["リーリエの決心", "メガサーナイトex"]);
    expect(namesOf(state.discard)).toEqual([
      "ハイパーボール",
      "基本超エネルギー",
      "基本炎エネルギー",
    ]);
  });

  test("ほかの手札が 1 枚では使えない。山札にポケモンが無くても使え、トラッシュは戻らない", () => {
    const short = buildState({ active: RALTS, hand: [ULTRA_BALL, LILLIE] });
    expect(canPlayTrainerFromHand(buildContext(short), ULTRA_BALL)).toBe(false);
    const noPokemon = buildState({
      active: RALTS,
      deck: [LILLIE],
      hand: [ULTRA_BALL, LILLIE, LILLIE],
    });
    playTrainerFromHand(buildContext(noPokemon), ULTRA_BALL);
    expect(noPokemon.hand).toEqual([]);
    expect(noPokemon.discard).toHaveLength(3);
  });
});

describeTranslation("なかよしポフィン", () => {
  test("山札から HP 70 以下のたねポケモンを、ベンチの空きの範囲で 2 枚までベンチに出し、空きが無ければ使えない", () => {
    const state = buildState({
      active: RALTS,
      bench: [RALTS, RALTS, RALTS, RALTS],
      deck: [DREEPY, LATIAS, SHUPPET],
      hand: [POFFIN, POFFIN],
    });
    const context = buildContext(state);
    playTrainerFromHand(context, POFFIN);
    expect(namesOf(state.bench.slice(4))).toEqual(["ドラメシヤ"]);
    expect(canPlayTrainerFromHand(context, POFFIN)).toBe(false);
  });
});

describeTranslation("夜のタンカ", () => {
  test("トラッシュからポケモンか基本エネルギーを 1 枚手札に加え、対象が無ければ使えない", () => {
    const state = buildState({
      active: RALTS,
      discard: [LILLIE, GARDEVOIR],
      hand: [NIGHT_STRETCHER, NIGHT_STRETCHER],
    });
    const context = buildContext(state);
    playTrainerFromHand(context, NIGHT_STRETCHER);
    expect(namesOf(state.hand)).toEqual(["夜のタンカ", "メガサーナイトex"]);
    state.hand.pop();
    expect(canPlayTrainerFromHand(context, NIGHT_STRETCHER)).toBe(false);
  });
});

describeTranslation("ポケパッド", () => {
  test("山札から「ルールを持つポケモン」を除くポケモンだけを手札に加えられる", () => {
    const state = buildState({
      active: RALTS,
      deck: [LATIAS, KIRLIA],
      hand: [POKEPAD],
    });
    let offered: string[] = [];
    playTrainerFromHand(
      buildContext(state, {
        chooseCards: (_state, request) => {
          offered = namesOf(request.candidates);
          return request.candidates.slice(0, 1);
        },
      }),
      POKEPAD
    );
    expect(offered).toEqual(["キルリア"]);
    expect(namesOf(state.hand)).toEqual(["キルリア"]);
  });
});

describeTranslation("エネルギー回収", () => {
  test("トラッシュから基本エネルギーを 2 枚まで手札に加える", () => {
    const state = buildState({
      active: RALTS,
      discard: [PSYCHIC_ENERGY, TELEPATH_ENERGY, FIRE_ENERGY, PSYCHIC_ENERGY],
      hand: [ENERGY_RETRIEVAL],
    });
    playTrainerFromHand(buildContext(state), ENERGY_RETRIEVAL);
    expect(namesOf(state.hand)).toEqual([
      "基本超エネルギー",
      "基本炎エネルギー",
    ]);
  });
});

describeTranslation("ポケモン回収サイクロン", () => {
  test("選んだ自分のポケモンをついているカードごと手札に戻し、場のポケモンが 1 匹なら使えない", () => {
    const state = buildState({
      active: GARDEVOIR,
      bench: [RALTS],
      hand: [SCOOP_UP_CYCLONE],
    });
    activeOf(state).underneath.push(RALTS, KIRLIA);
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    playTrainerFromHand(buildContext(state), SCOOP_UP_CYCLONE);
    expect(namesOf(state.hand)).toEqual([
      "メガサーナイトex",
      "ラルトス",
      "キルリア",
      "基本超エネルギー",
    ]);
    expect(activeOf(state).name).toBe("ラルトス");
    state.hand.push(SCOOP_UP_CYCLONE);
    expect(canPlayTrainerFromHand(buildContext(state), SCOOP_UP_CYCLONE)).toBe(
      false
    );
  });
});

describeTranslation("ポケギア3.0", () => {
  test("山札の上から 7 枚見て、サポートを 1 枚まで手札に加え、加えなくてもよい", () => {
    const deck = [...repeat(PSYCHIC_ENERGY, 6), LILLIE, TOUKO];
    const state = buildState({
      active: RALTS,
      deck,
      hand: [POKEGEAR, POKEGEAR],
    });
    const context = buildContext(state);
    playTrainerFromHand(context, POKEGEAR);
    expect(namesOf(state.hand)).toEqual(["ポケギア3.0", "リーリエの決心"]);
    playTrainerFromHand(
      buildContext(state, { chooseCards: () => [] }),
      POKEGEAR
    );
    expect(namesOf(state.hand)).toEqual(["リーリエの決心"]);
  });
});

describeTranslation("ふうせん", () => {
  test("つけたポケモンのにげるエネルギーを 2 個減らし、1 匹に 1 枚しかつけられない", () => {
    const state = buildState({
      active: DUDUNSPARCE,
      bench: [SHUPPET],
      hand: [BALLOON, BALLOON],
    });
    const context = buildContext(state);
    attachToolFromHand(context, BALLOON, activeOf(state));
    expect(calculateRetreatCost(state, activeOf(state))).toBe(1);
    expect(() => attachToolFromHand(context, BALLOON, activeOf(state))).toThrow(
      IllegalMove
    );
  });
});

describeTranslation("アクロマの執念", () => {
  test("山札からスタジアムとエネルギーを 1 枚ずつ手札に加え、片方だけでもよい", () => {
    const state = buildState({
      active: RALTS,
      deck: [GREAT_TREE, TELEPATH_ENERGY, LILLIE],
      hand: [ACHROMA],
    });
    playTrainerFromHand(buildContext(state), ACHROMA);
    expect(namesOf(state.hand)).toEqual(["偉大な大樹", "テレパス超エネルギー"]);
  });
});

describeTranslation("リーリエの決心", () => {
  test("手札を山札に戻して切り、サイドが 6 枚なら 8 枚、それ以外は 6 枚引く", () => {
    const state = buildState({
      active: RALTS,
      deck: repeat(PSYCHIC_ENERGY, 10),
      hand: [LILLIE, KIRLIA],
    });
    playTrainerFromHand(buildContext(state), LILLIE);
    expect(state.hand).toHaveLength(8);
    expect(state.deck).toHaveLength(3);

    const fewerPrizes = buildState({
      active: RALTS,
      deck: repeat(PSYCHIC_ENERGY, 10),
      hand: [LILLIE],
    });
    fewerPrizes.prizes.pop();
    playTrainerFromHand(buildContext(fewerPrizes), LILLIE);
    expect(fewerPrizes.hand).toHaveLength(6);
  });

  test("手札がこのカードだけでも山札があれば使え、手札がこのカードだけで山札も無ければ使えない", () => {
    const withDeck = buildState({
      active: RALTS,
      deck: [KIRLIA],
      hand: [LILLIE],
    });
    expect(canPlayTrainerFromHand(buildContext(withDeck), LILLIE)).toBe(true);
    const noDeck = buildState({ active: RALTS, hand: [LILLIE] });
    expect(canPlayTrainerFromHand(buildContext(noDeck), LILLIE)).toBe(false);
    noDeck.hand.push(KIRLIA);
    expect(canPlayTrainerFromHand(buildContext(noDeck), LILLIE)).toBe(true);
  });
});

describeTranslation("トウコ", () => {
  test("山札から進化ポケモンとエネルギーを 1 枚ずつ手札に加える", () => {
    const state = buildState({
      active: RALTS,
      deck: [RALTS, KIRLIA, TELEPATH_ENERGY],
      hand: [TOUKO],
    });
    playTrainerFromHand(buildContext(state), TOUKO);
    expect(namesOf(state.hand)).toEqual(["キルリア", "テレパス超エネルギー"]);
  });
});

describeTranslation("シアノ", () => {
  test("山札からポケモンex(メガシンカex を含む)を 3 枚まで手札に加える", () => {
    const state = buildState({
      active: RALTS,
      deck: [RALTS, LATIAS, GARDEVOIR, KANGASKHAN, MEW],
      hand: [CYANO],
    });
    playTrainerFromHand(buildContext(state), CYANO);
    expect(namesOf(state.hand)).toEqual([
      "ラティアスex",
      "メガサーナイトex",
      "メガガルーラex",
    ]);
  });
});

describeTranslation("ヒカリ", () => {
  test("山札からたね、1進化、2進化のポケモンを 1 枚ずつ手札に加える", () => {
    const state = buildState({
      active: RALTS,
      deck: [GARDEVOIR, KIRLIA, LILLIE, RALTS],
      hand: [HIKARI],
    });
    playTrainerFromHand(buildContext(state), HIKARI);
    expect(namesOf(state.hand)).toEqual([
      "ラルトス",
      "キルリア",
      "メガサーナイトex",
    ]);
  });
});

describeTranslation("ひふきやろう", () => {
  test("山札から基本炎エネルギーを 7 枚まで手札に加える", () => {
    const state = buildState({
      active: CHARMANDER,
      deck: [...repeat(FIRE_ENERGY, 8), IGNITION_ENERGY],
      hand: [FIRE_STOKER],
    });
    playTrainerFromHand(buildContext(state), FIRE_STOKER);
    expect(state.countInHand("基本炎エネルギー")).toBe(7);
    expect(namesOf(state.deck).sort()).toEqual(
      ["イグニッションエネルギー", "基本炎エネルギー"].sort()
    );
  });
});

describeTranslation("スグリ", () => {
  test("バトルポケモンをベンチポケモンと入れ替え、ベンチにいなければ使えない", () => {
    const state = buildState({
      active: RALTS,
      bench: [KIRLIA],
      hand: [SUGURI],
    });
    const context = buildContext(state);
    playTrainerFromHand(context, SUGURI);
    expect(activeOf(state).name).toBe("キルリア");
    const alone = buildState({ active: RALTS, hand: [SUGURI] });
    expect(canPlayTrainerFromHand(buildContext(alone), SUGURI)).toBe(false);
  });
});

describeTranslation("ムク", () => {
  test("手札からルールを持たないポケモンを 2 枚までトラッシュし、その枚数の 3 倍を引く", () => {
    const state = buildState({
      active: RALTS,
      deck: repeat(PSYCHIC_ENERGY, 8),
      hand: [MUKU, SHUPPET, DHELMISE, LATIAS],
    });
    let offered: string[] = [];
    playTrainerFromHand(
      buildContext(state, {
        chooseCards: (_state, request) => {
          offered = namesOf(request.candidates);
          return request.candidates.slice(0, request.maxCount);
        },
      }),
      MUKU
    );
    expect(offered).toEqual(["カゲボウズ", "ダダリン"]);
    expect(
      state.countInDiscard("カゲボウズ") + state.countInDiscard("ダダリン")
    ).toBe(2);
    expect(state.hand).toHaveLength(1 + 6);
  });

  test("手札がこのカードだけのときと、ルールを持たないポケモンが手札に無いときは使えない", () => {
    const alone = buildState({ active: RALTS, deck: [KIRLIA], hand: [MUKU] });
    expect(canPlayTrainerFromHand(buildContext(alone), MUKU)).toBe(false);
    const noPokemon = buildState({
      active: RALTS,
      deck: [KIRLIA],
      hand: [MUKU, LILLIE, LATIAS],
    });
    expect(canPlayTrainerFromHand(buildContext(noPokemon), MUKU)).toBe(false);
  });
});

describeTranslation("アカマツ", () => {
  test("違うタイプの基本エネルギーを 2 枚まで選び、1 枚を手札に、残りを自分のポケモンにつける", () => {
    const state = buildState({
      active: DREEPY,
      deck: [FIRE_ENERGY, PSYCHIC_ENERGY, DARK_ENERGY],
      hand: [AKAMATSU],
    });
    playTrainerFromHand(
      buildContext(state, {
        chooseCards: pickCardsByName(["基本炎エネルギー", "基本超エネルギー"]),
      }),
      AKAMATSU
    );
    expect(namesOf(state.hand)).toEqual(["基本炎エネルギー"]);
    expect(namesOf(activeOf(state).energies)).toEqual(["基本超エネルギー"]);
  });

  test("1 枚だけ選んだときは手札に加え、同じタイプを 2 枚は選べない", () => {
    const one = buildState({
      active: DREEPY,
      deck: [FIRE_ENERGY, FIRE_ENERGY],
      hand: [AKAMATSU],
    });
    playTrainerFromHand(
      buildContext(one, { chooseCards: pickCardsByName(["基本炎エネルギー"]) }),
      AKAMATSU
    );
    expect(namesOf(one.hand)).toEqual(["基本炎エネルギー"]);
    expect(activeOf(one).energies).toEqual([]);

    const same = buildState({
      active: DREEPY,
      deck: [FIRE_ENERGY, FIRE_ENERGY],
      hand: [AKAMATSU],
    });
    const chooseBoth = buildContext(same, {
      chooseCards: (_state, request) => request.candidates.slice(0, 2),
    });
    expect(() => playTrainerFromHand(chooseBoth, AKAMATSU)).toThrow(
      IllegalMove
    );
  });
});

describeTranslation("偉大な大樹", () => {
  test("番に 1 回、場のたねポケモンを山札の 1進化に進化させ、続けて 2進化にも進化させてよい", () => {
    const state = buildState({
      active: RALTS,
      deck: [KIRLIA, GARDEVOIR, PSYCHIC_ENERGY],
    });
    state.stadium = GREAT_TREE;
    const context = buildContext(state);
    useStadiumEffect(context);
    expect(activeOf(state).name).toBe("メガサーナイトex");
    expect(namesOf(activeOf(state).underneath)).toEqual([
      "ラルトス",
      "キルリア",
    ]);
    expect(canUseStadiumEffect(context)).toBe(false);
  });

  test("最初の自分の番と、この番に出したたねポケモンには使えない", () => {
    const firstTurn = buildState({ active: RALTS, deck: [KIRLIA], turn: 1 });
    firstTurn.stadium = GREAT_TREE;
    expect(canUseStadiumEffect(buildContext(firstTurn))).toBe(false);
    const fresh = buildState({ deck: [KIRLIA], hand: [RALTS] });
    fresh.stadium = GREAT_TREE;
    fresh.placeActiveFromHand(RALTS);
    expect(canUseStadiumEffect(buildContext(fresh))).toBe(false);
  });
});

describeTranslation("ジャミングタワー", () => {
  test("場にある間、ポケモンのどうぐの効果を無くす", () => {
    const state = buildState({
      active: DUDUNSPARCE,
      bench: [SHUPPET],
      hand: [BALLOON],
    });
    attachToolFromHand(buildContext(state), BALLOON, activeOf(state));
    state.stadium = JAMMING_TOWER;
    expect(calculateRetreatCost(state, activeOf(state))).toBe(3);
  });
});

describeTranslation("プリズムタワー", () => {
  test("番に 1 回、手札を 2 枚トラッシュして 1 枚引いてよく、手札が 2 枚無ければ使えない", () => {
    const state = buildState({
      active: RALTS,
      deck: [KIRLIA],
      hand: [LILLIE, PSYCHIC_ENERGY],
    });
    state.stadium = PRISM_TOWER;
    const context = buildContext(state);
    useStadiumEffect(context);
    expect(namesOf(state.hand)).toEqual(["キルリア"]);
    expect(canUseStadiumEffect(context)).toBe(false);
    state.hasUsedStadiumEffect = false;
    expect(canUseStadiumEffect(context)).toBe(false);
  });
});

describeTranslation("ロケット団の監視塔", () => {
  test("場にある間、自分の場の無色ポケモンの特性を無くし、手札のカードの特性は無くさない", () => {
    const state = buildState({
      active: KANGASKHAN,
      deck: [LILLIE, PSYCHIC_ENERGY],
      hand: [MEOWTH, TALONFLAME],
    });
    state.stadium = ROCKET_WATCHTOWER;
    const context = buildContext(state);
    expect(canUseAbility(context, activeOf(state), "おつかいダッシュ")).toBe(
      false
    );
    placeBasicPokemonOnBenchFromHand(context, MEOWTH);
    expect(namesOf(state.hand)).toEqual(["ファイアローex"]);
    expect(canUseAbilityFromHand(context, TALONFLAME, "エキサイトダイブ")).toBe(
      true
    );
  });
});

describeTranslation("テレパス超エネルギー", () => {
  test("手札から超ポケモンにつけたとき、山札から超タイプのたねポケモンを 2 枚までベンチに出す", () => {
    const state = buildState({
      active: RALTS,
      deck: [LATIAS, CHARMANDER, MEW, RALTS],
      hand: [TELEPATH_ENERGY],
    });
    attachEnergyFromHandToPokemon(
      buildContext(state),
      TELEPATH_ENERGY,
      activeOf(state)
    );
    expect(namesOf(state.bench)).toEqual(["ラティアスex", "ミュウex"]);
    expect(listEnergyUnits(state, activeOf(state))).toEqual(["psychic"]);
  });

  test("超ポケモン以外につけたとき、ベンチが 5 匹のときは効果が起きず、山札も切らない", () => {
    const notPsychic = buildState({
      active: CHARMANDER,
      deck: [LATIAS],
      hand: [TELEPATH_ENERGY],
    });
    attachEnergyFromHandToPokemon(
      buildContext(notPsychic),
      TELEPATH_ENERGY,
      activeOf(notPsychic)
    );
    expect(notPsychic.bench).toEqual([]);

    const deck = [KIRLIA, LATIAS, RALTS];
    const full = buildState({
      active: RALTS,
      bench: repeat(RALTS, 5),
      deck,
      hand: [TELEPATH_ENERGY],
    });
    attachEnergyFromHandToPokemon(
      buildContext(full),
      TELEPATH_ENERGY,
      activeOf(full)
    );
    expect(namesOf(full.deck)).toEqual([
      "キルリア",
      "ラティアスex",
      "ラルトス",
    ]);
  });
});

describeTranslation("イグニッションエネルギー", () => {
  test("たねポケモンには無色 1 個ぶん、進化ポケモンには無色 3 個ぶんとして働き、番の終わりにトラッシュする", () => {
    const state = buildState({ active: TALONFLAME, bench: [KANGASKHAN] });
    activeOf(state).energies.push(IGNITION_ENERGY);
    benchAt(state, 0).energies.push(IGNITION_ENERGY);
    expect(listEnergyUnits(state, activeOf(state))).toEqual([
      "colorless",
      "colorless",
      "colorless",
    ]);
    expect(listEnergyUnits(state, benchAt(state, 0))).toEqual(["colorless"]);
    resolveEndOfTurnTriggers(buildContext(state));
    expect(activeOf(state).energies).toEqual([]);
    expect(benchAt(state, 0).energies).toEqual([]);
    expect(state.countInDiscard("イグニッションエネルギー")).toBe(2);
  });

  test("進化ポケモンについた 1 枚で、にげるエネルギー 3 個ぶんを払える", () => {
    const state = buildState({ active: DUDUNSPARCE, bench: [SHUPPET] });
    activeOf(state).energies.push(IGNITION_ENERGY);
    retreatActive(buildContext(state), benchAt(state, 0), [IGNITION_ENERGY]);
    expect(activeOf(state).name).toBe("カゲボウズ");
  });
});

describeTranslation("レガシーエネルギー", () => {
  test("すべてのタイプのエネルギー 1 個ぶんとして働く", () => {
    const state = buildState({ active: DHELMISE });
    activeOf(state).energies.push(LEGACY_ENERGY);
    expect(listEnergyUnits(state, activeOf(state))).toEqual(["any"]);
    expect(
      listUsableAttacksOfActive(buildContext(state)).map(
        (usable) => usable.attack.name
      )
    ).toEqual(["むねんのイカリ"]);
  });
});

describeTranslation("基本超エネルギー", () => {
  test("超エネルギー 1 個ぶんとして働く", () => {
    const state = buildState({ active: RALTS });
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    expect(listEnergyUnits(state, activeOf(state))).toEqual(["psychic"]);
  });
});

describeTranslation("基本炎エネルギー", () => {
  test("炎エネルギー 1 個ぶんとして働く", () => {
    const state = buildState({ active: CHARMANDER });
    activeOf(state).energies.push(FIRE_ENERGY);
    expect(listEnergyUnits(state, activeOf(state))).toEqual(["fire"]);
  });
});

describeTranslation("基本悪エネルギー", () => {
  test("悪エネルギー 1 個ぶんとして働く", () => {
    const state = buildState({ active: FEZANDIPITI });
    activeOf(state).energies.push(DARK_ENERGY);
    expect(listEnergyUnits(state, activeOf(state))).toEqual(["dark"]);
  });
});

describe("翻訳の無いカード", () => {
  test("翻訳が無いサポートを使うと、効果は起きずトラッシュされる", () => {
    const state = buildState({ active: RALTS, bench: [KIRLIA], hand: [BOSS] });
    playTrainerFromHand(buildContext(state), BOSS);
    expect(state.hand).toEqual([]);
    expect(namesOf(state.discard)).toEqual(["ボスの指令"]);
    expect(activeOf(state).name).toBe("ラルトス");
  });
});

describe("翻訳ごとのテスト", () => {
  test("翻訳した記録はすべて、このファイルに骨組みで実行するテストを持つ", () => {
    const translatedNames = [...new Set(cardRecordTable.values())]
      .filter((record) => record.translationStatus === "translated")
      .map((record) => record.name);
    expect(
      translatedNames.filter((name) => !testedTranslations.has(name))
    ).toEqual([]);
  });
});

/**
 * 効果の翻訳ごとに、記録を骨組みで実行して、カードの効果どおりに場が動くことを確かめる。
 * 翻訳した記録はすべてここにテストを持つ(最後のテストで検査する)。
 */

import { describe, expect, test } from "bun:test";
import { calculateAttackDamage } from "./attack-damage.ts";
import {
  attachEnergyFromHandToPokemon,
  attachToolFromHand,
  canEvolvePokemonFromHand,
  canPlayTrainerFromHand,
  canUseAbility,
  canUseAbilityFromHand,
  canUseStadiumEffect,
  evolvePokemonFromHand,
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
  useAttackNamed,
} from "./card-test-support.ts";
import type { Card } from "./cards.ts";
import {
  calculateBenchLimit,
  calculateRetreatCost,
  countEmptyBenchSlots,
  listEnergyUnits,
} from "./continuous-effects.ts";
import { setupGame } from "./engine.ts";
import { type GameState, IllegalMove, PokemonInPlay } from "./state.ts";

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
const CYNTHIAS_GARCHOMP = buildRecordedCard("047381");
const CYNTHIAS_GABITE = buildRecordedCard("049093");
const CYNTHIAS_GIBLE = buildRecordedCard("049092");
const CYNTHIAS_ROSELIA = buildRecordedCard("048748");
const CYNTHIAS_ROSERADE = buildRecordedCard("047366");
const AZURILL = buildRecordedCard("050392");
const FIGHT_GONG = buildRecordedCard("048677");
const POWER_PROTEIN = buildRecordedCard("049368");
const JUDGE = buildRecordedCard("050448");
const EEVEE_EX = buildRecordedCard("049282");
const FLAREON_EX = buildRecordedCard("048810");
const MEGA_RAYQUAZA = buildRecordedCard("050396");
const ETHANS_HO_OH = buildRecordedCard("048543");
const ENERGY_SWITCH = buildRecordedCard("049354");
const GLASS_TRUMPET = buildRecordedCard("048671");
const ADVENTURE_LANTERN = buildRecordedCard("050402");
const ZERO_CAVERN = buildRecordedCard("048706");
const FIGHTING_ENERGY = buildRecordedCard("049464");
const ROCK_FIGHTING_ENERGY = buildRecordedCard("049713");
const LIGHTNING_ENERGY = buildRecordedCard("050480");
const WATER_ENERGY = buildRecordedCard("050479");
const RIOLU = buildRecordedCard("046518");
const MEGA_LUCARIO = buildRecordedCard("047762");
const LUNATONE = buildRecordedCard("047759");
const SOLROCK = buildRecordedCard("047760");
const CIPHERMANIAC = buildRecordedCard("045284");
const CARMINE = buildRecordedCard("049431");
const AZ = buildRecordedCard("050159");
const N_ZORUA = buildRecordedCard("049185");
const N_ZOROARK = buildRecordedCard("048634");
const N_ZEKROM = buildRecordedCard("048651");
const N_DARUMAKA = buildRecordedCard("048834");
const YVELTAL = buildRecordedCard("049197");
const MUNKIDORI = buildRecordedCard("049207");
const TATSUGIRI = buildRecordedCard("048657");
const N_POINT_UP = buildRecordedCard("049351");
const N_CASTLE = buildRecordedCard("048703");
const RAGING_BOLT = buildRecordedCard("049270");
const TEAL_MASK_OGERPON = buildRecordedCard("048798");
const IRON_LEAVES = buildRecordedCard("049478");
const GRASS_ENERGY = buildRecordedCard("047903");
const SLOWPOKE = buildRecordedCard("045977");
const SLOWKING = buildRecordedCard("045978");
const KYUREM = buildRecordedCard("045922");
const METAGROSS = buildRecordedCard("050143");
const SMOOCHUM = buildRecordedCard("046247");
const WONDER_PATCH = buildRecordedCard("048299");
const NIGHT_ACADEMY = buildRecordedCard("045939");
const BOOMERANG_ENERGY = buildRecordedCard("049454");
const APPLIN = buildRecordedCard("048778");
const DIPPLIN = buildRecordedCard("046670");
const THWACKEY = buildRecordedCard("046668");
const SEAKING = buildRecordedCard("046690");
const BUG_CATCHING_SET = buildRecordedCard("049383");
const SACRED_ASH = buildRecordedCard("048672");
const SECRET_BOX = buildRecordedCard("045783");
const GLADION = buildRecordedCard("050295");
const FESTIVAL_GROUNDS = buildRecordedCard("046841");
const FROAKIE = buildRecordedCard("050104");
const FROGADIER = buildRecordedCard("050105");
const MEGA_GRENINJA = buildRecordedCard("050106");
const GRENINJA_EX = buildRecordedCard("045621");
const DRAYDENS_TRUST = buildRecordedCard("050407");
const NEO_UPPER_ENERGY = buildRecordedCard("045217");
const ARIANA = buildRecordedCard("047526");
const SURFER = buildRecordedCard("050009");
const GRAND_TREE_FOREST = buildRecordedCard("050076");
const ABRA = buildRecordedCard("047832");
const KADABRA = buildRecordedCard("047833");
const ALAKAZAM = buildRecordedCard("047834");
const TOUCANNON = buildRecordedCard("050285");
const LILLIES_CARE = buildRecordedCard("045637");
const NIGHT_MINE = buildRecordedCard("048710");
const RICH_ENERGY = buildRecordedCard("046293");
const TERAPAGOS_EX = buildRecordedCard("049346");
const DRILBUR = buildRecordedCard("050263");
const MEGA_EXCADRILL = buildRecordedCard("050321");
const BELDUM = buildRecordedCard("049212");
const METANG = buildRecordedCard("046926");
const GENESECT_EX = buildRecordedCard("047988");
const ENERGY_SEARCH = buildRecordedCard("042243");
const PRECIOUS_CARRIER = buildRecordedCard("046220");
const ROCKET_RECEIVER = buildRecordedCard("049977");
const ENERGY_RECYCLER = buildRecordedCard("050068");
const STEEL_ENERGY = buildRecordedCard("030578");
const IRON_JUGULIS_TING_LU = buildRecordedCard("045594");
const N_SCRIPT = buildRecordedCard("049417");
const PRISM_ENERGY = buildRecordedCard("049455");
const MARNIES_IMPIDIMP = buildRecordedCard("047257");
const MARNIES_MORGREM = buildRecordedCard("047258");
const MARNIES_GRIMMSNARL = buildRecordedCard("047259");
const SPIKEMUTH_GYM = buildRecordedCard("047271");
const TORCHIC = buildRecordedCard("047411");
const BLAZIKEN_EX = buildRecordedCard("046470");
const HYDRAPPLE_EX = buildRecordedCard("048780");
const MEGANIUM = buildRecordedCard("047801");
const CELEBI = buildRecordedCard("047739");
const TOXEL = buildRecordedCard("048482");
const TOXTRICITY = buildRecordedCard("048495");
const ROCKET_FACTORY = buildRecordedCard("048712");
const DRATINI = buildRecordedCard("048646");
const DRAGONAIR = buildRecordedCard("048647");
const MEGA_DRAGONITE = buildRecordedCard("048648");
const KOMMO_O = buildRecordedCard("050390");
const CHERRIM = buildRecordedCard("050566");
const VICTINI = buildRecordedCard("050569");
const ZERAORA = buildRecordedCard("050570");
const MEWTWO = buildRecordedCard("050573");
const ZOROARK = buildRecordedCard("050583");
const IRIS = buildRecordedCard("050601");
const WAITRESS = buildRecordedCard("050602");
const GUY = buildRecordedCard("050603");
const BROCKS_SCOUTING = buildRecordedCard("050605");
const PIKACHU_FIND_A_FRIEND = buildRecordedCard("050635");
const PIKACHU_RUN_AROUND = buildRecordedCard("050638");
const PIKACHU_ENERGY_TAIL = buildRecordedCard("050643");
const PIKACHU_CHARGE_DASH = buildRecordedCard("050648");
const PIKACHU_TROPICAL = buildRecordedCard("050649");
const PIKACHU_NIGHT_WALK = buildRecordedCard("050651");
const PIKACHU_STOCKPILE = buildRecordedCard("050654");
const PIKACHU_EX_PARADE = buildRecordedCard("050659");
const PIKACHU_EX_FEVER = buildRecordedCard("050660");
const VIVILLON = buildRecordedCard("050617");
const MOLTRES = buildRecordedCard("050618");
const LAPRAS = buildRecordedCard("050623");
const ARTICUNO = buildRecordedCard("050624");
const PALKIA = buildRecordedCard("050626");
const ZAPDOS = buildRecordedCard("050661");
const MORPEKO = buildRecordedCard("050664");
const XERNEAS = buildRecordedCard("050675");
const GIMMIGHOUL = buildRecordedCard("050679");
const ALOLAN_MEOWTH = buildRecordedCard("050687");
const GALARIAN_MEOWTH = buildRecordedCard("050692");
const JIRACHI_EX = buildRecordedCard("050693");
const DIALGA = buildRecordedCard("050694");
const COSMOEM = buildRecordedCard("050677");
const SOLGALEO = buildRecordedCard("050696");
const SALAMENCE_EX = buildRecordedCard("050700");
const MEOWTH_30TH = buildRecordedCard("050704");
const DITTO = buildRecordedCard("050705");

/** テストを持つ翻訳の名前。describe を読み込む時点で集まる。 */
const testedTranslations = new Set<string>();

function describeTranslation(name: string, body: () => void): void {
  testedTranslations.add(name);
  describe(name, body);
}

/** ワザを使うポケモン attacker が、カード card の持つワザ attackName を使ったときのダメージ。 */
function damageOf(
  state: GameState,
  attacker: PokemonInPlay,
  card: Card,
  attackName: string
): number | null {
  const attack =
    card.record.category === "ポケモン"
      ? card.record.attacks.find((candidate) => candidate.name === attackName)
      : undefined;
  if (attack === undefined) {
    throw new Error(`${card.name} にワザ ${attackName} が無い`);
  }
  return calculateAttackDamage(state, attacker, attack);
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
    useAttackNamed(buildContext(state), "あふれるねがい");
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
    useAttackNamed(buildContext(state), "コールサイン");
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
    useAttackNamed(buildContext(state), "もってくる");
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
    useAttackNamed(buildContext(state), "しっぽをまく");
    expect(namesOf(state.hand)).toEqual([
      "ニャースex",
      "基本悪エネルギー",
      "基本悪エネルギー",
      "基本悪エネルギー",
    ]);
    expect(activeOf(state).name).toBe("ラルトス");

    const alone = buildState({ active: MEOWTH });
    activeOf(alone).energies.push(...repeat(DARK_ENERGY, 3));
    expect(() => useAttackNamed(buildContext(alone), "しっぽをまく")).toThrow(
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
    useAttackNamed(context, "あふれるねがい");
    expect(namesOf(benchAt(state, 0).energies)).toEqual(["基本超エネルギー"]);
    expect(namesOf(benchAt(state, 1).energies)).toEqual(["基本超エネルギー"]);
  });

  test("きおくのらせんで使うベンチのヤドキングのひらめきチャレンジも、自分で置いた山札の上のポケモンのワザとして使える", () => {
    const state = buildState({
      active: MEW,
      bench: [SLOWKING],
      deck: [PSYCHIC_ENERGY],
      hand: [METAGROSS],
    });
    state.placeHandCardsOnDeckTop([METAGROSS]);
    activeOf(state).energies.push(PSYCHIC_ENERGY, PSYCHIC_ENERGY);
    const context = buildContext(state);
    expect(
      listUsableAttacksOfActive(context).map(({ attack }) => attack.name)
    ).toEqual(["テレポートブレイク", "はねかえす", "メタリックハンマー"]);
    useAttackNamed(context, "メタリックハンマー");
    expect(namesOf(state.discard)).toEqual(["メタグロス"]);
    expect(namesOf(state.deck)).toEqual(["基本超エネルギー"]);
  });

  test("きおくのらせんで使うベンチの Nのゾロアークex のナイトジョーカーも、ベンチの「Nのポケモン」のワザとして使える", () => {
    const state = buildState({
      active: MEW,
      bench: [N_ZOROARK, N_ZEKROM],
    });
    activeOf(state).energies.push(DARK_ENERGY, DARK_ENERGY);
    expect(
      listUsableAttacksOfActive(buildContext(state)).map(
        ({ attack }) => attack.name
      )
    ).toEqual(["ひきさく", "ランページサンダー"]);
  });

  test("テレポートブレイクは、のぞむならベンチポケモンと入れ替える", () => {
    const state = buildState({ active: MEW, bench: [RALTS] });
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    useAttackNamed(
      buildContext(state, { choosesToApplyOptionalEffect: () => false }),
      "テレポートブレイク"
    );
    expect(activeOf(state).name).toBe("ミュウex");
    state.attacks.clear();
    useAttackNamed(buildContext(state), "テレポートブレイク");
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
    useAttackNamed(
      buildContext(state, {
        chooseCards: pickCardsByName(["ふしぎなアメ", "リーリエの決心"]),
      }),
      "かぎづめハント"
    );
    expect(namesOf(state.hand)).toEqual(["ふしぎなアメ", "リーリエの決心"]);

    const noPick = buildState({ active: TALONFLAME, deck: [RARE_CANDY] });
    activeOf(noPick).energies.push(IGNITION_ENERGY);
    expect(() =>
      useAttackNamed(
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
    useAttackNamed(
      buildContext(state, { chooseCards: pickCardsByName(["ダダリン"]) }),
      "にんぎょうキャッチ"
    );
    expect(namesOf(state.hand)).toEqual(["ダダリン"]);

    const noPick = buildState({ active: BANETTE, deck: [MUKU] });
    activeOf(noPick).energies.push(PSYCHIC_ENERGY);
    expect(() =>
      useAttackNamed(
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
    useAttackNamed(buildContext(state), "いれかわる");
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
    useAttackNamed(buildContext(state), "むかえにいく");
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

describeTranslation("シロナのガブリアスex", () => {
  test("スクリューダイブは、のぞむなら手札が 6 枚になるように引き、6 枚以上なら引かない", () => {
    const state = buildState({
      active: CYNTHIAS_GARCHOMP,
      deck: repeat(FIGHTING_ENERGY, 10),
      hand: [FIGHT_GONG, JUDGE],
    });
    activeOf(state).energies.push(FIGHTING_ENERGY);
    useAttackNamed(buildContext(state), "スクリューダイブ");
    expect(state.hand).toHaveLength(6);

    const fullHand = buildState({
      active: CYNTHIAS_GARCHOMP,
      deck: repeat(FIGHTING_ENERGY, 10),
      hand: repeat(JUDGE, 7),
    });
    activeOf(fullHand).energies.push(FIGHTING_ENERGY);
    useAttackNamed(buildContext(fullHand), "スクリューダイブ");
    expect(fullHand.hand).toHaveLength(7);
  });

  test("スクリューダイブの引く効果は、のぞまなければ起きない", () => {
    const state = buildState({
      active: CYNTHIAS_GARCHOMP,
      deck: repeat(FIGHTING_ENERGY, 10),
    });
    activeOf(state).energies.push(FIGHTING_ENERGY);
    useAttackNamed(
      buildContext(state, { choosesToApplyOptionalEffect: () => false }),
      "スクリューダイブ"
    );
    expect(state.hand).toEqual([]);
  });
});

describeTranslation("シロナのガバイト", () => {
  test("おうじゃのよびごえは、山札から「シロナのポケモン」を 1 枚手札に加え、このポケモンにつき番に 1 回", () => {
    const state = buildState({
      active: CYNTHIAS_GABITE,
      bench: [CYNTHIAS_GABITE],
      deck: [MEOWTH, FIGHTING_ENERGY, CYNTHIAS_GARCHOMP, CYNTHIAS_ROSELIA],
    });
    const context = buildContext(state);
    useAbility(context, activeOf(state), "おうじゃのよびごえ");
    expect(namesOf(state.hand)).toEqual(["シロナのガブリアスex"]);
    expect(canUseAbility(context, activeOf(state), "おうじゃのよびごえ")).toBe(
      false
    );
    useAbility(context, benchAt(state, 0), "おうじゃのよびごえ");
    expect(namesOf(state.hand)).toEqual([
      "シロナのガブリアスex",
      "シロナのロゼリア",
    ]);
  });

  test("名前に「シロナの」とつかないポケモンは選べない", () => {
    const state = buildState({
      active: CYNTHIAS_GABITE,
      deck: [MEOWTH, FIGHTING_ENERGY],
    });
    useAbility(buildContext(state), activeOf(state), "おうじゃのよびごえ");
    expect(state.hand).toEqual([]);
    expect(state.deck).toHaveLength(2);
  });
});

describeTranslation("ルリリ", () => {
  test("ぴょんぴょんチャージは、山札からエネルギー(特殊エネルギーを含む)を 1 枚ベンチポケモンにつける", () => {
    const state = buildState({
      active: AZURILL,
      bench: [CYNTHIAS_GIBLE],
      deck: [ROCK_FIGHTING_ENERGY, FIGHTING_ENERGY],
    });
    useAttackNamed(buildContext(state), "ぴょんぴょんチャージ");
    expect(namesOf(benchAt(state, 0).energies)).toEqual(["ロック闘エネルギー"]);
    expect(activeOf(state).energies).toEqual([]);
  });

  test("ベンチにポケモンがいなければ、エネルギーはつかない", () => {
    const state = buildState({
      active: AZURILL,
      deck: [FIGHTING_ENERGY],
    });
    useAttackNamed(buildContext(state), "ぴょんぴょんチャージ");
    expect(activeOf(state).energies).toEqual([]);
    expect(state.deck).toHaveLength(1);
  });
});

describeTranslation("ファイトゴング", () => {
  test("山札から闘タイプのたねポケモンか基本闘エネルギーを 1 枚手札に加え、特殊エネルギーや進化ポケモンは選べない", () => {
    const state = buildState({
      active: AZURILL,
      deck: [
        CYNTHIAS_ROSELIA,
        CYNTHIAS_GABITE,
        ROCK_FIGHTING_ENERGY,
        CYNTHIAS_GIBLE,
      ],
      hand: [FIGHT_GONG, FIGHT_GONG],
    });
    const context = buildContext(state);
    playTrainerFromHand(context, FIGHT_GONG);
    expect(namesOf(state.hand)).toEqual(["ファイトゴング", "シロナのフカマル"]);

    const energyOnly = buildState({
      active: AZURILL,
      deck: [ROCK_FIGHTING_ENERGY, FIGHTING_ENERGY],
      hand: [FIGHT_GONG],
    });
    playTrainerFromHand(buildContext(energyOnly), FIGHT_GONG);
    expect(namesOf(energyOnly.hand)).toEqual(["基本闘エネルギー"]);
  });
});

describeTranslation("ジャッジマン", () => {
  test("手札を山札に戻して切り、4 枚引く", () => {
    const state = buildState({
      active: AZURILL,
      deck: repeat(FIGHTING_ENERGY, 5),
      hand: [JUDGE, FIGHT_GONG, CYNTHIAS_GIBLE],
    });
    playTrainerFromHand(buildContext(state), JUDGE);
    expect(state.hand).toHaveLength(4);
    expect(state.deck).toHaveLength(3);
    expect(namesOf(state.discard)).toEqual(["ジャッジマン"]);
  });
});

describeTranslation("基本闘エネルギー", () => {
  test("闘エネルギー 1 個ぶんとして働く", () => {
    const state = buildState({ active: CYNTHIAS_GIBLE });
    activeOf(state).energies.push(FIGHTING_ENERGY);
    expect(listEnergyUnits(state, activeOf(state))).toEqual(["fighting"]);
  });
});

describeTranslation("ロック闘エネルギー", () => {
  test("闘エネルギー 1 個ぶんとして働く", () => {
    const state = buildState({ active: CYNTHIAS_GIBLE });
    activeOf(state).energies.push(ROCK_FIGHTING_ENERGY);
    expect(listEnergyUnits(state, activeOf(state))).toEqual(["fighting"]);
  });
});

describeTranslation("基本雷エネルギー", () => {
  test("雷エネルギー 1 個ぶんとして働く", () => {
    const state = buildState({ active: MEGA_RAYQUAZA });
    activeOf(state).energies.push(LIGHTNING_ENERGY);
    expect(listEnergyUnits(state, activeOf(state))).toEqual(["electric"]);
  });
});

describeTranslation("基本水エネルギー", () => {
  test("水エネルギー 1 個ぶんとして働く", () => {
    const state = buildState({ active: EEVEE_EX });
    activeOf(state).energies.push(WATER_ENERGY);
    expect(listEnergyUnits(state, activeOf(state))).toEqual(["water"]);
  });
});

describeTranslation("イーブイex", () => {
  test("にじいろDNA で、手札の「イーブイ」から進化するポケモンex をこのポケモンにのせて進化させる", () => {
    const state = buildState({ active: EEVEE_EX, hand: [FLAREON_EX] });
    const context = buildContext(state);
    expect(canEvolvePokemonFromHand(context, activeOf(state), FLAREON_EX)).toBe(
      true
    );
    evolvePokemonFromHand(context, activeOf(state), FLAREON_EX);
    expect(activeOf(state).name).toBe("ブースターex");
    expect(namesOf(activeOf(state).underneath)).toEqual(["イーブイex"]);
  });

  test("最初の番、出したばかりの番、特性が無くなっているとき(ロケット団の監視塔)は進化できない", () => {
    const firstTurn = buildState({
      active: EEVEE_EX,
      hand: [FLAREON_EX],
      turn: 1,
    });
    expect(
      canEvolvePokemonFromHand(
        buildContext(firstTurn),
        activeOf(firstTurn),
        FLAREON_EX
      )
    ).toBe(false);

    const fresh = buildState({ active: AZURILL, hand: [EEVEE_EX, FLAREON_EX] });
    const context = buildContext(fresh);
    const eevee = placeBasicPokemonOnBenchFromHand(context, EEVEE_EX);
    expect(canEvolvePokemonFromHand(context, eevee, FLAREON_EX)).toBe(false);

    const negated = buildState({ active: EEVEE_EX, hand: [FLAREON_EX] });
    negated.stadium = ROCKET_WATCHTOWER;
    expect(
      canEvolvePokemonFromHand(
        buildContext(negated),
        activeOf(negated),
        FLAREON_EX
      )
    ).toBe(false);
  });

  test("偉大な大樹で山札から進化させるときは働かない", () => {
    const state = buildState({ active: EEVEE_EX, deck: [FLAREON_EX] });
    state.stadium = GREAT_TREE;
    useStadiumEffect(buildContext(state));
    expect(activeOf(state).name).toBe("イーブイex");
  });
});

describeTranslation("ブースターex", () => {
  test("バーニングチャージは、山札から基本エネルギーを 2 枚まで自分のポケモン 1 匹につける", () => {
    const state = buildState({
      active: FLAREON_EX,
      bench: [MEGA_RAYQUAZA],
      deck: [ROCK_FIGHTING_ENERGY, FIRE_ENERGY, LIGHTNING_ENERGY, WATER_ENERGY],
    });
    activeOf(state).energies.push(FIRE_ENERGY, FIRE_ENERGY);
    useAttackNamed(
      buildContext(state, {
        choosePokemon: (_, request) =>
          request.candidates.filter(
            (pokemon) => pokemon.name === "メガレックウザex"
          ),
      }),
      "バーニングチャージ"
    );
    expect(namesOf(benchAt(state, 0).energies)).toEqual([
      "基本炎エネルギー",
      "基本雷エネルギー",
    ]);
    expect(state.deck).toHaveLength(2);
  });

  test("山札から 1 枚も選ばなくてよい", () => {
    const state = buildState({
      active: FLAREON_EX,
      deck: [FIRE_ENERGY],
    });
    activeOf(state).energies.push(FIRE_ENERGY, FIRE_ENERGY);
    useAttackNamed(
      buildContext(state, { chooseCards: () => [] }),
      "バーニングチャージ"
    );
    expect(activeOf(state).energies).toHaveLength(2);
    expect(state.deck).toHaveLength(1);
  });
});

describeTranslation("メガレックウザex", () => {
  test("はしゃのほうこうは、手札からベンチに出したとき山札の上から 4 枚見て基本エネルギーを 1 枚このポケモンにつけ、残りを山札の下に戻す", () => {
    const state = buildState({
      active: AZURILL,
      deck: [
        MEOWTH,
        ROCK_FIGHTING_ENERGY,
        LIGHTNING_ENERGY,
        FIRE_ENERGY,
        JUDGE,
      ],
      hand: [MEGA_RAYQUAZA],
    });
    const rayquaza = placeBasicPokemonOnBenchFromHand(
      buildContext(state),
      MEGA_RAYQUAZA
    );
    expect(namesOf(rayquaza.energies)).toEqual(["基本雷エネルギー"]);
    expect(state.deck).toHaveLength(4);
    expect(state.deck[0]?.name).toBe("ジャッジマン");
    expect(namesOf(state.deck.slice(1)).sort()).toEqual(
      ["ニャースex", "ロック闘エネルギー", "基本炎エネルギー"].sort()
    );
  });

  test("山札が 4 枚に満たなくても、ある分だけ見て使える", () => {
    const state = buildState({
      active: AZURILL,
      deck: [FIRE_ENERGY],
      hand: [MEGA_RAYQUAZA],
    });
    const rayquaza = placeBasicPokemonOnBenchFromHand(
      buildContext(state),
      MEGA_RAYQUAZA
    );
    expect(namesOf(rayquaza.energies)).toEqual(["基本炎エネルギー"]);
    expect(state.deck).toEqual([]);
  });

  test("ストームエメラルダは、自分のポケモン全員の炎と雷のエネルギーの数×50 で、すべてのタイプとして働く 1 枚は 1 つと数える", () => {
    const state = buildState({
      active: MEGA_RAYQUAZA,
      bench: [FLAREON_EX],
    });
    activeOf(state).energies.push(FIRE_ENERGY, LIGHTNING_ENERGY, WATER_ENERGY);
    benchAt(state, 0).energies.push(LEGACY_ENERGY, FIRE_ENERGY);
    const [storm] = listUsableAttacksOfActive(buildContext(state));
    expect(storm?.attack.name).toBe("ストームエメラルダ");
    expect(
      storm === undefined
        ? null
        : calculateAttackDamage(state, activeOf(state), storm.attack)
    ).toBe(200);
  });
});

describeTranslation("ヒビキのホウオウex", () => {
  test("こんじきのほのおは、手札の基本炎エネルギーを 2 枚までベンチの「ヒビキのポケモン」1 匹につけ、このポケモンにつき番に 1 回", () => {
    const state = buildState({
      active: MEGA_RAYQUAZA,
      bench: [ETHANS_HO_OH],
      hand: [FIRE_ENERGY, LIGHTNING_ENERGY, FIRE_ENERGY, FIRE_ENERGY],
    });
    const context = buildContext(state);
    const hoOh = benchAt(state, 0);
    useAbility(context, hoOh, "こんじきのほのお");
    expect(namesOf(hoOh.energies)).toEqual([
      "基本炎エネルギー",
      "基本炎エネルギー",
    ]);
    expect(state.hasAttachedEnergy).toBe(false);
    expect(canUseAbility(context, hoOh, "こんじきのほのお")).toBe(false);
  });

  test("1 枚だけつけてもよく、ベンチに「ヒビキのポケモン」がいなければ使えない", () => {
    const state = buildState({
      active: MEGA_RAYQUAZA,
      bench: [ETHANS_HO_OH],
      hand: [FIRE_ENERGY, FIRE_ENERGY],
    });
    const hoOh = benchAt(state, 0);
    useAbility(
      buildContext(state, {
        chooseCards: (_, request) => request.candidates.slice(0, 1),
      }),
      hoOh,
      "こんじきのほのお"
    );
    expect(namesOf(hoOh.energies)).toEqual(["基本炎エネルギー"]);

    const activeHoOh = buildState({
      active: ETHANS_HO_OH,
      bench: [MEGA_RAYQUAZA],
      hand: [FIRE_ENERGY],
    });
    expect(
      canUseAbility(
        buildContext(activeHoOh),
        activeOf(activeHoOh),
        "こんじきのほのお"
      )
    ).toBe(false);
  });
});

describeTranslation("エネルギーつけかえ", () => {
  test("自分のポケモンについている基本エネルギーを 1 個、別の自分のポケモンにつけ替える", () => {
    const state = buildState({
      active: MEGA_RAYQUAZA,
      bench: [FLAREON_EX],
      hand: [ENERGY_SWITCH],
    });
    activeOf(state).energies.push(FIRE_ENERGY);
    playTrainerFromHand(buildContext(state), ENERGY_SWITCH);
    expect(activeOf(state).energies).toEqual([]);
    expect(namesOf(benchAt(state, 0).energies)).toEqual(["基本炎エネルギー"]);
    expect(state.hasAttachedEnergy).toBe(false);
  });

  test("特殊エネルギーしかついていないときと、場のポケモンが 1 匹のときは使えない", () => {
    const special = buildState({
      active: CYNTHIAS_GIBLE,
      bench: [AZURILL],
      hand: [ENERGY_SWITCH],
    });
    activeOf(special).energies.push(ROCK_FIGHTING_ENERGY);
    expect(canPlayTrainerFromHand(buildContext(special), ENERGY_SWITCH)).toBe(
      false
    );

    const alone = buildState({
      active: MEGA_RAYQUAZA,
      hand: [ENERGY_SWITCH],
    });
    activeOf(alone).energies.push(FIRE_ENERGY);
    expect(canPlayTrainerFromHand(buildContext(alone), ENERGY_SWITCH)).toBe(
      false
    );
  });
});

describeTranslation("ガラスのラッパ", () => {
  test("場に「テラスタル」のポケモンがいれば、ベンチの無色ポケモン 2 匹までにトラッシュの基本エネルギーを 1 枚ずつつける", () => {
    const state = buildState({
      active: FLAREON_EX,
      bench: [MEGA_RAYQUAZA, MEOWTH, AZURILL],
      discard: [ROCK_FIGHTING_ENERGY, FIRE_ENERGY, LIGHTNING_ENERGY],
      hand: [GLASS_TRUMPET],
    });
    playTrainerFromHand(buildContext(state), GLASS_TRUMPET);
    expect(namesOf(benchAt(state, 0).energies)).toEqual(["基本炎エネルギー"]);
    expect(namesOf(benchAt(state, 1).energies)).toEqual(["基本雷エネルギー"]);
    expect(benchAt(state, 2).energies).toEqual([]);
    expect(namesOf(state.discard).sort()).toEqual(
      ["ガラスのラッパ", "ロック闘エネルギー"].sort()
    );
  });

  test("場に「テラスタル」のポケモンがいないときと、トラッシュに基本エネルギーが無いときは使えない", () => {
    const noTerastal = buildState({
      active: MEGA_RAYQUAZA,
      bench: [MEOWTH],
      discard: [FIRE_ENERGY],
      hand: [GLASS_TRUMPET],
    });
    expect(
      canPlayTrainerFromHand(buildContext(noTerastal), GLASS_TRUMPET)
    ).toBe(false);

    const noEnergy = buildState({
      active: EEVEE_EX,
      bench: [MEOWTH],
      hand: [GLASS_TRUMPET],
    });
    expect(canPlayTrainerFromHand(buildContext(noEnergy), GLASS_TRUMPET)).toBe(
      false
    );
  });
});

describeTranslation("ぼうけんのランタン", () => {
  test("山札から基本炎エネルギーと基本雷エネルギーを 1 枚ずつ手札に加え、片方だけでもよい", () => {
    const state = buildState({
      active: MEGA_RAYQUAZA,
      deck: [WATER_ENERGY, LIGHTNING_ENERGY, FIRE_ENERGY, FIRE_ENERGY],
      hand: [ADVENTURE_LANTERN],
    });
    playTrainerFromHand(buildContext(state), ADVENTURE_LANTERN);
    expect(namesOf(state.hand)).toEqual([
      "基本炎エネルギー",
      "基本雷エネルギー",
    ]);

    const fireOnly = buildState({
      active: MEGA_RAYQUAZA,
      deck: [WATER_ENERGY, FIRE_ENERGY],
      hand: [ADVENTURE_LANTERN],
    });
    playTrainerFromHand(buildContext(fireOnly), ADVENTURE_LANTERN);
    expect(namesOf(fireOnly.hand)).toEqual(["基本炎エネルギー"]);
  });
});

describeTranslation("ゼロの大空洞", () => {
  test("場に「テラスタル」のポケモンがいればベンチに 8 匹まで出せ、いなければ 5 匹のまま", () => {
    const state = buildState({
      active: EEVEE_EX,
      bench: repeat(AZURILL, 5),
      hand: [MEOWTH],
    });
    state.stadium = ZERO_CAVERN;
    expect(calculateBenchLimit(state)).toBe(8);
    placeBasicPokemonOnBenchFromHand(buildContext(state), MEOWTH);
    expect(state.bench).toHaveLength(6);

    const noTerastal = buildState({
      active: MEGA_RAYQUAZA,
      bench: repeat(AZURILL, 5),
      hand: [EEVEE_EX],
    });
    noTerastal.stadium = ZERO_CAVERN;
    expect(countEmptyBenchSlots(noTerastal)).toBe(0);
    expect(() =>
      placeBasicPokemonOnBenchFromHand(buildContext(noTerastal), EEVEE_EX)
    ).toThrow(IllegalMove);
  });

  test("場から「テラスタル」のポケモンがいなくなったら、ベンチを 5 匹になるまでトラッシュしてから、バトル場に出す", () => {
    const state = buildState({
      active: EEVEE_EX,
      bench: repeat(AZURILL, 8),
      hand: [SCOOP_UP_CYCLONE],
    });
    state.stadium = ZERO_CAVERN;
    playTrainerFromHand(
      buildContext(state, {
        choosePokemon: (_, request) =>
          request.purpose.includes("手札に戻す")
            ? request.candidates.filter(
                (pokemon) => pokemon.name === "イーブイex"
              )
            : request.candidates.slice(0, request.maxCount),
      }),
      SCOOP_UP_CYCLONE
    );
    expect(namesOf(state.hand)).toEqual(["イーブイex"]);
    expect(activeOf(state).name).toBe("ルリリ");
    expect(state.bench).toHaveLength(4);
    expect(state.discard.filter((card) => card.name === "ルリリ")).toHaveLength(
      3
    );
  });

  test("別のスタジアムを出してこのカードがトラッシュされたら、ベンチを 5 匹になるまでトラッシュする", () => {
    const state = buildState({
      active: EEVEE_EX,
      bench: repeat(AZURILL, 7),
      hand: [PRISM_TOWER],
    });
    state.stadium = ZERO_CAVERN;
    playTrainerFromHand(buildContext(state), PRISM_TOWER);
    expect(state.bench).toHaveLength(5);
    expect(namesOf(state.discard).sort()).toEqual(
      ["ゼロの大空洞", "ルリリ", "ルリリ"].sort()
    );
  });
});

describeTranslation("パワープロテイン", () => {
  test("使った番だけ、闘ポケモンのワザのダメージを +30 し、2 枚使えば +60", () => {
    const state = buildState({
      active: CYNTHIAS_GARCHOMP,
      deck: [FIGHTING_ENERGY],
      hand: [POWER_PROTEIN, POWER_PROTEIN],
    });
    const context = buildContext(state);
    const garchomp = activeOf(state);
    playTrainerFromHand(context, POWER_PROTEIN);
    expect(
      damageOf(state, garchomp, CYNTHIAS_GARCHOMP, "リューノバスター")
    ).toBe(290);
    playTrainerFromHand(context, POWER_PROTEIN);
    expect(
      damageOf(state, garchomp, CYNTHIAS_GARCHOMP, "リューノバスター")
    ).toBe(320);
    state.beginTurn();
    expect(
      damageOf(state, garchomp, CYNTHIAS_GARCHOMP, "リューノバスター")
    ).toBe(260);
  });

  test("闘ポケモンかはワザを使うポケモンで決まり、ミュウex がベンチの闘ポケモンのワザを使っても増えない", () => {
    const state = buildState({
      active: MEW,
      bench: [CYNTHIAS_GARCHOMP],
      hand: [POWER_PROTEIN],
    });
    playTrainerFromHand(buildContext(state), POWER_PROTEIN);
    expect(
      damageOf(state, activeOf(state), CYNTHIAS_GARCHOMP, "リューノバスター")
    ).toBe(260);
    expect(
      damageOf(state, benchAt(state, 0), CYNTHIAS_GARCHOMP, "リューノバスター")
    ).toBe(290);
  });
});

describeTranslation("シロナのロズレイド", () => {
  test("グローリーエールは、場にいる間、自分の「シロナのポケモン」のワザのダメージを 1 匹につき +30 し、自身のワザも増やす", () => {
    const state = buildState({
      active: CYNTHIAS_GARCHOMP,
      bench: [CYNTHIAS_ROSERADE, MEW],
    });
    expect(
      damageOf(state, activeOf(state), CYNTHIAS_GARCHOMP, "リューノバスター")
    ).toBe(290);
    expect(
      damageOf(state, benchAt(state, 0), CYNTHIAS_ROSERADE, "リーフステップ")
    ).toBe(110);
    expect(damageOf(state, benchAt(state, 1), MEW, "テレポートブレイク")).toBe(
      30
    );
    state.bench.push(new PokemonInPlay(CYNTHIAS_ROSERADE, 0));
    expect(
      damageOf(state, activeOf(state), CYNTHIAS_GARCHOMP, "リューノバスター")
    ).toBe(320);
  });

  test("パワープロテインと重ねて足す", () => {
    const state = buildState({
      active: CYNTHIAS_GARCHOMP,
      bench: [CYNTHIAS_ROSERADE],
      hand: [POWER_PROTEIN],
    });
    playTrainerFromHand(buildContext(state), POWER_PROTEIN);
    expect(
      damageOf(state, activeOf(state), CYNTHIAS_GARCHOMP, "リューノバスター")
    ).toBe(320);
  });
});

describeTranslation("メガルカリオex", () => {
  test("はどうづきは、トラッシュの基本闘エネルギーを 3 枚まで、ベンチポケモンに好きなようにつける", () => {
    const state = buildState({
      active: MEGA_LUCARIO,
      bench: [RIOLU, LUNATONE],
      discard: [
        FIGHTING_ENERGY,
        ROCK_FIGHTING_ENERGY,
        FIGHTING_ENERGY,
        FIGHTING_ENERGY,
        FIGHTING_ENERGY,
      ],
    });
    activeOf(state).energies.push(FIGHTING_ENERGY);
    useAttackNamed(
      buildContext(state, {
        choosePokemon: (_, request) =>
          request.candidates.filter((pokemon) => pokemon.name === "リオル"),
      }),
      "はどうづき"
    );
    expect(namesOf(benchAt(state, 0).energies)).toEqual(
      repeat("基本闘エネルギー", 3)
    );
    expect(benchAt(state, 1).energies).toEqual([]);
    expect(namesOf(activeOf(state).energies)).toEqual(["基本闘エネルギー"]);
    expect(namesOf(state.discard).sort()).toEqual(
      ["ロック闘エネルギー", "基本闘エネルギー"].sort()
    );
  });

  test("はどうづきで、トラッシュに基本闘エネルギーがあってもつけないことを選べる(公式 Q&A)", () => {
    const state = buildState({
      active: MEGA_LUCARIO,
      bench: [RIOLU],
      discard: [FIGHTING_ENERGY],
    });
    activeOf(state).energies.push(FIGHTING_ENERGY);
    useAttackNamed(
      buildContext(state, { chooseCards: () => [] }),
      "はどうづき"
    );
    expect(benchAt(state, 0).energies).toEqual([]);
    expect(namesOf(state.discard)).toEqual(["基本闘エネルギー"]);
  });
});

describeTranslation("ルナトーン", () => {
  test("ルナサイクルは、場にソルロックがいれば手札の基本闘エネルギーを 1 枚トラッシュして 3 枚引く", () => {
    const state = buildState({
      active: SOLROCK,
      bench: [LUNATONE],
      deck: repeat(PSYCHIC_ENERGY, 5),
      hand: [ROCK_FIGHTING_ENERGY, FIGHTING_ENERGY],
    });
    useAbility(buildContext(state), benchAt(state, 0), "ルナサイクル");
    expect(namesOf(state.discard)).toEqual(["基本闘エネルギー"]);
    expect(state.hand).toHaveLength(4);
    expect(state.deck).toHaveLength(2);
  });

  test("場にソルロックがいないときと、手札に基本闘エネルギーが無いときは使えない", () => {
    const noSolrock = buildState({
      active: LUNATONE,
      deck: repeat(PSYCHIC_ENERGY, 5),
      hand: [FIGHTING_ENERGY],
    });
    expect(
      canUseAbility(
        buildContext(noSolrock),
        activeOf(noSolrock),
        "ルナサイクル"
      )
    ).toBe(false);
    const noBasicEnergy = buildState({
      active: LUNATONE,
      bench: [SOLROCK],
      deck: repeat(PSYCHIC_ENERGY, 5),
      hand: [ROCK_FIGHTING_ENERGY],
    });
    expect(
      canUseAbility(
        buildContext(noBasicEnergy),
        activeOf(noBasicEnergy),
        "ルナサイクル"
      )
    ).toBe(false);
  });

  test("別のルナトーンのルナサイクルを使った番は使えない", () => {
    const state = buildState({
      active: LUNATONE,
      bench: [LUNATONE, SOLROCK],
      deck: repeat(PSYCHIC_ENERGY, 8),
      hand: [FIGHTING_ENERGY, FIGHTING_ENERGY],
    });
    const context = buildContext(state);
    useAbility(context, activeOf(state), "ルナサイクル");
    expect(canUseAbility(context, benchAt(state, 0), "ルナサイクル")).toBe(
      false
    );
  });
});

describeTranslation("暗号マニアの解読", () => {
  test("山札から 2 枚を選び、残りを切ってから、選んだ順に山札の上に置く", () => {
    const state = buildState({
      deck: [PSYCHIC_ENERGY, RIOLU, FIRE_ENERGY, LUNATONE, DARK_ENERGY],
      hand: [CIPHERMANIAC],
    });
    playTrainerFromHand(
      buildContext(state, {
        chooseCards: pickCardsByName(["ルナトーン", "リオル"]),
      }),
      CIPHERMANIAC
    );
    expect(namesOf(state.deck.slice(0, 2))).toEqual(["ルナトーン", "リオル"]);
    expect(state.deck).toHaveLength(5);
    expect(namesOf(state.discard)).toEqual(["暗号マニアの解読"]);
  });

  test("山札が 2 枚以上あれば 1 枚だけは選べず、山札が 1 枚ならその 1 枚を置く", () => {
    const twoOrMore = buildState({
      deck: [PSYCHIC_ENERGY, RIOLU, FIRE_ENERGY],
      hand: [CIPHERMANIAC],
    });
    expect(() =>
      playTrainerFromHand(
        buildContext(twoOrMore, {
          chooseCards: pickCardsByName(["リオル"]),
        }),
        CIPHERMANIAC
      )
    ).toThrow(IllegalMove);

    const one = buildState({ deck: [RIOLU], hand: [CIPHERMANIAC] });
    playTrainerFromHand(buildContext(one), CIPHERMANIAC);
    expect(namesOf(one.deck)).toEqual(["リオル"]);
  });
});

describeTranslation("ゼイユ", () => {
  test("手札をすべてトラッシュして 5 枚引く。先攻の最初の番でも使える", () => {
    const state = buildState({
      active: RALTS,
      deck: repeat(PSYCHIC_ENERGY, 6),
      hand: [CARMINE, LILLIE, FIRE_ENERGY],
      turn: 1,
      wentFirst: true,
    });
    const context = buildContext(state);
    expect(canPlayTrainerFromHand(context, LILLIE)).toBe(false);
    playTrainerFromHand(context, CARMINE);
    expect(namesOf(state.discard).sort()).toEqual(
      ["ゼイユ", "リーリエの決心", "基本炎エネルギー"].sort()
    );
    expect(namesOf(state.hand)).toEqual(repeat("基本超エネルギー", 5));
  });

  test("手札がゼイユだけでも使える(公式 Q&A)が、この番にサポートを使っていれば使えない", () => {
    const state = buildState({
      active: RALTS,
      deck: repeat(PSYCHIC_ENERGY, 6),
      hand: [CARMINE],
    });
    playTrainerFromHand(buildContext(state), CARMINE);
    expect(state.hand).toHaveLength(5);

    const used = buildState({
      active: RALTS,
      deck: repeat(PSYCHIC_ENERGY, 6),
      hand: [CARMINE],
      turn: 1,
      wentFirst: true,
    });
    used.hasUsedSupporter = true;
    expect(canPlayTrainerFromHand(buildContext(used), CARMINE)).toBe(false);
  });
});

describeTranslation("AZの安らぎ", () => {
  test("バトルポケモンをベンチポケモンと入れ替える。ベンチにポケモンがいなければ使えない", () => {
    const state = buildState({ active: RALTS, bench: [KIRLIA], hand: [AZ] });
    playTrainerFromHand(buildContext(state), AZ);
    expect(activeOf(state).name).toBe("キルリア");
    expect(benchAt(state, 0).name).toBe("ラルトス");

    const alone = buildState({ active: RALTS, hand: [AZ] });
    expect(canPlayTrainerFromHand(buildContext(alone), AZ)).toBe(false);
  });
});

describeTranslation("Nのゾロアークex", () => {
  test("とりひきは、手札を 1 枚トラッシュして 2 枚引く。ポケモンごとに番に 1 回", () => {
    const state = buildState({
      active: N_ZOROARK,
      bench: [N_ZOROARK],
      deck: repeat(PSYCHIC_ENERGY, 5),
      hand: [FIRE_ENERGY],
    });
    const context = buildContext(state);
    useAbility(context, activeOf(state), "とりひき");
    expect(namesOf(state.discard)).toEqual(["基本炎エネルギー"]);
    expect(state.hand).toHaveLength(2);
    expect(canUseAbility(context, activeOf(state), "とりひき")).toBe(false);
    expect(canUseAbility(context, benchAt(state, 0), "とりひき")).toBe(true);
  });

  test("山札が 0 枚のときと、手札が 0 枚のときは、とりひきを使えない(公式 Q&A)", () => {
    const emptyDeck = buildState({ active: N_ZOROARK, hand: [FIRE_ENERGY] });
    expect(
      canUseAbility(buildContext(emptyDeck), activeOf(emptyDeck), "とりひき")
    ).toBe(false);
    const emptyHand = buildState({
      active: N_ZOROARK,
      deck: repeat(PSYCHIC_ENERGY, 5),
    });
    expect(
      canUseAbility(buildContext(emptyHand), activeOf(emptyHand), "とりひき")
    ).toBe(false);
  });

  test("ナイトジョーカーは、ベンチの「Nのポケモン」のワザを、ナイトジョーカーに必要なエネルギーで使える", () => {
    const state = buildState({
      active: N_ZOROARK,
      bench: [N_ZEKROM, YVELTAL],
    });
    activeOf(state).energies.push(DARK_ENERGY, DARK_ENERGY);
    const usable = listUsableAttacksOfActive(buildContext(state));
    expect(usable.map(({ attack }) => attack.name)).toEqual([
      "ひきさく",
      "ランページサンダー",
    ]);
    const thunder = usable.find(
      ({ attack }) => attack.name === "ランページサンダー"
    );
    expect(thunder?.attack.cost).toEqual(["dark", "dark"]);
    expect(
      thunder === undefined
        ? null
        : calculateAttackDamage(state, activeOf(state), thunder.attack)
    ).toBe(250);
  });

  test("ベンチに「Nのポケモン」(Nのゾロアークex を除く)がいなければ、ナイトジョーカーで使えるワザは無い", () => {
    const state = buildState({ active: N_ZOROARK, bench: [YVELTAL] });
    activeOf(state).energies.push(DARK_ENERGY, DARK_ENERGY);
    expect(listUsableAttacksOfActive(buildContext(state))).toEqual([]);
    // ベンチの Nのゾロアークex のナイトジョーカーは選ぶワザに入れない
    state.bench.push(new PokemonInPlay(N_ZOROARK, 0));
    expect(listUsableAttacksOfActive(buildContext(state))).toEqual([]);
  });
});

describeTranslation("モモワロウex", () => {
  test("しはいのくさりは、ベンチの悪ポケモン(モモワロウex を除く)をバトルポケモンと入れ替える", () => {
    const state = buildState({
      active: N_DARUMAKA,
      bench: [MUNKIDORI, N_ZEKROM, MUNKIDORI, YVELTAL],
    });
    useAbility(buildContext(state), benchAt(state, 0), "しはいのくさり");
    expect(activeOf(state).name).toBe("イベルタル");
    expect(namesOf(state.bench.map((pokemon) => pokemon.card))).toContain(
      "Nのダルマッカ"
    );
  });

  test("ベンチにモモワロウex 以外の悪ポケモンがいなければ使えず、別のしはいのくさりを使った番も使えない", () => {
    const noTarget = buildState({
      active: MUNKIDORI,
      bench: [MUNKIDORI, N_ZEKROM],
    });
    expect(
      canUseAbility(
        buildContext(noTarget),
        benchAt(noTarget, 0),
        "しはいのくさり"
      )
    ).toBe(false);

    const state = buildState({
      active: YVELTAL,
      bench: [MUNKIDORI, MUNKIDORI, N_ZORUA],
    });
    const context = buildContext(state);
    useAbility(context, benchAt(state, 0), "しはいのくさり");
    expect(canUseAbility(context, benchAt(state, 1), "しはいのくさり")).toBe(
      false
    );
  });
});

describeTranslation("シャリタツ", () => {
  test("きゃくよせは、バトル場にいれば山札の上から 6 枚を見てサポートを 1 枚手札に加え、残りを切る", () => {
    const state = buildState({
      active: TATSUGIRI,
      deck: [
        PSYCHIC_ENERGY,
        LILLIE,
        FIRE_ENERGY,
        BOSS,
        PSYCHIC_ENERGY,
        PSYCHIC_ENERGY,
        HIKARI,
      ],
    });
    useAbility(buildContext(state), activeOf(state), "きゃくよせ");
    expect(namesOf(state.hand)).toEqual(["リーリエの決心"]);
    expect(state.deck).toHaveLength(6);
  });

  test("ベンチにいるときは使えず、山札が 6 枚に満たなくても使える(公式 Q&A)", () => {
    const benched = buildState({
      active: YVELTAL,
      bench: [TATSUGIRI],
      deck: [LILLIE],
    });
    expect(
      canUseAbility(buildContext(benched), benchAt(benched, 0), "きゃくよせ")
    ).toBe(false);
    const small = buildState({
      active: TATSUGIRI,
      deck: [FIRE_ENERGY, LILLIE],
    });
    useAbility(buildContext(small), activeOf(small), "きゃくよせ");
    expect(namesOf(small.hand)).toEqual(["リーリエの決心"]);
  });
});

describeTranslation("Nのポイントアップ", () => {
  test("トラッシュの基本エネルギーを 1 枚、ベンチの「Nのポケモン」につける", () => {
    const state = buildState({
      active: N_ZOROARK,
      bench: [YVELTAL, N_ZEKROM],
      discard: [ROCK_FIGHTING_ENERGY, LIGHTNING_ENERGY],
      hand: [N_POINT_UP],
    });
    playTrainerFromHand(buildContext(state), N_POINT_UP);
    expect(namesOf(benchAt(state, 1).energies)).toEqual(["基本雷エネルギー"]);
    expect(benchAt(state, 0).energies).toEqual([]);
    expect(activeOf(state).energies).toEqual([]);
  });

  test("ベンチに「Nのポケモン」がいないときは使えない", () => {
    const state = buildState({
      active: N_ZOROARK,
      bench: [YVELTAL],
      discard: [LIGHTNING_ENERGY],
      hand: [N_POINT_UP],
    });
    expect(canPlayTrainerFromHand(buildContext(state), N_POINT_UP)).toBe(false);
  });
});

describeTranslation("Nの城", () => {
  test("自分の場の「Nのポケモン」のにげるエネルギーを 0 にする", () => {
    const state = buildState({
      active: N_ZEKROM,
      bench: [YVELTAL, N_DARUMAKA],
    });
    state.stadium = N_CASTLE;
    expect(calculateRetreatCost(state, activeOf(state))).toBe(0);
    expect(calculateRetreatCost(state, benchAt(state, 1))).toBe(0);
    const withoutCastle = buildState({ active: N_ZEKROM });
    expect(calculateRetreatCost(withoutCastle, activeOf(withoutCastle))).toBe(
      2
    );
  });
});

describeTranslation("タケルライコex", () => {
  test("はじけるほうこうは、手札をすべてトラッシュして 6 枚引く", () => {
    const state = buildState({
      active: RAGING_BOLT,
      deck: repeat(PSYCHIC_ENERGY, 8),
      hand: [BOSS, GRASS_ENERGY],
    });
    activeOf(state).energies.push(GRASS_ENERGY);
    useAttackNamed(buildContext(state), "はじけるほうこう");
    expect(namesOf(state.discard).sort()).toEqual(
      ["ボスの指令", "基本草エネルギー"].sort()
    );
    expect(state.hand).toHaveLength(6);
  });

  test("きょくらいごうのダメージは、自分の場の基本エネルギーの枚数 × 70(特殊エネルギーは数えない)", () => {
    const state = buildState({
      active: RAGING_BOLT,
      bench: [TEAL_MASK_OGERPON],
    });
    activeOf(state).energies.push(LIGHTNING_ENERGY, FIGHTING_ENERGY);
    benchAt(state, 0).energies.push(GRASS_ENERGY, ROCK_FIGHTING_ENERGY);
    expect(
      damageOf(state, activeOf(state), RAGING_BOLT, "きょくらいごう")
    ).toBe(3 * 70);
  });
});

describeTranslation("オーガポン みどりのめんex", () => {
  test("みどりのまいは、手札の基本草エネルギーを 1 枚このポケモンにつけて 1 枚引く。ポケモンごとに番に 1 回", () => {
    const state = buildState({
      active: RAGING_BOLT,
      bench: [TEAL_MASK_OGERPON],
      deck: repeat(PSYCHIC_ENERGY, 3),
      hand: [GRASS_ENERGY, GRASS_ENERGY],
    });
    const context = buildContext(state);
    useAbility(context, benchAt(state, 0), "みどりのまい");
    expect(namesOf(benchAt(state, 0).energies)).toEqual(["基本草エネルギー"]);
    expect(namesOf(state.hand).sort()).toEqual(
      ["基本草エネルギー", "基本超エネルギー"].sort()
    );
    expect(state.hasAttachedEnergy).toBe(false);
    expect(canUseAbility(context, benchAt(state, 0), "みどりのまい")).toBe(
      false
    );
  });

  test("山札が 0 枚でも使え(公式 Q&A)、手札に基本草エネルギーが無ければ使えない", () => {
    const emptyDeck = buildState({
      active: TEAL_MASK_OGERPON,
      hand: [GRASS_ENERGY],
    });
    useAbility(buildContext(emptyDeck), activeOf(emptyDeck), "みどりのまい");
    expect(namesOf(activeOf(emptyDeck).energies)).toEqual(["基本草エネルギー"]);
    const noGrass = buildState({
      active: TEAL_MASK_OGERPON,
      deck: [PSYCHIC_ENERGY],
      hand: [LIGHTNING_ENERGY],
    });
    expect(
      canUseAbility(buildContext(noGrass), activeOf(noGrass), "みどりのまい")
    ).toBe(false);
  });
});

describeTranslation("テツノイサハex", () => {
  test("ラピッドバーニアは、手札からベンチに出したとき、バトルポケモンと入れ替え、場のエネルギーを好きなだけつけ替える", () => {
    const state = buildState({
      active: RAGING_BOLT,
      bench: [TEAL_MASK_OGERPON],
      hand: [IRON_LEAVES],
    });
    activeOf(state).energies.push(LIGHTNING_ENERGY, FIGHTING_ENERGY);
    benchAt(state, 0).energies.push(GRASS_ENERGY);
    placeBasicPokemonOnBenchFromHand(
      buildContext(state, {
        chooseCards: pickCardsByName(["基本草エネルギー", "基本雷エネルギー"]),
      }),
      IRON_LEAVES
    );
    expect(activeOf(state).name).toBe("テツノイサハex");
    expect(namesOf(activeOf(state).energies).sort()).toEqual(
      ["基本草エネルギー", "基本雷エネルギー"].sort()
    );
    expect(namesOf(benchAt(state, 1).energies)).toEqual(["基本闘エネルギー"]);
  });

  test("使わないことを選べば、ベンチに出るだけになる", () => {
    const state = buildState({ active: RAGING_BOLT, hand: [IRON_LEAVES] });
    placeBasicPokemonOnBenchFromHand(
      buildContext(state, { choosesToApplyOptionalEffect: () => false }),
      IRON_LEAVES
    );
    expect(activeOf(state).name).toBe("タケルライコex");
    expect(benchAt(state, 0).name).toBe("テツノイサハex");
  });
});

describeTranslation("基本草エネルギー", () => {
  test("草エネルギー 1 個ぶんとして働く", () => {
    const state = buildState({ active: TEAL_MASK_OGERPON });
    activeOf(state).energies.push(GRASS_ENERGY);
    expect(listEnergyUnits(state, activeOf(state))).toEqual(["grass"]);
  });
});

describeTranslation("ヤドン", () => {
  test("しっぽをたらすは、トラッシュのポケモンを 1 枚手札に加える", () => {
    const state = buildState({
      active: SLOWPOKE,
      discard: [PSYCHIC_ENERGY, KYUREM],
    });
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    useAttackNamed(buildContext(state), "しっぽをたらす");
    expect(namesOf(state.hand)).toEqual(["キュレム"]);
  });
});

describeTranslation("ヤドキング", () => {
  test("ひらめきチャレンジは、自分で山札の上に置いたカードがルールを持たないポケモンなら、そのワザをひらめきチャレンジのエネルギーで使える", () => {
    const state = buildState({
      active: SLOWKING,
      deck: [PSYCHIC_ENERGY],
      hand: [METAGROSS],
    });
    state.placeHandCardsOnDeckTop([METAGROSS]);
    activeOf(state).energies.push(PSYCHIC_ENERGY, PSYCHIC_ENERGY);
    const context = buildContext(state);
    const usable = listUsableAttacksOfActive(context);
    expect(usable.map(({ attack }) => attack.name)).toEqual([
      "はねかえす",
      "メタリックハンマー",
    ]);
    const hammer = usable.find(
      ({ attack }) => attack.name === "メタリックハンマー"
    );
    expect(
      hammer === undefined
        ? null
        : calculateAttackDamage(state, activeOf(state), hammer.attack)
    ).toBe(150);
    useAttackNamed(context, "メタリックハンマー");
    expect(namesOf(state.discard)).toEqual(["メタグロス"]);
    expect(namesOf(state.deck)).toEqual(["基本超エネルギー"]);
  });

  test("自分で置いた山札の上がポケモンでないとき(ルールを持つポケモンのときも)は、山札の上をトラッシュするだけのワザになる", () => {
    const energyOnTop = buildState({
      active: SLOWKING,
      deck: [METAGROSS],
      hand: [PSYCHIC_ENERGY],
    });
    energyOnTop.placeHandCardsOnDeckTop([PSYCHIC_ENERGY]);
    activeOf(energyOnTop).energies.push(PSYCHIC_ENERGY, PSYCHIC_ENERGY);
    const context = buildContext(energyOnTop);
    expect(
      listUsableAttacksOfActive(context).map(({ attack }) => attack.name)
    ).toEqual(["ひらめきチャレンジ"]);
    useAttackNamed(context, "ひらめきチャレンジ");
    expect(namesOf(energyOnTop.discard)).toEqual(["基本超エネルギー"]);

    const ruleBoxOnTop = buildState({ active: SLOWKING, hand: [MEOWTH] });
    ruleBoxOnTop.placeHandCardsOnDeckTop([MEOWTH]);
    activeOf(ruleBoxOnTop).energies.push(PSYCHIC_ENERGY, PSYCHIC_ENERGY);
    expect(
      listUsableAttacksOfActive(buildContext(ruleBoxOnTop)).map(
        ({ attack }) => attack.name
      )
    ).toEqual(["ひらめきチャレンジ"]);
  });

  test("自身のワザと同じ名前のワザを山札の上から選べるときも、直接使うワザでは山札の上をトラッシュしない", () => {
    const buildWithSlowkingOnTop = () => {
      const slowkingOnTop = buildRecordedCard("045978");
      const state = buildState({
        active: SLOWKING,
        deck: [PSYCHIC_ENERGY],
        hand: [slowkingOnTop],
      });
      state.placeHandCardsOnDeckTop([slowkingOnTop]);
      activeOf(state).energies.push(...repeat(PSYCHIC_ENERGY, 3));
      return state;
    };
    const direct = buildWithSlowkingOnTop();
    const directContext = buildContext(direct);
    const candidates = listUsableAttacksOfActive(directContext);
    expect(
      candidates.map(({ attack, usedAs }) => [attack.name, usedAs?.name])
    ).toEqual([
      ["ちょうねんりき", "ひらめきチャレンジ"],
      ["ちょうねんりき", undefined],
    ]);
    const [, directCandidate] = candidates;
    if (directCandidate === undefined) {
      throw new Error("自身のちょうねんりきが一覧に無い");
    }
    useAttack(directContext, directCandidate);
    expect(namesOf(direct.deck)).toEqual(["ヤドキング", "基本超エネルギー"]);
    expect(direct.discard).toEqual([]);

    const viaChallenge = buildWithSlowkingOnTop();
    const viaContext = buildContext(viaChallenge);
    const [viaCandidate] = listUsableAttacksOfActive(viaContext);
    if (viaCandidate === undefined) {
      throw new Error("ひらめきチャレンジのちょうねんりきが一覧に無い");
    }
    useAttack(viaContext, viaCandidate);
    expect(namesOf(viaChallenge.discard)).toEqual(["ヤドキング"]);
  });

  test("山札の上が何のカードか分からないとき(置いた後に切ったときも)は、ひらめきチャレンジを使えない", () => {
    const unknownTop = buildState({
      active: SLOWKING,
      deck: [METAGROSS, PSYCHIC_ENERGY],
    });
    activeOf(unknownTop).energies.push(PSYCHIC_ENERGY, PSYCHIC_ENERGY);
    expect(listUsableAttacksOfActive(buildContext(unknownTop))).toEqual([]);

    const shuffledAfterPlacing = buildState({
      active: SLOWKING,
      deck: [PSYCHIC_ENERGY],
      hand: [METAGROSS],
    });
    shuffledAfterPlacing.placeHandCardsOnDeckTop([METAGROSS]);
    shuffledAfterPlacing.shuffleDeck();
    activeOf(shuffledAfterPlacing).energies.push(
      PSYCHIC_ENERGY,
      PSYCHIC_ENERGY
    );
    expect(
      listUsableAttacksOfActive(buildContext(shuffledAfterPlacing))
    ).toEqual([]);
  });
});

describeTranslation("ムチュール", () => {
  test("るんるんキッスは、山札の基本超エネルギーを 2 枚まで、ベンチポケモン 1 匹につける", () => {
    const state = buildState({
      active: SMOOCHUM,
      bench: [SLOWPOKE],
      deck: [PSYCHIC_ENERGY, FIRE_ENERGY, PSYCHIC_ENERGY, PSYCHIC_ENERGY],
    });
    useAttackNamed(buildContext(state), "るんるんキッス");
    expect(namesOf(benchAt(state, 0).energies)).toEqual(
      repeat("基本超エネルギー", 2)
    );
    expect(activeOf(state).energies).toEqual([]);
  });
});

describeTranslation("ワンダーパッチ", () => {
  test("トラッシュの基本超エネルギーを 1 枚、ベンチの超ポケモンにつける", () => {
    const state = buildState({
      active: SLOWKING,
      bench: [N_ZEKROM, SLOWPOKE],
      discard: [FIRE_ENERGY, PSYCHIC_ENERGY],
      hand: [WONDER_PATCH],
    });
    playTrainerFromHand(buildContext(state), WONDER_PATCH);
    expect(namesOf(benchAt(state, 1).energies)).toEqual(["基本超エネルギー"]);
    expect(benchAt(state, 0).energies).toEqual([]);
  });

  test("ベンチに超ポケモンがいないときは使えない", () => {
    const state = buildState({
      active: SLOWKING,
      bench: [N_ZEKROM],
      discard: [PSYCHIC_ENERGY],
      hand: [WONDER_PATCH],
    });
    expect(canPlayTrainerFromHand(buildContext(state), WONDER_PATCH)).toBe(
      false
    );
  });
});

describeTranslation("夜のアカデミー", () => {
  test("自分の番ごとに 1 回、手札を 1 枚山札の上に置ける。山札が 0 枚でも置ける(公式 Q&A)", () => {
    const state = buildState({
      active: SLOWKING,
      hand: [KYUREM, BOSS],
    });
    state.stadium = NIGHT_ACADEMY;
    const context = buildContext(state, {
      chooseCards: pickCardsByName(["キュレム"]),
    });
    useStadiumEffect(context);
    expect(namesOf(state.deck)).toEqual(["キュレム"]);
    expect(namesOf(state.hand)).toEqual(["ボスの指令"]);
    expect(canUseStadiumEffect(context)).toBe(false);
  });

  test("手札が 0 枚のときは使えない", () => {
    const state = buildState({ active: SLOWKING, deck: [PSYCHIC_ENERGY] });
    state.stadium = NIGHT_ACADEMY;
    expect(canUseStadiumEffect(buildContext(state))).toBe(false);
  });
});

describeTranslation("ブーメランエネルギー", () => {
  test("無色エネルギー 1 個ぶんとして働く", () => {
    const state = buildState({ active: SLOWKING });
    activeOf(state).energies.push(BOOMERANG_ENERGY);
    expect(listEnergyUnits(state, activeOf(state))).toEqual(["colorless"]);
  });
});

describeTranslation("バチンキー", () => {
  test("ドンドンだいこは、バトルポケモンが特性「おまつりおんど」を持てば、山札から好きなカードを 1 枚手札に加える", () => {
    const state = buildState({
      active: DIPPLIN,
      bench: [THWACKEY],
      deck: [PSYCHIC_ENERGY, BOSS],
    });
    useAbility(
      buildContext(state, { chooseCards: pickCardsByName(["ボスの指令"]) }),
      benchAt(state, 0),
      "ドンドンだいこ"
    );
    expect(namesOf(state.hand)).toEqual(["ボスの指令"]);
  });

  test("バトルポケモンが特性「おまつりおんど」を持たなければ使えない", () => {
    const state = buildState({
      active: APPLIN,
      bench: [THWACKEY, DIPPLIN],
      deck: [PSYCHIC_ENERGY],
    });
    expect(
      canUseAbility(buildContext(state), benchAt(state, 0), "ドンドンだいこ")
    ).toBe(false);
  });
});

describeTranslation("アズマオウ", () => {
  test("場に「お祭り会場」があれば、クイックドローを 2 回連続で使い、2 枚ずつ引く", () => {
    const state = buildState({
      active: SEAKING,
      deck: repeat(PSYCHIC_ENERGY, 6),
    });
    state.stadium = FESTIVAL_GROUNDS;
    activeOf(state).energies.push(GRASS_ENERGY);
    const context = buildContext(state);
    useAttackNamed(context, "クイックドロー");
    expect(
      listUsableAttacksOfActive(context).map(({ attack }) => attack.name)
    ).toEqual(["クイックドロー"]);
    useAttackNamed(context, "クイックドロー");
    expect(state.hand).toHaveLength(4);
    expect(listUsableAttacksOfActive(context)).toEqual([]);
  });

  test("1 回目のワザで入れ替わってバトル場に出たアズマオウは、2 回目を使えない", () => {
    const state = buildState({
      active: ABRA,
      bench: [SEAKING],
      deck: repeat(PSYCHIC_ENERGY, 6),
    });
    state.stadium = FESTIVAL_GROUNDS;
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    benchAt(state, 0).energies.push(GRASS_ENERGY);
    const context = buildContext(state);
    useAttackNamed(context, "テレポートアタック");
    expect(activeOf(state).name).toBe("アズマオウ");
    expect(listUsableAttacksOfActive(context)).toEqual([]);
  });

  test("場に「お祭り会場」が無ければ、2 回目は使えない", () => {
    const state = buildState({
      active: SEAKING,
      deck: repeat(PSYCHIC_ENERGY, 6),
    });
    activeOf(state).energies.push(GRASS_ENERGY);
    const context = buildContext(state);
    useAttackNamed(context, "クイックドロー");
    expect(listUsableAttacksOfActive(context)).toEqual([]);
    expect(state.hand).toHaveLength(2);
  });
});

describeTranslation("むしとりセット", () => {
  test("山札の上から 7 枚を見て、草ポケモンと基本草エネルギーを合計 2 枚まで手札に加え、残りを切る", () => {
    const state = buildState({
      active: DIPPLIN,
      deck: [
        PSYCHIC_ENERGY,
        GRASS_ENERGY,
        SEAKING,
        APPLIN,
        THWACKEY,
        PSYCHIC_ENERGY,
        PSYCHIC_ENERGY,
        GRASS_ENERGY,
      ],
      hand: [BUG_CATCHING_SET],
    });
    playTrainerFromHand(buildContext(state), BUG_CATCHING_SET);
    expect(namesOf(state.hand)).toEqual(["基本草エネルギー", "カジッチュ"]);
    expect(state.deck).toHaveLength(6);
  });
});

describeTranslation("せいなるはい", () => {
  test("トラッシュのポケモンを 5 枚まで山札に戻して切る", () => {
    const state = buildState({
      active: DIPPLIN,
      discard: [...repeat(APPLIN, 6), PSYCHIC_ENERGY],
      hand: [SACRED_ASH],
    });
    playTrainerFromHand(buildContext(state), SACRED_ASH);
    expect(namesOf(state.deck)).toEqual(repeat("カジッチュ", 5));
    expect(namesOf(state.discard).sort()).toEqual(
      ["カジッチュ", "基本超エネルギー", "せいなるはい"].sort()
    );
  });

  test("トラッシュにポケモンが無ければ使えない", () => {
    const state = buildState({
      active: DIPPLIN,
      discard: [PSYCHIC_ENERGY],
      hand: [SACRED_ASH],
    });
    expect(canPlayTrainerFromHand(buildContext(state), SACRED_ASH)).toBe(false);
  });
});

describeTranslation("シークレットボックス", () => {
  test("手札を 3 枚トラッシュし、山札からグッズ・どうぐ・サポート・スタジアムを 1 枚ずつ手札に加える", () => {
    const state = buildState({
      active: DIPPLIN,
      deck: [PSYCHIC_ENERGY, BALLOON, BOSS, SACRED_ASH, FESTIVAL_GROUNDS],
      hand: [SECRET_BOX, APPLIN, APPLIN, GRASS_ENERGY],
    });
    playTrainerFromHand(buildContext(state), SECRET_BOX);
    expect(namesOf(state.hand).sort()).toEqual(
      ["せいなるはい", "ふうせん", "ボスの指令", "お祭り会場"].sort()
    );
    expect(state.discard).toHaveLength(4);
  });

  test("ほかの手札が 3 枚に満たなければ使えない", () => {
    const state = buildState({
      active: DIPPLIN,
      deck: [BOSS],
      hand: [SECRET_BOX, APPLIN, APPLIN],
    });
    expect(canPlayTrainerFromHand(buildContext(state), SECRET_BOX)).toBe(false);
  });
});

describeTranslation("グラジオの決戦", () => {
  test("手札がこのカードだけなら使え、この番のルールを持たないポケモンのワザのダメージを 80 増やす", () => {
    const state = buildState({
      active: SEAKING,
      bench: [MEOWTH],
      hand: [GLADION],
    });
    playTrainerFromHand(buildContext(state), GLADION);
    expect(damageOf(state, activeOf(state), SEAKING, "クイックドロー")).toBe(
      140
    );
    state.switchActive(benchAt(state, 0));
    expect(damageOf(state, activeOf(state), MEOWTH, "しっぽをまく")).toBe(60);
  });

  test("ほかに手札があれば使えない", () => {
    const state = buildState({
      active: SEAKING,
      hand: [GLADION, PSYCHIC_ENERGY],
    });
    expect(canPlayTrainerFromHand(buildContext(state), GLADION)).toBe(false);
  });
});

describeTranslation("ケロマツ", () => {
  test("もってくるは 1 枚引く", () => {
    const state = buildState({ active: FROAKIE, deck: [WATER_ENERGY] });
    activeOf(state).energies.push(WATER_ENERGY);
    useAttackNamed(buildContext(state), "もってくる");
    expect(namesOf(state.hand)).toEqual(["基本水エネルギー"]);
  });
});

describeTranslation("ゲコガシラ", () => {
  test("よびよせのじゅつは、山札からポケモンを 3 枚まで手札に加える", () => {
    const state = buildState({
      active: FROGADIER,
      deck: [FROAKIE, WATER_ENERGY, GRENINJA_EX, MEGA_GRENINJA, FROAKIE],
    });
    activeOf(state).energies.push(WATER_ENERGY);
    useAttackNamed(buildContext(state), "よびよせのじゅつ");
    expect(namesOf(state.hand)).toEqual([
      "ケロマツ",
      "ゲッコウガex",
      "メガゲッコウガex",
    ]);
  });
});

describeTranslation("ゲッコウガex", () => {
  test("しのびのやいばは、のぞむなら山札から好きなカードを 1 枚手札に加える", () => {
    const state = buildState({
      active: GRENINJA_EX,
      deck: [WATER_ENERGY, BOSS],
    });
    activeOf(state).energies.push(WATER_ENERGY);
    useAttackNamed(
      buildContext(state, { chooseCards: pickCardsByName(["ボスの指令"]) }),
      "しのびのやいば"
    );
    expect(namesOf(state.hand)).toEqual(["ボスの指令"]);

    const declined = buildState({ active: GRENINJA_EX, deck: [BOSS] });
    activeOf(declined).energies.push(WATER_ENERGY);
    useAttackNamed(
      buildContext(declined, { choosesToApplyOptionalEffect: () => false }),
      "しのびのやいば"
    );
    expect(declined.hand).toEqual([]);
  });
});

describeTranslation("ヒガナの信頼", () => {
  test("バトルポケモンをベンチと入れ替え、ベンチに下がったポケモンのエネルギーを 1 個新しいバトルポケモンにつけ替える", () => {
    const state = buildState({
      active: MEGA_GRENINJA,
      bench: [FROAKIE, GRENINJA_EX],
      hand: [DRAYDENS_TRUST],
    });
    activeOf(state).energies.push(WATER_ENERGY, WATER_ENERGY);
    playTrainerFromHand(
      buildContext(state, {
        choosePokemon: (_, request) =>
          request.candidates.filter(
            (pokemon) => pokemon.name === "ゲッコウガex"
          ),
      }),
      DRAYDENS_TRUST
    );
    expect(activeOf(state).name).toBe("ゲッコウガex");
    expect(namesOf(activeOf(state).energies)).toEqual(["基本水エネルギー"]);
    const switchedOut = state.bench.find(
      (pokemon) => pokemon.name === "メガゲッコウガex"
    );
    expect(switchedOut?.energies).toHaveLength(1);
  });

  test("バトルポケモンにエネルギーが無くても使え、入れ替えだけが起きる(公式 Q&A)", () => {
    const state = buildState({
      active: FROAKIE,
      bench: [FROGADIER],
      hand: [DRAYDENS_TRUST],
    });
    playTrainerFromHand(buildContext(state), DRAYDENS_TRUST);
    expect(activeOf(state).name).toBe("ゲコガシラ");
    expect(activeOf(state).energies).toEqual([]);
  });
});

describeTranslation("ネオアッパーエネルギー", () => {
  test("2進化ポケモンについていればすべてのタイプ 2 個ぶん、ほかは無色 1 個ぶんとして働く", () => {
    const state = buildState({ active: MEGA_GRENINJA, bench: [FROAKIE] });
    activeOf(state).energies.push(NEO_UPPER_ENERGY);
    benchAt(state, 0).energies.push(NEO_UPPER_ENERGY);
    expect(listEnergyUnits(state, activeOf(state))).toEqual(["any", "any"]);
    expect(listEnergyUnits(state, benchAt(state, 0))).toEqual(["colorless"]);
  });
});

describeTranslation("ロケット団のラムダ", () => {
  test("山札からトレーナーズを 1 枚手札に加える", () => {
    const state = buildState({
      active: FROAKIE,
      deck: [FROGADIER, WATER_ENERGY, NIGHT_ACADEMY],
      hand: [ARIANA],
    });
    playTrainerFromHand(buildContext(state), ARIANA);
    expect(namesOf(state.hand)).toEqual(["夜のアカデミー"]);
  });
});

describeTranslation("サーファー", () => {
  test("バトルポケモンをベンチと入れ替え、手札が 5 枚になるように引く", () => {
    const state = buildState({
      active: FROAKIE,
      bench: [FROGADIER],
      deck: repeat(WATER_ENERGY, 8),
      hand: [SURFER, BOSS],
    });
    playTrainerFromHand(buildContext(state), SURFER);
    expect(activeOf(state).name).toBe("ゲコガシラ");
    expect(state.hand).toHaveLength(5);
  });

  test("手札が 6 枚以上でも使え(公式 Q&A)、引かない。ベンチにポケモンがいなければ使えない", () => {
    const state = buildState({
      active: FROAKIE,
      bench: [FROGADIER],
      deck: repeat(WATER_ENERGY, 8),
      hand: [SURFER, ...repeat(BOSS, 6)],
    });
    playTrainerFromHand(buildContext(state), SURFER);
    expect(state.hand).toHaveLength(6);
    const alone = buildState({ active: FROAKIE, hand: [SURFER] });
    expect(canPlayTrainerFromHand(buildContext(alone), SURFER)).toBe(false);
  });
});

describeTranslation("活力の森", () => {
  test("出したばかりの草ポケモンを、草ポケモンに進化させられる(最初の自分の番を除く)", () => {
    const state = buildState({
      active: FROAKIE,
      hand: [CYNTHIAS_ROSELIA, CYNTHIAS_ROSERADE],
    });
    state.stadium = GRAND_TREE_FOREST;
    const context = buildContext(state);
    const roselia = placeBasicPokemonOnBenchFromHand(context, CYNTHIAS_ROSELIA);
    expect(canEvolvePokemonFromHand(context, roselia, CYNTHIAS_ROSERADE)).toBe(
      true
    );
    evolvePokemonFromHand(context, roselia, CYNTHIAS_ROSERADE);
    expect(benchAt(state, 0).name).toBe("シロナのロズレイド");
  });

  test("活力の森が無いとき、草ポケモンでないとき、最初の自分の番は進化させられない", () => {
    const noForest = buildState({
      active: FROAKIE,
      hand: [CYNTHIAS_ROSELIA, CYNTHIAS_ROSERADE],
    });
    const roselia = placeBasicPokemonOnBenchFromHand(
      buildContext(noForest),
      CYNTHIAS_ROSELIA
    );
    expect(
      canEvolvePokemonFromHand(
        buildContext(noForest),
        roselia,
        CYNTHIAS_ROSERADE
      )
    ).toBe(false);

    const water = buildState({ active: SEAKING, hand: [FROAKIE, FROGADIER] });
    water.stadium = GRAND_TREE_FOREST;
    const froakie = placeBasicPokemonOnBenchFromHand(
      buildContext(water),
      FROAKIE
    );
    expect(
      canEvolvePokemonFromHand(buildContext(water), froakie, FROGADIER)
    ).toBe(false);

    const firstTurn = buildState({
      active: FROAKIE,
      hand: [CYNTHIAS_ROSELIA, CYNTHIAS_ROSERADE],
      turn: 1,
    });
    firstTurn.stadium = GRAND_TREE_FOREST;
    const firstRoselia = placeBasicPokemonOnBenchFromHand(
      buildContext(firstTurn),
      CYNTHIAS_ROSELIA
    );
    expect(
      canEvolvePokemonFromHand(
        buildContext(firstTurn),
        firstRoselia,
        CYNTHIAS_ROSERADE
      )
    ).toBe(false);
  });
});

describeTranslation("ケーシィ", () => {
  test("テレポートアタックは、このポケモンをベンチポケモンと入れ替える", () => {
    const state = buildState({ active: ABRA, bench: [KADABRA] });
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    useAttackNamed(buildContext(state), "テレポートアタック");
    expect(activeOf(state).name).toBe("ユンゲラー");
  });
});

describeTranslation("ユンゲラー", () => {
  test("サイコドローは、手札から出して進化させたとき 2 枚引く。山札から進化させたときは起きない", () => {
    const state = buildState({
      active: ABRA,
      deck: repeat(PSYCHIC_ENERGY, 4),
      hand: [KADABRA],
    });
    evolvePokemonFromHand(buildContext(state), activeOf(state), KADABRA);
    expect(namesOf(state.hand)).toEqual(repeat("基本超エネルギー", 2));

    const declined = buildState({
      active: ABRA,
      deck: repeat(PSYCHIC_ENERGY, 4),
      hand: [KADABRA],
    });
    evolvePokemonFromHand(
      buildContext(declined, { choosesToApplyOptionalEffect: () => false }),
      activeOf(declined),
      KADABRA
    );
    expect(declined.hand).toEqual([]);
  });
});

describeTranslation("フーディン", () => {
  test("ふしぎなアメで手札から出して進化させたときも、サイコドローで 3 枚引く", () => {
    const state = buildState({
      active: ABRA,
      deck: repeat(PSYCHIC_ENERGY, 4),
      hand: [RARE_CANDY, ALAKAZAM],
    });
    playTrainerFromHand(buildContext(state), RARE_CANDY);
    expect(activeOf(state).name).toBe("フーディン");
    expect(namesOf(state.hand)).toEqual(repeat("基本超エネルギー", 3));
  });
});

describeTranslation("ドデカバシ", () => {
  test("スカイドローは、ポケモンごとに番に 1 回、1 枚引く", () => {
    const state = buildState({
      active: TOUCANNON,
      deck: repeat(PSYCHIC_ENERGY, 3),
    });
    const context = buildContext(state);
    useAbility(context, activeOf(state), "スカイドロー");
    expect(state.hand).toHaveLength(1);
    expect(canUseAbility(context, activeOf(state), "スカイドロー")).toBe(false);
  });
});

describeTranslation("スイレンのお世話", () => {
  test("トラッシュのルールを持たないポケモンと基本エネルギーを合計 3 枚まで手札に加える", () => {
    const state = buildState({
      active: ABRA,
      discard: [MEOWTH, KADABRA, PSYCHIC_ENERGY, ROCK_FIGHTING_ENERGY, ABRA],
      hand: [LILLIES_CARE],
    });
    playTrainerFromHand(buildContext(state), LILLIES_CARE);
    expect(namesOf(state.hand)).toEqual([
      "ユンゲラー",
      "基本超エネルギー",
      "ケーシィ",
    ]);
  });

  test("トラッシュがポケモンex だけのときは使えない(公式 Q&A)", () => {
    const state = buildState({
      active: ABRA,
      discard: [MEOWTH],
      hand: [LILLIES_CARE],
    });
    expect(canPlayTrainerFromHand(buildContext(state), LILLIES_CARE)).toBe(
      false
    );
  });
});

describeTranslation("夜の鉱山", () => {
  test("「テラスタル」のポケモンのワザに必要なエネルギーが無色 1 個ぶん多くなる", () => {
    const state = buildState({ active: TERAPAGOS_EX });
    activeOf(state).energies.push(PSYCHIC_ENERGY, PSYCHIC_ENERGY);
    const context = buildContext(state);
    expect(
      listUsableAttacksOfActive(context).map(({ attack }) => attack.name)
    ).toEqual(["ユニオンビート"]);
    state.stadium = NIGHT_MINE;
    expect(listUsableAttacksOfActive(context)).toEqual([]);
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    expect(
      listUsableAttacksOfActive(context).map(({ attack }) => attack.name)
    ).toEqual(["ユニオンビート"]);
  });

  test("「テラスタル」でないポケモンのワザには働かない", () => {
    const state = buildState({ active: ABRA });
    state.stadium = NIGHT_MINE;
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    expect(
      listUsableAttacksOfActive(buildContext(state)).map(
        ({ attack }) => attack.name
      )
    ).toEqual(["テレポートアタック"]);
  });
});

describeTranslation("リッチエネルギー", () => {
  test("手札からつけたとき 4 枚引き、無色エネルギー 1 個ぶんとして働く", () => {
    const state = buildState({
      active: ABRA,
      deck: repeat(PSYCHIC_ENERGY, 5),
      hand: [RICH_ENERGY],
    });
    attachEnergyFromHandToPokemon(
      buildContext(state),
      RICH_ENERGY,
      activeOf(state)
    );
    expect(state.hand).toHaveLength(4);
    expect(listEnergyUnits(state, activeOf(state))).toEqual(["colorless"]);
  });
});

describeTranslation("モグリュー", () => {
  test("なかまをよぶは、山札からたねポケモンを 2 枚までベンチに出す", () => {
    const state = buildState({
      active: DRILBUR,
      deck: [BELDUM, METANG, GENESECT_EX, DRILBUR],
    });
    activeOf(state).energies.push(STEEL_ENERGY);
    useAttackNamed(buildContext(state), "なかまをよぶ");
    expect(namesOf(state.bench.map((pokemon) => pokemon.card))).toEqual([
      "ダンバル",
      "ゲノセクトex",
    ]);
  });
});

describeTranslation("メタング", () => {
  test("メタルメーカーは、山札の上から 4 枚の基本鋼エネルギーを好きなだけ、自分のポケモンに好きなようにつけ、残りを山札の下に置く", () => {
    const state = buildState({
      active: METANG,
      bench: [BELDUM],
      deck: [STEEL_ENERGY, BOSS, STEEL_ENERGY, STEEL_ENERGY, PSYCHIC_ENERGY],
    });
    // 1 枚目をメタングに、2 枚目と 3 枚目をダンバルにつける
    const targets = ["メタング", "ダンバル", "ダンバル"];
    useAbility(
      buildContext(state, {
        choosePokemon: (_, request) => {
          const name = targets.shift();
          return request.candidates.filter((pokemon) => pokemon.name === name);
        },
      }),
      activeOf(state),
      "メタルメーカー"
    );
    expect(activeOf(state).energies).toHaveLength(1);
    expect(benchAt(state, 0).energies).toHaveLength(2);
    expect(namesOf(state.deck)).toEqual(["基本超エネルギー", "ボスの指令"]);
  });

  test("見た中に基本鋼エネルギーがあっても、つけないことを選べる(公式 Q&A)", () => {
    const state = buildState({
      active: METANG,
      deck: [STEEL_ENERGY, BOSS],
    });
    useAbility(
      buildContext(state, { chooseCards: () => [] }),
      activeOf(state),
      "メタルメーカー"
    );
    expect(activeOf(state).energies).toEqual([]);
    expect(state.deck).toHaveLength(2);
  });
});

describeTranslation("ゲノセクトex", () => {
  test("メタルシグナルは、山札から鋼の進化ポケモンを 2 枚まで手札に加える(たねのメガシンカex は選べない)", () => {
    const state = buildState({
      active: GENESECT_EX,
      deck: [BELDUM, MEGA_EXCADRILL, METANG, METANG, STEEL_ENERGY],
    });
    useAbility(buildContext(state), activeOf(state), "メタルシグナル");
    expect(namesOf(state.hand)).toEqual(["メガドリュウズex", "メタング"]);
  });
});

describeTranslation("エネルギー転送", () => {
  test("山札から基本エネルギーを 1 枚手札に加える", () => {
    const state = buildState({
      active: BELDUM,
      deck: [BOSS, STEEL_ENERGY],
      hand: [ENERGY_SEARCH],
    });
    playTrainerFromHand(buildContext(state), ENERGY_SEARCH);
    expect(namesOf(state.hand)).toEqual(["基本鋼エネルギー"]);
  });
});

describeTranslation("プレシャスキャリー", () => {
  test("山札からたねポケモンを好きなだけ、ベンチの空きの範囲でベンチに出す", () => {
    const state = buildState({
      active: BELDUM,
      bench: [DRILBUR],
      deck: [...repeat(BELDUM, 6), METANG],
      hand: [PRECIOUS_CARRIER],
    });
    playTrainerFromHand(buildContext(state), PRECIOUS_CARRIER);
    expect(state.bench).toHaveLength(5);
  });
});

describeTranslation("ロケット団のレシーバー", () => {
  test("山札から、名前に「ロケット団」とつくサポートを 1 枚手札に加える", () => {
    const state = buildState({
      active: BELDUM,
      deck: [BOSS, ARIANA],
      hand: [ROCKET_RECEIVER],
    });
    playTrainerFromHand(buildContext(state), ROCKET_RECEIVER);
    expect(namesOf(state.hand)).toEqual(["ロケット団のラムダ"]);
  });
});

describeTranslation("エネルギーリサイクル", () => {
  test("トラッシュの基本エネルギーを 5 枚まで山札に戻して切る", () => {
    const state = buildState({
      active: BELDUM,
      discard: [...repeat(STEEL_ENERGY, 6), ROCK_FIGHTING_ENERGY],
      hand: [ENERGY_RECYCLER],
    });
    playTrainerFromHand(buildContext(state), ENERGY_RECYCLER);
    expect(namesOf(state.deck)).toEqual(repeat("基本鋼エネルギー", 5));
  });
});

describeTranslation("基本鋼エネルギー", () => {
  test("鋼エネルギー 1 個ぶんとして働く", () => {
    const state = buildState({ active: BELDUM });
    activeOf(state).energies.push(STEEL_ENERGY);
    expect(listEnergyUnits(state, activeOf(state))).toEqual(["steel"]);
  });
});

describeTranslation("イーユイ", () => {
  test("ひきつけるは 2 枚引く", () => {
    const state = buildState({
      active: IRON_JUGULIS_TING_LU,
      deck: repeat(FIRE_ENERGY, 3),
    });
    activeOf(state).energies.push(FIRE_ENERGY);
    useAttackNamed(buildContext(state), "ひきつける");
    expect(state.hand).toHaveLength(2);
  });

  test("グラウンドメルトは、場にスタジアムがあれば 60 を足し、その後スタジアムをトラッシュする(ゼロの大空洞ならベンチを減らす)", () => {
    const state = buildState({
      active: IRON_JUGULIS_TING_LU,
      bench: [FLAREON_EX, DRILBUR, DRILBUR, DRILBUR, DRILBUR, DRILBUR],
    });
    state.stadium = ZERO_CAVERN;
    activeOf(state).energies.push(FIRE_ENERGY, FIRE_ENERGY);
    expect(
      damageOf(state, activeOf(state), IRON_JUGULIS_TING_LU, "グラウンドメルト")
    ).toBe(120);
    useAttackNamed(buildContext(state), "グラウンドメルト");
    expect(state.stadium).toBeNull();
    expect(namesOf(state.discard)).toContain("ゼロの大空洞");
    expect(state.bench).toHaveLength(5);
    expect(
      damageOf(state, activeOf(state), IRON_JUGULIS_TING_LU, "グラウンドメルト")
    ).toBe(60);
  });
});

describeTranslation("Nの筋書き", () => {
  test("ベンチのポケモンのエネルギーを合計 2 個まで、バトルポケモンにつけ替える", () => {
    const state = buildState({
      active: N_ZOROARK,
      bench: [N_ZEKROM, YVELTAL],
      hand: [N_SCRIPT],
    });
    benchAt(state, 0).energies.push(
      LIGHTNING_ENERGY,
      LIGHTNING_ENERGY,
      FIRE_ENERGY
    );
    benchAt(state, 1).energies.push(DARK_ENERGY);
    playTrainerFromHand(buildContext(state), N_SCRIPT);
    expect(namesOf(activeOf(state).energies)).toEqual([
      "基本雷エネルギー",
      "基本雷エネルギー",
    ]);
    expect(benchAt(state, 0).energies).toHaveLength(1);
    expect(benchAt(state, 1).energies).toHaveLength(1);
  });

  test("ベンチのポケモンにエネルギーがついていなければ使えない", () => {
    const state = buildState({
      active: N_ZOROARK,
      bench: [N_ZEKROM],
      hand: [N_SCRIPT],
    });
    activeOf(state).energies.push(DARK_ENERGY);
    expect(canPlayTrainerFromHand(buildContext(state), N_SCRIPT)).toBe(false);
  });
});

describeTranslation("プリズムエネルギー", () => {
  test("たねポケモンについていればすべてのタイプ 1 個ぶん、進化ポケモンなら無色 1 個ぶんとして働く", () => {
    const state = buildState({ active: DRILBUR, bench: [METANG] });
    activeOf(state).energies.push(PRISM_ENERGY);
    benchAt(state, 0).energies.push(PRISM_ENERGY);
    expect(listEnergyUnits(state, activeOf(state))).toEqual(["any"]);
    expect(listEnergyUnits(state, benchAt(state, 0))).toEqual(["colorless"]);
  });
});

describeTranslation("マリィのベロバー", () => {
  test("くすねるは 1 枚引く", () => {
    const state = buildState({ active: MARNIES_IMPIDIMP, deck: [DARK_ENERGY] });
    activeOf(state).energies.push(DARK_ENERGY);
    useAttackNamed(buildContext(state), "くすねる");
    expect(namesOf(state.hand)).toEqual(["基本悪エネルギー"]);
  });
});

describeTranslation("マリィのオーロンゲex", () => {
  test("パンクアップは、手札から出して進化させたとき、山札の基本悪エネルギーを 5 枚まで「マリィのポケモン」に好きなようにつける", () => {
    const state = buildState({
      active: MARNIES_MORGREM,
      bench: [MARNIES_IMPIDIMP, YVELTAL],
      deck: [...repeat(DARK_ENERGY, 6), BOSS],
      hand: [MARNIES_GRIMMSNARL],
    });
    const targets = ["マリィのオーロンゲex", "マリィのベロバー"];
    evolvePokemonFromHand(
      buildContext(state, {
        choosePokemon: (_, request) => {
          const name = targets.shift() ?? "マリィのオーロンゲex";
          return request.candidates.filter((pokemon) => pokemon.name === name);
        },
      }),
      activeOf(state),
      MARNIES_GRIMMSNARL
    );
    expect(activeOf(state).energies).toHaveLength(4);
    expect(namesOf(benchAt(state, 0).energies)).toEqual(["基本悪エネルギー"]);
    expect(benchAt(state, 1).energies).toEqual([]);
    expect(state.deck).toHaveLength(2);
  });

  test("ふしぎなアメで進化させたときもパンクアップを使える", () => {
    const state = buildState({
      active: MARNIES_IMPIDIMP,
      deck: repeat(DARK_ENERGY, 3),
      hand: [RARE_CANDY, MARNIES_GRIMMSNARL],
    });
    playTrainerFromHand(buildContext(state), RARE_CANDY);
    expect(activeOf(state).name).toBe("マリィのオーロンゲex");
    expect(activeOf(state).energies).toHaveLength(3);
  });
});

describeTranslation("スパイクタウンジム", () => {
  test("自分の番ごとに 1 回、山札から「マリィのポケモン」を 1 枚手札に加える", () => {
    const state = buildState({
      active: MARNIES_IMPIDIMP,
      deck: [YVELTAL, MARNIES_GRIMMSNARL, DARK_ENERGY],
    });
    state.stadium = SPIKEMUTH_GYM;
    const context = buildContext(state);
    useStadiumEffect(context);
    expect(namesOf(state.hand)).toEqual(["マリィのオーロンゲex"]);
    expect(canUseStadiumEffect(context)).toBe(false);
  });
});

describeTranslation("アチャモ", () => {
  test("もってくるは 1 枚引く", () => {
    const state = buildState({ active: TORCHIC, deck: [FIRE_ENERGY] });
    activeOf(state).energies.push(FIRE_ENERGY);
    useAttackNamed(buildContext(state), "もってくる");
    expect(namesOf(state.hand)).toEqual(["基本炎エネルギー"]);
  });
});

describeTranslation("バシャーモex", () => {
  test("たぎるとうしは、ポケモンごとに番に 1 回、トラッシュの基本エネルギーを 1 枚自分のポケモンにつける", () => {
    const state = buildState({
      active: DRAGAPULT,
      bench: [BLAZIKEN_EX],
      discard: [ROCK_FIGHTING_ENERGY, PSYCHIC_ENERGY],
    });
    const context = buildContext(state);
    useAbility(context, benchAt(state, 0), "たぎるとうし");
    expect(namesOf(activeOf(state).energies)).toEqual(["基本超エネルギー"]);
    expect(canUseAbility(context, benchAt(state, 0), "たぎるとうし")).toBe(
      false
    );
  });

  test("トラッシュに基本エネルギーが無ければ使えない", () => {
    const state = buildState({
      active: BLAZIKEN_EX,
      discard: [ROCK_FIGHTING_ENERGY],
    });
    expect(
      canUseAbility(buildContext(state), activeOf(state), "たぎるとうし")
    ).toBe(false);
  });
});

describeTranslation("カミツオロチex", () => {
  test("じゅくせいチャージは、ポケモンごとに番に 1 回、手札の基本草エネルギーを 1 枚自分のポケモンにつける", () => {
    const state = buildState({
      active: HYDRAPPLE_EX,
      bench: [DIPPLIN],
      hand: [GRASS_ENERGY, GRASS_ENERGY],
    });
    const context = buildContext(state, {
      choosePokemon: (_, request) =>
        request.candidates.filter((pokemon) => pokemon.name === "カミッチュ"),
    });
    useAbility(context, activeOf(state), "じゅくせいチャージ");
    expect(namesOf(benchAt(state, 0).energies)).toEqual(["基本草エネルギー"]);
    expect(state.hasAttachedEnergy).toBe(false);
    expect(canUseAbility(context, activeOf(state), "じゅくせいチャージ")).toBe(
      false
    );
  });

  test("みつあめストームは 30 に、自分のポケモン全員の草エネルギーの数×30 を足す(おいしげるで 2 個ぶんになった分も数える)", () => {
    const state = buildState({ active: HYDRAPPLE_EX, bench: [DIPPLIN] });
    activeOf(state).energies.push(GRASS_ENERGY, PSYCHIC_ENERGY);
    benchAt(state, 0).energies.push(GRASS_ENERGY);
    expect(
      damageOf(state, activeOf(state), HYDRAPPLE_EX, "みつあめストーム")
    ).toBe(30 + 2 * 30);
    state.bench.push(new PokemonInPlay(MEGANIUM, 0));
    expect(
      damageOf(state, activeOf(state), HYDRAPPLE_EX, "みつあめストーム")
    ).toBe(30 + 4 * 30);
  });
});

describeTranslation("メガニウム", () => {
  test("おいしげるは、自分のポケモン全員の基本草エネルギーを草 2 個ぶんにし、2 匹いても重ならない(公式 Q&A)", () => {
    const state = buildState({ active: HYDRAPPLE_EX, bench: [MEGANIUM] });
    activeOf(state).energies.push(GRASS_ENERGY, PRISM_ENERGY);
    expect(listEnergyUnits(state, activeOf(state))).toEqual([
      "grass",
      "grass",
      "colorless",
    ]);
    state.bench.push(new PokemonInPlay(MEGANIUM, 0));
    expect(listEnergyUnits(state, activeOf(state))).toHaveLength(3);
  });
});

describeTranslation("セレビィ", () => {
  test("ときをめぐるは、山札から草ポケモンとスタジアムを合計 3 枚まで手札に加える", () => {
    const state = buildState({
      active: CELEBI,
      deck: [FROAKIE, GRAND_TREE_FOREST, APPLIN, GRASS_ENERGY, MEGANIUM],
    });
    activeOf(state).energies.push(GRASS_ENERGY);
    useAttackNamed(buildContext(state), "ときをめぐる");
    expect(namesOf(state.hand)).toEqual([
      "活力の森",
      "カジッチュ",
      "メガニウム",
    ]);
  });
});

describeTranslation("エレズン", () => {
  test("なかまをよぶは、山札からたねポケモンを 2 枚までベンチに出す。ニャースex の特性は起きない(公式 Q&A)", () => {
    const state = buildState({
      active: TOXEL,
      deck: [MEOWTH, TOXTRICITY, TOXEL, BOSS],
    });
    activeOf(state).energies.push(DARK_ENERGY);
    useAttackNamed(buildContext(state), "なかまをよぶ");
    expect(namesOf(state.bench.map((pokemon) => pokemon.card))).toEqual([
      "ニャースex",
      "エレズン",
    ]);
    expect(state.hand).toEqual([]);
  });
});

describeTranslation("ストリンダー", () => {
  test("バッドアッパーは、ポケモンごとに番に 1 回、山札の基本悪エネルギーを 1 枚ベンチの悪ポケモンにつける", () => {
    const state = buildState({
      active: TOXTRICITY,
      bench: [N_ZEKROM, TOXEL],
      deck: [PSYCHIC_ENERGY, DARK_ENERGY],
    });
    const context = buildContext(state);
    useAbility(context, activeOf(state), "バッドアッパー");
    expect(namesOf(benchAt(state, 1).energies)).toEqual(["基本悪エネルギー"]);
    expect(benchAt(state, 0).energies).toEqual([]);
    expect(canUseAbility(context, activeOf(state), "バッドアッパー")).toBe(
      false
    );
  });

  test("ベンチに悪ポケモンがいなければ使えない", () => {
    const state = buildState({
      active: TOXTRICITY,
      bench: [N_ZEKROM],
      deck: [DARK_ENERGY],
    });
    expect(
      canUseAbility(buildContext(state), activeOf(state), "バッドアッパー")
    ).toBe(false);
  });
});

describeTranslation("ロケット団のファクトリー", () => {
  test("この番に名前に「ロケット団」とつくサポートを使っていれば、番に 1 回 2 枚引ける", () => {
    const state = buildState({
      active: TOXEL,
      deck: [...repeat(DARK_ENERGY, 3), BOSS],
      hand: [ARIANA],
    });
    state.stadium = ROCKET_FACTORY;
    const context = buildContext(state);
    expect(canUseStadiumEffect(context)).toBe(false);
    playTrainerFromHand(context, ARIANA);
    useStadiumEffect(context);
    expect(state.hand).toHaveLength(3);
    expect(canUseStadiumEffect(context)).toBe(false);
  });

  test("ほかのサポートを使った番は引けない", () => {
    const state = buildState({
      active: TOXEL,
      bench: [TOXEL],
      deck: repeat(DARK_ENERGY, 8),
      hand: [SURFER],
    });
    state.stadium = ROCKET_FACTORY;
    const context = buildContext(state);
    playTrainerFromHand(context, SURFER);
    expect(canUseStadiumEffect(context)).toBe(false);
  });
});

describeTranslation("ハクリュー", () => {
  test("しんかのみちびきは、このポケモンにエネルギーがついていれば、山札から進化ポケモンを 1 枚手札に加える", () => {
    const state = buildState({
      active: DRAGONAIR,
      deck: [DRATINI, MEGA_DRAGONITE, LIGHTNING_ENERGY],
    });
    const context = buildContext(state);
    expect(canUseAbility(context, activeOf(state), "しんかのみちびき")).toBe(
      false
    );
    activeOf(state).energies.push(LIGHTNING_ENERGY);
    useAbility(context, activeOf(state), "しんかのみちびき");
    expect(namesOf(state.hand)).toEqual(["メガカイリューex"]);
  });
});

describeTranslation("メガカイリューex", () => {
  test("スカイキャリーは、ポケモンごとに番に 1 回、バトルポケモンをベンチポケモンと入れ替える", () => {
    const state = buildState({ active: MEGA_DRAGONITE, bench: [DRATINI] });
    const context = buildContext(state);
    useAbility(context, activeOf(state), "スカイキャリー");
    expect(activeOf(state).name).toBe("ミニリュウ");
    expect(canUseAbility(context, benchAt(state, 0), "スカイキャリー")).toBe(
      false
    );
  });
});

describeTranslation("ジャラランガ", () => {
  test("スケイルビートは、山札の上から 6 枚の基本エネルギーを好きなだけ、自分のドラゴンポケモンに好きなようにつける", () => {
    const state = buildState({
      active: KOMMO_O,
      bench: [DRATINI, TOXEL],
      deck: [
        LIGHTNING_ENERGY,
        BOSS,
        FIGHTING_ENERGY,
        ROCK_FIGHTING_ENERGY,
        WATER_ENERGY,
        PSYCHIC_ENERGY,
        LIGHTNING_ENERGY,
      ],
    });
    useAbility(buildContext(state), activeOf(state), "スケイルビート");
    expect(activeOf(state).energies).toHaveLength(4);
    expect(benchAt(state, 1).energies).toEqual([]);
    expect(state.deck).toHaveLength(3);
  });
});

describeTranslation("チェリム", () => {
  test("エナジーギフトは、山札の基本エネルギーを 2 枚まで、自分のポケモンに好きなようにつける", () => {
    const state = buildState({
      active: CHERRIM,
      bench: [RALTS],
      deck: [BOSS, GRASS_ENERGY, PRISM_ENERGY, PSYCHIC_ENERGY, GRASS_ENERGY],
    });
    activeOf(state).energies.push(GRASS_ENERGY);
    const targets = [activeOf(state), benchAt(state, 0)];
    useAttackNamed(
      buildContext(state, {
        choosePokemon: (_, request) => {
          const next = targets.shift();
          return request.candidates.filter((pokemon) => pokemon === next);
        },
      }),
      "エナジーギフト"
    );
    expect(namesOf(activeOf(state).energies)).toEqual([
      "基本草エネルギー",
      "基本草エネルギー",
    ]);
    expect(namesOf(benchAt(state, 0).energies)).toEqual(["基本超エネルギー"]);
    expect(namesOf(state.deck)).toContain("プリズムエネルギー");
  });
});

describeTranslation("ビクティニ", () => {
  test("なかまをよぶは、山札からたねポケモンを 2 枚までベンチに出す", () => {
    const state = buildState({
      active: VICTINI,
      deck: [KIRLIA, RALTS, BOSS, MEOWTH, RALTS],
    });
    activeOf(state).energies.push(FIRE_ENERGY);
    useAttackNamed(buildContext(state), "なかまをよぶ");
    expect(namesOf(state.bench.map((pokemon) => pokemon.card))).toEqual([
      "ラルトス",
      "ニャースex",
    ]);
    expect(state.deck).toHaveLength(3);
  });
});

describeTranslation("ゼラオラ", () => {
  test("クイックドローは 1 枚引く", () => {
    const state = buildState({ active: ZERAORA, deck: [BOSS, RALTS] });
    activeOf(state).energies.push(LIGHTNING_ENERGY);
    useAttackNamed(buildContext(state), "クイックドロー");
    expect(namesOf(state.hand)).toEqual(["ボスの指令"]);
  });
});

describeTranslation("ミュウツー", () => {
  test("ちからをあたえるは、トラッシュの基本エネルギーを 2 枚まで、自分のポケモン 1 匹にまとめてつける", () => {
    const state = buildState({
      active: MEWTWO,
      bench: [RALTS],
      discard: [
        PSYCHIC_ENERGY,
        PRISM_ENERGY,
        BOSS,
        DARK_ENERGY,
        PSYCHIC_ENERGY,
      ],
    });
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    useAttackNamed(
      buildContext(state, {
        choosePokemon: (_, request) => request.candidates.slice(-1),
      }),
      "ちからをあたえる"
    );
    expect(namesOf(benchAt(state, 0).energies)).toEqual([
      "基本超エネルギー",
      "基本悪エネルギー",
    ]);
    expect(namesOf(state.discard)).toEqual([
      "プリズムエネルギー",
      "ボスの指令",
      "基本超エネルギー",
    ]);
  });
});

describeTranslation("ゾロアーク", () => {
  test("よるのぬけみちは、ベンチにいる間、バトルポケモンのにげるエネルギーを 2 個減らし、2 匹なら 4 個減らす(公式 Q&A)", () => {
    const state = buildState({ active: DHELMISE, bench: [ZOROARK] });
    expect(calculateRetreatCost(state, activeOf(state))).toBe(1);
    state.bench.push(new PokemonInPlay(ZOROARK, 0));
    expect(calculateRetreatCost(state, activeOf(state))).toBe(0);
  });

  test("バトル場にいるゾロアーク自身のにげるエネルギーは減らない", () => {
    const state = buildState({ active: ZOROARK, bench: [RALTS] });
    expect(calculateRetreatCost(state, activeOf(state))).toBe(1);
  });
});

describeTranslation("アイリスの闘志", () => {
  test("手札を 1 枚トラッシュし、手札が 6 枚になるように引く", () => {
    const state = buildState({
      active: RALTS,
      deck: repeat(PSYCHIC_ENERGY, 8),
      hand: [IRIS, BOSS, RALTS],
    });
    playTrainerFromHand(buildContext(state), IRIS);
    expect(namesOf(state.discard)).toEqual(["アイリスの闘志", "ボスの指令"]);
    expect(state.hand).toHaveLength(6);
  });

  test("このカードを除いた手札が 7 枚以上なら使えない(公式 Q&A)。6 枚なら使える", () => {
    const state = buildState({
      active: RALTS,
      deck: repeat(PSYCHIC_ENERGY, 8),
      hand: [IRIS, ...repeat(BOSS, 7)],
    });
    const context = buildContext(state);
    expect(canPlayTrainerFromHand(context, IRIS)).toBe(false);
    state.hand.pop();
    expect(canPlayTrainerFromHand(context, IRIS)).toBe(true);
  });

  test("このカードのほかに手札が無ければ使えない", () => {
    const state = buildState({
      active: RALTS,
      deck: repeat(PSYCHIC_ENERGY, 8),
      hand: [IRIS],
    });
    expect(canPlayTrainerFromHand(buildContext(state), IRIS)).toBe(false);
  });
});

describeTranslation("ウエートレス", () => {
  test("山札の上から 6 枚の基本エネルギーを 1 枚、自分のポケモンにつけ、残りを山札に戻す", () => {
    const state = buildState({
      active: RALTS,
      bench: [KIRLIA],
      deck: [
        BOSS,
        PRISM_ENERGY,
        RALTS,
        RALTS,
        RALTS,
        PSYCHIC_ENERGY,
        FIRE_ENERGY,
      ],
      hand: [WAITRESS],
    });
    playTrainerFromHand(
      buildContext(state, {
        choosePokemon: (_, request) => request.candidates.slice(-1),
      }),
      WAITRESS
    );
    expect(namesOf(benchAt(state, 0).energies)).toEqual(["基本超エネルギー"]);
    expect(state.deck).toHaveLength(6);
  });

  test("山札が 6 枚に満たなくても使える(公式 Q&A)", () => {
    const state = buildState({
      active: RALTS,
      deck: [BOSS, PSYCHIC_ENERGY],
      hand: [WAITRESS],
    });
    playTrainerFromHand(buildContext(state), WAITRESS);
    expect(namesOf(activeOf(state).energies)).toEqual(["基本超エネルギー"]);
  });
});

describeTranslation("ガイ", () => {
  test("3 枚引く", () => {
    const state = buildState({
      active: RALTS,
      deck: repeat(PSYCHIC_ENERGY, 5),
      hand: [GUY],
    });
    playTrainerFromHand(buildContext(state), GUY);
    expect(state.hand).toHaveLength(3);
  });
});

describeTranslation("タケシのスカウト", () => {
  test("山札からたねポケモンを 2 枚まで手札に加える", () => {
    const state = buildState({
      active: RALTS,
      deck: [KIRLIA, RALTS, GARDEVOIR, MEOWTH, BOSS],
      hand: [BROCKS_SCOUTING],
    });
    playTrainerFromHand(
      buildContext(state, {
        chooseCards: pickCardsByName(["ラルトス", "ニャースex"]),
      }),
      BROCKS_SCOUTING
    );
    expect(namesOf(state.hand)).toEqual(["ラルトス", "ニャースex"]);
  });

  test("進化ポケモンを選んだら、その 1 枚だけを手札に加える", () => {
    const state = buildState({
      active: RALTS,
      deck: [KIRLIA, RALTS, GARDEVOIR, MEOWTH, BOSS],
      hand: [BROCKS_SCOUTING],
    });
    playTrainerFromHand(buildContext(state), BROCKS_SCOUTING);
    expect(namesOf(state.hand)).toEqual(["キルリア"]);
    expect(state.deck).toHaveLength(4);
  });
});

/** 並びの順に値を返す乱数。コインは 0.5 未満がオモテ。 */
function randomSequence(values: readonly number[]) {
  let index = 0;
  return {
    nextFloat: () => {
      const value = values[index % values.length] ?? 0;
      index += 1;
      return value;
    },
  };
}

describeTranslation("ピカチュウ(050635)", () => {
  test("ともだちをさがすは、山札からポケモンを 1 枚手札に加える", () => {
    const state = buildState({
      active: PIKACHU_FIND_A_FRIEND,
      deck: [BOSS, KIRLIA, RALTS],
    });
    activeOf(state).energies.push(LIGHTNING_ENERGY);
    useAttackNamed(buildContext(state), "ともだちをさがす");
    expect(namesOf(state.hand)).toEqual(["キルリア"]);
  });
});

describeTranslation("ピカチュウ(050638)", () => {
  test("にげまわるは、このポケモンをベンチポケモンと入れ替える", () => {
    const state = buildState({ active: PIKACHU_RUN_AROUND, bench: [RALTS] });
    activeOf(state).energies.push(LIGHTNING_ENERGY);
    useAttackNamed(buildContext(state), "にげまわる");
    expect(activeOf(state).name).toBe("ラルトス");
  });
});

describeTranslation("ピカチュウ(050643)", () => {
  test("エナジーテールは、山札からエネルギーを 1 枚手札に加える", () => {
    const state = buildState({
      active: PIKACHU_ENERGY_TAIL,
      deck: [BOSS, PRISM_ENERGY, LIGHTNING_ENERGY],
    });
    activeOf(state).energies.push(LIGHTNING_ENERGY);
    useAttackNamed(buildContext(state), "エナジーテール");
    expect(namesOf(state.hand)).toEqual(["プリズムエネルギー"]);
  });
});

describeTranslation("ピカチュウ(050648)", () => {
  test("じゅうでんダッシュは、ウラが出るまで投げたオモテの数まで、山札の基本雷エネルギーをこのポケモンにつける", () => {
    const state = buildState({
      active: PIKACHU_CHARGE_DASH,
      deck: repeat(LIGHTNING_ENERGY, 4),
      random: randomSequence([0.1, 0.4, 0.9]),
    });
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    useAttackNamed(buildContext(state), "じゅうでんダッシュ");
    expect(namesOf(activeOf(state).energies)).toEqual([
      "基本超エネルギー",
      "基本雷エネルギー",
      "基本雷エネルギー",
    ]);
  });

  test("最初にウラが出たらつけない", () => {
    const state = buildState({
      active: PIKACHU_CHARGE_DASH,
      deck: repeat(LIGHTNING_ENERGY, 4),
      random: randomSequence([0.9]),
    });
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    useAttackNamed(buildContext(state), "じゅうでんダッシュ");
    expect(activeOf(state).energies).toHaveLength(1);
    expect(state.deck).toHaveLength(4);
  });
});

describeTranslation("ピカチュウ(050649)", () => {
  test("なんごくきぶんは、手札が 6 枚になるように引く", () => {
    const state = buildState({
      active: PIKACHU_TROPICAL,
      deck: repeat(LIGHTNING_ENERGY, 8),
      hand: [BOSS, RALTS],
    });
    activeOf(state).energies.push(LIGHTNING_ENERGY, LIGHTNING_ENERGY);
    useAttackNamed(buildContext(state), "なんごくきぶん");
    expect(state.hand).toHaveLength(6);
  });
});

describeTranslation("ピカチュウ(050651)", () => {
  test("よるのさんぽは 1 枚引く", () => {
    const state = buildState({
      active: PIKACHU_NIGHT_WALK,
      deck: [BOSS, RALTS],
    });
    activeOf(state).energies.push(LIGHTNING_ENERGY);
    useAttackNamed(buildContext(state), "よるのさんぽ");
    expect(namesOf(state.hand)).toEqual(["ボスの指令"]);
  });
});

describeTranslation("ピカチュウ(050654)", () => {
  test("ためこむは、トラッシュの基本エネルギーを 2 枚まで手札に加える", () => {
    const state = buildState({
      active: PIKACHU_STOCKPILE,
      discard: [
        PRISM_ENERGY,
        LIGHTNING_ENERGY,
        BOSS,
        PSYCHIC_ENERGY,
        FIRE_ENERGY,
      ],
    });
    activeOf(state).energies.push(LIGHTNING_ENERGY);
    useAttackNamed(buildContext(state), "ためこむ");
    expect(namesOf(state.hand)).toEqual([
      "基本雷エネルギー",
      "基本超エネルギー",
    ]);
  });
});

describeTranslation("ピカチュウex(050659)", () => {
  test("ピカピカパレードは、山札のたねポケモンを好きなだけ、ベンチの空きまでベンチに出す", () => {
    const state = buildState({
      active: PIKACHU_EX_PARADE,
      bench: [RALTS, RALTS],
      deck: [...repeat(RALTS, 3), KIRLIA, MEOWTH, BOSS],
    });
    activeOf(state).energies.push(LIGHTNING_ENERGY);
    useAttackNamed(buildContext(state), "ピカピカパレード");
    expect(namesOf(state.bench.map((pokemon) => pokemon.card))).toEqual(
      repeat("ラルトス", 5)
    );
    expect(state.deck).toHaveLength(3);
  });
});

describeTranslation("ピカチュウex(050660)", () => {
  test("ビリビリフィーバーは、手札の基本エネルギーを好きなだけ、自分のポケモンに好きなようにつける", () => {
    const state = buildState({
      active: PIKACHU_EX_FEVER,
      bench: [RALTS],
      hand: [LIGHTNING_ENERGY, PRISM_ENERGY, PSYCHIC_ENERGY, FIRE_ENERGY],
    });
    activeOf(state).energies.push(LIGHTNING_ENERGY);
    const targets = [activeOf(state), benchAt(state, 0), benchAt(state, 0)];
    useAttackNamed(
      buildContext(state, {
        choosePokemon: (_, request) => {
          const next = targets.shift();
          return request.candidates.filter((pokemon) => pokemon === next);
        },
      }),
      "ビリビリフィーバー"
    );
    expect(activeOf(state).energies).toHaveLength(2);
    expect(namesOf(benchAt(state, 0).energies)).toEqual([
      "基本超エネルギー",
      "基本炎エネルギー",
    ]);
    expect(namesOf(state.hand)).toEqual(["プリズムエネルギー"]);
    expect(state.hasAttachedEnergy).toBe(false);
  });
});

describeTranslation("ビビヨン", () => {
  test("みちびきのまいは、番に 1 回、コインでオモテなら山札からポケモンを 1 枚手札に加える", () => {
    const state = buildState({
      active: VIVILLON,
      deck: [BOSS, KIRLIA],
      random: randomSequence([0.2]),
    });
    const context = buildContext(state);
    useAbility(context, activeOf(state), "みちびきのまい");
    expect(namesOf(state.hand)).toEqual(["キルリア"]);
    expect(canUseAbility(context, activeOf(state), "みちびきのまい")).toBe(
      false
    );
  });

  test("コインがウラなら何も手札に加えない", () => {
    const state = buildState({
      active: VIVILLON,
      deck: [BOSS, KIRLIA],
      random: randomSequence([0.7]),
    });
    useAbility(buildContext(state), activeOf(state), "みちびきのまい");
    expect(state.hand).toEqual([]);
  });

  test("山札が無ければ使えない", () => {
    const state = buildState({ active: VIVILLON });
    expect(
      canUseAbility(buildContext(state), activeOf(state), "みちびきのまい")
    ).toBe(false);
  });
});

describe("ファイヤー、フリーザー、サンダーの「はばたき」の特性", () => {
  test("ほかの 2 匹が場にいれば、番に 1 回、手札の基本エネルギーを 1 枚自身につける(手札からつける番に 1 回に数えない)", () => {
    const state = buildState({
      active: MOLTRES,
      bench: [ARTICUNO, ZAPDOS],
      hand: [FIRE_ENERGY, WATER_ENERGY, LIGHTNING_ENERGY, FIRE_ENERGY],
    });
    const context = buildContext(state);
    useAbility(context, activeOf(state), "もえるはばたき");
    useAbility(context, benchAt(state, 0), "いてつくはばたき");
    useAbility(context, benchAt(state, 1), "はじけるはばたき");
    expect(namesOf(activeOf(state).energies)).toEqual(["基本炎エネルギー"]);
    expect(namesOf(benchAt(state, 0).energies)).toEqual(["基本水エネルギー"]);
    expect(namesOf(benchAt(state, 1).energies)).toEqual(["基本雷エネルギー"]);
    expect(canUseAbility(context, activeOf(state), "もえるはばたき")).toBe(
      false
    );
    expect(state.hasAttachedEnergy).toBe(false);
  });

  test("ほかの 2 匹のどちらかがいなければ使えない", () => {
    const state = buildState({
      active: MOLTRES,
      bench: [ARTICUNO],
      hand: [FIRE_ENERGY],
    });
    expect(
      canUseAbility(buildContext(state), activeOf(state), "もえるはばたき")
    ).toBe(false);
  });
});

describeTranslation("ファイヤー", () => {
  test("もえるはばたきは、手札に基本炎エネルギーが無ければ使えない", () => {
    const state = buildState({
      active: MOLTRES,
      bench: [ARTICUNO, ZAPDOS],
      hand: [WATER_ENERGY],
    });
    expect(
      canUseAbility(buildContext(state), activeOf(state), "もえるはばたき")
    ).toBe(false);
  });
});

describeTranslation("フリーザー", () => {
  test("いてつくはばたきは、ベンチにいても使える", () => {
    const state = buildState({
      active: ZAPDOS,
      bench: [MOLTRES, ARTICUNO],
      hand: [WATER_ENERGY],
    });
    useAbility(buildContext(state), benchAt(state, 1), "いてつくはばたき");
    expect(namesOf(benchAt(state, 1).energies)).toEqual(["基本水エネルギー"]);
  });
});

describeTranslation("サンダー", () => {
  test("はじけるはばたきは、手札の基本雷エネルギーを 1 枚だけつける", () => {
    const state = buildState({
      active: ZAPDOS,
      bench: [MOLTRES, ARTICUNO],
      hand: [LIGHTNING_ENERGY, LIGHTNING_ENERGY],
    });
    useAbility(buildContext(state), activeOf(state), "はじけるはばたき");
    expect(activeOf(state).energies).toHaveLength(1);
    expect(state.hand).toHaveLength(1);
  });
});

describeTranslation("ラプラス", () => {
  test("のせておよぐは、山札からサポートを 1 枚手札に加える", () => {
    const state = buildState({ active: LAPRAS, deck: [RALTS, BOSS, GUY] });
    activeOf(state).energies.push(WATER_ENERGY);
    useAttackNamed(buildContext(state), "のせておよぐ");
    expect(namesOf(state.hand)).toEqual(["ボスの指令"]);
  });
});

describeTranslation("パルキア", () => {
  test("ワームホールは、このポケモンをベンチポケモンと入れ替える", () => {
    const state = buildState({ active: PALKIA, bench: [RALTS] });
    activeOf(state).energies.push(WATER_ENERGY, WATER_ENERGY, WATER_ENERGY);
    useAttackNamed(buildContext(state), "ワームホール");
    expect(activeOf(state).name).toBe("ラルトス");
    expect(benchAt(state, 0).name).toBe("パルキア");
  });
});

describeTranslation("モルペコ", () => {
  test("おやつをえらぶは、山札の上から 3 枚トラッシュし、その中から 1 枚を手札に加える", () => {
    const state = buildState({
      active: MORPEKO,
      deck: [BOSS, RALTS, KIRLIA, GUY],
      discard: [LILLIE],
    });
    activeOf(state).energies.push(LIGHTNING_ENERGY);
    useAttackNamed(
      buildContext(state, { chooseCards: pickCardsByName(["キルリア"]) }),
      "おやつをえらぶ"
    );
    expect(namesOf(state.hand)).toEqual(["キルリア"]);
    expect(namesOf(state.discard)).toEqual([
      "リーリエの決心",
      "ボスの指令",
      "ラルトス",
    ]);
    expect(namesOf(state.deck)).toEqual(["ガイ"]);
  });

  test("もともとトラッシュにあったカードは選べない", () => {
    const state = buildState({
      active: MORPEKO,
      deck: [BOSS],
      discard: [LILLIE],
    });
    activeOf(state).energies.push(LIGHTNING_ENERGY);
    useAttackNamed(
      buildContext(state, {
        chooseCards: pickCardsByName(["リーリエの決心", "ボスの指令"]),
      }),
      "おやつをえらぶ"
    );
    expect(namesOf(state.hand)).toEqual(["ボスの指令"]);
  });
});

describeTranslation("ゼルネアス", () => {
  test("ジオナビゲートは、山札からスタジアムを 2 枚まで手札に加える", () => {
    const state = buildState({
      active: XERNEAS,
      deck: [NIGHT_ACADEMY, BOSS, ZERO_CAVERN, GRAND_TREE_FOREST],
    });
    activeOf(state).energies.push(PSYCHIC_ENERGY);
    useAttackNamed(buildContext(state), "ジオナビゲート");
    expect(namesOf(state.hand)).toEqual(["夜のアカデミー", "ゼロの大空洞"]);
  });
});

describeTranslation("コレクレー", () => {
  test("たくさんあるくは、コインでオモテなら山札から好きなカードを 1 枚手札に加え、ウラなら何もしない", () => {
    const heads = buildState({
      active: GIMMIGHOUL,
      deck: [BOSS, RALTS],
      random: randomSequence([0.3]),
    });
    heads.active?.energies.push(PSYCHIC_ENERGY);
    useAttackNamed(buildContext(heads), "たくさんあるく");
    expect(namesOf(heads.hand)).toEqual(["ボスの指令"]);
    const tails = buildState({
      active: GIMMIGHOUL,
      deck: [BOSS, RALTS],
      random: randomSequence([0.6]),
    });
    tails.active?.energies.push(PSYCHIC_ENERGY);
    useAttackNamed(buildContext(tails), "たくさんあるく");
    expect(tails.hand).toEqual([]);
  });
});

describe("ニャースの「ネコにこばん」", () => {
  for (const [label, card, energies] of [
    ["アローラ ニャース", ALOLAN_MEOWTH, []],
    ["ガラル ニャース", GALARIAN_MEOWTH, [STEEL_ENERGY]],
    ["ニャース", MEOWTH_30TH, [STEEL_ENERGY, STEEL_ENERGY]],
  ] as const) {
    describeTranslation(label, () => {
      test("ネコにこばんは 1 枚引く", () => {
        const state = buildState({ active: card, deck: [BOSS, RALTS] });
        activeOf(state).energies.push(...energies);
        useAttackNamed(buildContext(state), "ネコにこばん");
        expect(namesOf(state.hand)).toEqual(["ボスの指令"]);
      });
    });
  }

  test("おたからラッシュは、手札の枚数×10", () => {
    const state = buildState({
      active: GALARIAN_MEOWTH,
      hand: [BOSS, RALTS, KIRLIA],
    });
    expect(
      damageOf(state, activeOf(state), GALARIAN_MEOWTH, "おたからラッシュ")
    ).toBe(3 * 10);
  });
});

describeTranslation("ジラーチex", () => {
  test("ねがいをかなえるは、手札が 7 枚になるように引く", () => {
    const state = buildState({
      active: JIRACHI_EX,
      deck: repeat(STEEL_ENERGY, 10),
      hand: [BOSS, RALTS],
    });
    activeOf(state).energies.push(STEEL_ENERGY);
    useAttackNamed(buildContext(state), "ねがいをかなえる");
    expect(state.hand).toHaveLength(7);
  });
});

describeTranslation("ディアルガ", () => {
  test("リバースクロックは、トラッシュのポケモンと基本エネルギーを合計 3 枚まで山札に戻す", () => {
    const state = buildState({
      active: DIALGA,
      discard: [BOSS, PRISM_ENERGY, RALTS, STEEL_ENERGY, KIRLIA, RALTS],
    });
    activeOf(state).energies.push(STEEL_ENERGY);
    useAttackNamed(buildContext(state), "リバースクロック");
    expect(namesOf(state.discard)).toEqual([
      "ボスの指令",
      "プリズムエネルギー",
      "ラルトス",
    ]);
    expect(state.deck).toHaveLength(3);
  });
});

describeTranslation("ソルガレオ", () => {
  test("サンライズは、ベンチにいれば番に 1 回、山札の基本鋼エネルギーを 2 枚までこのポケモンにつける", () => {
    const state = buildState({
      active: COSMOEM,
      bench: [SOLGALEO],
      deck: [STEEL_ENERGY, BOSS, STEEL_ENERGY, STEEL_ENERGY],
    });
    const context = buildContext(state);
    useAbility(context, benchAt(state, 0), "サンライズ");
    expect(namesOf(benchAt(state, 0).energies)).toEqual([
      "基本鋼エネルギー",
      "基本鋼エネルギー",
    ]);
    expect(canUseAbility(context, benchAt(state, 0), "サンライズ")).toBe(false);
  });

  test("バトル場にいるときは使えない", () => {
    const state = buildState({ active: SOLGALEO, deck: [STEEL_ENERGY] });
    expect(
      canUseAbility(buildContext(state), activeOf(state), "サンライズ")
    ).toBe(false);
  });
});

describeTranslation("ボーマンダex", () => {
  test("とどろくよびごえは、トラッシュのドラゴンタイプのたねポケモンを 3 枚までベンチに出す", () => {
    const state = buildState({
      active: SALAMENCE_EX,
      discard: [DRATINI, KOMMO_O, RALTS, DREEPY, DRATINI, DRATINI],
    });
    activeOf(state).energies.push(FIRE_ENERGY);
    useAttackNamed(buildContext(state), "とどろくよびごえ");
    expect(namesOf(state.bench.map((pokemon) => pokemon.card))).toEqual([
      "ミニリュウ",
      "ドラメシヤ",
      "ミニリュウ",
    ]);
  });

  test("りゅうのはどうは、山札の上から 2 枚トラッシュする", () => {
    const state = buildState({
      active: SALAMENCE_EX,
      deck: [BOSS, RALTS, KIRLIA],
    });
    activeOf(state).energies.push(FIRE_ENERGY, WATER_ENERGY);
    useAttackNamed(buildContext(state), "りゅうのはどう");
    expect(namesOf(state.discard)).toEqual(["ボスの指令", "ラルトス"]);
    expect(namesOf(state.deck)).toEqual(["キルリア"]);
  });
});

describeTranslation("メタモン", () => {
  test("どっきりへんしんは、コインでオモテなら山札のポケモンと入れ替え、ついているカードを引き継ぎ、このカードを山札に戻す", () => {
    const state = buildState({
      active: DITTO,
      bench: [RALTS],
      deck: [BOSS, GARDEVOIR, RALTS],
      random: randomSequence([0.2]),
    });
    activeOf(state).energies.push(PSYCHIC_ENERGY, PSYCHIC_ENERGY);
    useAttackNamed(buildContext(state), "どっきりへんしん");
    expect(activeOf(state).name).toBe("メガサーナイトex");
    expect(activeOf(state).energies).toHaveLength(2);
    expect(namesOf(state.deck).sort()).toEqual(
      ["ボスの指令", "メタモン", "ラルトス"].sort()
    );
  });

  test("コインがウラなら入れ替えない", () => {
    const state = buildState({
      active: DITTO,
      deck: [GARDEVOIR],
      random: randomSequence([0.8]),
    });
    activeOf(state).energies.push(PSYCHIC_ENERGY, PSYCHIC_ENERGY);
    useAttackNamed(buildContext(state), "どっきりへんしん");
    expect(activeOf(state).name).toBe("メタモン");
    expect(namesOf(state.deck)).toEqual(["メガサーナイトex"]);
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
    const translated = [...new Set(cardRecordTable.values())].filter(
      (record) => record.translationStatus === "translated"
    );
    // 名前が同じ翻訳が複数あるカード(ピカチュウ)は、名前だけでは記録ごとにテストがあるか分からないため、
    // 「名前(先頭のカード ID)」でテストを置く
    const sharedNames = new Set(
      translated
        .map((record) => record.name)
        .filter((name, index, names) => names.indexOf(name) !== index)
    );
    const expectedLabels = translated.map((record) =>
      sharedNames.has(record.name)
        ? `${record.name}(${record.cardIds[0]})`
        : record.name
    );
    expect(
      expectedLabels.filter((label) => !testedTranslations.has(label))
    ).toEqual([]);
  });
});

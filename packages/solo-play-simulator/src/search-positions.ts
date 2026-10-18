/**
 * 探索が正しい手を選べるかを確かめる正しい手の局面。局面 A〜F(docs/solo-play-simulator-design.md「2 つの危うさを
 * 確かめる題材」)は開発責任者のメガサーナイトex(xG8Kax-DHob4e-84xcca)で、正しい手は #22 の規則ファイルの判断から
 * 取り、2026-09-26 に開発責任者が確認した。局面 1〜10(7 は取り下げ)は Issue 51「正しい手の局面」の表の通りで、
 * 正しい手は 2026-10-03〜06 に開発責任者(デッキの持ち主)が判断した。局面 1〜4 は `compare:issue22-rates` の試行の
 * 手札と場を、数え漏れを直す前の main で写したもの(docs/solo-play-simulator-design.md「順 1 で決めたこと(準備)」)。
 *
 * 局面は 60 枚から手札と場のカードを抜き、残りを arrangementSeed の乱数で並べて山札とサイドにする。山札とサイドの
 * 中身で正しい手が変わらないことを、並べ方を変えて確かめる。
 */

import type { CardRecord } from "./card-record-schema.ts";
import { cardRecordTable } from "./card-record-table.ts";
import type { Card } from "./cards.ts";
import {
  type Declaration,
  type ResolvedDeclaration,
  resolveDeclaration,
} from "./declaration.ts";
import { buildDeck } from "./engine.ts";
import {
  BAKEGAKURE_DECLARATION,
  DRAGAPULT_DECLARATION,
  ISSUE22_DECKS,
  MEGA_CHARIZARD_DECLARATION,
  MEGA_GARDEVOIR_DECLARATION,
} from "./issue22-decks.ts";
import { createSeededRandom } from "./random.ts";
import type { SearchPolicy } from "./search-policy.ts";
import { GameState, PokemonInPlay } from "./state.ts";

/** 局面に使うデッキの 60 枚と、宣言を記録で引き当てたもの。 */
interface PositionDeck {
  readonly cards: readonly Card[];
  readonly declaration: ResolvedDeclaration;
}

function buildPositionDeck(
  deckCode: string,
  declaration: Declaration
): PositionDeck {
  const deck = ISSUE22_DECKS.find((entry) => entry.deckCode === deckCode);
  if (deck === undefined) {
    throw new Error(`デッキ ${deckCode} が無い`);
  }
  return {
    cards: buildDeck(cardRecordTable, deck.decklist),
    declaration: resolveDeclaration(declaration, cardRecordTable),
  };
}

const POSITION_DECKS = {
  bakegakure: buildPositionDeck("9nnnLP-Wejgk5-gn6gn9", BAKEGAKURE_DECLARATION),
  dragapult: buildPositionDeck("9gngnQ-zAMw9G-96H9nn", DRAGAPULT_DECLARATION),
  megaCharizard: buildPositionDeck(
    "DxKGxx-6pqCKy-xxJ8Yc",
    MEGA_CHARIZARD_DECLARATION
  ),
  megaGardevoir: buildPositionDeck(
    "xG8Kax-DHob4e-84xcca",
    MEGA_GARDEVOIR_DECLARATION
  ),
} as const;

type PositionDeckKey = keyof typeof POSITION_DECKS;

export const RESOLVED_MEGA_GARDEVOIR_DECLARATION =
  POSITION_DECKS.megaGardevoir.declaration;

export const RESOLVED_MEGA_CHARIZARD_DECLARATION =
  POSITION_DECKS.megaCharizard.declaration;

/**
 * 局面に使うカード。カード ID はカードの記録を引くためのもので、そのデッキに入っている印刷と違ってよい(ドラパルトex の
 * ハイパーボールは 049600、ばけがくれのリーリエの決心は 050468)。60 枚からは記録の単位で照らして抜く。
 */
const CARD_IDS = {
  achroma: "045934",
  bossOrders: "050467",
  budew: "048533",
  charmander: "048351",
  dhelmise: "050308",
  dragapult: "049264",
  drakloak: "049263",
  dreepy: "049262",
  dudunsparce: "045203",
  fireEnergy: "050746",
  frillish: "047663",
  greatTree: "046040",
  kirlia: "049715",
  latias: "046248",
  lillie: "049445",
  lilliesClefairy: "047041",
  megaGardevoir: "048464",
  meowth: "049694",
  mitsuru: "047856",
  nightStretcher: "048681",
  poffin: "048675",
  pokegear: "049376",
  pokePad: "050424",
  poltchageist: "050224",
  psychicEnergy: "049463",
  ralts: "049714",
  rareCandy: "050462",
  rocketWatchTower: "048711",
  shuppet: "050250",
  specialRedCard: "050156",
  switchCard: "049602",
  ultraBall: "050461",
  yukari: "050083",
} as const;

type CardKey = keyof typeof CARD_IDS;

function recordOf(key: CardKey): CardRecord {
  const record = cardRecordTable.get(CARD_IDS[key]);
  if (record === undefined) {
    throw new Error(`局面に使う ${key}(${CARD_IDS[key]})の記録が無い`);
  }
  return record;
}

function isCardOf(card: Card, key: CardKey): boolean {
  return card.record === recordOf(key);
}

/** 場のポケモン。evolvedFrom は下にある進化前(たねから順に)。 */
interface PokemonSetup {
  readonly card: CardKey;
  readonly energies?: readonly CardKey[];
  readonly evolvedFrom?: readonly CardKey[];
}

interface PositionSetup {
  readonly active: PokemonSetup;
  readonly bench?: readonly PokemonSetup[];
  readonly deck: PositionDeckKey;
  /** トラッシュに置くカード(前の番までに使ったカード)。 */
  readonly discard?: readonly CardKey[];
  readonly hand: readonly CardKey[];
  /** サイドに置かないカード(山札にあることを局面の前提にするカード)。 */
  readonly keepInDeck?: readonly CardKey[];
  readonly turn: number;
  readonly wentFirst: boolean;
}

/** 60 枚から card を 1 枚抜く。 */
function takeCard(pool: Card[], key: CardKey): Card {
  const index = pool.findIndex((candidate) => isCardOf(candidate, key));
  const [card] = index < 0 ? [] : pool.splice(index, 1);
  if (card === undefined) {
    throw new Error(`局面に使う ${key} が 60 枚に足りない`);
  }
  return card;
}

function placePokemon(pool: Card[], setup: PokemonSetup): PokemonInPlay {
  const pokemon = new PokemonInPlay(takeCard(pool, setup.card), 0);
  for (const key of setup.evolvedFrom ?? []) {
    pokemon.underneath.push(takeCard(pool, key));
  }
  for (const key of setup.energies ?? []) {
    pokemon.energies.push(takeCard(pool, key));
  }
  return pokemon;
}

/** 残りのカードを並べ、keepInDeck のカード以外から 6 枚をサイドにする。 */
function arrangeUnseen(
  state: GameState,
  pool: Card[],
  keepInDeck: readonly CardKey[],
  arrangementSeed: number
): void {
  const random = createSeededRandom(arrangementSeed);
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random.nextFloat() * (index + 1));
    const card = pool[index] as Card;
    pool[index] = pool[other] as Card;
    pool[other] = card;
  }
  const kept = keepInDeck.map((key) => takeCard(pool, key));
  state.prizes.push(...pool.splice(0, 6));
  state.deck = [...pool, ...kept];
  for (let index = state.deck.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random.nextFloat() * (index + 1));
    const card = state.deck[index] as Card;
    state.deck[index] = state.deck[other] as Card;
    state.deck[other] = card;
  }
}

function buildPositionState(
  setup: PositionSetup,
  arrangementSeed: number
): GameState {
  const pool = [...POSITION_DECKS[setup.deck].cards];
  const state = new GameState(
    createSeededRandom(arrangementSeed + 1),
    [],
    setup.wentFirst
  );
  state.turn = setup.turn;
  state.active = placePokemon(pool, setup.active);
  state.bench.push(
    ...(setup.bench ?? []).map((pokemon) => placePokemon(pool, pokemon))
  );
  state.hand = setup.hand.map((key) => takeCard(pool, key));
  state.discard.push(
    ...(setup.discard ?? []).map((key) => takeCard(pool, key))
  );
  arrangeUnseen(state, pool, setup.keepInDeck ?? [], arrangementSeed);
  return state;
}

/** 対戦の準備の局面。手札 7 枚を抜き、残りを並べて山札にする(サイドは準備の後に置く)。 */
function buildSetupState(
  deck: PositionDeckKey,
  hand: readonly CardKey[],
  arrangementSeed: number
): GameState {
  const pool = [...POSITION_DECKS[deck].cards];
  const state = new GameState(
    createSeededRandom(arrangementSeed + 1),
    [],
    false
  );
  state.hand = hand.map((key) => takeCard(pool, key));
  arrangeUnseen(state, pool, [], arrangementSeed);
  state.deck.push(...state.prizes.splice(0));
  return state;
}

export interface SearchPosition {
  /** 局面を作る。山札とサイドは arrangementSeed の乱数で並べる。 */
  readonly build: (arrangementSeed: number) => GameState;
  readonly correctPlay: string;
  /** 探索と評価に渡す宣言(局面のデッキの宣言)。 */
  readonly declaration: ResolvedDeclaration;
  readonly id: string;
  /** 作った局面で探索に選ばせ、正しい手を選んだかを返す。 */
  readonly judge: (policy: SearchPolicy, state: GameState) => boolean;
  readonly situation: string;
}

function playTurnOf(policy: SearchPolicy, state: GameState): void {
  policy.playTurn({ choices: policy, state });
}

const LILLIE_USED = /サポート リーリエの決心/;
const ENERGY_ATTACHED = /エネルギー .+ → /;
/** 手札からの進化は履歴に「(山札から)」が付かない。 */
const KIRLIA_FROM_HAND = /進化 ラルトス → キルリア$/;
const MEGA_GARDEVOIR_FROM_DECK = /進化 キルリア → メガサーナイトex\(山札から\)/;
const ULTRA_BALL_USED = /グッズ ハイパーボール/;
const SEARCH_GOODS_USED = /グッズ (ハイパーボール|なかよしポフィン)/;
const ACHROMA_USED = /サポート アクロマの執念/;
const FIRE_ENERGY_TO_DRAGAPULT = /エネルギー 基本炎エネルギー → ドラパルトex$/;
const POKE_PAD_USED = /グッズ ポケパッド/;
/** 手札からベンチに出したときは履歴に「(山札から)」が付かない。 */
const RALTS_BENCHED_FROM_HAND = /ベンチ ラルトス$/;

function indexOfEvent(state: GameState, pattern: RegExp): number {
  return state.events.findIndex((event) => pattern.test(event));
}

function countInPlay(state: GameState, key: CardKey): number {
  return state
    .listPokemonInPlay()
    .filter((pokemon) => isCardOf(pokemon.card, key)).length;
}

function countInDiscard(state: GameState, key: CardKey): number {
  return state.discard.filter((card) => isCardOf(card, key)).length;
}

function countEvents(state: GameState, pattern: RegExp): number {
  return state.events.filter((event) => pattern.test(event)).length;
}

/** 対戦の準備で、手札のたねポケモン(basicKeys)からバトル場とベンチに出すものを探索に選ばせる。 */
function chooseSetupPlacement(
  policy: SearchPolicy,
  state: GameState,
  basicKeys: readonly CardKey[]
): { active: Card; bench: readonly Card[] } {
  const basics = state.hand.filter((card) =>
    basicKeys.some((key) => isCardOf(card, key))
  );
  const active = policy.chooseActiveAtSetup(state, basics);
  const rest = [...basics];
  rest.splice(rest.indexOf(active), 1);
  return { active, bench: policy.chooseBenchAtSetup(state, rest) };
}

function chooseAttackName(
  policy: SearchPolicy,
  state: GameState
): string | undefined {
  return policy.chooseAttack({ choices: policy, state })?.attack.name;
}

const SETUP_HAND: readonly CardKey[] = [
  "ralts",
  "meowth",
  "psychicEnergy",
  "psychicEnergy",
  "bossOrders",
  "switchCard",
  "specialRedCard",
];

export const SEARCH_POSITIONS: readonly SearchPosition[] = [
  {
    build: (seed) =>
      buildPositionState(
        {
          active: { card: "ralts" },
          deck: "megaGardevoir",
          hand: [
            "rareCandy",
            "megaGardevoir",
            "lillie",
            "psychicEnergy",
            "bossOrders",
            "specialRedCard",
          ],
          turn: 1,
          wentFirst: false,
        },
        seed
      ),
    correctPlay:
      "リーリエの決心を使わない。次の番のふしぎなアメの道の材料を流さない",
    declaration: POSITION_DECKS.megaGardevoir.declaration,
    id: "A",
    judge: (policy, state) => {
      playTurnOf(policy, state);
      return indexOfEvent(state, LILLIE_USED) < 0;
    },
    situation:
      "後攻 1 番目の番。バトル場にラルトス。手札にふしぎなアメ、メガサーナイトex、リーリエの決心",
  },
  {
    build: (seed) =>
      buildPositionState(
        {
          active: {
            card: "megaGardevoir",
            energies: ["psychicEnergy"],
            evolvedFrom: ["ralts", "kirlia"],
          },
          bench: [{ card: "ralts" }, { card: "ralts" }, { card: "latias" }],
          deck: "megaGardevoir",
          hand: ["bossOrders", "specialRedCard"],
          turn: 2,
          wentFirst: false,
        },
        seed
      ),
    correctPlay: "「メガシンフォニア」ではなく「あふれるねがい」を使う",
    declaration: POSITION_DECKS.megaGardevoir.declaration,
    id: "B",
    judge: (policy, state) =>
      chooseAttackName(policy, state) === "あふれるねがい",
    situation:
      "2 番目の番。バトル場に超エネルギー 1 個のメガサーナイトex、ベンチに 3 匹、山札に基本超エネルギー",
  },
  {
    build: (seed) => buildSetupState("megaGardevoir", SETUP_HAND, seed),
    correctPlay: "ニャースex をベンチに出さず手札に残す",
    declaration: POSITION_DECKS.megaGardevoir.declaration,
    id: "C",
    judge: (policy, state) => {
      const { active, bench } = chooseSetupPlacement(policy, state, [
        "ralts",
        "meowth",
      ]);
      return (
        isCardOf(active, "ralts") &&
        bench.every((card) => !isCardOf(card, "meowth"))
      );
    },
    situation: "対戦の準備。手札のたねポケモンがラルトスとニャースex",
  },
  {
    build: (seed) =>
      buildPositionState(
        {
          active: { card: "ralts" },
          deck: "megaGardevoir",
          hand: [
            "psychicEnergy",
            "lillie",
            "bossOrders",
            "specialRedCard",
            "switchCard",
          ],
          turn: 1,
          wentFirst: false,
        },
        seed
      ),
    correctPlay: "エネルギーをつけてからリーリエの決心を使う",
    declaration: POSITION_DECKS.megaGardevoir.declaration,
    id: "D",
    judge: (policy, state) => {
      playTurnOf(policy, state);
      const attached = indexOfEvent(state, ENERGY_ATTACHED);
      const lillie = indexOfEvent(state, LILLIE_USED);
      return attached >= 0 && lillie >= 0 && attached < lillie;
    },
    situation:
      "後攻 1 番目の番。バトル場にラルトス。手札に基本超エネルギーとリーリエの決心。次の番の材料は無い",
  },
  {
    build: (seed) =>
      buildPositionState(
        {
          active: { card: "ralts" },
          deck: "megaGardevoir",
          hand: ["kirlia", "achroma", "bossOrders", "specialRedCard"],
          keepInDeck: ["greatTree", "kirlia", "megaGardevoir"],
          turn: 2,
          wentFirst: false,
        },
        seed
      ),
    correctPlay:
      "アクロマの執念で偉大な大樹を取って出し、大樹でラルトスをキルリア、メガサーナイトex と進化させる。手札のキルリアは先に乗せない",
    declaration: POSITION_DECKS.megaGardevoir.declaration,
    id: "E",
    judge: (policy, state) => {
      playTurnOf(policy, state);
      const kirliaFromHand = indexOfEvent(state, KIRLIA_FROM_HAND);
      const treeEvolution = indexOfEvent(state, MEGA_GARDEVOIR_FROM_DECK);
      return (
        treeEvolution >= 0 &&
        (kirliaFromHand < 0 || kirliaFromHand > treeEvolution) &&
        countInPlay(state, "megaGardevoir") === 1
      );
    },
    situation:
      "2 番目の番。前の番からのラルトスが 1 匹。手札にキルリアとアクロマの執念。偉大な大樹は場に無い",
  },
  {
    build: (seed) =>
      buildPositionState(
        {
          active: { card: "ralts" },
          deck: "megaGardevoir",
          hand: ["ultraBall", "rareCandy", "frillish", "yukari", "bossOrders"],
          keepInDeck: ["megaGardevoir"],
          turn: 2,
          wentFirst: false,
        },
        seed
      ),
    correctPlay: "捨てる 2 枚にふしぎなアメを選ばない",
    declaration: POSITION_DECKS.megaGardevoir.declaration,
    id: "F",
    judge: (policy, state) => {
      playTurnOf(policy, state);
      return (
        indexOfEvent(state, ULTRA_BALL_USED) >= 0 &&
        countInPlay(state, "megaGardevoir") === 1
      );
    },
    situation:
      "2 番目の番。前の番からのラルトスが 1 匹。手札にハイパーボール、ふしぎなアメ、プルリル、ユカリ、ボスの指令。メガサーナイトex は手札に無い",
  },
  // 局面 1〜10 は Issue 51「正しい手の局面」の表。カードの効果は記録から読む(各局面のコメントのカード ID)
  {
    // ハイパーボール 050461(049600 は同じ記録)、なかよしポフィン 048675(049364 は同じ記録)。ドラパルトex の先攻の試行 13
    build: (seed) =>
      buildPositionState(
        {
          active: { card: "dreepy" },
          bench: [{ card: "budew" }, { card: "dreepy" }],
          deck: "dragapult",
          hand: [
            "nightStretcher",
            "ultraBall",
            "poffin",
            "rocketWatchTower",
            "poffin",
            "psychicEnergy",
          ],
          keepInDeck: ["drakloak", "dragapult", "rareCandy"],
          turn: 2,
          wentFirst: true,
        },
        seed
      ),
    correctPlay:
      "探すカードを手札に残したまま、何もせずに番を終えない(ハイパーボールかなかよしポフィンの少なくとも一方を使う)",
    declaration: POSITION_DECKS.dragapult.declaration,
    id: "1",
    judge: (policy, state) => {
      playTurnOf(policy, state);
      return indexOfEvent(state, SEARCH_GOODS_USED) >= 0;
    },
    situation:
      "ドラパルトex、2 番目の番。前の番からのドラメシヤ 2 匹。手札にハイパーボール 1 枚となかよしポフィン 2 枚。ドロンチ・ドラパルトex・ふしぎなアメは山札(先攻の試行 13)",
  },
  {
    // アクロマの執念 045934、偉大な大樹 046040、キルリア 049715、メガサーナイトex 048464。メガサーナイトex の先攻の試行 16
    build: (seed) =>
      buildPositionState(
        {
          active: { card: "latias", energies: ["psychicEnergy"] },
          bench: [{ card: "ralts" }, { card: "ralts" }, { card: "meowth" }],
          deck: "megaGardevoir",
          discard: ["poffin"],
          hand: [
            "megaGardevoir",
            "specialRedCard",
            "ultraBall",
            "kirlia",
            "achroma",
            "mitsuru",
          ],
          keepInDeck: ["greatTree"],
          turn: 2,
          wentFirst: true,
        },
        seed
      ),
    correctPlay:
      "番の終わりにメガサーナイトex が場にいる(アクロマの執念で偉大な大樹を取って出し、大樹でラルトスをキルリア、メガサーナイトex と進化させる)",
    declaration: POSITION_DECKS.megaGardevoir.declaration,
    id: "2",
    judge: (policy, state) => {
      playTurnOf(policy, state);
      return countInPlay(state, "megaGardevoir") >= 1;
    },
    situation:
      "メガサーナイトex、2 番目の番。前の番からのラルトス 2 匹。手札にキルリア・メガサーナイトex・アクロマの執念。偉大な大樹は山札(先攻の試行 16)",
  },
  {
    // アクロマの執念 045934、リーリエの決心 049445、ふしぎなアメ 050462。メガサーナイトex の先攻の試行 1
    build: (seed) =>
      buildPositionState(
        {
          active: { card: "lilliesClefairy" },
          bench: [{ card: "ralts", energies: ["psychicEnergy"] }],
          deck: "megaGardevoir",
          hand: [
            "specialRedCard",
            "kirlia",
            "achroma",
            "lillie",
            "rareCandy",
            "poffin",
          ],
          keepInDeck: ["greatTree", "megaGardevoir"],
          turn: 2,
          wentFirst: true,
        },
        seed
      ),
    correctPlay:
      "この番に使うサポートがアクロマの執念である(リーリエの決心ではない)",
    declaration: POSITION_DECKS.megaGardevoir.declaration,
    id: "3",
    judge: (policy, state) => {
      playTurnOf(policy, state);
      return (
        indexOfEvent(state, ACHROMA_USED) >= 0 &&
        indexOfEvent(state, LILLIE_USED) < 0
      );
    },
    situation:
      "メガサーナイトex、2 番目の番。前の番からのラルトス 1 匹。手札にキルリア・ふしぎなアメ・アクロマの執念・リーリエの決心(先攻の試行 1)",
  },
  {
    // ダダリン 050308、リーリエの決心 049445(050468 は同じ記録)、ハイパーボール 050461、ポケギア3.0 049376。ばけがくれの先攻の試行 5
    build: (seed) =>
      buildPositionState(
        {
          active: { card: "dhelmise" },
          deck: "bakegakure",
          hand: [
            "ultraBall",
            "pokegear",
            "lillie",
            "dudunsparce",
            "lillie",
            "lillie",
            "shuppet",
            "nightStretcher",
          ],
          turn: 2,
          wentFirst: true,
        },
        seed
      ),
    correctPlay: "この番にリーリエの決心を使う(手札に残したまま番を終えない)",
    declaration: POSITION_DECKS.bakegakure.declaration,
    id: "4",
    judge: (policy, state) => {
      playTurnOf(policy, state);
      return indexOfEvent(state, LILLIE_USED) >= 0;
    },
    situation:
      "ばけがくれ、2 番目の番。バトル場にエネルギー 0 個のダダリン。手札にリーリエの決心 3 枚・ハイパーボール・ポケギア3.0。エネルギーは無い(先攻の試行 5)",
  },
  {
    // ドラパルトex 049264(ファントムダイブは炎 1 個と超 1 個)、基本炎エネルギー 050746、基本超エネルギー 049463
    build: (seed) =>
      buildPositionState(
        {
          active: {
            card: "dragapult",
            energies: ["psychicEnergy"],
            evolvedFrom: ["dreepy", "drakloak"],
          },
          deck: "dragapult",
          hand: ["psychicEnergy", "fireEnergy", "bossOrders", "specialRedCard"],
          turn: 2,
          wentFirst: false,
        },
        seed
      ),
    correctPlay:
      "基本炎エネルギーをつける(ファントムダイブは炎と超が 1 個ずつ)",
    declaration: POSITION_DECKS.dragapult.declaration,
    id: "5",
    judge: (policy, state) => {
      playTurnOf(policy, state);
      return indexOfEvent(state, FIRE_ENERGY_TO_DRAGAPULT) >= 0;
    },
    situation:
      "ドラパルトex(基本超エネルギー 1 個つき)がバトル場。手札に基本炎エネルギー 1 枚と基本超エネルギー 1 枚(作った場面)",
  },
  {
    // ダダリン 050308(にげる 3)、カゲボウズ 050250(にげる 1)
    build: (seed) =>
      buildSetupState(
        "bakegakure",
        [
          "shuppet",
          "dhelmise",
          "bossOrders",
          "bossOrders",
          "nightStretcher",
          "nightStretcher",
          "psychicEnergy",
        ],
        seed
      ),
    correctPlay: "ダダリンをバトル場に、カゲボウズをベンチに置く",
    declaration: POSITION_DECKS.bakegakure.declaration,
    id: "6",
    judge: (policy, state) => {
      const { active, bench } = chooseSetupPlacement(policy, state, [
        "shuppet",
        "dhelmise",
      ]);
      return (
        isCardOf(active, "dhelmise") &&
        bench.some((card) => isCardOf(card, "shuppet"))
      );
    },
    situation:
      "ばけがくれ、対戦の準備。手札のたねポケモンがダダリン(にげる 3)とカゲボウズ(にげる 1)(作った場面)",
  },
  {
    // ポケモンいれかえ 049602、ニャースex 049694(にげる 1)、メガサーナイトex 048464(メガシンフォニア)
    build: (seed) =>
      buildPositionState(
        {
          active: { card: "meowth" },
          bench: [
            {
              card: "megaGardevoir",
              energies: ["psychicEnergy"],
              evolvedFrom: ["ralts", "kirlia"],
            },
          ],
          deck: "megaGardevoir",
          hand: ["bossOrders", "specialRedCard", "switchCard"],
          turn: 3,
          wentFirst: false,
        },
        seed
      ),
    correctPlay:
      "ポケモンいれかえでメガサーナイトex をバトル場に出し、メガシンフォニアを使う",
    declaration: POSITION_DECKS.megaGardevoir.declaration,
    id: "8",
    judge: (policy, state) => {
      playTurnOf(policy, state);
      return (
        state.active !== undefined &&
        isCardOf(state.active.card, "megaGardevoir") &&
        chooseAttackName(policy, state) === "メガシンフォニア"
      );
    },
    situation:
      "メガサーナイトex、3 番目の番。ベンチにメガサーナイトex(超エネルギー 1 個つき)。バトル場にエネルギー 0 個のニャースex。手札にポケモンいれかえ(作った場面)",
  },
  {
    // ハイパーボール 050461、チャデス 050224、カゲボウズ 050250、ポケパッド 050424、ダダリン 050308(むねんのイカリ)
    build: (seed) =>
      buildPositionState(
        {
          active: { card: "dhelmise", energies: ["psychicEnergy"] },
          deck: "bakegakure",
          hand: ["ultraBall", "pokePad", "poltchageist", "shuppet"],
          turn: 2,
          wentFirst: false,
        },
        seed
      ),
    correctPlay:
      "ハイパーボールで捨てる 2 枚にチャデスとカゲボウズを選ぶ(ポケパッドを捨てない)",
    declaration: POSITION_DECKS.bakegakure.declaration,
    id: "9",
    judge: (policy, state) => {
      playTurnOf(policy, state);
      return (
        countInDiscard(state, "poltchageist") >= 1 &&
        countInDiscard(state, "shuppet") >= 1 &&
        countInDiscard(state, "pokePad") === countEvents(state, POKE_PAD_USED)
      );
    },
    situation:
      "ばけがくれ、2 番目の番。バトル場にダダリン(超エネルギー 1 個つき)。トラッシュに特性「ばけがくれ」のポケモンは 0 枚。手札にハイパーボール・チャデス・カゲボウズ・ポケパッド(作った場面)",
  },
  {
    // メガサーナイトex 048464(あふれるねがい)、ラルトス 049714、基本超エネルギー 049463
    build: (seed) =>
      buildPositionState(
        {
          active: {
            card: "megaGardevoir",
            energies: ["psychicEnergy"],
            evolvedFrom: ["ralts", "kirlia"],
          },
          bench: [{ card: "ralts" }, { card: "latias" }],
          deck: "megaGardevoir",
          hand: ["ralts", "bossOrders", "specialRedCard"],
          keepInDeck: ["psychicEnergy"],
          turn: 2,
          wentFirst: false,
        },
        seed
      ),
    correctPlay: "ラルトスをベンチに出してから「あふれるねがい」を使う",
    declaration: POSITION_DECKS.megaGardevoir.declaration,
    id: "10",
    judge: (policy, state) => {
      playTurnOf(policy, state);
      return (
        indexOfEvent(state, RALTS_BENCHED_FROM_HAND) >= 0 &&
        chooseAttackName(policy, state) === "あふれるねがい"
      );
    },
    situation:
      "メガサーナイトex、2 番目の番。バトル場にメガサーナイトex(超エネルギー 1 個つき)。ベンチに 2 匹。手札にラルトス。山札に基本超エネルギーがある(作った場面)",
  },
];

/**
 * メガリザードン(DxKGxx-6pqCKy-xxJ8Yc)の後攻 2 番目の番。バトル場とベンチにヒトカゲ(048351)、手札にハイパーボール
 * (050461。050742 は同じ記録)、ポケパッド(050424。050743 は同じ記録)、リーリエの決心(049445。050468 は同じ記録)、
 * 基本炎エネルギー(050746)。混ぜ直しのテスト(`search-policy.test.ts`)のためだけの場面で、正しい手を判断していない
 * ため、局面(`SEARCH_POSITIONS`)には入れない。
 */
export function buildMegaCharizardSecondTurnState(
  arrangementSeed: number
): GameState {
  return buildPositionState(
    {
      active: { card: "charmander" },
      bench: [{ card: "charmander" }],
      deck: "megaCharizard",
      hand: ["ultraBall", "pokePad", "lillie", "fireEnergy"],
      turn: 2,
      wentFirst: false,
    },
    arrangementSeed
  );
}

/** 局面 id を作り、探索に選ばせて、正しい手を選んだかを返す。 */
export function playSearchPosition(
  position: SearchPosition,
  policy: SearchPolicy,
  arrangementSeed: number
): boolean {
  return position.judge(policy, position.build(arrangementSeed));
}

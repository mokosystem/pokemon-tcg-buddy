/**
 * 探索の 2 つの危うさを確かめる題材の局面 A〜F(docs/setup-rate-design.md「2 つの危うさを確かめる題材」)。
 * デッキは開発責任者のメガサーナイトex(xG8Kax-DHob4e-84xcca)。正しい手は #22 の規則ファイルの判断から取り、
 * 2026-09-26 に開発責任者が確認した。
 *
 * 局面は 60 枚から手札と場のカードを抜き、残りを arrangementSeed の乱数で並べて山札とサイドにする。山札とサイドの
 * 中身で正しい手が変わらないことを、並べ方を変えて確かめる。
 */

import { cardRecordTable } from "./card-record-table.ts";
import type { Card } from "./cards.ts";
import { resolveDeclaration } from "./declaration.ts";
import { buildDeck } from "./engine.ts";
import { ISSUE22_DECKS, MEGA_GARDEVOIR_DECLARATION } from "./issue22-decks.ts";
import { createSeededRandom } from "./random.ts";
import type { SearchPolicy } from "./search-policy.ts";
import { GameState, PokemonInPlay } from "./state.ts";

const MEGA_GARDEVOIR_DECK = ISSUE22_DECKS.find(
  (deck) => deck.deckCode === "xG8Kax-DHob4e-84xcca"
);
if (MEGA_GARDEVOIR_DECK === undefined) {
  throw new Error("メガサーナイトex のデッキが無い");
}

const MEGA_GARDEVOIR_CARDS: readonly Card[] = buildDeck(
  cardRecordTable,
  MEGA_GARDEVOIR_DECK.decklist
);

export const RESOLVED_MEGA_GARDEVOIR_DECLARATION = resolveDeclaration(
  MEGA_GARDEVOIR_DECLARATION,
  cardRecordTable
);

const CARD_IDS = {
  achroma: "045934",
  bossOrders: "050467",
  frillish: "047663",
  greatTree: "046040",
  kirlia: "049715",
  latias: "046248",
  lillie: "049445",
  megaGardevoir: "048464",
  meowth: "049694",
  psychicEnergy: "049463",
  ralts: "049714",
  rareCandy: "050462",
  specialRedCard: "050156",
  switchCard: "049602",
  ultraBall: "050461",
  yukari: "050083",
} as const;

type CardKey = keyof typeof CARD_IDS;

/** 場のポケモン。evolvedFrom は下にある進化前(たねから順に)。 */
interface PokemonSetup {
  readonly card: CardKey;
  readonly energies?: readonly CardKey[];
  readonly evolvedFrom?: readonly CardKey[];
}

interface PositionSetup {
  readonly active: PokemonSetup;
  readonly bench?: readonly PokemonSetup[];
  readonly hand: readonly CardKey[];
  /** サイドに置かないカード(山札にあることを局面の前提にするカード)。 */
  readonly keepInDeck?: readonly CardKey[];
  readonly turn: number;
  readonly wentFirst: boolean;
}

/** 60 枚から card を 1 枚抜く。 */
function takeCard(pool: Card[], key: CardKey): Card {
  const index = pool.findIndex(
    (candidate) => candidate.cardId === CARD_IDS[key]
  );
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
  const pool = [...MEGA_GARDEVOIR_CARDS];
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
  arrangeUnseen(state, pool, setup.keepInDeck ?? [], arrangementSeed);
  return state;
}

/** 対戦の準備の局面。手札 7 枚を抜き、残りを並べて山札にする(サイドは準備の後に置く)。 */
function buildSetupState(
  hand: readonly CardKey[],
  arrangementSeed: number
): GameState {
  const pool = [...MEGA_GARDEVOIR_CARDS];
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

function indexOfEvent(state: GameState, pattern: RegExp): number {
  return state.events.findIndex((event) => pattern.test(event));
}

function countInPlay(state: GameState, key: CardKey): number {
  return state
    .listPokemonInPlay()
    .filter((pokemon) => pokemon.card.cardId === CARD_IDS[key]).length;
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
          hand: ["bossOrders", "specialRedCard"],
          turn: 2,
          wentFirst: false,
        },
        seed
      ),
    correctPlay: "「メガシンフォニア」ではなく「あふれるねがい」を使う",
    id: "B",
    judge: (policy, state) =>
      policy.chooseAttack({ choices: policy, state })?.attack.name ===
      "あふれるねがい",
    situation:
      "2 番目の番。バトル場に超エネルギー 1 個のメガサーナイトex、ベンチに 3 匹、山札に基本超エネルギー",
  },
  {
    build: (seed) => buildSetupState(SETUP_HAND, seed),
    correctPlay: "ニャースex をベンチに出さず手札に残す",
    id: "C",
    judge: (policy, state) => {
      const basics = state.hand.filter(
        (card) =>
          card.cardId === CARD_IDS.ralts || card.cardId === CARD_IDS.meowth
      );
      const active = policy.chooseActiveAtSetup(state, basics);
      const rest = [...basics];
      rest.splice(rest.indexOf(active), 1);
      const bench = policy.chooseBenchAtSetup(state, rest);
      return (
        active.cardId === CARD_IDS.ralts &&
        bench.every((card) => card.cardId !== CARD_IDS.meowth)
      );
    },
    situation: "対戦の準備。手札のたねポケモンがラルトスとニャースex",
  },
  {
    build: (seed) =>
      buildPositionState(
        {
          active: { card: "ralts" },
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
          hand: ["kirlia", "achroma", "bossOrders", "specialRedCard"],
          keepInDeck: ["greatTree", "kirlia", "megaGardevoir"],
          turn: 2,
          wentFirst: false,
        },
        seed
      ),
    correctPlay:
      "アクロマの執念で偉大な大樹を取って出し、大樹でラルトスをキルリア、メガサーナイトex と進化させる。手札のキルリアは先に乗せない",
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
          hand: ["ultraBall", "rareCandy", "frillish", "yukari", "bossOrders"],
          keepInDeck: ["megaGardevoir"],
          turn: 2,
          wentFirst: false,
        },
        seed
      ),
    correctPlay: "捨てる 2 枚にふしぎなアメを選ばない",
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
];

/** 局面 id を作り、探索に選ばせて、正しい手を選んだかを返す。 */
export function playSearchPosition(
  position: SearchPosition,
  policy: SearchPolicy,
  arrangementSeed: number
): boolean {
  return position.judge(policy, position.build(arrangementSeed));
}

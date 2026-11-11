/**
 * 1 回の対戦風の一人回しの準備と進行。自分の番と相手の番を交互に、勝敗が決まるまで進める。
 *
 * 番の中で何をするか(プレイングの判断基準)はここでは決めず、PlayingPolicy として呼び出し側から受け取る。
 * 相手の攻撃、きぜつ、サイド、勝敗の判定は battle-style-solo-play-rules.ts の関数を呼ぶ。
 */

import {
  beginOwnTurn,
  playOpponentTurn,
  takePrizesForOpponentFieldDamage,
} from "./battle-style-solo-play-rules.ts";
import {
  listUsableAttacksOfActive,
  resolveEndOfTurnTriggers,
  useAttack,
} from "./card-effects.ts";
import type { CardRecord } from "./card-record-schema.ts";
import { buildCardFromRecord, type Card, isBasicPokemon } from "./cards.ts";
import {
  calculateBenchLimit,
  countEmptyBenchSlots,
  type UsableAttack,
} from "./continuous-effects.ts";
import type { EffectChoices, EffectContext } from "./effect-choices.ts";
import {
  type BattleStyleSoloPlayDecisionReason,
  type BattleTurn,
  GameState,
  HAND_SIZE_AT_SETUP,
  PRIZE_COUNT,
  type RandomSource,
} from "./state.ts";

/** デッキの 60 枚の内容の 1 行。カードは印刷のカード ID で指す(デッキコードの読み取りはカード ID を返す)。 */
export interface DecklistEntry {
  readonly cardId: string;
  readonly count: number;
}

export type Decklist = readonly DecklistEntry[];

/** カード ID → カードの記録。記録はどの印刷のカード ID からも引ける。 */
export type CardRecordTable = ReadonlyMap<string, CardRecord>;

/** 枚数を変えた比較用のデッキ。changes はカード ID → 増減枚数で、合計は 0 にする。 */
export interface DeckVariant {
  readonly changes: Readonly<Record<string, number>>;
  readonly label: string;
}

/**
 * 対戦の準備と番の中で、何を選ぶか。GLOSSARY.md「プレイングの判断基準」にあたる。決める点は、対戦の準備でバトル場と
 * ベンチに出すたねポケモン、番の中の行動、使うワザ、効果の中の選択、バトルポケモンがきぜつした後に出すベンチポケモン。
 * 後の 2 つは効果の実行の中から問い合わせるため EffectChoices に置き、ここではそれを継承する。
 */
export interface PlayingPolicy extends EffectChoices {
  /** 対戦の準備でバトル場に出すたねポケモン。basics は手札のたねポケモン。 */
  chooseActiveAtSetup: (state: GameState, basics: readonly Card[]) => Card;
  /** 使うワザ(使えるワザの一覧 listUsableAttacksOfActive の候補の 1 つ)。使わないときは undefined。先攻の最初の番は呼ばれない。 */
  chooseAttack: (context: EffectContext) => UsableAttack | undefined;
  /** 対戦の準備でベンチに出すたねポケモン。basics はバトル場に出した後の手札のたねポケモン。 */
  chooseBenchAtSetup: (
    state: GameState,
    basics: readonly Card[]
  ) => readonly Card[];
  /** 番の最初に 1 枚引いた後、ワザを選ぶ前までの行動をすべて行う。card-effects.ts の関数で行動する。 */
  playTurn: (context: EffectContext) => void;
}

/** デッキに入っているカード ID のうち、記録が無いもの。記録が無いカードがあるデッキは計算しない。 */
export class MissingCardRecordsError extends Error {
  readonly missingCardIds: readonly string[];

  constructor(missingCardIds: readonly string[]) {
    super(
      `カードの記録が無いカード ID があるため計算しない: ${missingCardIds.join("、")}`
    );
    this.name = "MissingCardRecordsError";
    this.missingCardIds = missingCardIds;
  }
}

/**
 * 60 枚の内容から、対戦で使うカードの並びを作る。記録が無いカード ID は全部集めて示して止める
 * (属性が分からないと、前提の文で何を含めていないかを正しく言えないため。
 * docs/solo-play-simulator-design.md「翻訳が無いカードと計算の前提」)。
 */
export function buildDeck(
  recordTable: CardRecordTable,
  decklist: Decklist
): Card[] {
  const cards: Card[] = [];
  const missing = new Set<string>();
  for (const { cardId, count } of decklist) {
    const record = recordTable.get(cardId);
    if (record === undefined) {
      missing.add(cardId);
    } else {
      const card = buildCardFromRecord(record, cardId);
      cards.push(...Array.from({ length: count }, () => card));
    }
  }
  if (missing.size > 0) {
    throw new MissingCardRecordsError([...missing]);
  }
  return cards;
}

export function applyVariant(
  decklist: Decklist,
  variant: DeckVariant
): DecklistEntry[] {
  const counts = new Map(decklist.map((entry) => [entry.cardId, entry.count]));
  for (const [cardId, delta] of Object.entries(variant.changes)) {
    const changed = (counts.get(cardId) ?? 0) + delta;
    if (changed < 0) {
      throw new Error(`${variant.label}: ${cardId} の枚数が負になる`);
    }
    counts.set(cardId, changed);
  }
  const changedDecklist = [...counts]
    .filter(([, count]) => count > 0)
    .map(([cardId, count]) => ({ cardId, count }));
  if (countCards(changedDecklist) !== countCards(decklist)) {
    throw new Error(`${variant.label}: 枚数の合計が元のデッキと違う`);
  }
  return changedDecklist;
}

function countCards(decklist: Decklist): number {
  return decklist.reduce((total, entry) => total + entry.count, 0);
}

/**
 * 番の終わりにワザを使う。使えるワザがある間だけ選ばせ、1 回使ったあとは 2 回目を使える効果(「おまつりおんど」)が
 * あるときだけもう一度選ばせる(使えるワザの一覧が空になれば終える)。
 */
function useAttacksOfTurn(context: EffectContext, policy: PlayingPolicy): void {
  while (listUsableAttacksOfActive(context).length > 0) {
    const attack = policy.chooseAttack(context);
    if (attack === undefined) {
      return;
    }
    useAttack(context, attack);
  }
}

/**
 * 対戦の準備。たねポケモンが無ければ引き直す。相手の引き直しによる追加の 1 枚は扱わない。
 * 準備でベンチに出したポケモンの「手札からベンチに出したとき」の特性は使えない(公式 Q&A「ニャースex」)
 * ため、card-effects.ts を通さずに基本操作で出す。
 */
export function setupGame(
  state: GameState,
  policy: Pick<PlayingPolicy, "chooseActiveAtSetup" | "chooseBenchAtSetup">
): void {
  state.shuffleDeck();
  state.draw(HAND_SIZE_AT_SETUP);
  while (!state.hand.some(isBasicPokemon)) {
    state.mulligans += 1;
    state.returnHandToDeck();
    state.draw(HAND_SIZE_AT_SETUP);
  }
  const active = policy.chooseActiveAtSetup(
    state,
    state.hand.filter(isBasicPokemon)
  );
  state.placeActiveFromHand(active);
  placeBenchAtSetup(
    state,
    policy.chooseBenchAtSetup(state, state.hand.filter(isBasicPokemon))
  );
  state.placePrizesFromDeck();
}

/** 対戦の準備で、手札のたねポケモンをベンチに出す。ベンチに空きが無くなったら残りは出さない。探索も同じ出し方で試す。 */
export function placeBenchAtSetup(
  state: GameState,
  cards: readonly Card[]
): void {
  for (const card of cards) {
    if (countEmptyBenchSlots(state) <= 0) {
      break;
    }
    state.placeOnBench(card, {
      benchLimit: calculateBenchLimit(state),
      from: "hand",
    });
  }
}

export interface BattleStyleSoloPlayGameOptions {
  /** 60 枚の内容。buildDeck で作る。 */
  readonly cards: readonly Card[];
  readonly policy: PlayingPolicy;
  readonly random: RandomSource;
  readonly wentFirst: boolean;
}

/** 1 回の対戦風の一人回しの結果。 */
export interface BattleStyleSoloPlayResult {
  readonly decidedTurn: BattleTurn;
  readonly events: readonly string[];
  /** 相手が取ったサイドの枚数。 */
  readonly opponentTakenPrizeCount: number;
  readonly outcome: "win" | "loss";
  readonly reason: BattleStyleSoloPlayDecisionReason;
  /** 自分が取ったサイドの枚数。 */
  readonly takenPrizeCount: number;
}

/**
 * 対戦をどこから続けるか。1 回の対戦を準備の後から進めるときと、探索が複製の上で先を試すときに使う。
 * - ownTurnStart: 自分の番の最初に 1 枚引くところから
 * - ownTurnActions: 自分の番に 1 枚引いた後。番の中の行動(PlayingPolicy の playTurn)から
 * - ownTurnAttack: 自分の番の行動を終えた後。ワザを選ぶところから
 * - opponentTurn: 自分の番の終わりのサイドの判定まで済んだ後。相手の番から
 */
export type BattleStyleSoloPlayResumePoint =
  | "ownTurnStart"
  | "ownTurnActions"
  | "ownTurnAttack"
  | "opponentTurn";

/** 続ける場所ごとの 1 歩。1 歩進めて、次に続ける場所を返す。勝敗が決まったかは呼んだ側が state.decision で見る。 */
const battleStyleSoloPlaySteps: {
  readonly [Point in BattleStyleSoloPlayResumePoint]: (
    context: EffectContext,
    policy: PlayingPolicy
  ) => BattleStyleSoloPlayResumePoint;
} = {
  opponentTurn: (context) => {
    playOpponentTurn(context);
    return "ownTurnStart";
  },
  ownTurnActions: (context, policy) => {
    policy.playTurn(context);
    return "ownTurnAttack";
  },
  ownTurnAttack: (context, policy) => {
    useAttacksOfTurn(context, policy);
    if (context.state.decision === undefined) {
      resolveEndOfTurnTriggers(context);
      takePrizesForOpponentFieldDamage(context.state);
    }
    return "opponentTurn";
  },
  ownTurnStart: ({ state }) => {
    beginOwnTurn(state);
    return "ownTurnActions";
  },
};

/**
 * from から進め、勝敗が決まるか、少なくとも 1 歩進めた後で stopAt に着いたら止める。止めた場所を返し、勝敗が決まったら
 * undefined を返す。stopAt を省くと勝敗が決まるまで進める(番の回数に上限は置かない。
 * docs/solo-play-simulator-design.md「対戦風の一人回し」の番の並び)。
 */
export function advanceBattleStyleSoloPlay(
  context: EffectContext,
  policy: PlayingPolicy,
  from: BattleStyleSoloPlayResumePoint,
  stopAt?: BattleStyleSoloPlayResumePoint
): BattleStyleSoloPlayResumePoint | undefined {
  let next = from;
  while (context.state.decision === undefined) {
    next = battleStyleSoloPlaySteps[next](context, policy);
    if (next === stopAt) {
      return context.state.decision === undefined ? next : undefined;
    }
  }
  return undefined;
}

/** from から勝敗が決まるまで進め、1 回の対戦の結果を返す。 */
export function continueBattleStyleSoloPlayGame(
  context: EffectContext,
  policy: PlayingPolicy,
  from: BattleStyleSoloPlayResumePoint
): BattleStyleSoloPlayResult {
  advanceBattleStyleSoloPlay(context, policy, from);
  return summarizeBattleStyleSoloPlay(context.state);
}

/**
 * 対戦の準備から勝敗が決まるまで進める。先攻なら自分の番から、後攻なら相手の番から交互に進める
 * (docs/solo-play-simulator-design.md「対戦風の一人回し」の番の並び)。
 */
export function runBattleStyleSoloPlayGame(
  options: BattleStyleSoloPlayGameOptions
): BattleStyleSoloPlayResult {
  const { policy } = options;
  const state = new GameState(options.random, options.cards, options.wentFirst);
  const context: EffectContext = { choices: policy, state };
  setupGame(state, policy);
  return continueBattleStyleSoloPlayGame(
    context,
    policy,
    state.wentFirst ? "ownTurnStart" : "opponentTurn"
  );
}

function summarizeBattleStyleSoloPlay(
  state: GameState
): BattleStyleSoloPlayResult {
  const { decision } = state;
  if (decision === undefined) {
    throw new Error("勝敗が決まる前に結果をまとめようとした");
  }
  return {
    decidedTurn: decision.decidedTurn,
    events: [...state.events],
    opponentTakenPrizeCount: PRIZE_COUNT - state.opponentRemainingPrizeCount,
    outcome: decision.reason === "ownPrizesTaken" ? "win" : "loss",
    reason: decision.reason,
    takenPrizeCount: PRIZE_COUNT - state.prizes.length,
  };
}

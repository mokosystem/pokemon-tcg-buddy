/**
 * 1 回の対戦(自分側だけ)の準備と進行。
 *
 * 番の中で何をするか(プレイングの判断基準)はここでは決めず、PlayingPolicy として
 * 呼び出し側から受け取る。#22 の規則ファイルにあった行動の優先順位の並びを移していないのは、
 * Issue 27 の順 7 で「宣言した狙いの成立確率を最大にする手を探索で選ぶ」形に置き換えるため。
 */

import { resolveEndOfTurnTriggers, useAttack } from "./card-effects.ts";
import type { CardRecord } from "./card-record-schema.ts";
import { buildCardFromRecord, type Card, isBasicPokemon } from "./cards.ts";
import type { EffectChoices, EffectContext } from "./effect-choices.ts";
import { GameState, HAND_SIZE_AT_SETUP, type RandomSource } from "./state.ts";

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
 * 対戦の準備と番の中で、何を選ぶか。CONTEXT.md「プレイングの判断基準」にあたる。
 * 効果の中の選択(EffectChoices)もここに含む。順 7 で探索に置き換えるまでは、テストと答え合わせが
 * 固定の手順をここに書く。
 */
export interface PlayingPolicy extends EffectChoices {
  chooseActiveAtSetup: (basics: readonly Card[]) => Card;
  /** 使うワザの名前。使わないときは null。先攻の最初の番は呼ばれない。 */
  chooseAttack: (context: EffectContext) => string | null;
  chooseBenchAtSetup: (basics: readonly Card[]) => readonly Card[];
  /** 番の最初に 1 枚引いた後、ワザを選ぶ前までの行動をすべて行う。card-effects.ts の関数で行動する。 */
  playTurn: (context: EffectContext) => void;
}

/** 狙い。番の終わり(ワザを使う前)の場を見て判定する。 */
export interface Goal {
  /** 成立しなかった番の場を見て、要因を短い語で返す。集計の内訳の見出しになる。 */
  readonly explainFailure: (state: GameState) => string;
  readonly isAchieved: (state: GameState) => boolean;
  readonly name: string;
}

export interface GameResult {
  /** 番 → 使ったワザの名前。 */
  readonly attacks: ReadonlyMap<number, string>;
  readonly events: readonly string[];
  /** 狙いごとの、成立しなかった番 → 要因。 */
  readonly failureLabels: ReadonlyMap<string, ReadonlyMap<number, string>>;
  /** 狙いごとの、最初に成立した番。maxTurn までに成立しなかったときは null。 */
  readonly goalFirstTurn: ReadonlyMap<string, number | null>;
  readonly mulligans: number;
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
 * docs/setup-rate-design.md「翻訳が無いカードと計算の前提」)。
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
  const active = policy.chooseActiveAtSetup(state.hand.filter(isBasicPokemon));
  state.placeActiveFromHand(active);
  for (const card of policy.chooseBenchAtSetup(
    state.hand.filter(isBasicPokemon)
  )) {
    if (state.countEmptyBenchSlots() <= 0) {
      break;
    }
    state.placeOnBench(card, { from: "hand" });
  }
  state.placePrizesFromDeck();
}

export interface RunGameOptions {
  /** 60 枚の内容。buildDeck で作る。 */
  readonly cards: readonly Card[];
  readonly goals: readonly Goal[];
  /** 何番目の自分の番まで進めるか。 */
  readonly maxTurn: number;
  readonly policy: PlayingPolicy;
  readonly random: RandomSource;
  readonly wentFirst: boolean;
}

interface GoalProgress {
  readonly failureLabels: Map<number, string>;
  firstTurn: number | null;
  readonly goal: Goal;
}

export function runGame(options: RunGameOptions): GameResult {
  const { policy, maxTurn } = options;
  const state = new GameState(options.random, options.cards, options.wentFirst);
  const context: EffectContext = { choices: policy, state };
  setupGame(state, policy);
  const progresses: GoalProgress[] = options.goals.map((goal) => ({
    failureLabels: new Map(),
    firstTurn: null,
    goal,
  }));
  for (let turnIndex = 0; turnIndex < maxTurn; turnIndex += 1) {
    state.beginTurn();
    policy.playTurn(context);
    for (const progress of progresses) {
      if (progress.firstTurn !== null) {
        continue;
      }
      if (progress.goal.isAchieved(state)) {
        progress.firstTurn = state.turn;
      } else {
        progress.failureLabels.set(
          state.turn,
          progress.goal.explainFailure(state)
        );
      }
    }
    if (state.canAttack()) {
      const attack = policy.chooseAttack(context);
      if (attack !== null) {
        useAttack(context, attack);
      }
    }
    resolveEndOfTurnTriggers(context);
  }
  return {
    attacks: new Map(state.attacks),
    events: [...state.events],
    failureLabels: new Map(
      progresses.map((progress) => [progress.goal.name, progress.failureLabels])
    ),
    goalFirstTurn: new Map(
      progresses.map((progress) => [progress.goal.name, progress.firstTurn])
    ),
    mulligans: state.mulligans,
  };
}

/**
 * 1 回の対戦(自分側だけ)の準備と進行。
 *
 * 番の中で何をするか(プレイングの判断基準)はここでは決めず、PlayingPolicy として
 * 呼び出し側から受け取る。#22 の規則ファイルにあった行動の優先順位の並びを移していないのは、
 * Issue 27 の順 7 で「宣言した狙いの成立確率を最大にする手を探索で選ぶ」形に置き換えるため。
 */

import { type Card, isBasicPokemon } from "./cards.ts";
import { GameState, HAND_SIZE_AT_SETUP, type RandomSource } from "./state.ts";

export interface DecklistEntry {
  readonly count: number;
  readonly name: string;
}

export type Decklist = readonly DecklistEntry[];

/** カード名 → カード。デッキの 60 枚の内容(Decklist)はこの表の名前で書く。 */
export type CardTable = ReadonlyMap<string, Card>;

/** 枚数を変えた比較用のデッキ。changes はカード名 → 増減枚数で、合計は 0 にする。 */
export interface DeckVariant {
  readonly changes: Readonly<Record<string, number>>;
  readonly label: string;
}

/**
 * 対戦の準備と番の中で、何を選ぶか。CONTEXT.md「プレイングの判断基準」にあたる。
 * 順 7 で探索に置き換えるまでは、テストと答え合わせが固定の手順をここに書く。
 */
export interface PlayingPolicy {
  chooseActiveAtSetup: (basics: readonly Card[]) => Card;
  /** 使うワザの名前。使わないときは null。先攻の最初の番は呼ばれない。 */
  chooseAttack: (state: GameState) => string | null;
  chooseBenchAtSetup: (basics: readonly Card[]) => readonly Card[];
  /** 番の最初に 1 枚引いた後、ワザを選ぶ前までの行動をすべて行う。 */
  playTurn: (state: GameState) => void;
  /** 番の終わりに働く効果(例: 番の終わりにトラッシュする特殊エネルギー)。 */
  resolveTurnEndEffects?: (state: GameState) => void;
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

export function buildDeck(cardTable: CardTable, decklist: Decklist): Card[] {
  const cards: Card[] = [];
  for (const { name, count } of decklist) {
    const card = cardTable.get(name);
    if (card === undefined) {
      throw new Error(`カード表に ${name} が無い`);
    }
    for (let copy = 0; copy < count; copy += 1) {
      cards.push(card);
    }
  }
  return cards;
}

export function applyVariant(
  decklist: Decklist,
  variant: DeckVariant
): DecklistEntry[] {
  const counts = new Map(decklist.map((entry) => [entry.name, entry.count]));
  for (const [name, delta] of Object.entries(variant.changes)) {
    const changed = (counts.get(name) ?? 0) + delta;
    if (changed < 0) {
      throw new Error(`${variant.label}: ${name} の枚数が負になる`);
    }
    counts.set(name, changed);
  }
  const changedDecklist = [...counts]
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ count, name }));
  if (countCards(changedDecklist) !== countCards(decklist)) {
    throw new Error(`${variant.label}: 枚数の合計が元のデッキと違う`);
  }
  return changedDecklist;
}

function countCards(decklist: Decklist): number {
  return decklist.reduce((total, entry) => total + entry.count, 0);
}

/** 対戦の準備。たねポケモンが無ければ引き直す。相手の引き直しによる追加の 1 枚は扱わない。 */
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
  setupGame(state, policy);
  const progresses: GoalProgress[] = options.goals.map((goal) => ({
    failureLabels: new Map(),
    firstTurn: null,
    goal,
  }));
  for (let turnIndex = 0; turnIndex < maxTurn; turnIndex += 1) {
    state.beginTurn();
    policy.playTurn(state);
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
      const attack = policy.chooseAttack(state);
      if (attack !== null) {
        state.attacks.set(state.turn, attack);
        state.record(`ワザ ${attack}`);
      }
    }
    policy.resolveTurnEndEffects?.(state);
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

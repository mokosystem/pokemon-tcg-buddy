/**
 * 対戦の自分側の状態と基本操作。
 *
 * 相手の行動は含めない。相手がいないため、サイドは 6 枚のまま減らず、
 * 自分のポケモンはきぜつしない。ルールの出典は docs/pokemon-tcg/basic-rules.md。
 */

import {
  type Card,
  CardCategory,
  EvolutionStage,
  isBasicPokemon,
  isEnergy,
  isPokemon,
  isSupporter,
} from "./cards.ts";

export const BENCH_LIMIT = 5;
export const HAND_SIZE_AT_SETUP = 7;
export const PRIZE_COUNT = 6;
export const COLORLESS = "colorless";

/**
 * 山札を切るための乱数の源。0 以上 1 未満の値を返す。
 * 種を指定できる生成器は乱数試行(Issue 27 の順 2 の 2 セッション目)で足す。
 */
export interface RandomSource {
  nextFloat: () => number;
}

export type CardPredicate = (card: Card) => boolean;

export type CardSource = "hand" | "deck";

/**
 * ワザに必要なエネルギー(タイプ名の並び。無色は colorless)を、ついているエネルギーの
 * 個数分(units)で払えるか。タイプ指定の分を先に埋め、残りを無色に充てる。
 */
export function canPayCost(
  cost: readonly string[],
  units: readonly string[]
): boolean {
  const remaining = [...units];
  for (const required of cost) {
    if (required === COLORLESS) {
      continue;
    }
    const index = remaining.indexOf(required);
    if (index < 0) {
      return false;
    }
    remaining.splice(index, 1);
  }
  const colorlessNeeded = cost.filter(
    (required) => required === COLORLESS
  ).length;
  return remaining.length >= colorlessNeeded;
}

/** 基本ルールに反する操作が要求されたときに投げる。呼び出し側の書き誤りを示す。 */
export class IllegalMove extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalMove";
  }
}

function removeFirst<T>(items: T[], item: T, zone: string): void {
  const index = items.indexOf(item);
  if (index < 0) {
    throw new IllegalMove(`${zone}に ${String(item)} が無い`);
  }
  items.splice(index, 1);
}

function removeCard(cards: Card[], card: Card, zone: string): void {
  const index = cards.indexOf(card);
  if (index < 0) {
    throw new IllegalMove(`${zone}に ${card.name} が無い`);
  }
  cards.splice(index, 1);
}

export class PokemonInPlay {
  card: Card;
  readonly turnEntered: number;
  turnEvolved = -1;
  readonly energies: Card[] = [];
  readonly underneath: Card[] = [];

  constructor(card: Card, turnEntered: number) {
    this.card = card;
    this.turnEntered = turnEntered;
  }

  get name(): string {
    return this.card.name;
  }

  /** この番に場に出た、またはこの番に進化したポケモンは進化できない。 */
  isFresh(turn: number): boolean {
    return this.turnEntered === turn || this.turnEvolved === turn;
  }

  countEnergy(energyType: string): number {
    return this.energies.filter((energy) =>
      energy.provides.includes(energyType)
    ).length;
  }
}

export class GameState {
  readonly random: RandomSource;
  deck: Card[];
  hand: Card[] = [];
  readonly prizes: Card[] = [];
  readonly discard: Card[] = [];
  active: PokemonInPlay | null = null;
  readonly bench: PokemonInPlay[] = [];
  stadium: Card | null = null;
  readonly wentFirst: boolean;
  turn = 0;
  mulligans = 0;
  // 真偽値の欄の初期値を宣言に書かず constructor で代入しているのは、Biome が `= false` を
  // false 型と推論し、この欄を条件に使う箇所を noUnnecessaryConditions で誤検出するため。
  hasUsedSupporter: boolean;
  hasAttachedEnergy: boolean;
  hasPlayedStadium: boolean;
  hasRetreated: boolean;
  readonly usedOncePerTurn = new Set<string>();
  readonly attacks = new Map<number, string>();
  readonly events: string[] = [];

  constructor(
    random: RandomSource,
    cards: readonly Card[],
    wentFirst: boolean
  ) {
    this.random = random;
    this.deck = [...cards];
    this.wentFirst = wentFirst;
    this.hasUsedSupporter = false;
    this.hasAttachedEnergy = false;
    this.hasPlayedStadium = false;
    this.hasRetreated = false;
  }

  // ---- 記録 ----

  record(event: string): void {
    this.events.push(`[${this.turn}] ${event}`);
  }

  // ---- 問い合わせ ----

  listPokemonInPlay(): PokemonInPlay[] {
    return this.active ? [this.active, ...this.bench] : [...this.bench];
  }

  countInPlay(name: string): number {
    return this.findAllInPlay(name).length;
  }

  findAllInPlay(name: string): PokemonInPlay[] {
    return this.listPokemonInPlay().filter((pokemon) => pokemon.name === name);
  }

  countInHand(name: string): number {
    return countByName(this.hand, name);
  }

  findFirstInHand(name: string): Card | null {
    return this.hand.find((card) => card.name === name) ?? null;
  }

  /**
   * 山札とサイドにある枚数。プレイヤーが知りうるのはこの合計までで、山札にあるか
   * サイドにあるかは区別できない。行動を選ぶ判断にはこちらを使う。
   */
  countUnseen(name: string): number {
    return countByName(this.deck, name) + countByName(this.prizes, name);
  }

  /** 山札にある枚数。山札を見てよい効果(検索)の実行と、失敗要因の事後分析にだけ使う。 */
  countInDeck(name: string): number {
    return countByName(this.deck, name);
  }

  countInPrizes(name: string): number {
    return countByName(this.prizes, name);
  }

  countInDiscard(name: string): number {
    return countByName(this.discard, name);
  }

  countEmptyBenchSlots(): number {
    return BENCH_LIMIT - this.bench.length;
  }

  isFirstTurnGoingFirst(): boolean {
    return this.wentFirst && this.turn === 1;
  }

  canUseSupporter(): boolean {
    return !(this.hasUsedSupporter || this.isFirstTurnGoingFirst());
  }

  canAttack(): boolean {
    return this.active !== null && !this.isFirstTurnGoingFirst();
  }

  canEvolve(target: PokemonInPlay, card: Card): boolean {
    return (
      this.turn >= 2 &&
      isPokemon(card) &&
      card.evolvesFrom === target.name &&
      !target.isFresh(this.turn)
    );
  }

  // ---- 山札 ----

  shuffleDeck(): void {
    // Fisher-Yates。後ろから順に、まだ決めていない範囲から 1 枚を選んで入れ替える。
    for (let index = this.deck.length - 1; index > 0; index -= 1) {
      const other = Math.floor(this.random.nextFloat() * (index + 1));
      const card = this.deck[index];
      const swapped = this.deck[other];
      if (card !== undefined && swapped !== undefined) {
        this.deck[index] = swapped;
        this.deck[other] = card;
      }
    }
  }

  draw(count: number): Card[] {
    const drawn = this.deck.splice(0, count);
    this.hand.push(...drawn);
    return drawn;
  }

  findInDeck(predicate: CardPredicate): Card | null {
    return this.deck.find(predicate) ?? null;
  }

  takeFromDeckToHand(card: Card): void {
    removeCard(this.deck, card, "山札");
    this.hand.push(card);
  }

  /** 条件ごとに 1 枚ずつ山札から手札に加え、最後に山札を切る。見つからない条件は飛ばす。 */
  searchDeckToHand(predicates: readonly CardPredicate[]): Card[] {
    const found: Card[] = [];
    for (const predicate of predicates) {
      const card = this.findInDeck(predicate);
      if (card !== null) {
        this.takeFromDeckToHand(card);
        found.push(card);
      }
    }
    this.shuffleDeck();
    return found;
  }

  /** 山札の上から count 枚を見て、条件に合う 1 枚を手札に加える。残りは山札に戻して切る。 */
  revealTopAndTake(count: number, predicate: CardPredicate): Card | null {
    const taken = this.deck.slice(0, count).find(predicate) ?? null;
    if (taken !== null) {
      removeCard(this.deck, taken, "山札");
      this.hand.push(taken);
    }
    this.shuffleDeck();
    return taken;
  }

  /** 山札の上から count 枚を見て、rank が最も小さい 1 枚を手札に加え、残りを山札の下に戻す。 */
  lookAtTopAndTakeOne(
    count: number,
    rank: (card: Card) => number
  ): Card | null {
    const top = this.deck.splice(0, count);
    let taken: Card | null = null;
    for (const card of top) {
      if (taken === null || rank(card) < rank(taken)) {
        taken = card;
      }
    }
    if (taken === null) {
      return null;
    }
    this.hand.push(taken);
    this.deck.push(...top.filter((card) => card !== taken));
    return taken;
  }

  /**
   * 場のポケモンを、ついているカードごと山札に戻して切る。バトル場のポケモンを戻したときは、
   * 呼び出し側が次のバトルポケモンを選ぶ(相手がいないため、選ばなくてもよい)。
   */
  returnPokemonToDeck(target: PokemonInPlay): void {
    if (target === this.active) {
      this.active = null;
    } else {
      removeFirst(this.bench, target, "ベンチ");
    }
    this.deck.push(target.card, ...target.underneath, ...target.energies);
    this.shuffleDeck();
    this.record(`${target.name} を山札に戻す`);
  }

  returnHandToDeck(): void {
    this.deck.push(...this.hand);
    this.hand = [];
    this.shuffleDeck();
  }

  // ---- 手札からの操作 ----

  discardFromHand(cards: readonly Card[]): void {
    for (const card of cards) {
      removeCard(this.hand, card, "手札");
      this.discard.push(card);
    }
  }

  useGoods(card: Card): void {
    if (card.category !== CardCategory.Goods) {
      throw new IllegalMove(`${card.name} はグッズではない`);
    }
    this.discardFromHand([card]);
    this.record(`グッズ ${card.name}`);
  }

  useSupporter(card: Card): void {
    if (!isSupporter(card)) {
      throw new IllegalMove(`${card.name} はサポートではない`);
    }
    if (!this.canUseSupporter()) {
      throw new IllegalMove("この番はサポートを使えない");
    }
    this.hasUsedSupporter = true;
    this.discardFromHand([card]);
    this.record(`サポート ${card.name}`);
  }

  playStadium(card: Card): void {
    if (card.category !== CardCategory.Stadium) {
      throw new IllegalMove(`${card.name} はスタジアムではない`);
    }
    if (this.hasPlayedStadium) {
      throw new IllegalMove("この番はもうスタジアムを出した");
    }
    if (this.stadium?.name === card.name) {
      throw new IllegalMove("同じ名前のスタジアムは出せない");
    }
    if (this.stadium !== null) {
      this.discard.push(this.stadium);
    }
    removeCard(this.hand, card, "手札");
    this.stadium = card;
    this.hasPlayedStadium = true;
    this.record(`スタジアム ${card.name}`);
  }

  /**
   * byEffect はカードの効果で進化ポケモンを直接ベンチに出すとき
   * (例: ファイアローex の特性)に真にする。
   */
  placeOnBench(
    card: Card,
    options: { from: CardSource; byEffect?: boolean }
  ): PokemonInPlay {
    if (!(isPokemon(card) && (isBasicPokemon(card) || options.byEffect))) {
      throw new IllegalMove(`${card.name} はたねポケモンではない`);
    }
    if (this.countEmptyBenchSlots() <= 0) {
      throw new IllegalMove("ベンチに空きがない");
    }
    this.removeFrom(options.from, card);
    const pokemon = new PokemonInPlay(card, this.turn);
    this.bench.push(pokemon);
    this.record(
      `ベンチ ${card.name}${options.from === "hand" ? "" : "(山札から)"}`
    );
    return pokemon;
  }

  attachEnergyFromHand(card: Card, target: PokemonInPlay): void {
    if (!isEnergy(card)) {
      throw new IllegalMove(`${card.name} はエネルギーではない`);
    }
    if (this.hasAttachedEnergy) {
      throw new IllegalMove("この番はもう手札からエネルギーをつけた");
    }
    removeCard(this.hand, card, "手札");
    target.energies.push(card);
    this.hasAttachedEnergy = true;
    this.record(`エネルギー ${card.name} → ${target.name}`);
  }

  /** ワザや特性の効果で山札からつける。手札からつける 1 回の制限には数えない。 */
  attachEnergyFromDeck(card: Card, target: PokemonInPlay): void {
    removeCard(this.deck, card, "山札");
    target.energies.push(card);
    this.record(`エネルギー ${card.name} → ${target.name}(山札から)`);
  }

  evolve(
    target: PokemonInPlay,
    card: Card,
    options: { from: CardSource; ignoreFreshness?: boolean }
  ): void {
    if (this.turn < 2) {
      throw new IllegalMove("自分の最初の番は進化できない");
    }
    if (card.evolvesFrom !== target.name) {
      throw new IllegalMove(`${card.name} は ${target.name} から進化しない`);
    }
    if (target.isFresh(this.turn) && !options.ignoreFreshness) {
      throw new IllegalMove(
        `${target.name} はこの番に場に出た/進化したため進化できない`
      );
    }
    this.replacePokemon(target, card, options.from);
  }

  /** ふしぎなアメの進化。たねから 1 進化を飛ばして 2 進化にする。 */
  evolveSkippingStage1(
    target: PokemonInPlay,
    stage2: Card,
    stage1Name: string
  ): void {
    if (this.turn < 2) {
      throw new IllegalMove("自分の最初の番は進化できない");
    }
    if (
      target.card.stage !== EvolutionStage.Basic ||
      stage2.stage !== EvolutionStage.Stage2
    ) {
      throw new IllegalMove("たねから 2 進化への進化ではない");
    }
    if (stage2.evolvesFrom !== stage1Name) {
      throw new IllegalMove(`${stage2.name} は ${stage1Name} から進化しない`);
    }
    if (target.isFresh(this.turn)) {
      throw new IllegalMove(
        `${target.name} はこの番に場に出たため進化できない`
      );
    }
    this.replacePokemon(target, stage2, "hand");
  }

  private replacePokemon(
    target: PokemonInPlay,
    card: Card,
    from: CardSource
  ): void {
    this.removeFrom(from, card);
    target.underneath.push(target.card);
    this.record(
      `進化 ${target.name} → ${card.name}${from === "hand" ? "" : "(山札から)"}`
    );
    target.card = card;
    target.turnEvolved = this.turn;
  }

  private removeFrom(source: CardSource, card: Card): void {
    if (source === "hand") {
      removeCard(this.hand, card, "手札");
    } else {
      removeCard(this.deck, card, "山札");
    }
  }

  // ---- バトル場の入れ替え ----

  switchActive(benchPokemon: PokemonInPlay): void {
    if (this.active === null || !this.bench.includes(benchPokemon)) {
      throw new IllegalMove("入れ替える相手がいない");
    }
    removeFirst(this.bench, benchPokemon, "ベンチ");
    this.bench.push(this.active);
    this.active = benchPokemon;
    this.record(`バトル場 ← ${benchPokemon.name}`);
  }

  retreat(benchPokemon: PokemonInPlay, cost: number): void {
    if (this.hasRetreated) {
      throw new IllegalMove("この番はもうにげた");
    }
    if (this.active === null || this.active.energies.length < cost) {
      throw new IllegalMove("にげるためのエネルギーが足りない");
    }
    this.discard.push(...this.active.energies.splice(-cost, cost));
    this.hasRetreated = true;
    this.record(`にげる(${cost})`);
    this.switchActive(benchPokemon);
  }

  // ---- 番の進行 ----

  beginTurn(): void {
    this.turn += 1;
    this.hasUsedSupporter = false;
    this.hasAttachedEnergy = false;
    this.hasPlayedStadium = false;
    this.hasRetreated = false;
    this.usedOncePerTurn.clear();
    if (this.deck.length === 0) {
      throw new IllegalMove("山札が無く引けない");
    }
    const [drawn] = this.draw(1);
    this.record(`番の最初に引く: ${drawn?.name ?? ""}`);
  }
}

function countByName(cards: readonly Card[], name: string): number {
  return cards.filter((card) => card.name === name).length;
}

/**
 * 対戦の自分側の状態と基本操作。
 *
 * 相手の行動は含めない。相手がいないため、サイドは 6 枚のまま減らず、
 * 自分のポケモンはきぜつしない。ルールの出典は docs/pokemon-tcg/basic-rules.md。
 * カードの効果(何を探し、何を捨てるか)はここでは決めず、card-effects.ts が記録の翻訳に従って
 * この基本操作を呼ぶ。
 */

import {
  CardCategory,
  EvolutionStage,
  type PokemonInPlayFilter,
  type PokemonType,
} from "./card-record-schema.ts";
import {
  type Card,
  isBasicPokemon,
  isEnergy,
  isPokemon,
  isSupporter,
} from "./cards.ts";

export const BENCH_LIMIT = 5;
export const HAND_SIZE_AT_SETUP = 7;
export const PRIZE_COUNT = 6;
export const COLORLESS: PokemonType = "colorless";

/** エネルギー 1 個ぶんのタイプ。any はすべてのタイプとして働く 1 個(レガシーエネルギーなど)。 */
export type EnergyUnit = PokemonType | "any";

/** 山札を切るための乱数の源。0 以上 1 未満の値を返す。種を指定できる生成器は random.ts にある。 */
export interface RandomSource {
  nextFloat: () => number;
}

export type CardSource = "hand" | "deck" | "discard";

/** 山札の上から見たカードのうち、選ばなかった残りの扱い(card-record-schema.ts の restPlacement)。 */
export type DeckTopRestPlacement =
  | "shuffleIntoDeck"
  | "bottomOfDeck"
  | "shuffleThenBottomOfDeck";

/** この番だけ、条件に合うポケモンが使うワザのダメージを増やす効果(card-record-schema.ts の increaseAttackDamageThisTurn)。 */
export interface AttackDamageIncrease {
  readonly amount: number;
  readonly attackerFilter: PokemonInPlayFilter;
}

/**
 * ワザに必要なエネルギー(タイプの並び。無色は colorless)を、ついているエネルギーの
 * 個数分(units)で払えるか。タイプ指定の分を同じタイプで先に埋め、足りなければすべてのタイプとして
 * 働く 1 個を充て、残りを無色に充てる。すべてのタイプとして働く 1 個を後に回すのは、同じタイプの
 * 1 個で埋められる指定にそれを使うと、別のタイプの指定を埋められなくなるため。
 */
export function canPayCost(
  cost: readonly PokemonType[],
  units: readonly EnergyUnit[]
): boolean {
  const remaining = [...units];
  const typedCost = cost.filter((required) => required !== COLORLESS);
  const unmatched: PokemonType[] = [];
  for (const required of typedCost) {
    const index = remaining.indexOf(required);
    if (index < 0) {
      unmatched.push(required);
    } else {
      remaining.splice(index, 1);
    }
  }
  for (const _ of unmatched) {
    const index = remaining.indexOf("any");
    if (index < 0) {
      return false;
    }
    remaining.splice(index, 1);
  }
  const colorlessNeeded = cost.length - typedCost.length;
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
  tool: Card | null = null;
  /** この番にこのポケモンが使った特性の名前。「番に 1 回」はポケモンごとに数える。 */
  readonly abilitiesUsedThisTurn = new Set<string>();

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

  /** このポケモンと、ついているカードすべて(進化前、エネルギー、どうぐ)。 */
  listCardsIncludingAttached(): Card[] {
    return [
      this.card,
      ...this.underneath,
      ...this.energies,
      ...(this.tool === null ? [] : [this.tool]),
    ];
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
  /** 今場にあるスタジアムの効果を、この番に使ったか。スタジアムが入れ替わったら戻す(`playStadium`)。 */
  hasUsedStadiumEffect: boolean;
  hasRetreated: boolean;
  /** この番に使った特性の名前(場全体)。同じ名前の特性の回数の制限と、名前に文字列を含む条件に使う。 */
  abilityNamesUsedThisTurn: string[] = [];
  /** この番に使った、ワザのダメージを増やす効果(パワープロテイン)。番の終わりのワザのダメージの判定に使う。 */
  attackDamageIncreasesThisTurn: AttackDamageIncrease[] = [];
  readonly attacks = new Map<number, string>();
  /** この番に 2 回目のワザ(「おまつりおんど」)を使ったか。1 回目は attacks に番があるかで分かる。 */
  hasUsedSecondAttack = false;
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
    this.hasUsedStadiumEffect = false;
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

  isFirstTurnGoingFirst(): boolean {
    return this.wentFirst && this.turn === 1;
  }

  /** usableOnFirstTurnGoingFirst は、先攻の最初の番でも使える印を持つサポート(ゼイユ)のときに真にする。 */
  canUseSupporter(
    options: { usableOnFirstTurnGoingFirst?: boolean } = {}
  ): boolean {
    return !(
      this.hasUsedSupporter ||
      (this.isFirstTurnGoingFirst() && !options.usableOnFirstTurnGoingFirst)
    );
  }

  /** ワザを使える番か。ワザごとのエネルギーの判定は card-effects.ts が場の効果を集めて行う。 */
  canAttack(): boolean {
    return this.active !== null && !this.isFirstTurnGoingFirst();
  }

  /** このポケモンを、この番に手札の進化ポケモンへ進化させられるか(最初の番、出したばかりの制限を含む)。 */
  canEvolve(target: PokemonInPlay, card: Card): boolean {
    return (
      this.canEvolveThisTurn(target) &&
      isPokemon(card) &&
      card.evolvesFrom === target.name
    );
  }

  canEvolveThisTurn(target: PokemonInPlay): boolean {
    return this.turn >= 2 && !target.isFresh(this.turn);
  }

  // ---- 山札 ----

  shuffleDeck(): void {
    this.shuffleCards(this.deck);
  }

  private shuffleCards(cards: Card[]): void {
    // Fisher-Yates。後ろから順に、まだ決めていない範囲から 1 枚を選んで入れ替える。
    for (let index = cards.length - 1; index > 0; index -= 1) {
      const other = Math.floor(this.random.nextFloat() * (index + 1));
      const card = cards[index];
      const swapped = cards[other];
      if (card !== undefined && swapped !== undefined) {
        cards[index] = swapped;
        cards[other] = card;
      }
    }
  }

  draw(count: number): Card[] {
    const drawn = this.deck.splice(0, count);
    this.hand.push(...drawn);
    return drawn;
  }

  takeFromDeckToHand(card: Card): void {
    removeCard(this.deck, card, "山札");
    this.hand.push(card);
  }

  /** 山札の上から count 枚をトラッシュする。山札が足りなければある分だけ。 */
  discardFromDeckTop(count: number): Card[] {
    const discarded = this.deck.splice(0, count);
    this.discard.push(...discarded);
    this.record(
      `山札の上から ${discarded.map((card) => card.name).join("、")} をトラッシュ`
    );
    return discarded;
  }

  /** 手札の chosen を、並びの順に山札の上に置く(先頭がいちばん上)。山札は切らない。 */
  placeHandCardsOnDeckTop(chosen: readonly Card[]): void {
    for (const card of chosen) {
      removeCard(this.hand, card, "手札");
    }
    this.deck.unshift(...chosen);
    this.record(
      `手札の ${chosen.map((card) => card.name).join("、")} を山札の上に置く`
    );
  }

  /**
   * 山札から chosen を取り出し、残りを切ってから、chosen を並びの順に山札の上に置く(先頭がいちばん上)。
   * 切ってから置くので、次に引くカードは chosen の順で決まる。
   */
  placeOnDeckTopAfterShuffle(chosen: readonly Card[]): void {
    for (const card of chosen) {
      removeCard(this.deck, card, "山札");
    }
    this.shuffleDeck();
    this.deck.unshift(...chosen);
    this.record(
      `山札の上に ${chosen.map((card) => card.name).join("、")} を置く`
    );
  }

  /** 山札の上から lookCount 枚のうち chosen を手札に加え、残りを restPlacement の通りに山札に戻す。 */
  takeFromDeckTop(
    lookCount: number,
    chosen: readonly Card[],
    restPlacement: DeckTopRestPlacement
  ): void {
    this.hand.push(...this.removeFromDeckTop(lookCount, chosen, restPlacement));
  }

  /** 山札の上から lookCount 枚のうち chosen(エネルギー)を target につけ、残りを restPlacement の通りに山札に戻す。 */
  attachFromDeckTop(
    lookCount: number,
    chosen: readonly Card[],
    target: PokemonInPlay,
    restPlacement: DeckTopRestPlacement
  ): void {
    if (!chosen.every(isEnergy)) {
      throw new IllegalMove("エネルギーではないカードをつけようとした");
    }
    for (const energy of this.removeFromDeckTop(
      lookCount,
      chosen,
      restPlacement
    )) {
      target.energies.push(energy);
      this.record(`エネルギー ${energy.name} → ${target.name}(山札の上から)`);
    }
  }

  /** 山札の上から lookCount 枚のうち、エネルギーをそれぞれの target につけ、残りを restPlacement の通りに山札に戻す。 */
  attachFromDeckTopToEach(
    lookCount: number,
    assignments: readonly { energy: Card; target: PokemonInPlay }[],
    restPlacement: DeckTopRestPlacement
  ): void {
    if (!assignments.every(({ energy }) => isEnergy(energy))) {
      throw new IllegalMove("エネルギーではないカードをつけようとした");
    }
    this.removeFromDeckTop(
      lookCount,
      assignments.map(({ energy }) => energy),
      restPlacement
    );
    for (const { energy, target } of assignments) {
      target.energies.push(energy);
      this.record(`エネルギー ${energy.name} → ${target.name}(山札の上から)`);
    }
  }

  /**
   * 山札の上から lookCount 枚を見て chosen を取り出し、残りを山札に戻す(切る、下に置く、切ってから下に置く)。
   * 同じカードは同じ参照を枚数分並べているため、参照ではなく位置で 1 枚ずつ除く。
   */
  private removeFromDeckTop(
    lookCount: number,
    chosen: readonly Card[],
    restPlacement: DeckTopRestPlacement
  ): Card[] {
    const looked = this.deck.splice(0, lookCount);
    for (const card of chosen) {
      removeCard(looked, card, "山札の上から見たカード");
    }
    if (restPlacement === "shuffleThenBottomOfDeck") {
      this.shuffleCards(looked);
    }
    this.deck.push(...looked);
    if (restPlacement === "shuffleIntoDeck") {
      this.shuffleDeck();
    }
    return [...chosen];
  }

  /**
   * 場のポケモンを、ついているカードごと山札に戻して切る。バトル場のポケモンを戻したときは、
   * 呼び出し側がベンチから次のバトルポケモンを出す(promoteToActive)。
   */
  returnPokemonToDeck(target: PokemonInPlay): void {
    this.removeFromPlay(target);
    this.deck.push(...target.listCardsIncludingAttached());
    this.shuffleDeck();
    this.record(`${target.name} を山札に戻す`);
  }

  /** 場のポケモンを、ついているカードごと手札に戻す。バトル場のときの扱いは returnPokemonToDeck と同じ。 */
  returnPokemonToHand(target: PokemonInPlay): void {
    this.removeFromPlay(target);
    this.hand.push(...target.listCardsIncludingAttached());
    this.record(`${target.name} を手札に戻す`);
  }

  private removeFromPlay(target: PokemonInPlay): void {
    if (target === this.active) {
      this.active = null;
    } else {
      removeFirst(this.bench, target, "ベンチ");
    }
  }

  discardHand(): void {
    this.discard.push(...this.hand);
    this.hand = [];
  }

  returnHandToDeck(): void {
    this.deck.push(...this.hand);
    this.hand = [];
    this.shuffleDeck();
  }

  // ---- 対戦の準備 ----

  /** 手札のたねポケモンをバトル場に出す。対戦の準備(番 0)でだけ使う。 */
  placeActiveFromHand(card: Card): PokemonInPlay {
    if (!isBasicPokemon(card)) {
      throw new IllegalMove(`${card.name} はたねポケモンではない`);
    }
    if (this.active !== null) {
      throw new IllegalMove("バトル場にはもうポケモンがいる");
    }
    removeCard(this.hand, card, "手札");
    const pokemon = new PokemonInPlay(card, this.turn);
    this.active = pokemon;
    this.record(`バトル場 ${card.name}`);
    return pokemon;
  }

  /** 山札の上から 6 枚をサイドに置く。 */
  placePrizesFromDeck(): void {
    this.prizes.push(...this.deck.splice(0, PRIZE_COUNT));
  }

  // ---- 手札からの操作 ----

  discardFromHand(cards: readonly Card[]): void {
    for (const card of cards) {
      removeCard(this.hand, card, "手札");
      this.discard.push(card);
    }
  }

  /** トラッシュの cards を山札に戻して切る。 */
  returnFromDiscardToDeck(cards: readonly Card[]): void {
    for (const card of cards) {
      removeCard(this.discard, card, "トラッシュ");
      this.deck.push(card);
    }
    this.shuffleDeck();
    this.record(
      `トラッシュの ${cards.map((card) => card.name).join("、")} を山札に戻す`
    );
  }

  takeFromDiscardToHand(card: Card): void {
    removeCard(this.discard, card, "トラッシュ");
    this.hand.push(card);
  }

  /**
   * グッズを使う基本処理(手札からトラッシュへ)。効果の翻訳は card-effects.ts がこの後に実行する。
   * 使っている間のカードを脇に置かずに先にトラッシュするのは、今の翻訳にトラッシュの中身を見る
   * グッズ・サポートが無く、脇に置いても結果が同じになるため。
   */
  useGoods(card: Card): void {
    if (card.category !== CardCategory.Goods) {
      throw new IllegalMove(`${card.name} はグッズではない`);
    }
    this.discardFromHand([card]);
    this.record(`グッズ ${card.name}`);
  }

  /** サポートを使う基本処理。効果の扱いは useGoods と同じ。 */
  useSupporter(
    card: Card,
    options: { usableOnFirstTurnGoingFirst?: boolean } = {}
  ): void {
    if (!isSupporter(card)) {
      throw new IllegalMove(`${card.name} はサポートではない`);
    }
    if (!this.canUseSupporter(options)) {
      throw new IllegalMove("この番はサポートを使えない");
    }
    this.hasUsedSupporter = true;
    this.discardFromHand([card]);
    this.record(`サポート ${card.name}`);
  }

  /** 場のスタジアムをトラッシュする(イーユイの「グラウンドメルト」)。 */
  discardStadium(): void {
    if (this.stadium === null) {
      return;
    }
    this.discard.push(this.stadium);
    this.record(`スタジアム ${this.stadium.name} をトラッシュ`);
    this.stadium = null;
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
    // 前のスタジアムの効果を使った番でも、新しく出したスタジアムの効果は使える(公式 Q&A: ポケモンパルシティの
    // 効果を使ったあと、トラッシュして手札から出し直したら、もう一度使えると回答。
    // https://www.pokemon-card.com/rules/faq/search.php?freeword=%E3%83%9D%E3%82%B1%E3%83%A2%E3%83%B3%E3%83%91%E3%83%AB%E3%82%B7%E3%83%86%E3%82%A3&regulation_faq_main_item1=all 、2026-09-23 に確認)
    this.hasUsedStadiumEffect = false;
    this.record(`スタジアム ${card.name}`);
  }

  /** ポケモンのどうぐをつける。1 匹につき 1 枚まで。 */
  attachToolFromHand(card: Card, target: PokemonInPlay): void {
    if (card.category !== CardCategory.Tool) {
      throw new IllegalMove(`${card.name} はポケモンのどうぐではない`);
    }
    if (target.tool !== null) {
      throw new IllegalMove(
        `${target.name} にはもうポケモンのどうぐがついている`
      );
    }
    removeCard(this.hand, card, "手札");
    target.tool = card;
    this.record(`どうぐ ${card.name} → ${target.name}`);
  }

  /**
   * byEffect はカードの効果で進化ポケモンを直接ベンチに出すとき
   * (例: ファイアローex の特性)に真にする。benchLimit はベンチに出せるポケモンの数で、
   * 場にある間ずっと働く効果で変わる(continuous-effects.ts の calculateBenchLimit)。
   */
  placeOnBench(
    card: Card,
    options: { benchLimit: number; byEffect?: boolean; from: CardSource }
  ): PokemonInPlay {
    if (!(isPokemon(card) && (isBasicPokemon(card) || options.byEffect))) {
      throw new IllegalMove(`${card.name} はたねポケモンではない`);
    }
    if (this.bench.length >= options.benchLimit) {
      throw new IllegalMove("ベンチに空きがない");
    }
    this.removeFrom(options.from, card);
    const pokemon = new PokemonInPlay(card, this.turn);
    this.bench.push(pokemon);
    this.record(`ベンチ ${card.name}${sourceLabel(options.from)}`);
    return pokemon;
  }

  /** 手札からエネルギーをつける(1 番に 1 回)。 */
  attachEnergyFromHand(card: Card, target: PokemonInPlay): void {
    if (this.hasAttachedEnergy) {
      throw new IllegalMove("この番はもう手札からエネルギーをつけた");
    }
    this.attachEnergyByEffect(card, target, "hand");
    this.hasAttachedEnergy = true;
  }

  /** ワザや特性の効果でつける。手札からつける 1 回の制限には数えない。 */
  attachEnergyByEffect(
    card: Card,
    target: PokemonInPlay,
    from: CardSource
  ): void {
    if (!isEnergy(card)) {
      throw new IllegalMove(`${card.name} はエネルギーではない`);
    }
    this.removeFrom(from, card);
    target.energies.push(card);
    this.record(`エネルギー ${card.name} → ${target.name}${sourceLabel(from)}`);
  }

  discardAttachedEnergy(target: PokemonInPlay, energy: Card): void {
    removeCard(target.energies, energy, `${target.name} のエネルギー`);
    this.discard.push(energy);
  }

  /** ポケモンについているエネルギーを、別のポケモンにつけ替える。手札からつける番に 1 回には数えない。 */
  moveAttachedEnergy(
    from: PokemonInPlay,
    to: PokemonInPlay,
    energy: Card
  ): void {
    if (from === to) {
      throw new IllegalMove("同じポケモンにはつけ替えられない");
    }
    removeCard(from.energies, energy, `${from.name} のエネルギー`);
    to.energies.push(energy);
    this.record(`エネルギー ${energy.name} を ${from.name} → ${to.name}`);
  }

  /** ベンチのポケモンを、ついているカードごとトラッシュする(ベンチの上限を超えたとき。きぜつではない)。 */
  discardBenchedPokemon(target: PokemonInPlay): void {
    removeFirst(this.bench, target, "ベンチ");
    this.discard.push(...target.listCardsIncludingAttached());
    this.record(`ベンチの ${target.name} をトラッシュ`);
  }

  /**
   * asIfNamed は、進化前の名前をこの名前として照らし合わせるとき(イーブイex の「にじいろDNA」)に渡す。
   * 渡してよいかは呼び出し側が場にある間ずっと働く効果で確かめる(card-effects.ts の canEvolvePokemonFromHand)。
   */
  evolve(
    target: PokemonInPlay,
    card: Card,
    options: { asIfNamed?: string; from: CardSource; ignoreFreshness?: boolean }
  ): void {
    if (this.turn < 2) {
      throw new IllegalMove("自分の最初の番は進化できない");
    }
    if (card.evolvesFrom !== (options.asIfNamed ?? target.name)) {
      throw new IllegalMove(`${card.name} は ${target.name} から進化しない`);
    }
    if (target.isFresh(this.turn) && !options.ignoreFreshness) {
      throw new IllegalMove(
        `${target.name} はこの番に場に出た/進化したため進化できない`
      );
    }
    this.replacePokemon(target, card, options.from);
  }

  /** ふしぎなアメの進化。たねから 1進化を飛ばして、手札の 2進化にする。 */
  evolveSkippingStage1(target: PokemonInPlay, stage2: Card): void {
    if (!this.canEvolveThisTurn(target)) {
      throw new IllegalMove(
        `${target.name} は最初の番か、この番に場に出たため進化できない`
      );
    }
    if (
      target.card.stage !== EvolutionStage.Basic ||
      stage2.stage !== EvolutionStage.Stage2
    ) {
      throw new IllegalMove("たねから 2進化への進化ではない");
    }
    if (stage2.basicPokemonOfEvolutionLine !== target.name) {
      throw new IllegalMove(
        `${stage2.name} は ${target.name} の進化の系統ではない`
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
    this.record(`進化 ${target.name} → ${card.name}${sourceLabel(from)}`);
    target.card = card;
    target.turnEvolved = this.turn;
  }

  private removeFrom(source: CardSource, card: Card): void {
    const zones = { deck: this.deck, discard: this.discard, hand: this.hand };
    removeCard(zones[source], card, sourceZoneName[source]);
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

  /** バトル場が空になったときに、ベンチのポケモンをバトル場に出す。 */
  promoteToActive(benchPokemon: PokemonInPlay): void {
    if (this.active !== null) {
      throw new IllegalMove("バトル場にはもうポケモンがいる");
    }
    removeFirst(this.bench, benchPokemon, "ベンチ");
    this.active = benchPokemon;
    this.record(`バトル場に出す ${benchPokemon.name}`);
  }

  /** にげる。トラッシュするエネルギーが足りるか(にげるエネルギーの判定)は card-effects.ts が場の効果を集めて行う。 */
  retreat(
    benchPokemon: PokemonInPlay,
    energiesToDiscard: readonly Card[]
  ): void {
    if (this.hasRetreated) {
      throw new IllegalMove("この番はもうにげた");
    }
    const { active } = this;
    if (active === null) {
      throw new IllegalMove("バトル場にポケモンがいない");
    }
    for (const energy of energiesToDiscard) {
      this.discardAttachedEnergy(active, energy);
    }
    this.hasRetreated = true;
    this.record(`にげる(${energiesToDiscard.length} 枚トラッシュ)`);
    this.switchActive(benchPokemon);
  }

  // ---- この番だけ働く効果 ----

  increaseAttackDamageThisTurn(increase: AttackDamageIncrease): void {
    this.attackDamageIncreasesThisTurn.push(increase);
  }

  // ---- 番の進行 ----

  beginTurn(): void {
    this.turn += 1;
    this.hasUsedSupporter = false;
    this.hasAttachedEnergy = false;
    this.hasPlayedStadium = false;
    this.hasUsedStadiumEffect = false;
    this.hasRetreated = false;
    this.hasUsedSecondAttack = false;
    this.abilityNamesUsedThisTurn = [];
    this.attackDamageIncreasesThisTurn = [];
    for (const pokemon of this.listPokemonInPlay()) {
      pokemon.abilitiesUsedThisTurn.clear();
    }
    if (this.deck.length === 0) {
      throw new IllegalMove("山札が無く引けない");
    }
    const [drawn] = this.draw(1);
    this.record(`番の最初に引く: ${drawn?.name ?? ""}`);
  }
}

const sourceZoneName: Readonly<Record<CardSource, string>> = {
  deck: "山札",
  discard: "トラッシュ",
  hand: "手札",
};

function sourceLabel(source: CardSource): string {
  return source === "hand" ? "" : `(${sourceZoneName[source]}から)`;
}

function countByName(cards: readonly Card[], name: string): number {
  return cards.filter((card) => card.name === name).length;
}

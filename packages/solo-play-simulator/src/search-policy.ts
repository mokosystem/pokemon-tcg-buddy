/**
 * 探索によるプレイングの判断基準(Issue 27 の順 7)。宣言した狙いの成立確率の合計を最大にする手を、状態を複製して
 * 試しながら 1 手ずつ選ぶ。形の理由は docs/setup-rate-design.md「宣言と探索(Issue 27 の順 7)」の「探索の形」にある。
 *
 * - 番の中は、今できる行動の一覧の行動ごとに状態を複製して行い、評価の高い行動を実際に行う。「番を終える」が
 *   いちばん高ければ終える
 * - 効果の中の選択(何を捨て、何を探すか)は、行動の前の状態を複製してそこまでの選択を再生し、候補を 1 つ入れて
 *   効果を最後まで行って評価する。効果の実行(runEffect)は途中で止めて再開できないため
 * - 探索は山札の順とサイドの中身を知らない。複製で先を試すときは、見えていないカードを混ぜ直し、実際の対戦とは
 *   別の乱数に差し替えてから試す。結果が見えていないカードやコインで決まった行動は、混ぜ直しを変えて数回試して平均する
 */

import {
  listUsableAttacksOfActive,
  resolveEndOfTurnTriggers,
  useAttack,
} from "./card-effects.ts";
import type { Card } from "./cards.ts";
import {
  isMainAttackCandidate,
  type ResolvedDeclaration,
} from "./declaration.ts";
import {
  type CardChoiceRequest,
  type EffectChoices,
  type EffectContext,
  firstCandidateChoices,
  hasDistinctProvidedTypes,
  type PokemonChoiceRequest,
} from "./effect-choices.ts";
import { type PlayingPolicy, placeBenchAtSetup } from "./engine.ts";
import {
  listAvailableActions,
  type PlayerAction,
  performAction,
} from "./player-actions.ts";
import { SeededRandom } from "./random.ts";
import {
  BENCH_LIMIT,
  type GameState,
  type PokemonInPlay,
  type RandomSource,
} from "./state.ts";

/** 探索が数えた仕事の量。1 回の試行あたりの複製と評価の回数を記録するために持つ。 */
export interface SearchStatistics {
  /** 状態を複製した回数。 */
  clones: number;
  /** 評価を呼んだ回数。 */
  evaluations: number;
}

export interface EvaluationInput {
  /**
   * 判定がまだ済んでいない最初の番。番の中の行動を比べるときはその番、ワザを比べるときは次の番(その番の狙いは
   * ワザの前に判定済み)、対戦の準備では 1。これより前の締め切りは評価に含めない。
   */
  readonly fromTurn: number;
  /** 評価が乱数を使うとき(次の番を試す評価)の種。同じ場面で比べる候補には同じ種を渡す。 */
  readonly seed: number;
  /** 評価する状態が番のどこにあるか。次の番を試す評価が、試しをどこから始めるかを決めるのに使う。 */
  readonly stage: TurnStage;
  /** 評価する状態。評価は状態を変えない(試すときは複製する)。 */
  readonly state: GameState;
  /** 評価の中で状態を複製したり評価を呼んだりしたら、ここに数える。 */
  readonly statistics: SearchStatistics;
}

/**
 * 評価する状態が番のどこにあるか。
 * - actionsRemain: fromTurn の番の中で、この後も行動を続けられる(番の中の行動を試した後)
 * - actionsDone: fromTurn の番の行動を終えた(「番を終える」を試すとき)。狙いの判定とワザはまだ
 * - beforeDraw: fromTurn の番の最初の 1 枚を引く前(ワザを試して次の番に進めた後、対戦の準備)
 */
export type TurnStage = "actionsRemain" | "actionsDone" | "beforeDraw";

/** 状態の良さ。大きいほど良い。宣言の狙い(3 段 × 締め切り)の成立確率の合計の見積もりにする。 */
export type Evaluator = (input: EvaluationInput) => number;

export interface SearchOptions {
  /**
   * 結果が見えていないカードやコインで決まる行動を、混ぜ直しを変えて何回試して平均するか。結果がそれらで決まらない
   * 行動(ベンチに出す、進化させる、エネルギーをつける)は 1 回だけ試す。
   */
  readonly samplesForUncertainOutcome: number;
  /**
   * 効果の中の選択を、候補を再生して試して選ぶか。偽なら候補の先頭から選ぶ(次の番を試す評価が、試しの中で使う軽い探索)。
   */
  readonly searchesEffectChoices: boolean;
  /** 探索が使う乱数の種。実際の対戦の乱数とは別に持ち、探索が試した回数で実際の対戦の山札の順が変わらないようにする。 */
  readonly seed: number;
}

export interface SearchPolicy extends PlayingPolicy {
  readonly statistics: SearchStatistics;
}

/** 番の中で同じことを繰り返していないかの歯止め。1 つの番の行動はカードの枚数と番に 1 回の制限で有限になる。 */
const MAX_ACTIONS_PER_TURN = 100;

/** 評価の差がこれ以下なら同じとみなし、先に並んだ候補(番を終える、使わない、を含む)を選ぶ。 */
const EVALUATION_TOLERANCE = 1e-9;

/** 状態に対して行う 1 つの行動。複製した状態にも同じ行動を行えるよう、状態ではなく文脈を受け取る。 */
type ReplayableAction = (context: EffectContext) => void;

/**
 * 行動を試した後、評価の前に複製に行うこと。ワザは番の狙いを判定した後に使うため、ワザを試した複製は番の終わりの
 * 効果を起こして次の番に進め(引く 1 枚は引かない)、次の番の側から評価する。
 */
type TrialEnding = (state: GameState) => void;

const endTurnForEvaluation: TrialEnding = (state) => {
  resolveEndOfTurnTriggers({ choices: firstCandidateChoices, state });
  state.advanceToNextTurn();
};

/** 効果の中の選択の答え。候補は何番目かで持つ(複製では場のポケモンの参照が変わるため)。 */
type ChoiceAnswer =
  | { readonly indices: readonly number[]; readonly kind: "cards" }
  | { readonly indices: readonly number[]; readonly kind: "pokemon" }
  | { readonly applies: boolean; readonly kind: "optional" };

type ChoiceRequest =
  | { readonly kind: "cards"; readonly request: CardChoiceRequest }
  | { readonly kind: "pokemon"; readonly request: PokemonChoiceRequest }
  | { readonly kind: "optional" };

const cardKeys = new WeakMap<Card, number>();
let nextCardKey = 0;

/** カードの参照ごとの番号。同じ行動かを見分ける鍵を作るのに使う。 */
function keyOfCard(card: Card): number {
  let key = cardKeys.get(card);
  if (key === undefined) {
    key = nextCardKey;
    nextCardKey += 1;
    cardKeys.set(card, key);
  }
  return key;
}

/**
 * 場のポケモンの見分けの鍵。場所(バトル場かベンチか)、カード、進化前、ついているカード、場に出た番、進化した番、
 * この番に使った特性が同じポケモンは入れ替えても同じ場になるので、同じ鍵にする。
 */
function keyOfPokemon(state: GameState, pokemon: PokemonInPlay): string {
  return [
    pokemon === state.active ? "active" : "bench",
    keyOfCard(pokemon.card),
    pokemon.underneath.map(keyOfCard).join("."),
    pokemon.energies.map(keyOfCard).sort().join("."),
    pokemon.tool === null ? "" : keyOfCard(pokemon.tool),
    pokemon.turnEntered,
    pokemon.turnEvolved,
    [...pokemon.abilitiesUsedThisTurn].sort().join("."),
  ].join("/");
}

/** 行動の欄ごとの鍵の作り方。場のポケモンを指す欄は、指すポケモンの見分けの鍵にする。 */
const actionFieldKeys: Readonly<
  Record<string, (state: GameState, value: unknown) => string>
> = {
  benchIndex: (state, value) => {
    const pokemon = state.bench[value as number];
    return pokemon === undefined ? String(value) : keyOfPokemon(state, pokemon);
  },
  card: (_, value) => String(keyOfCard(value as Card)),
  energiesToDiscard: (_, value) =>
    (value as readonly Card[]).map(keyOfCard).sort().join("."),
  pokemonIndex: (state, value) => keyOfPokemonAt(state, value as number),
  targetIndex: (state, value) => keyOfPokemonAt(state, value as number),
};

function keyOfPokemonAt(state: GameState, index: number): string {
  const pokemon = state.listPokemonInPlay()[index];
  return pokemon === undefined ? String(index) : keyOfPokemon(state, pokemon);
}

/** 行動の見分けの鍵。入れ替えても同じ場になるポケモンへの同じ行動は、同じ鍵にする。 */
function keyOfAction(state: GameState, action: PlayerAction): string {
  return Object.entries(action)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(
      ([field, value]) =>
        `${field}=${actionFieldKeys[field]?.(state, value) ?? String(value)}`
    )
    .join(",");
}

/** 入れ替えても同じ場になる行動を 1 つにまとめる(先に並んだものを残す)。同じ結果になる行動を何度も試さないため。 */
function listDistinctActions(
  state: GameState,
  actions: readonly PlayerAction[]
): PlayerAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = keyOfAction(state, action);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function copyRandom(random: RandomSource): SeededRandom {
  if (!(random instanceof SeededRandom)) {
    throw new Error(
      "探索は実際の対戦の乱数を写して効果の中の選択を再生するため、createSeededRandom の乱数が要る"
    );
  }
  return random.copy();
}

/**
 * 同じ参照のカードをまとめ、各参照から何枚選ぶかの組を並べる。大きい組から先に並べる(評価が同じなら多く選ぶ)。
 * 返すのは候補の何番目かの並び。
 */
function listCardOptions(request: CardChoiceRequest): number[][] {
  const groups: { card: Card; indices: number[] }[] = [];
  request.candidates.forEach((card, index) => {
    const group = groups.find((entry) => entry.card === card);
    if (group === undefined) {
      groups.push({ card, indices: [index] });
    } else {
      group.indices.push(index);
    }
  });
  const options: number[][] = [];
  const extend = (groupIndex: number, chosen: number[]): void => {
    const group = groups[groupIndex];
    if (group === undefined) {
      if (chosen.length >= request.minCount) {
        options.push(chosen);
      }
      return;
    }
    const most = Math.min(
      group.indices.length,
      request.maxCount - chosen.length
    );
    for (let count = most; count >= 0; count -= 1) {
      extend(groupIndex + 1, [...chosen, ...group.indices.slice(0, count)]);
    }
  };
  extend(0, []);
  const valid = request.mustHaveDistinctTypes
    ? options.filter((option) =>
        hasDistinctProvidedTypes(
          option.map((index) => request.candidates[index] as Card)
        )
      )
    : options;
  return valid.sort((left, right) => right.length - left.length);
}

/** 場のポケモンを min〜max 匹選ぶ組。場のポケモンはそれぞれ別のものとして扱う。大きい組から先に並べる。 */
function listPokemonOptions(request: PokemonChoiceRequest): number[][] {
  const options: number[][] = [];
  const extend = (next: number, chosen: number[]): void => {
    if (chosen.length >= request.minCount) {
      options.push(chosen);
    }
    if (chosen.length === request.maxCount) {
      return;
    }
    for (let index = next; index < request.candidates.length; index += 1) {
      extend(index + 1, [...chosen, index]);
    }
  };
  extend(0, []);
  return options.sort((left, right) => right.length - left.length);
}

function listChoiceOptions(
  state: GameState,
  choice: ChoiceRequest
): ChoiceAnswer[] {
  switch (choice.kind) {
    case "cards":
      return listCardOptions(choice.request).map((indices) => ({
        indices,
        kind: "cards",
      }));
    case "pokemon": {
      // 入れ替えても同じ場になるポケモンの組は 1 つにまとめる
      const { candidates } = choice.request;
      const seen = new Set<string>();
      return listPokemonOptions(choice.request).flatMap(
        (indices): ChoiceAnswer[] => {
          const key = indices
            .map((index) => {
              const pokemon = candidates[index];
              return pokemon === undefined ? "" : keyOfPokemon(state, pokemon);
            })
            .sort()
            .join("|");
          if (seen.has(key)) {
            return [];
          }
          seen.add(key);
          return [{ indices, kind: "pokemon" }];
        }
      );
    }
    default:
      return [
        { applies: true, kind: "optional" },
        { applies: false, kind: "optional" },
      ];
  }
}

function pickByIndices<T>(
  candidates: readonly T[],
  answer: ChoiceAnswer,
  kind: "cards" | "pokemon"
): T[] {
  if (answer.kind !== kind) {
    throw new Error("再生した選択の種類が、実際の選択と食い違う");
  }
  return answer.indices.map((index) => {
    const candidate = candidates[index];
    if (candidate === undefined) {
      throw new Error("再生した選択の候補が、実際の選択と食い違う");
    }
    return candidate;
  });
}

function answerOptional(answer: ChoiceAnswer): boolean {
  if (answer.kind !== "optional") {
    throw new Error("再生した選択の種類が、実際の選択と食い違う");
  }
  return answer.applies;
}

/**
 * 決めた答えを順に返す選択。prefix を返し終えたら次の 1 つに forced を返し、その直前に onForced を呼ぶ。
 * それより後の選択は候補の先頭から選ぶ。効果の中の選択の候補を 1 つ試すときに使う。
 * onForced には、ここまでに山札のカードを候補にした選択があったか(山札の中身を見たか)を渡す。
 */
class ScriptedChoices implements EffectChoices {
  private answered = 0;
  private hasSeenDeck = false;
  private readonly prefix: readonly ChoiceAnswer[];
  private readonly forced: ChoiceAnswer;
  private readonly onForced: (state: GameState, hasSeenDeck: boolean) => void;

  constructor(
    prefix: readonly ChoiceAnswer[],
    forced: ChoiceAnswer,
    onForced: (state: GameState, hasSeenDeck: boolean) => void
  ) {
    this.prefix = prefix;
    this.forced = forced;
    this.onForced = onForced;
  }

  private takeAnswer(
    state: GameState,
    choice: ChoiceRequest
  ): ChoiceAnswer | undefined {
    if (choice.kind === "cards" && choice.request.fromDeck) {
      this.hasSeenDeck = true;
    }
    const position = this.answered;
    this.answered += 1;
    if (position < this.prefix.length) {
      return this.prefix[position];
    }
    if (position === this.prefix.length) {
      this.onForced(state, this.hasSeenDeck);
      return this.forced;
    }
  }

  chooseCards(state: GameState, request: CardChoiceRequest): readonly Card[] {
    const answer = this.takeAnswer(state, { kind: "cards", request });
    return answer === undefined
      ? firstCandidateChoices.chooseCards(state, request)
      : pickByIndices(request.candidates, answer, "cards");
  }

  choosePokemon(state: GameState, request: PokemonChoiceRequest) {
    const answer = this.takeAnswer(state, { kind: "pokemon", request });
    return answer === undefined
      ? firstCandidateChoices.choosePokemon(state, request)
      : pickByIndices(request.candidates, answer, "pokemon");
  }

  choosesToApplyOptionalEffect(state: GameState, purpose: string): boolean {
    const answer = this.takeAnswer(state, { kind: "optional" });
    return answer === undefined
      ? firstCandidateChoices.choosesToApplyOptionalEffect(state, purpose)
      : answerOptional(answer);
  }
}

/** 探索の各部分が共有する道具(複製と評価を数え、評価を呼ぶ)。 */
class SearchTools {
  readonly statistics: SearchStatistics = { clones: 0, evaluations: 0 };
  readonly searchesEffectChoices: boolean;
  private readonly evaluator: Evaluator;

  constructor(evaluator: Evaluator, searchesEffectChoices: boolean) {
    this.evaluator = evaluator;
    this.searchesEffectChoices = searchesEffectChoices;
  }

  cloneState(state: GameState, random: RandomSource): GameState {
    this.statistics.clones += 1;
    return state.clone(random);
  }

  evaluate(
    state: GameState,
    fromTurn: number,
    seed: number,
    stage: TurnStage
  ): number {
    this.statistics.evaluations += 1;
    return this.evaluator({
      fromTurn,
      seed,
      stage,
      state,
      statistics: this.statistics,
    });
  }

  /**
   * 見えていないカードを混ぜ直した複製。混ぜ直しと、その後の山札を切る・コインを投げるには、seed から作った
   * 実際の対戦とは別の乱数を使う。
   */
  cloneWithRemixedUnseenCards(state: GameState, seed: number): GameState {
    const trial = this.cloneState(state, new SeededRandom(seed));
    trial.remixUnseenCards();
    return trial;
  }

  /**
   * 行動を複製で試した評価。seeds の種ごとに見えていないカードを混ぜ直した複製で行動を行い、評価の平均をとる。
   * 行動の結果が見えていないカードやコインで決まらなかったら、1 回で打ち切る。効果の中の選択は、同じ複製の中で
   * 候補を試して選ぶ(試す回数は 1 回)。
   */
  evaluateByTrying(
    state: GameState,
    action: ReplayableAction,
    fromTurn: number,
    seeds: readonly number[],
    ending?: TrialEnding
  ): number {
    let total = 0;
    let tried = 0;
    for (const seed of seeds) {
      const trial = this.cloneWithRemixedUnseenCards(state, seed);
      const uncertainBefore = trial.uncertainOutcomeCount;
      action({
        choices: this.searchesEffectChoices
          ? new ChoiceSearch({
              action,
              createStateBeforeAction: () =>
                this.cloneWithRemixedUnseenCards(state, seed),
              ...(ending === undefined ? {} : { ending }),
              fromTurn,
              seeds: [seed],
              tools: this,
            })
          : firstCandidateChoices,
        state: trial,
      });
      ending?.(trial);
      total += this.evaluate(
        trial,
        fromTurn,
        seed,
        ending === undefined ? "actionsRemain" : "beforeDraw"
      );
      tried += 1;
      if (trial.uncertainOutcomeCount === uncertainBefore) {
        break;
      }
    }
    return total / tried;
  }
}

interface ChoiceSearchParameters {
  readonly action: ReplayableAction;
  /** 行動の前の状態の新しい複製を返す。乱数も行動の前と同じ続きにする(再生が同じ経過をたどるように)。 */
  readonly createStateBeforeAction: () => GameState;
  readonly ending?: TrialEnding;
  readonly fromTurn: number;
  /** 候補を試すときの混ぜ直しの種。候補どうしで同じ種を使う。 */
  readonly seeds: readonly number[];
  readonly tools: SearchTools;
}

/**
 * 行動の中の効果の選択を、候補ごとに再生して試して選ぶ。候補を試すときは、行動の前の状態を複製してそこまでの選択を
 * 同じように再生し、試す選択の直前で見えていないカードを混ぜ直して乱数を差し替える(そこまでの経過はプレイヤーが
 * 実際に見たものなので実際の通りに再生し、そこから先は知らないものとして試す)。この行動の中で山札を探したり
 * 上から見たりした後(試す選択そのものを含む)は、山札の順だけを混ぜ直し、サイドは変えない。プレイヤーは山札の中身を
 * 見て山札とサイドの分かれ方を知っており、選んだカード(偉大な大樹で選んだキルリア)はまだ山札にあるため。
 */
class ChoiceSearch implements EffectChoices {
  private readonly answers: ChoiceAnswer[] = [];
  private readonly parameters: ChoiceSearchParameters;

  constructor(parameters: ChoiceSearchParameters) {
    this.parameters = parameters;
  }

  private evaluateOption(option: ChoiceAnswer): number {
    const { action, createStateBeforeAction, ending, fromTurn, seeds, tools } =
      this.parameters;
    let total = 0;
    let tried = 0;
    for (const seed of seeds) {
      const replay = createStateBeforeAction();
      let uncertainAtChoice = replay.uncertainOutcomeCount;
      action({
        choices: new ScriptedChoices(
          this.answers,
          option,
          (state, hasSeenDeck) => {
            state.random = new SeededRandom(seed);
            if (hasSeenDeck) {
              state.shuffleUnknownDeckOrder();
            } else {
              state.remixUnseenCards();
            }
            uncertainAtChoice = state.uncertainOutcomeCount;
          }
        ),
        state: replay,
      });
      ending?.(replay);
      total += tools.evaluate(
        replay,
        fromTurn,
        seed,
        ending === undefined ? "actionsRemain" : "beforeDraw"
      );
      tried += 1;
      if (replay.uncertainOutcomeCount === uncertainAtChoice) {
        break;
      }
    }
    return total / tried;
  }

  private choose(state: GameState, choice: ChoiceRequest): ChoiceAnswer {
    const options = listChoiceOptions(state, choice);
    const [first] = options;
    if (first === undefined) {
      throw new Error("効果の中の選択に、選べる組が無い");
    }
    let best = first;
    if (options.length > 1) {
      let bestValue = Number.NEGATIVE_INFINITY;
      for (const option of options) {
        const value = this.evaluateOption(option);
        if (value > bestValue + EVALUATION_TOLERANCE) {
          best = option;
          bestValue = value;
        }
      }
    }
    this.answers.push(best);
    return best;
  }

  chooseCards(state: GameState, request: CardChoiceRequest): readonly Card[] {
    return pickByIndices(
      request.candidates,
      this.choose(state, { kind: "cards", request }),
      "cards"
    );
  }

  choosePokemon(state: GameState, request: PokemonChoiceRequest) {
    return pickByIndices(
      request.candidates,
      this.choose(state, { kind: "pokemon", request }),
      "pokemon"
    );
  }

  choosesToApplyOptionalEffect(state: GameState): boolean {
    return answerOptional(this.choose(state, { kind: "optional" }));
  }
}

/** 対戦の準備の選び方(バトル場のたねと、ベンチに出すたねの組)。 */
interface SetupOption {
  readonly active: Card;
  readonly bench: readonly Card[];
}

/** 手札のたねポケモンから、バトル場の 1 匹とベンチに出す組を並べる。ベンチは多い組から先に並べる。 */
function listSetupOptions(basics: readonly Card[]): SetupOption[] {
  const kinds = [...new Set(basics)];
  return kinds.flatMap((active) => {
    const rest = [...basics];
    rest.splice(rest.indexOf(active), 1);
    const restKinds = [...new Set(rest)];
    const benches: Card[][] = [];
    const extend = (kindIndex: number, chosen: Card[]): void => {
      const kind = restKinds[kindIndex];
      if (kind === undefined) {
        benches.push(chosen);
        return;
      }
      const most = Math.min(
        rest.filter((card) => card === kind).length,
        BENCH_LIMIT - chosen.length
      );
      for (let count = most; count >= 0; count -= 1) {
        extend(kindIndex + 1, [
          ...chosen,
          ...Array.from({ length: count }, () => kind),
        ]);
      }
    };
    extend(0, []);
    return benches
      .sort((left, right) => right.length - left.length)
      .map((bench) => ({ active, bench }));
  });
}

function isMainAttackOf(
  declaration: ResolvedDeclaration,
  context: EffectContext,
  index: number
): boolean {
  const candidate = listUsableAttacksOfActive(context)[index];
  return (
    candidate !== undefined &&
    isMainAttackCandidate(candidate, declaration.mainAttacks)
  );
}

function useAttackAt(index: number): ReplayableAction {
  return (context) => {
    const candidate = listUsableAttacksOfActive(context)[index];
    if (candidate === undefined) {
      throw new Error(`使えるワザの ${index} 番目が無い`);
    }
    useAttack(context, candidate);
  };
}

/**
 * 宣言と評価から、探索でプレイングの判断基準を作る。evaluator は search-evaluators.ts の 3 つのどれか。
 * 1 つの判断基準を試行をまたいで使ってよい(試行ごとの記憶は対戦の状態ごとに持つ)。
 */
export function createSearchPolicy(
  declaration: ResolvedDeclaration,
  evaluator: Evaluator,
  options: SearchOptions
): SearchPolicy {
  const tools = new SearchTools(evaluator, options.searchesEffectChoices);
  const searchRandom = new SeededRandom(options.seed);
  const drawSeeds = (): number[] =>
    Array.from({ length: options.samplesForUncertainOutcome }, () =>
      searchRandom.nextSeed()
    );
  const hasOpenDeadline = (fromTurn: number): boolean =>
    declaration.deadlines.some((deadline) => deadline >= fromTurn);
  const benchChosenAtSetup = new WeakMap<GameState, readonly Card[]>();
  /** runGame がワザを使うときの効果の中の選択。chooseAttack で用意する。 */
  let choicesForAttack: EffectChoices | undefined;

  /** 実際の状態で行動を行う。効果の中の選択は、行動の前の状態から再生して試して選ぶ。 */
  const createChoicesFor = (
    state: GameState,
    action: ReplayableAction,
    fromTurn: number,
    ending?: TrialEnding
  ): EffectChoices => {
    if (!options.searchesEffectChoices) {
      return firstCandidateChoices;
    }
    const before = tools.cloneState(state, copyRandom(state.random));
    return new ChoiceSearch({
      action,
      createStateBeforeAction: () =>
        tools.cloneState(before, copyRandom(before.random)),
      ...(ending === undefined ? {} : { ending }),
      fromTurn,
      seeds: drawSeeds(),
      tools,
    });
  };

  const chooseTurnAction = (
    context: EffectContext
  ): PlayerAction | undefined => {
    const { state } = context;
    const actions = listAvailableActions(context);
    if (actions.length === 1 || !hasOpenDeadline(state.turn)) {
      return;
    }
    const seeds = drawSeeds();
    const [firstSeed = 0] = seeds;
    let best: PlayerAction | undefined;
    let bestValue = tools.evaluate(state, state.turn, firstSeed, "actionsDone");
    for (const action of listDistinctActions(state, actions)) {
      if (action.kind === "endTurn") {
        continue;
      }
      const value = tools.evaluateByTrying(
        state,
        (trialContext) => performAction(trialContext, action),
        state.turn,
        seeds
      );
      if (value > bestValue + EVALUATION_TOLERANCE) {
        best = action;
        bestValue = value;
      }
    }
    return best;
  };

  const chooseSetup = (state: GameState, basics: readonly Card[]) => {
    const seeds = drawSeeds();
    const [seed = 0] = seeds;
    let best: SetupOption | undefined;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const option of listSetupOptions(basics)) {
      const trial = tools.cloneWithRemixedUnseenCards(state, seed);
      trial.placeActiveFromHand(option.active);
      placeBenchAtSetup(trial, option.bench);
      trial.placePrizesFromDeck();
      const value = tools.evaluate(trial, 1, seed, "beforeDraw");
      if (value > bestValue + EVALUATION_TOLERANCE) {
        best = option;
        bestValue = value;
      }
    }
    if (best === undefined) {
      throw new Error("たねポケモンが無い");
    }
    return best;
  };

  return {
    chooseActiveAtSetup: (state, basics) => {
      const { active, bench } = chooseSetup(state, basics);
      benchChosenAtSetup.set(state, bench);
      return active;
    },
    chooseAttack: (context) => {
      choicesForAttack = undefined;
      const { state } = context;
      const candidates = listUsableAttacksOfActive(context);
      const fromTurn = state.turn + 1;
      // 評価が同じなら主軸のワザ、ほかのワザ、使わないの順に選ぶ
      const order = candidates
        .map((_, index) => index)
        .sort(
          (left, right) =>
            Number(isMainAttackOf(declaration, context, right)) -
            Number(isMainAttackOf(declaration, context, left))
        );
      let best: number | null = order[0] ?? null;
      if (hasOpenDeadline(fromTurn)) {
        const seeds = drawSeeds();
        const [firstSeed = 0] = seeds;
        let bestValue = Number.NEGATIVE_INFINITY;
        for (const index of [...order, null]) {
          const value =
            index === null
              ? tools.evaluateByTrying(
                  state,
                  () => undefined,
                  fromTurn,
                  [firstSeed],
                  endTurnForEvaluation
                )
              : tools.evaluateByTrying(
                  state,
                  useAttackAt(index),
                  fromTurn,
                  seeds,
                  endTurnForEvaluation
                );
          if (value > bestValue + EVALUATION_TOLERANCE) {
            best = index;
            bestValue = value;
          }
        }
      }
      if (best === null) {
        return null;
      }
      choicesForAttack = createChoicesFor(
        state,
        useAttackAt(best),
        fromTurn,
        endTurnForEvaluation
      );
      return candidates[best] ?? null;
    },
    chooseBenchAtSetup: (state) => benchChosenAtSetup.get(state) ?? [],
    chooseCards: (state, request) => {
      if (choicesForAttack === undefined) {
        throw new Error("探索が用意していない行動で、効果の中の選択を問われた");
      }
      return choicesForAttack.chooseCards(state, request);
    },
    choosePokemon: (state, request) => {
      if (choicesForAttack === undefined) {
        throw new Error("探索が用意していない行動で、効果の中の選択を問われた");
      }
      return choicesForAttack.choosePokemon(state, request);
    },
    choosesToApplyOptionalEffect: (state, purpose) => {
      if (choicesForAttack === undefined) {
        throw new Error("探索が用意していない行動で、効果の中の選択を問われた");
      }
      return choicesForAttack.choosesToApplyOptionalEffect(state, purpose);
    },
    playTurn: (context) => {
      choicesForAttack = undefined;
      const { state } = context;
      for (let count = 0; count < MAX_ACTIONS_PER_TURN; count += 1) {
        const action = chooseTurnAction(context);
        if (action === undefined) {
          return;
        }
        performAction(
          {
            choices: createChoicesFor(
              state,
              (actionContext) => performAction(actionContext, action),
              state.turn
            ),
            state,
          },
          action
        );
      }
      throw new Error("1 つの番の行動が多すぎる(同じ行動を繰り返している)");
    },
    statistics: tools.statistics,
  };
}

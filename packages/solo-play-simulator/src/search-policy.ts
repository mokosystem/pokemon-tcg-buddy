/**
 * 探索によるプレイングの判断基準。候補の手ごとに、見えていないカードを混ぜ直した複製の上で手を行い、その先を決まった方法で
 * 進めて 1 回の試しの点数を出し、決まった回数の平均がいちばん高い手を選ぶ。先の進め方は試しの点数を出す関数(TrialScorer)
 * が決める(試し回し、学習した場の評価)。
 *
 * - 番の中は、今できる行動の一覧の行動と「番を終える」を、それぞれ同じ回数だけ試して比べる
 * - ワザは、使えるワザの一覧の各候補と「使わない」を試す。先はサイドの判定と相手の番まで進めて点数を出す
 * - 効果の中の選択(何を捨て、何を探すか)は、行動の前の状態を複製してそこまでの選択を再生し、候補を 1 つ入れて
 *   効果を最後まで行ってから点数を出す。効果の実行(runEffect)は途中で止めて再開できないため
 * - 相手の番にバトルポケモンがきぜつした後に出すベンチポケモンも、候補ごとに試して選ぶ
 * - 探索は山札の順とサイドの中身を知らない。複製で先を試すときは、見えていないカードを混ぜ直し、実際の対戦とは
 *   別の乱数に差し替えてから試す
 */

import { takePrizesForOpponentFieldDamage } from "./battle-style-solo-play-rules.ts";
import {
  listUsableAttacksOfActive,
  resolveEndOfTurnTriggers,
  useAttack,
} from "./card-effects.ts";
import type { Card } from "./cards.ts";
import type { UsableAttack } from "./continuous-effects.ts";
import {
  type CardChoiceRequest,
  type EffectChoices,
  type EffectContext,
  firstCandidateChoices,
  hasDistinctProvidedTypes,
  type PokemonChoiceRequest,
} from "./effect-choices.ts";
import {
  type BattleStyleSoloPlayResumePoint,
  type PlayingPolicy,
  placeBenchAtSetup,
} from "./engine.ts";
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

/** 探索が数えた仕事の量。1 回の対戦あたりの複製と試しの回数を記録するために持つ。 */
export interface SearchStatistics {
  /** 状態を複製した回数。 */
  clones: number;
  /** 試しの点数を出した回数。 */
  trialScores: number;
}

/** 1 回の試しの点数。 */
export interface TrialScore {
  /** 自分が取ったサイドの枚数から、相手が取ったサイドの枚数を引いた値。 */
  readonly prizeDifference: number;
  /** 試し回しで勝てば 1、負ければ 0。学習した場の評価では、勝率の見積もり(0〜1)。 */
  readonly winRate: number;
}

export interface TrialScoringInput {
  /** state をどこから続けるか。 */
  readonly resumePoint: BattleStyleSoloPlayResumePoint;
  /** 点数を出す関数が乱数を使うときの種。同じ場面で比べる候補には同じ並びの種を渡す。 */
  readonly seed: number;
  /** 候補の手を行った後の、見えていないカードを混ぜ直した複製。点数を出す関数は書き換えてよい(使い捨て)。 */
  readonly state: GameState;
}

export type TrialScorer = (input: TrialScoringInput) => TrialScore;

/** 試した平均の勝率が並んだとき(差が EVALUATION_TOLERANCE 以下)に、何で比べるか。 */
export type TrialScoreTieBreak = "none" | "prizeDifference";

export interface SearchOptions {
  /** 候補の手 1 つを何回試して平均するか(設定の「試す回数」)。 */
  readonly samplesPerCandidate: number;
  readonly scoreTrial: TrialScorer;
  /** 効果の中の選択を、候補を再生して試して選ぶか。偽なら候補の先頭から選ぶ。 */
  readonly searchesEffectChoices: boolean;
  /** 探索が使う乱数の種。実際の対戦の乱数とは別に持ち、探索が試した回数で実際の対戦の山札の順が変わらないようにする。 */
  readonly seed: number;
  readonly tieBreak: TrialScoreTieBreak;
}

export interface SearchPolicy extends PlayingPolicy {
  /**
   * 番の中の行動を実際の状態で行う。効果の中の選択は、行動の前の状態から再生して試して選ぶ(searchesEffectChoices が
   * 偽なら候補の先頭から)。番の中の手の並びを探す探索(turn-sequence-search-policy.ts)が、選んだ並びの最初の行動を
   * 行うときに使う。
   */
  readonly performTurnAction: (
    context: EffectContext,
    action: PlayerAction
  ) => void;
  readonly statistics: SearchStatistics;
}

/** 番の中で同じことを繰り返していないかの歯止め。1 つの番の行動はカードの枚数と番に 1 回の制限で有限になる。 */
const MAX_ACTIONS_PER_TURN = 100;

/** 点数の差がこれ以下なら同じとみなし、先に並んだ候補(番を終える、使わない、を含む)を選ぶ。 */
const EVALUATION_TOLERANCE = 1e-9;

/**
 * 2 つの試しの点数を比べる。left のほうが良ければ正、right のほうが良ければ負、同じとみなすなら 0。平均の勝率を比べ、
 * 差が EVALUATION_TOLERANCE 以下なら、tieBreak が "prizeDifference" のときだけ取ったサイドの差で比べる。
 */
export function compareTrialScores(
  left: TrialScore,
  right: TrialScore,
  tieBreak: TrialScoreTieBreak
): number {
  const winRateDifference = left.winRate - right.winRate;
  if (Math.abs(winRateDifference) > EVALUATION_TOLERANCE) {
    return winRateDifference;
  }
  if (tieBreak === "none") {
    return 0;
  }
  const prizeDifference = left.prizeDifference - right.prizeDifference;
  return Math.abs(prizeDifference) > EVALUATION_TOLERANCE ? prizeDifference : 0;
}

/** 候補を並びの順に点数で比べ、いちばん良い候補を返す。点数が同じなら先に並んだ候補を残す。 */
export function pickBestCandidate<T>(
  candidates: readonly T[],
  scoreCandidate: (candidate: T) => TrialScore,
  tieBreak: TrialScoreTieBreak
): T {
  let best: { candidate: T; score: TrialScore } | undefined;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate);
    if (
      best === undefined ||
      compareTrialScores(score, best.score, tieBreak) > 0
    ) {
      best = { candidate, score };
    }
  }
  if (best === undefined) {
    throw new Error("比べる候補が無い");
  }
  return best.candidate;
}

/** 試しの点数の平均。 */
function averageTrialScores(scores: readonly TrialScore[]): TrialScore {
  const count = Math.max(scores.length, 1);
  return {
    prizeDifference:
      scores.reduce((total, score) => total + score.prizeDifference, 0) / count,
    winRate: scores.reduce((total, score) => total + score.winRate, 0) / count,
  };
}

/** 状態に対して行う 1 つの行動。複製した状態にも同じ行動を行えるよう、状態ではなく文脈を受け取る。 */
type ReplayableAction = (context: EffectContext) => void;

/** 行動を試した後の複製を、どこから続けるか。続ける前に複製に行うことがあれば、ここで行う。 */
type TrialContinuation = (state: GameState) => BattleStyleSoloPlayResumePoint;

/** 番の中の行動を試した後は、番の中の行動から続ける。 */
const continueTurnActions: TrialContinuation = () => "ownTurnActions";
/** 番を終えるとき、またはワザを使った後は、ワザを選ぶところから続ける(2 回目のワザを使える効果があれば続ける側が選ぶ)。 */
const continueFromAttack: TrialContinuation = () => "ownTurnAttack";
/**
 * ワザを使わないときは、番の終わりの効果とサイドの判定を行って相手の番から続ける(engine.ts の番の進行と同じ順)。
 * 番の終わりの効果の中の選択は候補の先頭から選ぶ。
 */
const continueWithoutAttack: TrialContinuation = (state) => {
  resolveEndOfTurnTriggers({ choices: firstCandidateChoices, state });
  takePrizesForOpponentFieldDamage(state);
  return "opponentTurn";
};

function doNothing(): void {
  // 「番を終える」と「使わない」は、複製に何もしない
}

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
 * 場のポケモンの見分けの鍵。場所(バトル場かベンチか)、カード、進化前、ついているカード、のっているダメカン、場に出た番、
 * 進化した番、この番に使った特性が同じポケモンは入れ替えても同じ場になるので、同じ鍵にする。
 */
function keyOfPokemon(state: GameState, pokemon: PokemonInPlay): string {
  return [
    pokemon === state.active ? "active" : "bench",
    keyOfCard(pokemon.card),
    pokemon.underneath.map(keyOfCard).join("."),
    pokemon.energies.map(keyOfCard).sort().join("."),
    pokemon.tool === undefined ? "" : keyOfCard(pokemon.tool),
    pokemon.damage,
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
export function listDistinctActions(
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

/** きぜつした後にバトル場に出すベンチポケモンの問い合わせを、効果の中の選択と同じ形の求めにする。 */
function buildPromoteRequest(
  candidates: readonly PokemonInPlay[]
): PokemonChoiceRequest {
  return {
    candidates,
    maxCount: 1,
    minCount: 1,
    purpose: "きぜつした後にバトル場に出すベンチポケモン",
  };
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

  choosePokemonToPromoteAfterKnockOut(
    state: GameState,
    candidates: readonly PokemonInPlay[]
  ): PokemonInPlay {
    const request = buildPromoteRequest(candidates);
    const answer = this.takeAnswer(state, { kind: "pokemon", request });
    const [chosen] =
      answer === undefined
        ? firstCandidateChoices.choosePokemon(state, request)
        : pickByIndices(candidates, answer, "pokemon");
    if (chosen === undefined) {
      throw new Error("きぜつした後にバトル場に出すベンチポケモンの候補が無い");
    }
    return chosen;
  }

  choosesToApplyOptionalEffect(state: GameState, purpose: string): boolean {
    const answer = this.takeAnswer(state, { kind: "optional" });
    return answer === undefined
      ? firstCandidateChoices.choosesToApplyOptionalEffect(state, purpose)
      : answerOptional(answer);
  }
}

/** 探索の各部分が共有する道具(複製と試しを数え、試しの点数を出す)。 */
class SearchTools {
  readonly statistics: SearchStatistics = { clones: 0, trialScores: 0 };
  readonly searchesEffectChoices: boolean;
  readonly tieBreak: TrialScoreTieBreak;
  private readonly scorer: TrialScorer;

  constructor(options: SearchOptions) {
    this.scorer = options.scoreTrial;
    this.searchesEffectChoices = options.searchesEffectChoices;
    this.tieBreak = options.tieBreak;
  }

  cloneState(state: GameState, random: RandomSource): GameState {
    this.statistics.clones += 1;
    return state.clone(random);
  }

  scoreTrial(
    state: GameState,
    resumePoint: BattleStyleSoloPlayResumePoint,
    seed: number
  ): TrialScore {
    this.statistics.trialScores += 1;
    return this.scorer({ resumePoint, seed, state });
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
   * 行動を複製で試した点数の平均。seeds の種ごとに見えていないカードを混ぜ直した複製で行動を行い、continuation の
   * 場所から点数を出す。効果の中の選択は、同じ複製の中で候補を試して選ぶ(試す回数は 1 回)。
   */
  scoreByTrying(
    state: GameState,
    action: ReplayableAction,
    seeds: readonly number[],
    continuation: TrialContinuation
  ): TrialScore {
    return averageTrialScores(
      seeds.map((seed) => {
        const trial = this.cloneWithRemixedUnseenCards(state, seed);
        action({
          choices: this.searchesEffectChoices
            ? new ChoiceSearch({
                action,
                continuation,
                createStateBeforeAction: () =>
                  this.cloneWithRemixedUnseenCards(state, seed),
                seeds: [seed],
                tools: this,
              })
            : firstCandidateChoices,
          state: trial,
        });
        return this.scoreTrial(trial, continuation(trial), seed);
      })
    );
  }
}

interface ChoiceSearchParameters {
  readonly action: ReplayableAction;
  readonly continuation: TrialContinuation;
  /** 行動の前の状態の新しい複製を返す。乱数も行動の前と同じ続きにする(再生が同じ経過をたどるように)。 */
  readonly createStateBeforeAction: () => GameState;
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

  private scoreOption(option: ChoiceAnswer): TrialScore {
    const { action, continuation, createStateBeforeAction, seeds, tools } =
      this.parameters;
    return averageTrialScores(
      seeds.map((seed) => {
        const replay = createStateBeforeAction();
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
            }
          ),
          state: replay,
        });
        return tools.scoreTrial(replay, continuation(replay), seed);
      })
    );
  }

  private choose(state: GameState, choice: ChoiceRequest): ChoiceAnswer {
    const options = listChoiceOptions(state, choice);
    const best =
      options.length > 1
        ? pickBestCandidate(
            options,
            (option) => this.scoreOption(option),
            this.parameters.tools.tieBreak
          )
        : options[0];
    if (best === undefined) {
      throw new Error("効果の中の選択に、選べる組が無い");
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

  choosePokemonToPromoteAfterKnockOut(
    state: GameState,
    candidates: readonly PokemonInPlay[]
  ): PokemonInPlay {
    const [chosen] = pickByIndices(
      candidates,
      this.choose(state, {
        kind: "pokemon",
        request: buildPromoteRequest(candidates),
      }),
      "pokemon"
    );
    if (chosen === undefined) {
      throw new Error("きぜつした後にバトル場に出すベンチポケモンの候補が無い");
    }
    return chosen;
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
 * 試しの点数を出す関数から、探索でプレイングの判断基準を作る。判断基準は試行の中で記憶を持つ(対戦の準備で選んだベンチ、
 * ワザの効果の中の選択)ため、試行ごとに作る。
 */
export function createSearchPolicy(options: SearchOptions): SearchPolicy {
  const tools = new SearchTools(options);
  const searchRandom = new SeededRandom(options.seed);
  const drawSeeds = (): number[] =>
    Array.from({ length: options.samplesPerCandidate }, () =>
      searchRandom.nextSeed()
    );
  const benchChosenAtSetup = new WeakMap<GameState, readonly Card[]>();
  /** runBattleStyleSoloPlayGame がワザを使うときの効果の中の選択。chooseAttack で用意する。 */
  let choicesForAttack: EffectChoices | undefined;

  /** 実際の状態で行動を行うときの効果の中の選択。行動の前の状態から再生して試して選ぶ。 */
  const createChoicesFor = (
    state: GameState,
    action: ReplayableAction,
    continuation: TrialContinuation
  ): EffectChoices => {
    if (!options.searchesEffectChoices) {
      return firstCandidateChoices;
    }
    const before = tools.cloneState(state, copyRandom(state.random));
    return new ChoiceSearch({
      action,
      continuation,
      createStateBeforeAction: () =>
        tools.cloneState(before, copyRandom(before.random)),
      seeds: drawSeeds(),
      tools,
    });
  };

  /**
   * 相手の番にバトルポケモンがきぜつした後に出すベンチポケモンを、候補ごとに試して選ぶ。相手の番のきぜつは、ベンチ
   * ポケモンを先に、バトルポケモンを最後にきぜつさせる(battle-style-solo-play-rules.ts の
   * knockOutOwnPokemonAtOrAboveMaxHp)ので、出した後に相手の番で起きることは無く、自分の番の最初から続ける。
   * 複製では場のポケモンの参照が変わるため、候補はベンチの何番目かで指す。
   */
  const choosePromotionInOpponentTurn = (
    state: GameState,
    candidates: readonly PokemonInPlay[]
  ): PokemonInPlay => {
    const seeds = drawSeeds();
    // 入れ替えても同じ場になるポケモンは 1 つにまとめる
    const distinctCandidates = listChoiceOptions(state, {
      kind: "pokemon",
      request: buildPromoteRequest(candidates),
    }).flatMap((option) => pickByIndices(candidates, option, "pokemon"));
    return pickBestCandidate(
      distinctCandidates,
      (candidate) => {
        const benchIndex = state.bench.indexOf(candidate);
        return tools.scoreByTrying(
          state,
          ({ state: trial }) => {
            const promoted = trial.bench[benchIndex];
            if (promoted === undefined) {
              throw new Error("複製のベンチに、出すポケモンがいない");
            }
            trial.promoteToActive(promoted);
          },
          seeds,
          () => "ownTurnStart"
        );
      },
      options.tieBreak
    );
  };

  /**
   * 番の中の行動の外で問われた選択に答えるもの。自分の番のワザの効果の選択は、ワザのために用意した選択に渡す。
   * 相手の番にベンチの上限が下がってベンチを減らす選択(bench-limit.ts の trimBenchToLimit)は、候補の先頭から選ぶ。
   * ベンチの上限を下げるスタジアム(ゼロの大空洞。記録 card-records/stadiums/048706.json)が、計測する 2 デッキ
   * (recorded-decks.ts の RS3MMy-FuGPRu-MypM2X と 9gngnQ-zAMw9G-96H9nn)に入っておらず、試して選ぶ仕組みを作っても
   * 計測で働かないため。
   */
  const choicesOutsideTurnActions = (state: GameState): EffectChoices => {
    if (state.turnOwner === "opponent") {
      return firstCandidateChoices;
    }
    if (choicesForAttack === undefined) {
      throw new Error("探索が用意していない行動で、効果の中の選択を問われた");
    }
    return choicesForAttack;
  };

  const chooseTurnAction = (
    context: EffectContext
  ): PlayerAction | undefined => {
    const { state } = context;
    const actions = listAvailableActions(context);
    if (actions.length === 1) {
      return;
    }
    const seeds = drawSeeds();
    const best = pickBestCandidate<PlayerAction>(
      [
        { kind: "endTurn" },
        ...listDistinctActions(state, actions).filter(
          (action) => action.kind !== "endTurn"
        ),
      ],
      (action) =>
        action.kind === "endTurn"
          ? tools.scoreByTrying(state, doNothing, seeds, continueFromAttack)
          : tools.scoreByTrying(
              state,
              (trialContext) => performAction(trialContext, action),
              seeds,
              continueTurnActions
            ),
      options.tieBreak
    );
    return best.kind === "endTurn" ? undefined : best;
  };

  const chooseSetup = (state: GameState, basics: readonly Card[]) => {
    const seeds = drawSeeds();
    const resumePoint = state.wentFirst ? "ownTurnStart" : "opponentTurn";
    return pickBestCandidate(
      listSetupOptions(basics),
      (option) =>
        tools.scoreByTrying(
          state,
          ({ state: trial }) => {
            trial.placeActiveFromHand(option.active);
            placeBenchAtSetup(trial, option.bench);
            trial.placePrizesFromDeck();
          },
          seeds,
          () => resumePoint
        ),
      options.tieBreak
    );
  };

  const performTurnAction = (context: EffectContext, action: PlayerAction) => {
    const { state } = context;
    performAction(
      {
        choices: createChoicesFor(
          state,
          (actionContext) => performAction(actionContext, action),
          continueTurnActions
        ),
        state,
      },
      action
    );
  };

  return {
    chooseActiveAtSetup: (state, basics) => {
      const { active, bench } = chooseSetup(state, basics);
      benchChosenAtSetup.set(state, bench);
      return active;
    },
    chooseAttack: (context): UsableAttack | undefined => {
      const { state } = context;
      const candidates = listUsableAttacksOfActive(context);
      // 候補は使えるワザの一覧の順に試し、点数が同じなら先に並んだ候補(最後に「使わない」)を選ぶ
      const seeds = drawSeeds();
      const best = pickBestCandidate(
        [...candidates.keys(), undefined],
        (index) =>
          index === undefined
            ? tools.scoreByTrying(
                state,
                doNothing,
                seeds,
                continueWithoutAttack
              )
            : tools.scoreByTrying(
                state,
                useAttackAt(index),
                seeds,
                continueFromAttack
              ),
        options.tieBreak
      );
      // ワザを使わないときも、番の終わりの効果の中の選択が問われうるので、候補の先頭から選ぶ選択を用意する
      choicesForAttack =
        best === undefined
          ? firstCandidateChoices
          : createChoicesFor(state, useAttackAt(best), continueFromAttack);
      return best === undefined ? undefined : candidates[best];
    },
    chooseBenchAtSetup: (state) => benchChosenAtSetup.get(state) ?? [],
    chooseCards: (state, request) =>
      choicesOutsideTurnActions(state).chooseCards(state, request),
    choosePokemon: (state, request) =>
      choicesOutsideTurnActions(state).choosePokemon(state, request),
    choosePokemonToPromoteAfterKnockOut: (state, candidates) =>
      state.turnOwner === "opponent"
        ? choosePromotionInOpponentTurn(state, candidates)
        : choicesOutsideTurnActions(state).choosePokemonToPromoteAfterKnockOut(
            state,
            candidates
          ),
    choosesToApplyOptionalEffect: (state, purpose) =>
      choicesOutsideTurnActions(state).choosesToApplyOptionalEffect(
        state,
        purpose
      ),
    performTurnAction,
    playTurn: (context) => {
      choicesForAttack = undefined;
      for (let count = 0; count < MAX_ACTIONS_PER_TURN; count += 1) {
        const action = chooseTurnAction(context);
        if (action === undefined) {
          return;
        }
        performTurnAction(context, action);
      }
      throw new Error("1 つの番の行動が多すぎる(同じ行動を繰り返している)");
    },
    statistics: tools.statistics,
  };
}

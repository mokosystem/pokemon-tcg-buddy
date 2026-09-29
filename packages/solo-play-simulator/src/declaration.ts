/**
 * 宣言(CONTEXT.md「宣言」)の書式と、宣言とカードの記録から狙いの 3 段を導く処理。書式の理由は
 * docs/solo-play-simulator-design.md「宣言と探索(Issue 27 の順 7)」にある。
 *
 * 宣言は利用者の入力なので、読み込み時にスキーマ(valibot)で書式を検査し、続けて記録と突き合わせる
 * (カード ID に記録があるか、主軸のワザの名前が記録のワザの一覧にあるか)。
 */

import {
  array,
  getDotPath,
  type InferOutput,
  integer,
  minLength,
  minValue,
  nonEmpty,
  number,
  optional,
  picklist,
  pipe,
  regex,
  safeParse,
  strictObject,
  string,
} from "valibot";
import { calculateAttackDamage } from "./attack-damage.ts";
import { listUsableAttacksOfActive } from "./card-effects.ts";
import {
  type Attack,
  CardCategory,
  type CardRecord,
  type PokemonRecord,
} from "./card-record-schema.ts";
import type { Card } from "./cards.ts";
import type { UsableAttack } from "./continuous-effects.ts";
import { firstCandidateChoices } from "./effect-choices.ts";
import type { CardRecordTable, Goal } from "./engine.ts";
import type { GameState, PokemonInPlay } from "./state.ts";

const nonEmptyText = pipe(string(), nonEmpty());
const CardIdSchema = pipe(string(), regex(/^[0-9]{6}$/));
const turnNumber = pipe(number(), integer(), minValue(1));

/** 主軸への道の必要なカードの置き場所。deck は評価では「山札かサイドのどちらかにある、まだ見えていないカード」として扱う。 */
export const RequiredCardPlaceSchema = picklist([
  "hand",
  "inPlay",
  "inPlaySincePreviousTurn",
  "stadium",
  "deck",
]);
export type RequiredCardPlace = InferOutput<typeof RequiredCardPlaceSchema>;

export const DeclarationSchema = strictObject({
  /** 締め切り(何番目の自分の番までか)。省略すると 2 と 3。 */
  deadlines: optional(pipe(array(turnNumber), minLength(1))),
  /** 主軸のポケモンとワザ。どれか 1 つが成り立てばよい。 */
  mainAttacks: pipe(
    array(strictObject({ attackName: nonEmptyText, cardId: CardIdSchema })),
    minLength(1)
  ),
  /** 狙いの 3 段目「N 以上で打てる」の N。省略すると狙いは 2 段目まで。 */
  minimumDamage: optional(pipe(number(), integer(), minValue(1))),
  pathsToMainAttacker: pipe(
    array(
      strictObject({
        name: nonEmptyText,
        requiredCards: pipe(
          array(
            strictObject({
              cardId: CardIdSchema,
              place: RequiredCardPlaceSchema,
            })
          ),
          minLength(1)
        ),
      })
    ),
    minLength(1)
  ),
});
export type Declaration = InferOutput<typeof DeclarationSchema>;

const DEFAULT_DEADLINES: readonly number[] = [2, 3];

export interface MainAttack {
  readonly attack: Attack;
  readonly record: PokemonRecord;
}

export interface RequiredCard {
  readonly place: RequiredCardPlace;
  readonly record: CardRecord;
}

export interface PathToMainAttacker {
  readonly name: string;
  readonly requiredCards: readonly RequiredCard[];
}

/** 宣言のカード ID を記録に引き当てたもの。探索と評価はこれを使う。 */
export interface ResolvedDeclaration {
  /** 締め切り。小さい順で重なりが無い。 */
  readonly deadlines: readonly number[];
  /** 狙いの 3 段(立つ、打てる、N 以上で打てる)。minimumDamage が無ければ 2 段。 */
  readonly goals: readonly Goal[];
  readonly mainAttacks: readonly MainAttack[];
  readonly minimumDamage?: number;
  readonly paths: readonly PathToMainAttacker[];
}

export class DeclarationValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`宣言に誤りがある:\n${problems.join("\n")}`);
    this.name = "DeclarationValidationError";
    this.problems = problems;
  }
}

function resolveMainAttack(
  recordTable: CardRecordTable,
  entry: Declaration["mainAttacks"][number],
  problems: string[]
): MainAttack | undefined {
  const record = recordTable.get(entry.cardId);
  if (record === undefined) {
    problems.push(`mainAttacks: カード ID ${entry.cardId} の記録が無い`);
    return;
  }
  if (record.category !== CardCategory.Pokemon) {
    problems.push(
      `mainAttacks: ${record.name}(${entry.cardId})はポケモンではない`
    );
    return;
  }
  const attack = record.attacks.find(
    (candidate) => candidate.name === entry.attackName
  );
  if (attack === undefined) {
    problems.push(
      `mainAttacks: ${record.name} の記録にワザ ${entry.attackName} が無い`
    );
    return;
  }
  return { attack, record };
}

function resolvePath(
  recordTable: CardRecordTable,
  path: Declaration["pathsToMainAttacker"][number],
  problems: string[]
): PathToMainAttacker {
  const requiredCards: RequiredCard[] = [];
  for (const { cardId, place } of path.requiredCards) {
    const record = recordTable.get(cardId);
    if (record === undefined) {
      problems.push(`${path.name}: カード ID ${cardId} の記録が無い`);
    } else {
      requiredCards.push({ place, record });
    }
  }
  return { name: path.name, requiredCards };
}

/** 宣言の JSON を検査し、記録に引き当てる。誤りはまとめて DeclarationValidationError で示す。 */
export function resolveDeclaration(
  content: unknown,
  recordTable: CardRecordTable
): ResolvedDeclaration {
  const parsed = safeParse(DeclarationSchema, content);
  if (!parsed.success) {
    throw new DeclarationValidationError(
      parsed.issues.map(
        (issue) => `${getDotPath(issue) ?? "(宣言の全体)"}: ${issue.message}`
      )
    );
  }
  const declaration = parsed.output;
  const problems: string[] = [];
  const mainAttacks = declaration.mainAttacks.flatMap((entry) => {
    const resolved = resolveMainAttack(recordTable, entry, problems);
    return resolved === undefined ? [] : [resolved];
  });
  const paths = declaration.pathsToMainAttacker.map((path) =>
    resolvePath(recordTable, path, problems)
  );
  if (problems.length > 0) {
    throw new DeclarationValidationError(problems);
  }
  const deadlines = [
    ...new Set(declaration.deadlines ?? DEFAULT_DEADLINES),
  ].sort((left, right) => left - right);
  const { minimumDamage } = declaration;
  return {
    deadlines,
    goals: buildGoals(mainAttacks, minimumDamage, paths),
    mainAttacks,
    ...(minimumDamage === undefined ? {} : { minimumDamage }),
    paths,
  };
}

// ---- 狙いの 3 段 ----

/** 主軸のポケモン(mainAttacks の記録と同じ記録のポケモン)が場にいるか。狙いの 1 段目。 */
export function isMainPokemonInPlay(
  state: GameState,
  mainAttacks: readonly MainAttack[]
): boolean {
  return state
    .listPokemonInPlay()
    .some((pokemon) =>
      mainAttacks.some((main) => main.record === pokemon.card.record)
    );
}

/**
 * 使えるワザの候補が主軸のワザにあたるか。ワザの持ち主の記録で見るため、ミュウex の「きおくのらせん」でベンチの
 * 主軸のワザを使う候補も含む。主軸のワザがほかのワザを「このワザとして使う」ワザ(Nのゾロアークex の「ナイトジョーカー」)
 * なら、候補は選んだワザになり持ち主もそのワザのポケモンになるため、usedAs で照合する。usedAs は記録のワザそのもの
 * (continuous-effects.ts の listAttacksUsedAs)。
 */
export function isMainAttackCandidate(
  candidate: UsableAttack,
  mainAttacks: readonly MainAttack[]
): boolean {
  return mainAttacks.some(
    (main) =>
      main.attack === candidate.usedAs ||
      (main.record === candidate.owner.card.record &&
        main.attack.name === candidate.attack.name)
  );
}

/** バトルポケモンの使えるワザの一覧のうち、主軸のワザにあたる候補。狙いの 2 段目。 */
export function listMainAttackCandidates(
  state: GameState,
  mainAttacks: readonly MainAttack[]
): UsableAttack[] {
  return listUsableAttacksOfActive({
    choices: firstCandidateChoices,
    state,
  }).filter((candidate) => isMainAttackCandidate(candidate, mainAttacks));
}

/** 主軸のワザにあたる候補のうち、いちばん大きいダメージ。候補が無ければ null。狙いの 3 段目に使う。 */
export function calculateBestMainAttackDamage(
  state: GameState,
  mainAttacks: readonly MainAttack[]
): number | null {
  const { active } = state;
  if (active === null) {
    return null;
  }
  const damages = listMainAttackCandidates(state, mainAttacks).map(
    (candidate) => calculateAttackDamage(state, active, candidate.attack) ?? 0
  );
  return damages.length === 0 ? null : Math.max(...damages);
}

// ---- 主軸への道の足りないカード(失敗の要因) ----

/** 記録のカードが今どこにあるか(手札、場、山札、サイド、トラッシュの順に探す)。 */
function describePlace(state: GameState, record: CardRecord): string {
  const zones: readonly [string, readonly Card[]][] = [
    ["手札", state.hand],
    ["場", state.listPokemonInPlay().map((pokemon) => pokemon.card)],
    ["山札", state.deck],
    ["サイド", state.prizes],
    ["トラッシュ", state.discard],
  ];
  const found = zones.find(([, zoneCards]) =>
    zoneCards.some((candidate) => candidate.record === record)
  );
  return found === undefined ? "無い" : found[0];
}

/**
 * 1 つの道を見るときに使ったカード。同じ道で同じ 1 枚を 2 つの必要なカードに数えないため。手札と山札は記録ごとの
 * 枚数で数える(buildDeck は同じカード ID の各枚を同じ Card で表すので、Card の集合では 2 枚目以降を区別できない)。
 * 場のポケモンは 1 匹ずつ別の PokemonInPlay なので、そのまま集合で持つ。
 */
interface UsedInPath {
  readonly deck: Map<CardRecord, number>;
  readonly hand: Map<CardRecord, number>;
  readonly inPlay: Set<PokemonInPlay>;
}

/** zoneCards に record のカードが、使った分を除いて残っていれば 1 枚使い、使えたかを返す。 */
function takeCard(
  zoneCards: readonly Card[],
  used: Map<CardRecord, number>,
  record: CardRecord
): boolean {
  const taken = used.get(record) ?? 0;
  const available = zoneCards.filter(
    (candidate) => candidate.record === record
  ).length;
  if (available <= taken) {
    return false;
  }
  used.set(record, taken + 1);
  return true;
}

function takePokemonInPlay(
  state: GameState,
  used: UsedInPath,
  record: CardRecord,
  isUsable: (pokemon: PokemonInPlay) => boolean
): boolean {
  const pokemon = state
    .listPokemonInPlay()
    .find(
      (candidate) =>
        candidate.card.record === record &&
        !used.inPlay.has(candidate) &&
        isUsable(candidate)
    );
  if (pokemon !== undefined) {
    used.inPlay.add(pokemon);
  }
  return pokemon !== undefined;
}

/** 必要なカードが置き場所にあるか。置き場所の種類(RequiredCardPlace)と 1 対 1 に対応させる。 */
const requiredCardCheckers: Readonly<
  Record<
    RequiredCardPlace,
    (state: GameState, used: UsedInPath, record: CardRecord) => boolean
  >
> = {
  deck: (state, used, record) => takeCard(state.deck, used.deck, record),
  hand: (state, used, record) => takeCard(state.hand, used.hand, record),
  inPlay: (state, used, record) =>
    takePokemonInPlay(state, used, record, () => true),
  inPlaySincePreviousTurn: (state, used, record) =>
    takePokemonInPlay(
      state,
      used,
      record,
      (pokemon) => !pokemon.isFresh(state.turn)
    ),
  stadium: (state, _, record) => state.stadium?.record === record,
};

/** 置き場所に無い必要なカードの今の置き場所。前の番から場に要るポケモンがこの番に出たばかりなら、そう書く。 */
function describeMissingCard(state: GameState, required: RequiredCard): string {
  const isFreshInPlay =
    required.place === "inPlaySincePreviousTurn" &&
    state
      .listPokemonInPlay()
      .some(
        (pokemon) =>
          pokemon.card.record === required.record && pokemon.isFresh(state.turn)
      );
  const where = isFreshInPlay
    ? "この番に場に出たか進化した"
    : describePlace(state, required.record);
  return `${required.record.name}(${where})`;
}

/** 道の必要なカードのうち、置き場所に揃っていないものの一覧(名前と今の置き場所)。 */
export function listMissingCards(
  state: GameState,
  path: PathToMainAttacker
): string[] {
  const used: UsedInPath = {
    deck: new Map(),
    hand: new Map(),
    inPlay: new Set(),
  };
  return path.requiredCards.flatMap((required) =>
    requiredCardCheckers[required.place](state, used, required.record)
      ? []
      : [describeMissingCard(state, required)]
  );
}

/**
 * 主軸が場にいないときの失敗の要因。宣言の道のうちいちばん揃っている道(足りないカードが少ない道、同数なら先の道)に
 * ついて、足りないカードと今の置き場所を出す。#22 の規則ファイルがデッキごとに書いていた要因の関数の代わりで、
 * 宣言の道から作る(docs/solo-play-simulator-design.md「主軸への道を探索の評価に使う理由」)。
 */
export function explainPathShortfall(
  state: GameState,
  paths: readonly PathToMainAttacker[]
): string {
  const best = paths
    .map((path) => ({ missing: listMissingCards(state, path), path }))
    .reduce<{ missing: string[]; path: PathToMainAttacker } | null>(
      (current, candidate) =>
        current === null || candidate.missing.length < current.missing.length
          ? candidate
          : current,
      null
    );
  if (best === null || best.missing.length === 0) {
    return "道は揃っているが主軸が場にいない";
  }
  return `${best.path.name}: ${best.missing.join("、")} が足りない`;
}

// ---- 狙いの 3 段 ----

function joinNames(names: readonly string[]): string {
  return [...new Set(names)].join(" か ");
}

function buildGoals(
  mainAttacks: readonly MainAttack[],
  minimumDamage: number | undefined,
  paths: readonly PathToMainAttacker[]
): Goal[] {
  const pokemonNames = joinNames(mainAttacks.map((main) => main.record.name));
  const attackNames = joinNames(mainAttacks.map((main) => main.attack.name));
  const explainNotInPlay = (state: GameState): string =>
    `${pokemonNames} が場にいない(${explainPathShortfall(state, paths)})`;
  const stand: Goal = {
    explainFailure: explainNotInPlay,
    isAchieved: (state) => isMainPokemonInPlay(state, mainAttacks),
    name: `${pokemonNames} が場にいる`,
  };
  const explainAttackFailure = (state: GameState): string =>
    isMainPokemonInPlay(state, mainAttacks)
      ? `${pokemonNames} はいるが、バトル場から ${attackNames} を使えない`
      : explainNotInPlay(state);
  const attack: Goal = {
    explainFailure: explainAttackFailure,
    isAchieved: (state) =>
      listMainAttackCandidates(state, mainAttacks).length > 0,
    name: `${attackNames} を打てる`,
  };
  if (minimumDamage === undefined) {
    return [stand, attack];
  }
  const damage: Goal = {
    explainFailure: (state) => {
      const best = calculateBestMainAttackDamage(state, mainAttacks);
      return best === null
        ? explainAttackFailure(state)
        : `ダメージが ${best} で ${minimumDamage} に届かない`;
    },
    isAchieved: (state) =>
      (calculateBestMainAttackDamage(state, mainAttacks) ?? 0) >= minimumDamage,
    name: `${attackNames} を ${minimumDamage} 以上で打てる`,
  };
  return [stand, attack, damage];
}

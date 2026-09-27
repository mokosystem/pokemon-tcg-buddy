/**
 * 宣言(CONTEXT.md「宣言」)の書式と、宣言とカードの記録から狙いの 3 段を導く処理。書式の理由は
 * docs/setup-rate-design.md「宣言と探索(Issue 27 の順 7)」にある。
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
import type { UsableAttack } from "./continuous-effects.ts";
import { firstCandidateChoices } from "./effect-choices.ts";
import type { CardRecordTable, Goal } from "./engine.ts";
import type { GameState } from "./state.ts";

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
    goals: buildGoals(mainAttacks, minimumDamage),
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
 * バトルポケモンの使えるワザの一覧のうち、主軸のワザにあたる候補。ワザの持ち主の記録で見るため、ミュウex の
 * 「きおくのらせん」でベンチの主軸のワザを使う候補も含む。狙いの 2 段目。
 */
export function listMainAttackCandidates(
  state: GameState,
  mainAttacks: readonly MainAttack[]
): UsableAttack[] {
  return listUsableAttacksOfActive({
    choices: firstCandidateChoices,
    state,
  }).filter((candidate) =>
    mainAttacks.some(
      (main) =>
        main.record === candidate.owner.card.record &&
        main.attack.name === candidate.attack.name
    )
  );
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

function joinNames(names: readonly string[]): string {
  return [...new Set(names)].join(" か ");
}

function buildGoals(
  mainAttacks: readonly MainAttack[],
  minimumDamage: number | undefined
): Goal[] {
  const pokemonNames = joinNames(mainAttacks.map((main) => main.record.name));
  const attackNames = joinNames(mainAttacks.map((main) => main.attack.name));
  const notInPlay = `${pokemonNames} が場にいない`;
  const stand: Goal = {
    explainFailure: () => notInPlay,
    isAchieved: (state) => isMainPokemonInPlay(state, mainAttacks),
    name: `${pokemonNames} が場にいる`,
  };
  const explainAttackFailure = (state: GameState): string =>
    isMainPokemonInPlay(state, mainAttacks)
      ? `${pokemonNames} はいるが、バトル場から ${attackNames} を使えない`
      : notInPlay;
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

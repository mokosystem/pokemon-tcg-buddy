/**
 * カードの記録の検査。1 ファイルごとのスキーマの検査と、スキーマで表せない制約(記録をまたぐ検査、
 * ファイルの置き場所、記録の中の欄どうしの整合)を行い、カード ID から記録を引く表を作る。
 *
 * 入口(card-record-table.ts)が読み込み時にこの検査を 1 回通し、落ちたらファイル名と JSON の中の位置を
 * 添えて止める。壊れた記録で数字を出さないため(docs/setup-rate-design.md「検査をコードに置く理由」)。
 */

import { getDotPath, safeParse } from "valibot";
import {
  CardCategory,
  type CardEffect,
  type CardRecord,
  CardRecordSchema,
} from "./card-record-schema.ts";

/** 記録の JSON ファイル 1 つ。path は src/card-records/ からの相対パス(例: goods/048675.json)。 */
export interface CardRecordFile {
  readonly content: unknown;
  readonly path: string;
}

export interface ParsedCardRecordFile {
  readonly path: string;
  readonly record: CardRecord;
}

export class CardRecordValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`カードの記録に誤りがある:\n${problems.join("\n")}`);
    this.name = "CardRecordValidationError";
    this.problems = problems;
  }
}

/** カードの種類ごとのディレクトリ。 */
const CARD_RECORD_DIRECTORIES: Readonly<Record<CardCategory, string>> = {
  [CardCategory.BasicEnergy]: "energies",
  [CardCategory.Goods]: "goods",
  [CardCategory.Pokemon]: "pokemon",
  [CardCategory.SpecialEnergy]: "energies",
  [CardCategory.Stadium]: "stadiums",
  [CardCategory.Supporter]: "supporters",
  [CardCategory.Tool]: "pokemon-tools",
};

/** 1 ファイルをスキーマで検査する。誤りはファイル名と JSON の中の位置(ドット区切り)を添えた文で返す。 */
export function parseCardRecordFile(
  file: CardRecordFile
): { problems: string[] } | { record: CardRecord } {
  const result = safeParse(CardRecordSchema, file.content);
  if (result.success) {
    return { record: result.output };
  }
  return {
    problems: result.issues.map(
      (issue) =>
        `${file.path}: ${getDotPath(issue) ?? "(記録の全体)"}: ${issue.message}`
    ),
  };
}

const allowedCardEffectKinds: Readonly<
  Partial<Record<CardCategory, readonly CardEffect["kind"][]>>
> = {
  [CardCategory.Goods]: ["whenPlayed"],
  [CardCategory.SpecialEnergy]: [
    "continuous",
    "triggeredWhenAttachedFromHand",
    "triggeredAtEndOfOwnTurn",
  ],
  [CardCategory.Stadium]: ["activatedOncePerTurn", "continuous"],
  [CardCategory.Supporter]: ["whenPlayed"],
  [CardCategory.Tool]: ["continuous"],
};

function countTranslatedEffects(record: CardRecord): number {
  switch (record.category) {
    case CardCategory.Pokemon:
      return (
        record.abilities.filter((ability) => ability.translation !== undefined)
          .length +
        record.attacks.filter((attack) => attack.effect !== undefined).length
      );
    case CardCategory.BasicEnergy:
      return 0;
    default:
      return record.cardEffects.length;
  }
}

function findDuplicates(values: readonly string[]): string[] {
  return [
    ...new Set(
      values.filter((value, index) => values.indexOf(value) !== index)
    ),
  ];
}

function findPlacementProblems(file: ParsedCardRecordFile): string[] {
  const { record } = file;
  const expected = `${CARD_RECORD_DIRECTORIES[record.category]}/${record.cardIds[0]}.json`;
  return file.path === expected
    ? []
    : [
        `${file.path}: 置き場所は ${expected}(種類のディレクトリと先頭のカード ID)にする`,
      ];
}

/**
 * 翻訳の状態と効果の有無の整合。エネルギーは供給(provision)そのものが翻訳にあたるため、
 * 翻訳した効果が無くても translated にできる(基本エネルギー、レガシーエネルギー)。
 */
function findTranslationStatusProblems(record: CardRecord): string[] {
  const translated = countTranslatedEffects(record);
  if (record.translationStatus === "translated") {
    const isEnergy =
      record.category === CardCategory.BasicEnergy ||
      record.category === CardCategory.SpecialEnergy;
    return !isEnergy && translated === 0
      ? ["翻訳の状態が translated なのに、翻訳した効果が 1 つも無い"]
      : [];
  }
  return translated > 0
    ? [`翻訳の状態が ${record.translationStatus} なのに、翻訳した効果がある`]
    : [];
}

function findPokemonAttributeProblems(record: CardRecord): string[] {
  if (record.category !== CardCategory.Pokemon) {
    return [];
  }
  const problems: string[] = [];
  if (record.exRule !== undefined && !record.hasRuleBox) {
    problems.push("ポケモンex・メガシンカex はルールを持つポケモンにする");
  }
  for (const name of findDuplicates(
    record.attacks.map((attack) => attack.name)
  )) {
    problems.push(`ワザの名前 ${name} が重なっている`);
  }
  for (const name of findDuplicates(
    record.abilities.map((ability) => ability.name)
  )) {
    problems.push(`特性の名前 ${name} が重なっている`);
  }
  return problems;
}

function findCardEffectProblems(record: CardRecord): string[] {
  if (!("cardEffects" in record)) {
    return [];
  }
  const allowed = allowedCardEffectKinds[record.category] ?? [];
  const problems = record.cardEffects
    .filter((cardEffect) => !allowed.includes(cardEffect.kind))
    .map(
      (cardEffect) =>
        `${record.category} は効果のきっかけ ${cardEffect.kind} を持てない`
    );
  const whenPlayedCount = record.cardEffects.filter(
    (cardEffect) => cardEffect.kind === "whenPlayed"
  ).length;
  if (whenPlayedCount > 1) {
    // 「2 つの効果から 1 つを選ぶ」カード(スグリ)の選ぶ仕組みはまだ無く、今は翻訳する効果を 1 つにしている
    problems.push("使ったときの効果は 1 つまで");
  }
  return problems;
}

function findRulingProblems(record: CardRecord): string[] {
  return record.rulings.flatMap((ruling) =>
    ruling.source.kind === "officialQa" &&
    !ruling.source.searchUrl.includes("freeword=")
      ? [`裁定「${ruling.question}」の出典の URL に検索語(freeword)が無い`]
      : []
  );
}

/** 1 つの記録の中の欄どうしの整合と、ファイルの置き場所。 */
function findRecordProblems(file: ParsedCardRecordFile): string[] {
  const { record } = file;
  return [
    ...findPlacementProblems(file),
    ...[
      ...findTranslationStatusProblems(record),
      ...findPokemonAttributeProblems(record),
      ...findCardEffectProblems(record),
      ...findRulingProblems(record),
      ...findDuplicates(record.cardIds).map(
        (cardId) => `カード ID ${cardId} が記録の中で重なっている`
      ),
    ].map((problem) => `${file.path}: ${problem}`),
  ];
}

/**
 * 記録をまたぐ検査と、記録ごとの整合の検査。進化前の名前が記録にあるかは検査しない
 * (進化前がどのデッキにも入らない記録が正当にある。docs/setup-rate-design.md「検査をコードに置く理由」)。
 */
export function findCardRecordProblems(
  files: readonly ParsedCardRecordFile[]
): string[] {
  const owners = new Map<string, string[]>();
  for (const file of files) {
    for (const cardId of new Set(file.record.cardIds)) {
      owners.set(cardId, [...(owners.get(cardId) ?? []), file.path]);
    }
  }
  const duplicated = [...owners]
    .filter(([, paths]) => paths.length > 1)
    .map(
      ([cardId, paths]) =>
        `カード ID ${cardId} が複数の記録にある: ${paths.join("、")}`
    );
  return [...files.flatMap(findRecordProblems), ...duplicated];
}

/** 全記録を検査し、カード ID(どの印刷の ID からも)から記録を引く表を作る。誤りがあれば全部を添えて止める。 */
export function buildCardRecordTable(
  files: readonly CardRecordFile[]
): ReadonlyMap<string, CardRecord> {
  const problems: string[] = [];
  const parsed: ParsedCardRecordFile[] = [];
  for (const file of files) {
    const result = parseCardRecordFile(file);
    if ("record" in result) {
      parsed.push({ path: file.path, record: result.record });
    } else {
      problems.push(...result.problems);
    }
  }
  problems.push(...findCardRecordProblems(parsed));
  if (problems.length > 0) {
    throw new CardRecordValidationError(problems);
  }
  return new Map(
    parsed.flatMap(({ record }) =>
      record.cardIds.map((cardId) => [cardId, record] as const)
    )
  );
}

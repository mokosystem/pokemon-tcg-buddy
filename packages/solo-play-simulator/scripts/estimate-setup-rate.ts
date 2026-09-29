/**
 * デッキの 60 枚の内容と宣言を入力に、探索(道の揃い具合を見る評価)で主軸の成立率を計算する入口。
 * `pokemon-tcg-estimate-setup-rate` スキルがこれを呼ぶ。パッケージのディレクトリで次のように実行する
 * (入力の JSON のパス、先攻・後攻それぞれの試行回数、乱数の種)。
 *
 *   bun run estimate:setup-rate <入力の JSON> [試行回数=20000] [乱数の種=20260917]
 *
 * 入力の JSON は 1 つのファイルで、デッキコード、60 枚の内容(カード ID と枚数)、宣言、比べたい枚数の変更案(任意)を
 * 持つ(書式は `EstimateInputSchema`)。利用者のデッキの内容は本人のものなので、このファイルはリポジトリに置かず、作業領域に
 * 書いて捨てる。出力は、計算の前提(デッキによらない前提とカードごとの前提。変更案で足すカードの前提も含む)、先攻・
 * 後攻の成立率の表、失敗の要因の内訳、枚数を変えたときの比較。乱数の種は既定を固定し、同じ入力なら同じ数字が出る。
 * 60 枚の内容にも変更案にも、記録の無いカード ID があれば計算せずに止まる(engine.ts の MissingCardRecordsError)。
 * 探索の設定は順 8 の答え合わせと同じ(混ぜ直しを変えて試す回数 4、効果の中の選択は候補を試して選ぶ、探索の乱数の
 * 種 1)。
 */

import { readFileSync } from "node:fs";
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
  pipe,
  record,
  regex,
  safeParse,
  strictObject,
  string,
} from "valibot";
import {
  buildCardPremises,
  DECK_INDEPENDENT_PREMISES,
  formatCardPremises,
} from "../src/card-premises.ts";
import { cardRecordTable } from "../src/card-record-table.ts";
import type { Card } from "../src/cards.ts";
import {
  DeclarationSchema,
  type ResolvedDeclaration,
  resolveDeclaration,
} from "../src/declaration.ts";
import {
  applyVariant,
  buildDeck,
  type DeckVariant,
  type PlayingPolicy,
} from "../src/engine.ts";
import { createPathProgressEvaluator } from "../src/search-evaluators.ts";
import { createSearchPolicy } from "../src/search-policy.ts";
import {
  compareVariants,
  type Deadline,
  formatAssumptions,
  formatSummary,
  formatVariantComparison,
  simulate,
} from "../src/simulate.ts";
import { SAMPLES_FOR_UNCERTAIN_OUTCOME } from "./search-evaluator-choices.ts";

const DEFAULT_TRIALS = 20_000;
/** #22 の検証の記録と順 8 の答え合わせと同じ種。 */
const DEFAULT_SEED = 20_260_917;
const SEARCH_SEED = 1;
const DECK_SIZE = 60;

const CardIdSchema = pipe(string(), regex(/^[0-9]{6}$/));

/** 入力の JSON の書式。宣言の書式は declaration.ts の DeclarationSchema。 */
export const EstimateInputSchema = strictObject({
  deckCode: pipe(string(), nonEmpty()),
  /** 60 枚の内容。デッキコードの読み取り(docs/pokemon-tcg/deck-tool.md 手順 1)で読んだカード ID と枚数。 */
  decklist: pipe(
    array(
      strictObject({
        cardId: CardIdSchema,
        count: pipe(number(), integer(), minValue(1)),
      })
    ),
    minLength(1)
  ),
  declaration: DeclarationSchema,
  /** 出力の見出しに使うデッキの呼び名。 */
  name: pipe(string(), nonEmpty()),
  /** 枚数の変更案。changes はカード ID → 増減枚数で、合計は 0 にする(engine.ts の DeckVariant)。 */
  variants: optional(
    array(
      strictObject({
        changes: record(CardIdSchema, pipe(number(), integer())),
        label: pipe(string(), nonEmpty()),
      })
    )
  ),
});
export type EstimateInput = InferOutput<typeof EstimateInputSchema>;

function readInput(path: string): EstimateInput {
  const parsed = safeParse(
    EstimateInputSchema,
    JSON.parse(readFileSync(path, "utf8"))
  );
  if (!parsed.success) {
    throw new Error(
      `入力の JSON に誤りがある:\n${parsed.issues
        .map((issue) => `${getDotPath(issue) ?? "(全体)"}: ${issue.message}`)
        .join("\n")}`
    );
  }
  return parsed.output;
}

function parsePositiveInteger(
  argument: string | undefined,
  fallback: number,
  label: string
): number {
  if (argument === undefined) {
    return fallback;
  }
  const value = Number(argument);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label}は 1 以上の整数で渡す: ${argument}`);
  }
  return value;
}

/** 変更案と、その案で 60 枚に足す(元のデッキに無い)カード。前提に書くため。 */
interface VariantAddedCards {
  readonly addedCards: readonly Card[];
  readonly variant: DeckVariant;
}

interface EstimateRun {
  readonly cards: readonly Card[];
  readonly createPolicy: () => PlayingPolicy;
  readonly deadlines: readonly Deadline[];
  readonly input: EstimateInput;
  readonly maxTurn: number;
  readonly resolved: ResolvedDeclaration;
  readonly seed: number;
  readonly trials: number;
  readonly variants: readonly VariantAddedCards[];
}

/**
 * 変更案ごとに 60 枚を組み立て、元のデッキに無い記録のカードを集める。ここで組み立てるのは、変更案の誤り(記録の無い
 * カード ID、枚数が負になる、合計が変わる)を試行の前に見つけるためでもある(比較は元のデッキの試行の後に回る)。
 */
function listVariantAddedCards(
  decklist: EstimateInput["decklist"],
  baseCards: readonly Card[],
  variants: readonly DeckVariant[]
): VariantAddedCards[] {
  const baseRecords = new Set(baseCards.map((card) => card.record));
  return variants.map((variant) => ({
    addedCards: buildDeck(
      cardRecordTable,
      applyVariant(decklist, variant)
    ).filter((card) => !baseRecords.has(card.record)),
    variant,
  }));
}

/** 入力を読み、宣言と 60 枚の内容(変更案を含む)を記録に引き当て、探索の作り方をまとめる。 */
function prepareRun(argv: readonly string[]): EstimateRun {
  const [inputPath, trialsArgument, seedArgument] = argv;
  if (inputPath === undefined) {
    throw new Error("入力の JSON のパスを渡す");
  }
  const input = readInput(inputPath);
  const cardCount = input.decklist.reduce(
    (total, entry) => total + entry.count,
    0
  );
  if (cardCount !== DECK_SIZE) {
    throw new Error(
      `60 枚の内容の合計が ${cardCount} 枚で、${DECK_SIZE} 枚ではない`
    );
  }
  const resolved = resolveDeclaration(input.declaration, cardRecordTable);
  const deadlines = resolved.goals.flatMap((goal) =>
    resolved.deadlines.map((turn) => ({ goal: goal.name, turn }))
  );
  const cards = buildDeck(cardRecordTable, input.decklist);
  return {
    cards,
    createPolicy: () =>
      createSearchPolicy(resolved, createPathProgressEvaluator(resolved), {
        samplesForUncertainOutcome: SAMPLES_FOR_UNCERTAIN_OUTCOME,
        searchesEffectChoices: true,
        seed: SEARCH_SEED,
      }),
    deadlines,
    input,
    maxTurn: Math.max(...resolved.deadlines),
    resolved,
    seed: parsePositiveInteger(seedArgument, DEFAULT_SEED, "乱数の種"),
    trials: parsePositiveInteger(trialsArgument, DEFAULT_TRIALS, "試行回数"),
    variants: listVariantAddedCards(
      input.decklist,
      cards,
      input.variants ?? []
    ),
  };
}

/** 変更案で足すカードのカードごとの前提。元のデッキの前提に続けて出す(比較の数字だけ見て省略を見落とさないため)。 */
function formatVariantCardPremises(
  variants: readonly VariantAddedCards[]
): string[] {
  return variants.flatMap(({ addedCards, variant }) =>
    formatCardPremises(buildCardPremises(addedCards)).map(
      (line) => `変更案「${variant.label}」で足すカード: ${line}`
    )
  );
}

function printAssumptions(run: EstimateRun): void {
  console.log(
    formatAssumptions({
      assumptions: [
        ...DECK_INDEPENDENT_PREMISES,
        "手札の使い方は、宣言した狙いの成立確率を最大にする手を探索(道の揃い具合を見る評価)で選ぶ。実際のプレイヤーの判断とは違うことがある",
        ...formatCardPremises(buildCardPremises(run.cards)),
        ...formatVariantCardPremises(run.variants),
      ],
      deckCode: run.input.deckCode,
      title: `${run.input.name} の成立率(先攻・後攻 ${run.trials} 回ずつ、乱数の種 ${run.seed})`,
    })
  );
}

function formatSeconds(startedAt: number): string {
  return `${((performance.now() - startedAt) / 1000).toFixed(1)} 秒`;
}

/** 先攻・後攻それぞれの成立率の表と失敗の要因の内訳を出す。 */
function printRates(run: EstimateRun): void {
  for (const wentFirst of [true, false]) {
    const startedAt = performance.now();
    const summary = simulate({
      cards: run.cards,
      goals: run.resolved.goals,
      maxTurn: run.maxTurn,
      policy: run.createPolicy(),
      seed: run.seed,
      trials: run.trials,
      wentFirst,
    });
    console.log(formatSummary(summary, run.deadlines));
    console.log(`所要時間 ${formatSeconds(startedAt)}\n`);
  }
}

/** 入力に変更案があれば、枚数を変えたときの比較を出す。 */
function printVariantComparison(run: EstimateRun): void {
  const variants = run.variants.map((entry) => entry.variant);
  if (variants.length === 0) {
    return;
  }
  const startedAt = performance.now();
  console.log(
    formatVariantComparison(
      compareVariants({
        createPolicy: run.createPolicy,
        deadlines: run.deadlines,
        decklist: run.input.decklist,
        goals: run.resolved.goals,
        maxTurn: run.maxTurn,
        recordTable: cardRecordTable,
        seed: run.seed,
        trials: run.trials,
        variants,
      })
    )
  );
  console.log(`変更案の比較の所要時間 ${formatSeconds(startedAt)}\n`);
}

function main(argv: readonly string[]): void {
  const prepared = prepareRun(argv);
  printAssumptions(prepared);
  printRates(prepared);
  printVariantComparison(prepared);
}

main(process.argv.slice(2));

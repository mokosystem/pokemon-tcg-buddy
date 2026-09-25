/**
 * カードの記録(カード 1 種の属性、ワザと特性の一覧、効果の翻訳、裁定のデータ、含めなかった効果)の書式。
 *
 * 記録は src/card-records/ の JSON に 1 記録 1 ファイルで置き、このスキーマで検査する。TypeScript の型は
 * ここから導き、編集時の検証に使う JSON Schema(src/card-records/card-record.schema.json)もここから生成する。
 * 部品の意味と足す手順は docs/setup-rate-design.md「効果の記法と裁定のデータ」にある。
 *
 * スキーマの道具を valibot にしたのは、パッケージに実行時にコードを生成する処理(new Function、eval)が無く、
 * 依存も無く、JSON Schema を公式の @valibot/to-json-schema で出せるため(選定の記録は設計文書)。
 * 記録をまたぐ制約(カード ID の重複など)と、JSON Schema に変換できない制約はここに書かず、
 * card-record-validation.ts の検査関数に置く。
 */

import {
  array,
  boolean,
  type InferOutput,
  integer,
  isoDate,
  literal,
  minLength,
  minValue,
  nonEmpty,
  number,
  optional,
  picklist,
  pipe,
  regex,
  startsWith,
  strictObject,
  string,
  variant,
} from "valibot";

export const CardCategory = {
  BasicEnergy: "基本エネルギー",
  Goods: "グッズ",
  Pokemon: "ポケモン",
  SpecialEnergy: "特殊エネルギー",
  Stadium: "スタジアム",
  Supporter: "サポート",
  Tool: "ポケモンのどうぐ",
} as const;

export type CardCategory = (typeof CardCategory)[keyof typeof CardCategory];

export const EvolutionStage = {
  Basic: "たね",
  Stage1: "1進化",
  Stage2: "2進化",
} as const;

export type EvolutionStage =
  (typeof EvolutionStage)[keyof typeof EvolutionStage];

/** 記録の `$schema` の値。記録はすべて src/card-records/<カードの種類>/ にあり、スキーマはその 1 つ上に置く。 */
export const CARD_RECORD_SCHEMA_REFERENCE = "../card-record.schema.json";

const nonEmptyText = pipe(string(), nonEmpty());
const countFromZero = pipe(number(), integer(), minValue(0));
const countFromOne = pipe(number(), integer(), minValue(1));

/** タイプ。値はカード詳細ページのアイコンの class 名(icon-psychic など)に合わせ、icon-none(無色)だけ colorless にする。 */
export const PokemonTypeSchema = picklist([
  "grass",
  "fire",
  "water",
  "electric",
  "psychic",
  "fighting",
  "dark",
  "steel",
  "fairy",
  "dragon",
  "colorless",
]);
export type PokemonType = InferOutput<typeof PokemonTypeSchema>;

const CardCategorySchema = picklist(Object.values(CardCategory));
const EvolutionStageSchema = picklist(Object.values(EvolutionStage));

/** 特別なルールのうち、きぜつしたときに相手がとるサイドを増やすもの。メガシンカex もポケモンex として扱う(公式 Q&A「シアノ」)。 */
export const ExRuleSchema = picklist(["pokemonEx", "megaEvolutionEx"]);
export type ExRule = InferOutput<typeof ExRuleSchema>;

// ---- 条件: カードを選ぶ条件 ----

const cardFilterEntries = {
  categories: optional(array(CardCategorySchema)),
  /** この名前のカードを除く(モモワロウex の「しはいのくさり」: 「モモワロウex」をのぞく)。 */
  excludesNames: optional(array(nonEmptyText)),
  excludesPokemonWithRuleBox: optional(literal(true)),
  exRules: optional(array(ExRuleSchema)),
  /** 「テラスタル」のポケモンだけ(ガラスのラッパ、ゼロの大空洞)。 */
  isTerastal: optional(literal(true)),
  maxHp: optional(countFromZero),
  /**
   * 名前にこの文字列を含む。「シロナのポケモン」のようなトレーナーの名前のついたポケモンは「シロナの」と書く
   * (公式 Q&A: 名前に「ロケット団の」とつくポケモンを「ロケット団のポケモン」として扱う。カードの記録の裁定のデータ)。
   */
  nameIncludes: optional(nonEmptyText),
  names: optional(array(nonEmptyText)),
  pokemonTypes: optional(array(PokemonTypeSchema)),
  /** エネルギーが供給するタイプ。「基本超エネルギー」は種類の基本エネルギーとこの欄の psychic で書く。 */
  providedEnergyTypes: optional(array(PokemonTypeSchema)),
  stages: optional(array(EvolutionStageSchema)),
};

/**
 * 1 枚のカードに対する条件。書いた欄はすべて満たす必要があり(かつ)、欄の中の並びはどれか 1 つでよい(または)。
 * 欄をまたぐ「または」(闘タイプのたねポケモン、または基本闘エネルギー)は anyOf に並べ、1 段だけ入れ子にできる。
 * 欄が無ければ好きなカード。
 */
export const CardFilterSchema = strictObject({
  ...cardFilterEntries,
  anyOf: optional(pipe(array(strictObject(cardFilterEntries)), minLength(2))),
});
export type CardFilter = InferOutput<typeof CardFilterSchema>;

/** 場のポケモンに対する条件。カードを選ぶ条件を場のいちばん上のカードに当て、加えて場所で絞る。 */
export const PokemonInPlayFilterSchema = strictObject({
  ...CardFilterSchema.entries,
  positions: optional(array(picklist(["active", "bench"]))),
});
export type PokemonInPlayFilter = InferOutput<typeof PokemonInPlayFilterSchema>;

// ---- 条件: 効果を使える条件 ----

const basicConditionOptions = [
  strictObject({
    condition: literal("selfIsActive"),
  }),
  /** このポケモンがベンチにいる(ゾロアークの「よるのぬけみち」、ソルガレオの「サンライズ」)。 */
  strictObject({
    condition: literal("selfIsOnBench"),
  }),
  strictObject({
    condition: literal("selfHasNoEnergyAttached"),
  }),
  /** このポケモンにエネルギーがついている(ハクリューの「しんかのみちびき」)。 */
  strictObject({
    condition: literal("selfHasEnergyAttached"),
  }),
  strictObject({
    condition: literal("attachedPokemonMatches"),
    filter: PokemonInPlayFilterSchema,
  }),
  strictObject({
    condition: literal("ownPokemonInPlayExists"),
    filter: PokemonInPlayFilterSchema,
  }),
  strictObject({
    condition: literal("deckHasCards"),
    minCount: countFromOne,
  }),
  strictObject({
    condition: literal("handHasCards"),
    filter: optional(CardFilterSchema),
    /** 使おうとしているこのカードを除いた手札で数える。 */
    minCountExcludingThisCard: countFromOne,
  }),
  /** 使おうとしているこのカードを除いた手札が、maxCountExcludingThisCard 枚以下(アイリスの闘志)。 */
  strictObject({
    condition: literal("handHasAtMostCards"),
    maxCountExcludingThisCard: countFromZero,
  }),
  strictObject({
    condition: literal("noAbilityUsedThisTurnWithNameIncluding"),
    text: nonEmptyText,
  }),
  strictObject({
    condition: literal("ownRemainingPrizesAre"),
    count: countFromZero,
  }),
  /** 場にこの名前のスタジアムが出ている(カミッチュなどの「おまつりおんど」: 「お祭り会場」)。 */
  strictObject({
    condition: literal("stadiumInPlayNamed"),
    name: nonEmptyText,
  }),
  /** 自分のバトルポケモンが、この名前の特性を持つ(バチンキーの「ドンドンだいこ」: 「おまつりおんど」)。 */
  strictObject({
    abilityName: nonEmptyText,
    condition: literal("activePokemonHasAbilityNamed"),
  }),
  /** この番に手札から使ったサポートの名前に、この文字列を含む(ロケット団のファクトリー: 「ロケット団」)。 */
  strictObject({
    condition: literal("supporterUsedThisTurnNameIncludes"),
    text: nonEmptyText,
  }),
  /** 手札が、使おうとしているこのカード 1 枚だけ(グラジオの決戦)。 */
  strictObject({
    condition: literal("handHasNoOtherCards"),
  }),
] as const;

export const BasicConditionSchema = variant("condition", basicConditionOptions);

/** 効果を使える条件。「または」は 1 段だけ入れ子にでき、中には「または」を置かない。 */
export const ConditionSchema = variant("condition", [
  ...basicConditionOptions,
  strictObject({
    condition: literal("anyOf"),
    conditions: pipe(array(BasicConditionSchema), minLength(2)),
  }),
]);
export type Condition = InferOutput<typeof ConditionSchema>;

// ---- 基本操作 ----

export const DrawCountSchema = variant("kind", [
  strictObject({ kind: literal("fixed"), value: countFromOne }),
  strictObject({
    kind: literal("perCardDiscardedEarlierInThisEffect"),
    multiplier: countFromOne,
  }),
  /** 手札がこの枚数になるように引く。手札がすでにこの枚数以上なら引かない。 */
  strictObject({ handSize: countFromOne, kind: literal("untilHandSize") }),
]);
export type DrawCount = InferOutput<typeof DrawCountSchema>;

/**
 * 山札の上から見たカードのうち、選ばなかった残りの扱い。shuffleThenBottomOfDeck は残りを切ってから
 * 山札の下に置く(メガレックウザex の「はしゃのほうこう」)。
 */
const DeckTopRestPlacementSchema = picklist([
  "shuffleIntoDeck",
  "bottomOfDeck",
  "shuffleThenBottomOfDeck",
]);

/**
 * 効果でつけるエネルギーの上限。fixed は決まった枚数、coinFlipsUntilTails はウラが出るまでコインを投げたオモテの数
 * (ピカチュウ 050648 の「じゅうでんダッシュ」)。コインはオモテとウラを 1/2 ずつとする。
 */
export const AttachCountSchema = variant("kind", [
  strictObject({ kind: literal("fixed"), value: countFromOne }),
  strictObject({ kind: literal("coinFlipsUntilTails") }),
]);
export type AttachCount = InferOutput<typeof AttachCountSchema>;

/** 山札から探す 1 回分。条件に合うカードを最大 maxCount 枚選ぶ。 */
export const DeckSearchPickSchema = strictObject({
  filter: CardFilterSchema,
  maxCount: countFromOne,
});

const basicOperationOptions = [
  strictObject({
    count: DrawCountSchema,
    operation: literal("drawCards"),
  }),
  strictObject({
    operation: literal("shuffleHandIntoDeck"),
  }),
  /** 手札を count 枚選び、山札の上に置く(夜のアカデミー)。山札は切らない。山札が 0 枚でも置ける(公式 Q&A「夜のアカデミー」)。 */
  strictObject({
    count: countFromOne,
    operation: literal("placeHandCardsOnDeckTop"),
  }),
  /** 手札をすべてトラッシュする。手札が 0 枚でも使える(公式 Q&A「ゼイユ」)。 */
  strictObject({
    operation: literal("discardHand"),
  }),
  strictObject({
    filter: optional(CardFilterSchema),
    maxCount: countFromOne,
    minCount: countFromZero,
    operation: literal("discardFromHand"),
  }),
  strictObject({
    operation: literal("searchDeckIntoHand"),
    picks: pipe(array(DeckSearchPickSchema), minLength(1)),
  }),
  /**
   * 山札から、picks のうち 1 つを選んで、その条件に合うカードを上限まで手札に加えて切る(タケシのスカウト:
   * たねポケモンを 2 枚まで、または進化ポケモンを 1 枚)。どの 1 つにするかはプレイングの判断基準が決める。
   */
  strictObject({
    operation: literal("searchDeckIntoHandFromOneOfPicks"),
    picks: pipe(array(DeckSearchPickSchema), minLength(2)),
  }),
  strictObject({
    filter: CardFilterSchema,
    maxCount: countFromOne,
    operation: literal("searchDeckOntoBench"),
  }),
  strictObject({
    energyFilter: CardFilterSchema,
    operation: literal("searchDeckAndAttachEnergyToEachPokemon"),
    targetFilter: PokemonInPlayFilterSchema,
  }),
  strictObject({
    filter: CardFilterSchema,
    maxCount: countFromOne,
    operation: literal("searchDeckIntoHandAndAttachRest"),
    requiresDistinctTypes: boolean(),
    targetFilter: PokemonInPlayFilterSchema,
  }),
  strictObject({
    canContinueToStage2: boolean(),
    operation: literal("evolveFromDeck"),
  }),
  /** 山札から条件に合うエネルギーを maxCount 枚まで選び、条件に合う自分のポケモン 1 匹にまとめてつけて切る。 */
  strictObject({
    energyFilter: CardFilterSchema,
    maxCount: countFromOne,
    operation: literal("searchDeckAndAttachEnergyToOnePokemon"),
    targetFilter: PokemonInPlayFilterSchema,
  }),
  /**
   * 山札から条件に合うエネルギーを maxCount 枚まで選び、条件に合う自分のポケモンに好きなようにつけて切る
   * (マリィのオーロンゲex の「パンクアップ」)。1 枚も選ばなくてよい(公式 Q&A「パンクアップ」)。
   */
  strictObject({
    energyFilter: CardFilterSchema,
    maxCount: countFromOne,
    operation: literal("searchDeckAndAttachEnergyDistributedToPokemon"),
    targetFilter: PokemonInPlayFilterSchema,
  }),
  /**
   * 山札から好きなカードを count 枚選び、残りの山札を切ってから、選んだカードを好きな順で山札の上に置く
   * (暗号マニアの解読)。山札が count 枚に満たなければ全部を選ぶ(公式 Q&A「マオ」: 2 枚以上あれば必ず 2 枚選ぶ)。
   */
  strictObject({
    count: countFromOne,
    operation: literal("searchDeckAndPlaceOnTopAfterShuffle"),
  }),
  strictObject({
    filter: CardFilterSchema,
    lookCount: countFromOne,
    maxTakeCount: countFromOne,
    minTakeCount: countFromZero,
    operation: literal("lookAtDeckTopAndTakeIntoHand"),
    restPlacement: DeckTopRestPlacementSchema,
  }),
  /** 山札の上から lookCount 枚を見て、条件に合うエネルギーをこのポケモン(効果の持ち主)につける。 */
  strictObject({
    filter: CardFilterSchema,
    lookCount: countFromOne,
    maxAttachCount: countFromOne,
    minAttachCount: countFromZero,
    operation: literal("lookAtDeckTopAndAttachEnergyToSelf"),
    restPlacement: DeckTopRestPlacementSchema,
  }),
  /**
   * 山札の上から lookCount 枚を見て、条件に合うエネルギーを選び、条件に合う自分のポケモンに好きなようにつける
   * (メタングの「メタルメーカー」)。
   */
  strictObject({
    filter: CardFilterSchema,
    lookCount: countFromOne,
    maxAttachCount: countFromOne,
    minAttachCount: countFromZero,
    operation: literal("lookAtDeckTopAndAttachEnergyToOwnPokemon"),
    restPlacement: DeckTopRestPlacementSchema,
    targetFilter: PokemonInPlayFilterSchema,
  }),
  strictObject({
    filter: CardFilterSchema,
    maxCount: countFromOne,
    minCount: countFromZero,
    operation: literal("addFromDiscardToHand"),
  }),
  strictObject({
    filter: CardFilterSchema,
    maxCount: countFromOne,
    operation: literal("placeFromDiscardOntoBench"),
  }),
  /** トラッシュから条件に合うカードを minCount〜maxCount 枚選び、山札に戻して切る(せいなるはい)。 */
  strictObject({
    filter: CardFilterSchema,
    maxCount: countFromOne,
    minCount: countFromZero,
    operation: literal("returnFromDiscardToDeck"),
  }),
  /** 手札から条件に合うエネルギーを 1〜maxCount 枚選び、条件に合う自分のポケモン 1 匹につける。手札からつける番に 1 回には数えない。 */
  strictObject({
    energyFilter: CardFilterSchema,
    maxCount: countFromOne,
    operation: literal("attachEnergyFromHand"),
    targetFilter: PokemonInPlayFilterSchema,
  }),
  /**
   * 手札から条件に合うエネルギーを好きなだけ選び、条件に合う自分のポケモンに好きなようにつける(ピカチュウex 050660 の
   * 「ビリビリフィーバー」)。手札からつける番に 1 回には数えない。
   */
  strictObject({
    energyFilter: CardFilterSchema,
    operation: literal("attachEnergyFromHandDistributedToPokemon"),
    targetFilter: PokemonInPlayFilterSchema,
  }),
  /**
   * 山札から条件に合うエネルギーを maxCount 枚まで選び、このポケモン(効果の持ち主)につけて切る(ソルガレオの
   * 「サンライズ」、ピカチュウ 050648 の「じゅうでんダッシュ」)。
   */
  strictObject({
    energyFilter: CardFilterSchema,
    maxCount: AttachCountSchema,
    operation: literal("searchDeckAndAttachEnergyToSelf"),
  }),
  /** 手札から条件に合うエネルギーを 1〜maxCount 枚選び、このポケモン(効果の持ち主)につける。手札からつける番に 1 回には数えない。 */
  strictObject({
    energyFilter: CardFilterSchema,
    maxCount: countFromOne,
    operation: literal("attachEnergyFromHandToSelf"),
  }),
  /**
   * トラッシュから条件に合うエネルギーを maxCount 枚まで選び、条件に合う自分のポケモン 1 匹にまとめてつける
   * (ミュウツーの「ちからをあたえる」)。
   */
  strictObject({
    energyFilter: CardFilterSchema,
    maxCount: countFromOne,
    operation: literal("attachEnergyFromDiscardToOnePokemon"),
    targetFilter: PokemonInPlayFilterSchema,
  }),
  /** 条件に合う自分のポケモンを maxPokemonCount 匹まで選び、トラッシュから条件に合うエネルギーを 1 枚ずつつける。 */
  strictObject({
    energyFilter: CardFilterSchema,
    maxPokemonCount: countFromOne,
    operation: literal("attachEnergyFromDiscardToEachChosenPokemon"),
    targetFilter: PokemonInPlayFilterSchema,
  }),
  /**
   * トラッシュから条件に合うエネルギーを maxCount 枚まで選び、条件に合う自分のポケモンに好きなようにつける
   * (1 匹に何枚つけてもよい。メガルカリオex の「はどうづき」)。1 枚も選ばなくてよい(公式 Q&A「はどうづき」)。
   */
  strictObject({
    energyFilter: CardFilterSchema,
    maxCount: countFromOne,
    operation: literal("attachEnergyFromDiscardDistributedToPokemon"),
    targetFilter: PokemonInPlayFilterSchema,
  }),
  /** 自分のベンチポケモンについているエネルギーを合計 maxCount 個まで選び、バトルポケモンにつけ替える(Nの筋書き)。 */
  strictObject({
    maxCount: countFromOne,
    operation: literal("moveEnergyFromBenchToActive"),
  }),
  /**
   * この効果の中の入れ替え(switchActiveWithBench)でベンチに下がったポケモンのエネルギーを 1 個選び、新しいバトルポケモンに
   * つけ替える(ヒガナの信頼)。
   */
  strictObject({
    operation: literal("moveEnergyFromSwitchedOutPokemonToActive"),
  }),
  /** 自分の場のほかのポケモンについているエネルギーを好きなだけ選び、このポケモン(効果の持ち主)につけ替える。 */
  strictObject({
    operation: literal("moveAnyEnergyFromOwnPokemonToSelf"),
  }),
  /** 自分の場のポケモンについている条件に合うエネルギーを 1 枚選び、自分の別のポケモンにつけ替える。 */
  strictObject({
    energyFilter: CardFilterSchema,
    operation: literal("moveEnergyToAnotherOwnPokemon"),
  }),
  /**
   * この番、条件に合う自分のポケモンが使うワザの、相手のバトルポケモンへのダメージを amount 増やす(パワープロテイン)。
   * 条件はワザを使うポケモン(バトルポケモン)に当てる。
   */
  strictObject({
    amount: countFromOne,
    attackerFilter: PokemonInPlayFilterSchema,
    operation: literal("increaseAttackDamageThisTurn"),
  }),
  strictObject({
    operation: literal("evolveBasicToStage2FromHand"),
  }),
  /** バトルポケモンをベンチポケモンと入れ替える。benchFilter はバトル場に出すベンチポケモンの条件。 */
  strictObject({
    benchFilter: optional(CardFilterSchema),
    operation: literal("switchActiveWithBench"),
  }),
  strictObject({
    operation: literal("returnSelfToDeck"),
  }),
  /** ベンチにいるこのポケモン(効果の持ち主)を、バトルポケモンと入れ替える(テツノイサハex の「ラピッドバーニア」)。 */
  strictObject({
    operation: literal("switchSelfWithActive"),
  }),
  strictObject({
    operation: literal("returnPokemonToHand"),
    target: picklist(["self", "chosenOwnPokemon"]),
  }),
  strictObject({
    operation: literal("placeSelfOnBenchFromHand"),
  }),
  strictObject({
    operation: literal("discardSelf"),
  }),
  /** 山札の上から count 枚トラッシュする(ボーマンダex の「りゅうのはどう」)。山札が足りなければある分だけ。 */
  strictObject({
    count: countFromOne,
    operation: literal("discardFromDeckTop"),
  }),
  /**
   * この効果の中で山札の上からトラッシュしたカードから、minCount〜maxCount 枚を選んで手札に加える
   * (モルペコの「おやつをえらぶ」)。
   */
  strictObject({
    maxCount: countFromOne,
    minCount: countFromZero,
    operation: literal("addCardsDiscardedFromDeckTopInThisEffectToHand"),
  }),
  /** 場のスタジアムをトラッシュする(イーユイの「グラウンドメルト」)。 */
  strictObject({
    operation: literal("discardStadiumInPlay"),
  }),
] as const;

export const BasicOperationSchema = variant("operation", basicOperationOptions);
export type BasicOperation = InferOutput<typeof BasicOperationSchema>;

/** 操作の列の 1 歩。条件で分かれる歩は 1 段だけ入れ子にでき、中には分かれる歩を置かない。 */
export const EffectStepSchema = variant("operation", [
  ...basicOperationOptions,
  strictObject({
    condition: ConditionSchema,
    operation: literal("branchOnCondition"),
    stepsOtherwise: array(BasicOperationSchema),
    stepsWhenMet: array(BasicOperationSchema),
  }),
  /**
   * コインを 1 回投げ、オモテなら stepsWhenHeads を行う(ビビヨンの「みちびきのまい」、メタモンの「どっきりへんしん」)。
   * コインはオモテとウラを 1/2 ずつとする。使えるかの判定(状態を変えない)で乱数を引かないよう、条件ではなく操作の列の
   * 1 歩にしている。
   */
  strictObject({
    operation: literal("branchOnCoinFlip"),
    stepsWhenHeads: pipe(array(BasicOperationSchema), minLength(1)),
  }),
]);
export type EffectStep = InferOutput<typeof EffectStepSchema>;

/** 使える条件と操作の列。isOptional はワザの「のぞむなら」のように、効果を起こすかを選べるもの。 */
export const EffectSchema = strictObject({
  isOptional: boolean(),
  steps: pipe(array(EffectStepSchema), minLength(1)),
  useConditions: array(ConditionSchema),
});
export type Effect = InferOutput<typeof EffectSchema>;

// ---- 場にある間ずっと働く効果 ----

/** エネルギーが供給するもの。1 枚が何個ぶんとして働くか。anyType はすべてのタイプとして働く。 */
export const EnergyProvisionSchema = variant("kind", [
  strictObject({
    kind: literal("type"),
    type: PokemonTypeSchema,
    units: countFromOne,
  }),
  strictObject({
    kind: literal("anyType"),
    units: countFromOne,
  }),
]);
export type EnergyProvision = InferOutput<typeof EnergyProvisionSchema>;

export const ContinuousScopeSchema = variant("scope", [
  /** 持ち主自身。特殊エネルギーではそのエネルギー自身。 */
  strictObject({ scope: literal("self") }),
  /** ポケモンのどうぐ・特殊エネルギーをつけているポケモン。 */
  strictObject({ scope: literal("attachedPokemon") }),
  /** 自分の場の条件に合うポケモン全員。おたがいに働く効果も、相手の場は乱数試行の外なので自分の場だけを書く。 */
  strictObject({
    filter: PokemonInPlayFilterSchema,
    scope: literal("ownPokemon"),
  }),
  /** ポケモンではなく自分(プレイヤー)の値を変える効果(ベンチの上限)。 */
  strictObject({ scope: literal("ownPlayer") }),
]);

export const ContinuousChangeSchema = variant("change", [
  strictObject({ change: literal("setRetreatCostToZero") }),
  strictObject({
    amount: countFromOne,
    change: literal("reduceRetreatCost"),
  }),
  strictObject({ change: literal("allowBenchedPokemonAttacks") }),
  /** 範囲のポケモンが使うワザに必要なエネルギーを、無色 count 個ぶん多くする(夜の鉱山)。ワザを使うポケモンに当てる。 */
  strictObject({
    change: literal("addColorlessToAttackCost"),
    count: countFromOne,
  }),
  /**
   * 持っているワザを 2 回連続で使える(アズマオウなどの「おまつりおんど」)。2 回目は、このポケモンが記録に持つワザから
   * 選び直す。効果で使えるようになったワザは選べない(公式 Q&A「おまつりおんど」)。
   */
  strictObject({ change: literal("useAttacksTwice") }),
  strictObject({ change: literal("negateAbilities") }),
  strictObject({ change: literal("negateToolEffects") }),
  strictObject({
    change: literal("setEnergyProvision"),
    provision: EnergyProvisionSchema,
  }),
  /**
   * 範囲のポケモンについている、energyFilter に合うエネルギーの供給を provision にする(メガニウムの「おいしげる」:
   * 基本草エネルギーが草 2 個ぶん)。同じ項目の効果が複数働いても重ならない。
   */
  strictObject({
    change: literal("setAttachedEnergyProvision"),
    energyFilter: CardFilterSchema,
    provision: EnergyProvisionSchema,
  }),
  /** ベンチに出せるポケモンの数。範囲は ownPlayer にする(card-record-validation.ts が検査する)。 */
  strictObject({
    change: literal("setBenchLimit"),
    limit: countFromOne,
  }),
  /**
   * 手札の進化ポケモンのうち evolutionFilter に合い、進化前の名前が name のものを、このポケモンにのせて進化させられる
   * (イーブイex の「にじいろDNA」)。手札から進化させるときだけ働く。
   */
  strictObject({
    change: literal("allowEvolutionFromHandAsIfNamed"),
    evolutionFilter: CardFilterSchema,
    name: nonEmptyText,
  }),
  /**
   * 範囲のポケモンを、出したばかりの番(最初の自分の番を除く)でも、evolutionFilter に合う手札の進化ポケモンに進化させられる
   * (活力の森)。手札から進化させるときだけ働き、ふしぎなアメには働かない(公式 Q&A「活力の森」)。
   */
  strictObject({
    change: literal("allowEvolvingFreshPokemon"),
    evolutionFilter: CardFilterSchema,
  }),
  /**
   * 範囲のポケモンが使うワザの、相手のバトルポケモンへのダメージを amount 増やす(シロナのロズレイドの
   * 「グローリーエール」)。範囲はワザを使うポケモン(バトルポケモン)に当てる。
   */
  strictObject({
    amount: countFromOne,
    change: literal("increaseAttackDamage"),
  }),
]);

export const ContinuousEffectSchema = strictObject({
  change: ContinuousChangeSchema,
  conditions: array(ConditionSchema),
  scope: ContinuousScopeSchema,
});
export type ContinuousEffect = InferOutput<typeof ContinuousEffectSchema>;

// ---- ワザ ----

/** ダメージの上乗せを数える対象。 */
export const DamageCountTargetSchema = variant("count", [
  /**
   * 自分のポケモン全員についている、いずれかのタイプのエネルギーの数。すべてのタイプとして働くエネルギーは
   * 1 個ぶんを 1 つと数える(公式 Q&A「ストームエメラルダ」: プリズムエネルギー 3 枚で炎と雷の数は 3)。
   */
  strictObject({
    count: literal("energyAttachedToOwnPokemon"),
    energyTypes: pipe(array(PokemonTypeSchema), minLength(1)),
  }),
  strictObject({
    abilityName: nonEmptyText,
    count: literal("discardPokemonWithAbilityName"),
  }),
  /**
   * ワザを使うポケモンについているエネルギーの数(メガドリュウズex の「マキシマムドリル」)。energyTypes を書けば、
   * そのいずれかのタイプとして数えられる個数(カイオーガの「ハイドロポンプ」: 水エネルギーの数)。すべてのタイプとして
   * 働く 1 個は 1 つと数える。
   */
  strictObject({
    count: literal("energyAttachedToAttackingPokemon"),
    energyTypes: optional(pipe(array(PokemonTypeSchema), minLength(1))),
  }),
  /** 自分のポケモン全員についている基本エネルギーの枚数(タケルライコex の「きょくらいごう」)。 */
  strictObject({ count: literal("basicEnergyAttachedToOwnPokemon") }),
  /** 場に出ているスタジアムの数(0 か 1。イーユイの「グラウンドメルト」)。 */
  strictObject({ count: literal("stadiumsInPlay") }),
  /**
   * 自分の場の、条件に合うポケモンの数。条件が無ければ場のポケモン全員(エーフィex の「サンシャインビート」)。
   * ベンチの数は positions に bench(テラパゴスex の「ユニオンビート」)、たねポケモンの数は stages にたね
   * (ナゲツケサルの「れんけいスロー」)を書く。
   */
  strictObject({
    count: literal("ownPokemonInPlay"),
    filter: optional(PokemonInPlayFilterSchema),
  }),
]);

export const DamageBonusSchema = variant("kind", [
  strictObject({
    kind: literal("perCount"),
    target: DamageCountTargetSchema,
    unit: countFromOne,
  }),
  strictObject({
    add: countFromOne,
    atLeast: countFromOne,
    kind: literal("whenCountAtLeast"),
    target: DamageCountTargetSchema,
  }),
]);
export type DamageBonus = InferOutput<typeof DamageBonusSchema>;

/**
 * ワザのダメージ。コイン、相手の側、追加のコストで決まる上乗せは持たず、含めなかった効果に書く。
 * ほかのカードがダメージを増やす効果(グッズ、特性)は、そのカードの記録の翻訳に書く。
 */
export const AttackDamageSchema = variant("kind", [
  strictObject({ kind: literal("none") }),
  strictObject({
    amount: countFromZero,
    bonus: optional(DamageBonusSchema),
    kind: literal("fixed"),
  }),
]);
export type AttackDamage = InferOutput<typeof AttackDamageSchema>;

export const AttackSchema = strictObject({
  /** 必要なエネルギー。無色は colorless。必要なエネルギーが無いワザは空の並び。 */
  cost: array(PokemonTypeSchema),
  damage: AttackDamageSchema,
  /** ダメージ以外の効果の翻訳。ダメージだけのワザ、翻訳しない効果のワザは持たない。 */
  effect: optional(EffectSchema),
  name: nonEmptyText,
  /**
   * 自分のベンチの条件に合うポケモンが持つワザを 1 つ選び、このワザとして使う(Nのゾロアークex の
   * 「ナイトジョーカー」)。選んだワザは、このワザに必要なエネルギーで使える(continuous-effects.ts の listUsableAttacks)。
   */
  usesAttackOfBenchedPokemon: optional(CardFilterSchema),
  /**
   * 山札の上から 1 枚トラッシュし、それが条件に合うポケモンなら、そのポケモンが持つワザを 1 つ選び、このワザとして
   * 使う(ヤドキングの「ひらめきチャレンジ」)。選んだワザは、このワザに必要なエネルギーで使える。山札の上が
   * 何のカードか分かっているときだけ使えるワザに出す(continuous-effects.ts の listDeckTopAttacksUsedAs)。
   */
  usesAttackOfDiscardedDeckTop: optional(CardFilterSchema),
});
export type Attack = InferOutput<typeof AttackSchema>;

// ---- 特性 ----

export const AbilityTranslationSchema = variant("kind", [
  strictObject({
    effect: EffectSchema,
    kind: literal("activatedInPlay"),
    usageLimit: picklist([
      "oncePerTurnPerPokemon",
      "oncePerTurnPerAbilityName",
      "unlimited",
    ]),
  }),
  strictObject({
    effect: EffectSchema,
    kind: literal("activatedFromHand"),
  }),
  strictObject({
    effect: EffectSchema,
    kind: literal("triggeredWhenPlacedOnBenchFromHand"),
  }),
  /** 手札から出して進化させたとき(ふしぎなアメで進化させたときを含む)。山札から進化させたときは起きない。 */
  strictObject({
    effect: EffectSchema,
    kind: literal("triggeredWhenEvolvedFromHand"),
  }),
  strictObject({
    continuousEffect: ContinuousEffectSchema,
    kind: literal("continuous"),
  }),
]);
export type AbilityTranslation = InferOutput<typeof AbilityTranslationSchema>;

/** 特性。名前は翻訳の有無によらず持つ(特性の名前で数える条件があるため)。翻訳しない特性は translation を持たない。 */
export const AbilitySchema = strictObject({
  name: nonEmptyText,
  translation: optional(AbilityTranslationSchema),
});
export type Ability = InferOutput<typeof AbilitySchema>;

// ---- トレーナーズと特殊エネルギーの効果 ----

export const CardEffectSchema = variant("kind", [
  /**
   * グッズ・サポートを使ったとき。usableOnFirstTurnGoingFirst は基本ルールの例外の印で、先攻の最初の番でも
   * サポートを使える(ゼイユ)。例外はカード自身に書かれている(docs/pokemon-tcg/basic-rules.md)。
   */
  strictObject({
    effect: EffectSchema,
    kind: literal("whenPlayed"),
    usableOnFirstTurnGoingFirst: optional(literal(true)),
  }),
  /** スタジアムの「自分の番ごとに 1 回」。 */
  strictObject({
    effect: EffectSchema,
    kind: literal("activatedOncePerTurn"),
  }),
  strictObject({
    continuousEffect: ContinuousEffectSchema,
    kind: literal("continuous"),
  }),
  strictObject({
    effect: EffectSchema,
    kind: literal("triggeredWhenAttachedFromHand"),
  }),
  strictObject({
    effect: EffectSchema,
    kind: literal("triggeredAtEndOfOwnTurn"),
  }),
]);
export type CardEffect = InferOutput<typeof CardEffectSchema>;

// ---- 裁定のデータ ----

export const RulingSourceSchema = variant("kind", [
  strictObject({
    checkedOn: pipe(string(), isoDate()),
    kind: literal("officialQa"),
    /** 該当した質問の要旨。公式 Q&A の質問文と回答文は転載せず、自分の言葉で書く。 */
    questionSummary: nonEmptyText,
    searchUrl: pipe(
      string(),
      startsWith("https://www.pokemon-card.com/rules/faq/search.php?")
    ),
  }),
  strictObject({
    /** 解釈の拠り所(基本ルール、同じ書き方の別のカードの公式 Q&A など)。 */
    basis: nonEmptyText,
    checkedOn: pipe(string(), isoDate()),
    kind: literal("noMatchingQa"),
    searchTerms: pipe(array(nonEmptyText), minLength(1)),
  }),
]);

export const RulingSchema = strictObject({
  /** 採った解釈。 */
  interpretation: nonEmptyText,
  /** カードテキストだけでは決まらない点。 */
  question: nonEmptyText,
  /** 記録のどの条件や操作に反映したか。 */
  reflectedIn: nonEmptyText,
  source: RulingSourceSchema,
});
export type Ruling = InferOutput<typeof RulingSchema>;

// ---- 含めなかった効果 ----

/**
 * 含めなかった理由。相手の側に働く、特殊状態、回復、ダメージやダメカンを与える処理、ダメージの上乗せのうち
 * 記録に持たないもの(コイン、相手の側、追加のコストで決まるもの)、自分の次の番の制限、後攻の最初の番に使えない制限、
 * 一人回しでは使う理由が無い。
 */
export const ExclusionReasonSchema = picklist([
  "requiresOpponent",
  "specialCondition",
  "healing",
  "damageOrDamageCounters",
  "damageBonusNotModeled",
  "ownNextTurnRestriction",
  "firstTurnGoingSecondRestriction",
  "noReasonToUseInSoloPlay",
]);
export type ExclusionReason = InferOutput<typeof ExclusionReasonSchema>;

export const ExcludedEffectSchema = strictObject({
  /** 何を含めなかったか。計算の前提にそのまま出すので、カードテキストを引き写さず自分の言葉で書く。 */
  description: nonEmptyText,
  reason: ExclusionReasonSchema,
});
export type ExcludedEffect = InferOutput<typeof ExcludedEffectSchema>;

// ---- 記録 ----

export const TranslationStatusSchema = picklist([
  "translated",
  "notTranslatable",
  "irrelevantToCalculation",
  "notYetTranslated",
]);
export type TranslationStatus = InferOutput<typeof TranslationStatusSchema>;

const commonRecordEntries = {
  $schema: literal(CARD_RECORD_SCHEMA_REFERENCE),
  /** 印刷のカード ID の並び。先頭が詳細ページを読んだ印刷。 */
  cardIds: pipe(array(pipe(string(), regex(/^[0-9]{6}$/))), minLength(1)),
  excludedEffects: array(ExcludedEffectSchema),
  name: nonEmptyText,
  rulings: array(RulingSchema),
  translationStatus: TranslationStatusSchema,
  /** 3 点確認(実在、スタンダードで使えるか、カードテキスト)をした日。 */
  verifiedOn: pipe(string(), isoDate()),
};

const pokemonRecordEntries = {
  ...commonRecordEntries,
  abilities: array(AbilitySchema),
  attacks: array(AttackSchema),
  category: literal(CardCategory.Pokemon),
  /** ポケモンex・メガシンカex のルール。どちらでもないポケモンは持たない。 */
  exRule: optional(ExRuleSchema),
  hasRuleBox: boolean(),
  hp: countFromOne,
  isTerastal: boolean(),
  pokemonType: PokemonTypeSchema,
  retreatCost: countFromZero,
};

/** ポケモンの記録。進化前の名前と進化の系統のたねポケモンの名前は、それを持つ進化の段階だけが持つ。 */
export const PokemonRecordSchema = variant("stage", [
  strictObject({
    ...pokemonRecordEntries,
    stage: literal(EvolutionStage.Basic),
  }),
  strictObject({
    ...pokemonRecordEntries,
    /** 進化前のポケモンの名前。 */
    evolvesFrom: nonEmptyText,
    stage: literal(EvolutionStage.Stage1),
  }),
  strictObject({
    ...pokemonRecordEntries,
    /** 進化の系統のたねポケモンの名前。1進化を飛ばす進化(ふしぎなアメ)の判定に使う。 */
    basicPokemonOfEvolutionLine: nonEmptyText,
    evolvesFrom: nonEmptyText,
    stage: literal(EvolutionStage.Stage2),
  }),
]);

function defineTrainerRecordSchema<
  const Category extends
    | typeof CardCategory.Goods
    | typeof CardCategory.Supporter
    | typeof CardCategory.Stadium
    | typeof CardCategory.Tool,
>(category: Category) {
  return strictObject({
    ...commonRecordEntries,
    cardEffects: array(CardEffectSchema),
    category: literal(category),
  });
}

const BasicEnergyRecordSchema = strictObject({
  ...commonRecordEntries,
  category: literal(CardCategory.BasicEnergy),
  provision: EnergyProvisionSchema,
});

const SpecialEnergyRecordSchema = strictObject({
  ...commonRecordEntries,
  cardEffects: array(CardEffectSchema),
  category: literal(CardCategory.SpecialEnergy),
  provision: EnergyProvisionSchema,
});

export const CardRecordSchema = variant("category", [
  PokemonRecordSchema,
  defineTrainerRecordSchema(CardCategory.Goods),
  defineTrainerRecordSchema(CardCategory.Supporter),
  defineTrainerRecordSchema(CardCategory.Stadium),
  defineTrainerRecordSchema(CardCategory.Tool),
  BasicEnergyRecordSchema,
  SpecialEnergyRecordSchema,
]);
export type CardRecord = InferOutput<typeof CardRecordSchema>;
export type PokemonRecord = InferOutput<typeof PokemonRecordSchema>;

/**
 * JSON Schema に書き出すときに $defs へ切り出す部品。切り出さないと、同じ部品が参照される箇所ごとに
 * 展開されて 1 万行を超える(2026-09-23 に @valibot/to-json-schema 1.8.0 で約 17 万行を観測)。
 */
export const CARD_RECORD_SCHEMA_DEFINITIONS = {
  Ability: AbilitySchema,
  AbilityTranslation: AbilityTranslationSchema,
  AttachCount: AttachCountSchema,
  Attack: AttackSchema,
  AttackDamage: AttackDamageSchema,
  BasicCondition: BasicConditionSchema,
  BasicOperation: BasicOperationSchema,
  CardEffect: CardEffectSchema,
  CardFilter: CardFilterSchema,
  Condition: ConditionSchema,
  ContinuousChange: ContinuousChangeSchema,
  ContinuousEffect: ContinuousEffectSchema,
  ContinuousScope: ContinuousScopeSchema,
  DamageBonus: DamageBonusSchema,
  DamageCountTarget: DamageCountTargetSchema,
  DeckSearchPick: DeckSearchPickSchema,
  DrawCount: DrawCountSchema,
  Effect: EffectSchema,
  EffectStep: EffectStepSchema,
  EnergyProvision: EnergyProvisionSchema,
  ExcludedEffect: ExcludedEffectSchema,
  PokemonInPlayFilter: PokemonInPlayFilterSchema,
  PokemonType: PokemonTypeSchema,
  Ruling: RulingSchema,
  RulingSource: RulingSourceSchema,
} as const;

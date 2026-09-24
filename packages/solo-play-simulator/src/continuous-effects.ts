/**
 * 場にある間ずっと働く効果(特性、スタジアム、ポケモンのどうぐ、特殊エネルギー)を集め、判定に当てる。
 *
 * 状態を書き換えず、判定のたびに場にある効果を集めて実効値を求める。場を離れた効果は集めた中に
 * 入らないので、効果を消すための記録が要らない(docs/setup-rate-design.md「場にある間ずっと働く効果」)。
 */

import {
  type Attack,
  CardCategory,
  type CardFilter,
  type ContinuousEffect,
  type EnergyProvision,
  type PokemonType,
} from "./card-record-schema.ts";
import { type Card, isPokemon, matchesCardFilter } from "./cards.ts";
import { areConditionsMet, matchesPokemonFilter } from "./conditions.ts";
import {
  BENCH_LIMIT,
  type EnergyUnit,
  type GameState,
  type PokemonInPlay,
} from "./state.ts";

interface CollectedContinuousEffect {
  readonly effect: ContinuousEffect;
  /** 特性のポケモン、どうぐ・特殊エネルギーをつけているポケモン。スタジアムは null。 */
  readonly holder: PokemonInPlay | null;
  readonly sourceCard: Card;
}

function listCardContinuousEffects(card: Card): ContinuousEffect[] {
  if (!("cardEffects" in card.record)) {
    return [];
  }
  return card.record.cardEffects.flatMap((cardEffect) =>
    cardEffect.kind === "continuous" ? [cardEffect.continuousEffect] : []
  );
}

function listAbilityContinuousEffects(card: Card): ContinuousEffect[] {
  if (card.record.category !== CardCategory.Pokemon) {
    return [];
  }
  return card.record.abilities.flatMap((ability) =>
    ability.translation?.kind === "continuous"
      ? [ability.translation.continuousEffect]
      : []
  );
}

function appliesTo(
  state: GameState,
  collected: CollectedContinuousEffect,
  pokemon: PokemonInPlay
): boolean {
  const { scope } = collected.effect;
  switch (scope.scope) {
    case "self":
    case "attachedPokemon":
      return collected.holder === pokemon;
    case "ownPokemon":
      return matchesPokemonFilter(state, pokemon, scope.filter);
    default:
      // ownPlayer はポケモンではなくプレイヤーの値(ベンチの上限)を変える
      return false;
  }
}

function isEffectConditionMet(
  state: GameState,
  collected: CollectedContinuousEffect
): boolean {
  return areConditionsMet(state, collected.effect.conditions, {
    card: collected.sourceCard,
    pokemon: collected.holder,
  });
}

function toCollected(
  sourceCard: Card,
  holder: PokemonInPlay | null,
  effects: readonly ContinuousEffect[]
): CollectedContinuousEffect[] {
  return effects.map((effect) => ({ effect, holder, sourceCard }));
}

/**
 * 今働いている効果を集める。特性やどうぐを無くす効果は、スタジアムが持つものだけを先に集めて当てる。
 * 特性やどうぐが特性・どうぐを無くすカードはまだ翻訳に無く、無くす効果どうしの優先も決めていない
 * (docs/setup-rate-design.md「場にある間ずっと働く効果」)。
 */
function collectContinuousEffects(
  state: GameState
): CollectedContinuousEffect[] {
  const { stadium } = state;
  const activeStadiumEffects = (
    stadium === null
      ? []
      : toCollected(stadium, null, listCardContinuousEffects(stadium))
  ).filter((collected) => isEffectConditionMet(state, collected));
  const isNegatedBy = (
    change: "negateAbilities" | "negateToolEffects",
    pokemon: PokemonInPlay
  ) =>
    activeStadiumEffects.some(
      (collected) =>
        collected.effect.change.change === change &&
        appliesTo(state, collected, pokemon)
    );
  const pokemonEffects = state.listPokemonInPlay().flatMap((pokemon) => {
    const { tool } = pokemon;
    return [
      ...(isNegatedBy("negateAbilities", pokemon)
        ? []
        : toCollected(
            pokemon.card,
            pokemon,
            listAbilityContinuousEffects(pokemon.card)
          )),
      ...(tool === null || isNegatedBy("negateToolEffects", pokemon)
        ? []
        : toCollected(tool, pokemon, listCardContinuousEffects(tool))),
      ...pokemon.energies.flatMap((energy) =>
        toCollected(energy, pokemon, listCardContinuousEffects(energy))
      ),
    ];
  });
  return [
    ...activeStadiumEffects,
    ...pokemonEffects.filter((collected) =>
      isEffectConditionMet(state, collected)
    ),
  ];
}

function listEffectsApplyingTo(
  state: GameState,
  pokemon: PokemonInPlay
): CollectedContinuousEffect[] {
  return collectContinuousEffects(state).filter((collected) =>
    appliesTo(state, collected, pokemon)
  );
}

export function isAbilityNegated(
  state: GameState,
  pokemon: PokemonInPlay
): boolean {
  return listEffectsApplyingTo(state, pokemon).some(
    (collected) => collected.effect.change.change === "negateAbilities"
  );
}

/** にげるために必要なエネルギーの数。0 にする効果は減らす効果より優先する。 */
export function calculateRetreatCost(
  state: GameState,
  pokemon: PokemonInPlay
): number {
  const changes = listEffectsApplyingTo(state, pokemon).map(
    (collected) => collected.effect.change
  );
  if (changes.some((change) => change.change === "setRetreatCostToZero")) {
    return 0;
  }
  const reduction = changes.reduce(
    (total, change) =>
      change.change === "reduceRetreatCost" ? total + change.amount : total,
    0
  );
  return Math.max(0, pokemon.card.retreatCost - reduction);
}

/** ついているエネルギー 1 枚が今供給するもの。特殊エネルギー自身の効果(進化ポケモンについていれば 3 個ぶん、など)を当てる。 */
export function resolveEnergyProvision(
  state: GameState,
  pokemon: PokemonInPlay,
  energy: Card
): EnergyProvision {
  const base = energy.provision;
  if (base === undefined) {
    throw new Error(`${energy.name} はエネルギーではない`);
  }
  const override = collectContinuousEffects(state).find(
    (collected) =>
      collected.sourceCard === energy &&
      collected.holder === pokemon &&
      collected.effect.scope.scope === "self" &&
      collected.effect.change.change === "setEnergyProvision"
  );
  if (override?.effect.change.change === "setEnergyProvision") {
    return override.effect.change.provision;
  }
  return base;
}

export function toEnergyUnits(provision: EnergyProvision): EnergyUnit[] {
  const unit = provision.kind === "anyType" ? "any" : provision.type;
  return Array.from({ length: provision.units }, () => unit);
}

/** ポケモンについているエネルギーが今供給する 1 個ずつのタイプ。ワザのエネルギーの判定に使う。 */
export function listEnergyUnits(
  state: GameState,
  pokemon: PokemonInPlay
): EnergyUnit[] {
  return pokemon.energies.flatMap((energy) =>
    toEnergyUnits(resolveEnergyProvision(state, pokemon, energy))
  );
}

/**
 * ついているエネルギーのうち、指定のタイプのいずれかとして数えられる個数。すべてのタイプとして働く 1 個は、
 * タイプをいくつ指定しても 1 つと数える(公式 Q&A「ストームエメラルダ」)。
 */
export function countEnergyUnitsOfTypes(
  state: GameState,
  pokemon: PokemonInPlay,
  types: readonly PokemonType[]
): number {
  return listEnergyUnits(state, pokemon).filter(
    (unit) => unit === "any" || types.includes(unit)
  ).length;
}

/**
 * 自分のベンチに出せるポケモンの数。ベンチの上限を変える効果(ゼロの大空洞)が働いていればその数、
 * 無ければ基本ルールの 5 匹。効果が働くかは、今の場で判定する(公式 Q&A「ゼロの大空洞」: 場に「テラスタル」の
 * ポケモンがいないときは、「テラスタル」のたねポケモンを 6 匹目としてベンチに出せない)。
 */
export function calculateBenchLimit(state: GameState): number {
  const limits = collectContinuousEffects(state).flatMap((collected) =>
    collected.effect.change.change === "setBenchLimit" &&
    collected.effect.scope.scope === "ownPlayer"
      ? [collected.effect.change.limit]
      : []
  );
  return limits.length === 0 ? BENCH_LIMIT : Math.max(...limits);
}

/**
 * このポケモンが使うワザの、相手のバトルポケモンへのダメージを増やす量(シロナのロズレイドの「グローリーエール」)。
 * 効果は持ち主ごとに集めるので、同じ特性のポケモンが 2 匹いれば 2 回分を足す(公式 Q&A「グローリーエール」:
 * 2 匹いれば「+60」)。
 */
export function sumAttackDamageIncrease(
  state: GameState,
  attacker: PokemonInPlay
): number {
  return listEffectsApplyingTo(state, attacker).reduce(
    (total, collected) =>
      collected.effect.change.change === "increaseAttackDamage"
        ? total + collected.effect.change.amount
        : total,
    0
  );
}

export function countEmptyBenchSlots(state: GameState): number {
  return Math.max(0, calculateBenchLimit(state) - state.bench.length);
}

/**
 * 手札の進化ポケモン card を、進化前の名前が違う target にのせて進化させる効果(イーブイex の「にじいろDNA」)が
 * 働いていれば、照らし合わせる進化前の名前を返す。働いていなければ undefined。
 */
export function findEvolutionNameAllowedByEffect(
  state: GameState,
  target: PokemonInPlay,
  card: Card
): string | undefined {
  if (!isPokemon(card)) {
    return;
  }
  for (const collected of listEffectsApplyingTo(state, target)) {
    const { change } = collected.effect;
    if (
      change.change === "allowEvolutionFromHandAsIfNamed" &&
      card.evolvesFrom === change.name &&
      matchesCardFilter(card, change.evolutionFilter)
    ) {
      return change.name;
    }
  }
}

export interface UsableAttack {
  readonly attack: Attack;
  /** 使う前に山札の上から 1 枚トラッシュする(ヤドキングの「ひらめきチャレンジ」)。 */
  readonly discardsDeckTopFirst?: true;
  /** ワザを持っているポケモン。ミュウex の「きおくのらせん」ではベンチのポケモン。 */
  readonly owner: PokemonInPlay;
}

/**
 * 山札の上から 1 枚トラッシュしたポケモンのワザを「このワザとして使う」ワザ(ヤドキングの「ひらめきチャレンジ」)で
 * 使えるワザ。トラッシュするのは使うときで、ここでは山札のいちばん上のカードを見て、それが条件に合うポケモンなら
 * そのワザを、元のワザに必要なエネルギーで使えるワザとして返す。合わなければ(山札が 0 枚のときも)元のワザを、
 * トラッシュだけが起きるワザとして返す。山札の上は実際には使うまで分からないが、ワザを使ったときに起きることは同じ。
 * ほかのワザを「このワザとして使う」ワザ(ヤドキング自身の「ひらめきチャレンジ」)は選ぶワザに入れない。
 */
function listDeckTopAttacksUsedAs(
  state: GameState,
  pokemon: PokemonInPlay,
  usedAs: Attack,
  filter: CardFilter
): UsableAttack[] {
  const [top] = state.deck;
  if (
    top === undefined ||
    top.record.category !== CardCategory.Pokemon ||
    !matchesCardFilter(top, filter)
  ) {
    return [{ attack: usedAs, discardsDeckTopFirst: true, owner: pokemon }];
  }
  return top.record.attacks
    .filter((attack) => !usesAnotherAttack(attack))
    .map((attack) => ({
      attack: { ...attack, cost: usedAs.cost },
      discardsDeckTopFirst: true,
      owner: pokemon,
    }));
}

function usesAnotherAttack(attack: Attack): boolean {
  return (
    attack.usesAttackOfBenchedPokemon !== undefined ||
    attack.usesAttackOfDiscardedDeckTop !== undefined
  );
}

/** このポケモンの記録のワザ 1 つから、使えるワザを返す。ほかのワザを「このワザとして使う」ワザは、選べるワザに置き換える。 */
function listAttacksUsedAs(
  state: GameState,
  pokemon: PokemonInPlay,
  attack: Attack
): UsableAttack[] {
  if (attack.usesAttackOfBenchedPokemon !== undefined) {
    return listBenchedAttacksUsedAs(state, pokemon, attack);
  }
  if (attack.usesAttackOfDiscardedDeckTop !== undefined) {
    return listDeckTopAttacksUsedAs(
      state,
      pokemon,
      attack,
      attack.usesAttackOfDiscardedDeckTop
    );
  }
  return [{ attack, owner: pokemon }];
}

/**
 * ベンチのポケモンが持つワザを「このワザとして使う」ワザ(Nのゾロアークex の「ナイトジョーカー」)で使えるワザ。
 * 選んだワザは、元のワザに必要なエネルギーで使う(公式 Q&A にこの点を問う質問は無く、カードテキスト「このワザとして
 * 使う」による)。ベンチのポケモンが自分で持っているワザだけを選べる(公式 Q&A「ナイトジョーカー」、2026-09-24 確認)。
 * 元のワザ自体はダメージも効果も持たないため、一覧に入れない。ベンチの別の Nのゾロアークex の「ナイトジョーカー」も
 * 入れない(選んでも、同じベンチのほかのポケモンのワザを選ぶことになり、一覧に既にある)。
 */
function listBenchedAttacksUsedAs(
  state: GameState,
  pokemon: PokemonInPlay,
  usedAs: Attack
): UsableAttack[] {
  const filter = usedAs.usesAttackOfBenchedPokemon;
  if (filter === undefined) {
    return [];
  }
  return state.bench
    .filter(
      (benched) =>
        benched !== pokemon && matchesCardFilter(benched.card, filter)
    )
    .flatMap((benched) =>
      benched.card.record.category === CardCategory.Pokemon
        ? benched.card.record.attacks
            .filter((attack) => !usesAnotherAttack(attack))
            .map((attack) => ({
              attack: { ...attack, cost: usedAs.cost },
              owner: benched,
            }))
        : []
    );
}

/**
 * 1 回目のワザを使ったあとに、2 回目として使えるワザ(「おまつりおんど」)。2 回目を使える効果が働いていれば、
 * このポケモンが記録に持つワザ(ほかのワザを「このワザとして使う」ワザを除く)を返す。
 */
export function listSecondAttacks(
  state: GameState,
  pokemon: PokemonInPlay
): UsableAttack[] {
  const allowsSecondAttack = listEffectsApplyingTo(state, pokemon).some(
    (collected) => collected.effect.change.change === "useAttacksTwice"
  );
  if (
    !allowsSecondAttack ||
    pokemon.card.record.category !== CardCategory.Pokemon
  ) {
    return [];
  }
  return pokemon.card.record.attacks
    .filter((attack) => !usesAnotherAttack(attack))
    .map((attack) => ({ attack, owner: pokemon }));
}

/**
 * このポケモンが使えるワザ。自身のワザに、ベンチのポケモンのワザを使えるようにする効果の分を足す。
 * ベンチのポケモンについては、そのポケモン自身が持つワザだけを足し、効果で使えるようになったワザは
 * 足さない(公式 Q&A: 効果で使えるようになったワザは、そのポケモンが持っているワザとして扱わない)。
 */
export function listUsableAttacks(
  state: GameState,
  pokemon: PokemonInPlay
): UsableAttack[] {
  const own =
    pokemon.card.record.category === CardCategory.Pokemon
      ? pokemon.card.record.attacks.flatMap((attack) =>
          listAttacksUsedAs(state, pokemon, attack)
        )
      : [];
  const allowsBenchAttacks = listEffectsApplyingTo(state, pokemon).some(
    (collected) =>
      collected.effect.change.change === "allowBenchedPokemonAttacks"
  );
  if (!allowsBenchAttacks) {
    return own;
  }
  const fromBench = state.bench
    .filter((benched) => benched !== pokemon)
    .flatMap((benched) =>
      benched.card.record.category === CardCategory.Pokemon
        ? benched.card.record.attacks.map((attack) => ({
            attack,
            owner: benched,
          }))
        : []
    );
  return [...own, ...fromBench];
}

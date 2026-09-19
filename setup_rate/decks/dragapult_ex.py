"""ドラパルトex デッキの規則。

デッキコード 9gngnQ-zAMw9G-96H9nn(チャンピオンズリーグ2026 愛知May 優勝デッキ。公式の記事
https://www.pokemon-card.com/info/005499.html 。2026-09-17 に読み取り)。
各カードの効果は 2026-09-17 に公式のカード詳細ページで確認し、計算に必要な範囲だけを自分の言葉で書いている。
詳細ページ: https://www.pokemon-card.com/card-search/details.php/card/{カード ID}/regu/XY

狙い: ドラメシヤからふしぎなアメで 2 番目の番にドラパルトex を立て、炎と超のエネルギーを 1 枚ずつつけて
3 番目の番に「ファントムダイブ」を打つ。ドロンチの特性「ていさつしれい」とアカマツ(山札からエネルギーを
1 枚つける)が速さを支える。ヨマワルの線(カースドボム)は相手への攻撃手段なので、この計算では追わない。
"""

from __future__ import annotations

from collections.abc import Callable

from setup_rate.cards import Card, Stage, basic_energy, goods, pokemon, stadium, supporter
from setup_rate.engine import Action, DeckRules, Variant
from setup_rate.state import COLORLESS, GameState, PokemonInPlay, can_pay_cost

FIRE = "fire"
PSYCHIC = "psychic"
DARK = "dark"
DRAGON = "dragon"
GRASS = "grass"

DRAGAPULT = "ドラパルトex"
DRAKLOAK = "ドロンチ"
DREEPY = "ドラメシヤ"
DUSKNOIR = "ヨノワール"
DUSCLOPS = "サマヨール"
DUSKULL = "ヨマワル"
MUNKIDORI = "マシマシラ"
BUDEW = "スボミー"
FEZANDIPITI = "キチキギスex"
MEOWTH = "ニャースex"
ULTRA_BALL = "ハイパーボール"
POKEPAD = "ポケパッド"
POFFIN = "なかよしポフィン"
RARE_CANDY = "ふしぎなアメ"
NIGHT_STRETCHER = "夜のタンカ"
SPECIAL_RED_CARD = "スペシャルレッドカード"
UNFAIR_STAMP = "アンフェアスタンプ"
LILLIE = "リーリエの決心"
BOSS = "ボスの指令"
AKAMATSU = "アカマツ"
HIKARI = "ヒカリ"
MAY = "メイのはげまし"
ROCKET_TOWER = "ロケット団の監視塔"
JAMMING_TOWER = "ジャミングタワー"
FIRE_ENERGY = "基本炎エネルギー"
PSYCHIC_ENERGY = "基本超エネルギー"
DARK_ENERGY = "基本悪エネルギー"

PHANTOM_DIVE = "ファントムダイブ"
JET_HEADBUTT = "ジェットヘッド"
RECON_DIRECTIVE = "ていさつしれい"
PHANTOM_DIVE_COST = [FIRE, PSYCHIC]
DREEPY_IN_PLAY_LIMIT = 3
EXPENDABLE_TIER_LIMIT = 2

CARD_TABLE: dict[str, Card] = {
    card.name: card
    for card in [
        pokemon(DRAGAPULT, "049264", Stage.STAGE2, 320, DRAGON, evolves_from=DRAKLOAK, has_rule_box=True, retreat_cost=1),
        pokemon(DRAKLOAK, "049263", Stage.STAGE1, 90, DRAGON, evolves_from=DREEPY, retreat_cost=1),
        pokemon(DREEPY, "049262", Stage.BASIC, 70, DRAGON, retreat_cost=1),
        pokemon(DUSKNOIR, "049026", Stage.STAGE2, 160, PSYCHIC, evolves_from=DUSCLOPS, retreat_cost=3),
        pokemon(DUSCLOPS, "049025", Stage.STAGE1, 90, PSYCHIC, evolves_from=DUSKULL, retreat_cost=2),
        pokemon(DUSKULL, "049024", Stage.BASIC, 60, PSYCHIC, retreat_cost=1),
        pokemon(MUNKIDORI, "049074", Stage.BASIC, 110, PSYCHIC, retreat_cost=1),
        pokemon(BUDEW, "048533", Stage.BASIC, 30, GRASS, retreat_cost=0),
        pokemon(FEZANDIPITI, "049205", Stage.BASIC, 210, DARK, has_rule_box=True, retreat_cost=1),
        pokemon(MEOWTH, "049694", Stage.BASIC, 170, COLORLESS, has_rule_box=True, retreat_cost=1),
        goods(ULTRA_BALL, "049600"),
        goods(POKEPAD, "049703"),
        goods(POFFIN, "049364"),
        goods(RARE_CANDY, "049371"),
        goods(NIGHT_STRETCHER, "049386"),
        goods(SPECIAL_RED_CARD, "050156"),
        goods(UNFAIR_STAMP, "049349"),
        supporter(LILLIE, "049609"),
        supporter(BOSS, "049440"),
        supporter(AKAMATSU, "049412"),
        supporter(HIKARI, "048417"),
        supporter(MAY, "049708"),
        stadium(ROCKET_TOWER, "048711"),
        stadium(JAMMING_TOWER, "047214"),
        basic_energy(FIRE_ENERGY, "047904", FIRE),
        basic_energy(PSYCHIC_ENERGY, "048307", PSYCHIC),
        basic_energy(DARK_ENERGY, "047909", DARK),
    ]
}

DECKLIST: list[tuple[str, int]] = [
    (DRAGAPULT, 3),
    (DRAKLOAK, 4),
    (DREEPY, 4),
    (DUSKNOIR, 1),
    (DUSCLOPS, 1),
    (DUSKULL, 2),
    (MUNKIDORI, 1),
    (BUDEW, 1),
    (FEZANDIPITI, 1),
    (MEOWTH, 1),
    (ULTRA_BALL, 4),
    (POKEPAD, 4),
    (POFFIN, 4),
    (RARE_CANDY, 2),
    (NIGHT_STRETCHER, 2),
    (SPECIAL_RED_CARD, 1),
    (UNFAIR_STAMP, 1),
    (LILLIE, 4),
    (BOSS, 3),
    (AKAMATSU, 2),
    (HIKARI, 2),
    (MAY, 1),
    (ROCKET_TOWER, 2),
    (JAMMING_TOWER, 1),
    (FIRE_ENERGY, 3),
    (PSYCHIC_ENERGY, 3),
    (DARK_ENERGY, 2),
]

DRAGAPULT_LINE = (DRAGAPULT, DRAKLOAK, DREEPY)


# ---- 場の見かた ----


def is_named(name: str) -> Callable[[Card], bool]:
    return lambda card: card.name == name


def energy_units(target: PokemonInPlay) -> list[str]:
    units: list[str] = []
    for energy in target.energies:
        units.extend(energy.provides)
    return units


def can_phantom_dive(target: PokemonInPlay) -> bool:
    return target.name == DRAGAPULT and can_pay_cost(PHANTOM_DIVE_COST, energy_units(target))


def lead(state: GameState) -> PokemonInPlay | None:
    """主軸として育てるポケモン。ドラパルトex > ドロンチ > ドラメシヤ の順で、エネルギーが多いもの、次にバトル場を優先する。"""
    for name in DRAGAPULT_LINE:
        found = state.find_in_play(name)
        if found:
            found.sort(key=lambda p: (-len(p.energies), p is not state.active, p.turn_entered))
            return found[0]
    return None


def evolvable(state: GameState, name: str) -> list[PokemonInPlay]:
    found = [p for p in state.find_in_play(name) if state.turn >= 2 and not p.is_fresh(state.turn)]
    found.sort(key=lambda p: (-len(p.energies), p is not state.active, p.turn_entered))
    return found


def is_dragapult_in_play(state: GameState) -> bool:
    return state.count_in_play(DRAGAPULT) > 0


def is_active_dragapult_ready(state: GameState) -> bool:
    return state.active is not None and can_phantom_dive(state.active) and state.can_attack()


def has_free_retreat(state: GameState) -> bool:
    return state.active is not None and state.active.card.retreat_cost == 0


def can_switch_active(state: GameState) -> bool:
    """このデッキにポケモンいれかえは無い。にげるエネルギーを払えるかだけを見る。"""
    active = state.active
    if active is None or state.retreated:
        return False
    return has_free_retreat(state) or len(active.energies) >= active.card.retreat_cost


def missing_energy_types(target: PokemonInPlay) -> list[str]:
    """ファントムダイブに足りないタイプ。炎と超を 1 枚ずつ。"""
    units = energy_units(target)
    return [required for required in PHANTOM_DIVE_COST if required not in units]


# ---- 対戦の準備 ----

# ドラメシヤをバトル場に置くのは、入れ替えの手段が無いデッキなので、育てる線を最初からバトル場に置くため
ACTIVE_PRIORITY = [DREEPY, BUDEW, DUSKULL, MUNKIDORI, FEZANDIPITI, MEOWTH]
SETUP_BENCH_PRIORITY = [DREEPY, DREEPY, DUSKULL]


def choose_active(basics: list[Card]) -> Card:
    for name in ACTIVE_PRIORITY:
        for card in basics:
            if card.name == name:
                return card
    return basics[0]


def choose_bench_at_setup(basics: list[Card]) -> list[Card]:
    chosen: list[Card] = []
    pool = list(basics)
    for name in SETUP_BENCH_PRIORITY:
        for card in pool:
            if card.name == name:
                chosen.append(card)
                pool.remove(card)
                break
    return chosen


# ---- 手札の価値(ハイパーボールで捨てる順) ----


def expendable_tier(state: GameState, card: Card, seen: dict[str, int]) -> int:
    name = card.name
    nth = seen.get(name, 0)
    if name in (ROCKET_TOWER, JAMMING_TOWER, BOSS, SPECIAL_RED_CARD, UNFAIR_STAMP, MAY, FEZANDIPITI, MUNKIDORI, BUDEW):
        return 0
    if name in (DUSKNOIR, DUSCLOPS):
        return 1
    if name == DUSKULL and (state.count_in_play(DUSKULL) >= 1 or nth >= 1):
        return 1
    if name == DARK_ENERGY:
        return 1
    if name == NIGHT_STRETCHER and not any(c.is_pokemon or c.name in (FIRE_ENERGY, PSYCHIC_ENERGY) for c in state.discard):
        return 1
    if name == MEOWTH and state.count_in_play(MEOWTH) >= 1:
        return 1
    if name == POFFIN and (state.count_in_play(DREEPY) >= DREEPY_IN_PLAY_LIMIT or state.count_unseen(DREEPY) == 0):
        return 1
    if name in (FIRE_ENERGY, PSYCHIC_ENERGY) and nth >= 1:
        return 2
    if card.is_supporter and nth >= 1:
        return 2
    if name in (ULTRA_BALL, POKEPAD) and nth >= 1:
        return 2
    if name == DRAKLOAK and nth >= 1:
        return 2
    if name == DREEPY and state.count_in_play(DREEPY) + nth >= DREEPY_IN_PLAY_LIMIT:
        return 2
    return 3


def expendable_cards(state: GameState, excluding: Card) -> list[Card]:
    seen: dict[str, int] = {}
    ranked: list[tuple[int, int, Card]] = []
    skipped = False
    for index, card in enumerate(state.hand):
        if card is excluding and not skipped:
            skipped = True
            continue
        tier = expendable_tier(state, card, seen)
        seen[card.name] = seen.get(card.name, 0) + 1
        if tier <= EXPENDABLE_TIER_LIMIT:
            ranked.append((tier, index, card))
    ranked.sort(key=lambda item: (item[0], item[1]))
    return [card for _, _, card in ranked]


# ---- 何が欲しいか ----


def is_dreepy_wanted(state: GameState) -> bool:
    return state.count_in_play(DREEPY) + state.count_in_hand(DREEPY) == 0 and state.count_unseen(DREEPY) > 0 and state.bench_space() > 0


def is_dragapult_wanted(state: GameState) -> bool:
    return (
        not is_dragapult_in_play(state)
        and state.count_in_hand(DRAGAPULT) == 0
        and state.count_unseen(DRAGAPULT) > 0
        and (state.count_in_hand(RARE_CANDY) > 0 or state.count_in_play(DRAKLOAK) > 0 or state.count_in_hand(DRAKLOAK) > 0)
    )


def is_drakloak_wanted(state: GameState) -> bool:
    return (
        state.count_in_play(DREEPY) > 0
        and state.count_in_hand(DRAKLOAK) == 0
        and state.count_in_play(DRAKLOAK) < 2
        and state.count_unseen(DRAKLOAK) > 0
        and not (state.count_in_hand(RARE_CANDY) > 0 and state.count_in_hand(DRAGAPULT) > 0)
    )


def wanted_pokemon_for_ultra_ball(state: GameState) -> str | None:
    if is_dreepy_wanted(state):
        return DREEPY
    if is_dragapult_wanted(state) and state.count_in_hand(RARE_CANDY) > 0:
        return DRAGAPULT
    if is_drakloak_wanted(state) and state.count_in_play(DRAKLOAK) == 0:
        return DRAKLOAK
    if is_dragapult_wanted(state):
        return DRAGAPULT
    if (
        state.count_in_hand(MEOWTH) + state.count_in_play(MEOWTH) == 0
        and state.count_unseen(MEOWTH) > 0
        and state.can_use_supporter()
        and choose_supporter(state) is None
        and state.bench_space() > 0
    ):
        return MEOWTH
    if is_drakloak_wanted(state):
        return DRAKLOAK
    return None


def wanted_pokemon_for_pokepad(state: GameState) -> str | None:
    """ポケパッドは「ルールを持つポケモン」を除くため、ドラパルトex は取れない。ドラメシヤとドロンチが対象。"""
    if is_dreepy_wanted(state):
        return DREEPY
    if is_drakloak_wanted(state):
        return DRAKLOAK
    if state.count_in_play(DREEPY) < 2 and state.count_in_hand(DREEPY) == 0 and state.count_unseen(DREEPY) > 0 and state.bench_space() > 0:
        return DREEPY
    return None


def wanted_energy_types(state: GameState) -> list[str]:
    target = lead(state)
    if target is None:
        return [FIRE, PSYCHIC]
    missing = missing_energy_types(target)
    in_hand = {e.provides[0] for e in state.hand if e.is_energy}
    return [t for t in missing if t not in in_hand]


def choose_supporter(state: GameState) -> str | None:
    if not state.can_use_supporter():
        return None
    in_hand = {name for name in (HIKARI, AKAMATSU, LILLIE) if state.count_in_hand(name) > 0}
    target = lead(state)
    if HIKARI in in_hand and not is_dragapult_in_play(state) and state.count_in_hand(DRAGAPULT) == 0 and state.count_unseen(DRAGAPULT) > 0:
        return HIKARI
    if AKAMATSU in in_hand and target is not None and wanted_energy_types(state) and (
        state.count_unseen(FIRE_ENERGY) > 0 or state.count_unseen(PSYCHIC_ENERGY) > 0
    ):
        return AKAMATSU
    if LILLIE in in_hand and not holds_next_turn_plan(state):
        return LILLIE
    if HIKARI in in_hand and not is_dragapult_in_play(state) and state.count_unseen(DRAGAPULT) > 0:
        return HIKARI
    if AKAMATSU in in_hand and target is not None and missing_energy_types(target) and (
        state.count_unseen(FIRE_ENERGY) > 0 or state.count_unseen(PSYCHIC_ENERGY) > 0
    ):
        return AKAMATSU
    if LILLIE in in_hand:
        return LILLIE
    return None


def holds_next_turn_plan(state: GameState) -> bool:
    has_candy_route = state.count_in_hand(RARE_CANDY) > 0 and state.count_in_hand(DRAGAPULT) > 0
    has_hand_route = state.count_in_hand(DRAKLOAK) > 0 or (state.count_in_hand(DRAGAPULT) > 0 and state.count_in_play(DRAKLOAK) > 0)
    return has_candy_route or has_hand_route


def wanted_supporter_for_meowth(state: GameState) -> str | None:
    if not is_dragapult_in_play(state) and state.count_in_hand(DRAGAPULT) == 0 and state.count_unseen(HIKARI) > 0:
        return HIKARI
    target = lead(state)
    if target is not None and wanted_energy_types(state) and state.count_unseen(AKAMATSU) > 0:
        return AKAMATSU
    if state.count_unseen(LILLIE) > 0:
        return LILLIE
    return None


# ---- 行動 ----


def bench_dreepy_available(state: GameState) -> bool:
    return state.count_in_hand(DREEPY) > 0 and state.count_in_play(DREEPY) < DREEPY_IN_PLAY_LIMIT and state.bench_space() > 0


def bench_dreepy(state: GameState) -> None:
    state.place_on_bench(state.first_in_hand(DREEPY), from_hand=True)


def poffin_available(state: GameState) -> bool:
    return (
        state.count_in_hand(POFFIN) > 0
        and state.bench_space() > 0
        and (
            (state.count_in_play(DREEPY) < DREEPY_IN_PLAY_LIMIT and state.count_unseen(DREEPY) > 0)
            or (state.count_in_play(DUSKULL) == 0 and state.count_unseen(DUSKULL) > 0 and state.count_in_play(DREEPY) >= 2)
        )
    )


def use_poffin(state: GameState) -> None:
    """なかよしポフィン: HP 70 以下のたねを 2 枚までベンチに出す。ドラメシヤを上限まで、次にヨマワル 1 匹。"""
    state.use_goods(state.first_in_hand(POFFIN))
    placed = 0
    while placed < 2 and state.bench_space() > 0:
        if state.count_in_play(DREEPY) < DREEPY_IN_PLAY_LIMIT:
            card = state.find_in_deck(is_named(DREEPY))
        elif state.count_in_play(DUSKULL) == 0:
            card = state.find_in_deck(is_named(DUSKULL))
        else:
            card = None
        if card is None:
            break
        state.place_on_bench(card, from_hand=False)
        placed += 1
    state.shuffle_deck()


def rare_candy_available(state: GameState) -> bool:
    return (
        state.count_in_hand(RARE_CANDY) > 0
        and state.count_in_hand(DRAGAPULT) > 0
        and not is_dragapult_in_play(state)
        and bool(evolvable(state, DREEPY))
    )


def use_rare_candy(state: GameState) -> None:
    target = evolvable(state, DREEPY)[0]
    state.use_goods(state.first_in_hand(RARE_CANDY))
    state.evolve_skipping_stage1(target, state.first_in_hand(DRAGAPULT), DRAKLOAK)


def evolve_dragapult_from_hand_available(state: GameState) -> bool:
    card = state.first_in_hand(DRAGAPULT)
    return card is not None and bool(evolvable(state, DRAKLOAK))


def evolve_dragapult_from_hand(state: GameState) -> None:
    state.evolve(evolvable(state, DRAKLOAK)[0], state.first_in_hand(DRAGAPULT), from_hand=True)


def evolve_drakloak_from_hand_available(state: GameState) -> bool:
    return state.count_in_hand(DRAKLOAK) > 0 and state.count_in_play(DRAKLOAK) < 2 and bool(evolvable(state, DREEPY))


def evolve_drakloak_from_hand(state: GameState) -> None:
    candidates = evolvable(state, DREEPY)
    # アメでドラパルトex にする予定のドラメシヤ(エネルギーが多い先頭)は残し、別のドラメシヤをドロンチにする
    if state.count_in_hand(RARE_CANDY) > 0 and state.count_in_hand(DRAGAPULT) > 0 and len(candidates) > 1:
        candidates = candidates[1:]
    state.evolve(candidates[0], state.first_in_hand(DRAKLOAK), from_hand=True)


def recon_rank(state: GameState) -> Callable[[Card], int]:
    """ていさつしれいで手札に加えるカードの優先順位(小さいほど欲しい)。"""
    wanted_types = wanted_energy_types(state)

    def rank(card: Card) -> int:
        if card.name == DRAGAPULT and state.count_in_hand(DRAGAPULT) == 0 and not is_dragapult_in_play(state):
            return 0
        if card.name == RARE_CANDY and state.count_in_hand(RARE_CANDY) == 0 and not is_dragapult_in_play(state):
            return 1
        if card.is_energy and card.provides[0] in wanted_types:
            return 2
        if card.name == DRAKLOAK and state.count_in_hand(DRAKLOAK) == 0 and not is_dragapult_in_play(state):
            return 3
        if card.name in (AKAMATSU, HIKARI):
            return 4
        if card.name in (ULTRA_BALL, POKEPAD, LILLIE):
            return 5
        if card.is_energy:
            return 6
        return 9

    return rank


def recon_available(state: GameState) -> bool:
    drakloaks = state.find_in_play(DRAKLOAK)
    return any(f"{RECON_DIRECTIVE}:{id(d)}" not in state.used_once_per_turn for d in drakloaks) and len(state.deck) >= 1


def recon(state: GameState) -> None:
    """ドロンチの特性「ていさつしれい」: 番に 1 回、山札の上 2 枚を見て 1 枚を手札に加え、残りを山札の下に戻す。
    ドロンチが 2 匹いればそれぞれ 1 回使える。"""
    drakloak = next(d for d in state.find_in_play(DRAKLOAK) if f"{RECON_DIRECTIVE}:{id(d)}" not in state.used_once_per_turn)
    state.used_once_per_turn.add(f"{RECON_DIRECTIVE}:{id(drakloak)}")
    taken = state.look_top_take_one(2, recon_rank(state))
    state.record(f"特性 ていさつしれい: {taken.name if taken else '(山札が無い)'}")


def pokepad_available(state: GameState) -> bool:
    return state.count_in_hand(POKEPAD) > 0 and wanted_pokemon_for_pokepad(state) is not None


def use_pokepad(state: GameState) -> None:
    wanted = wanted_pokemon_for_pokepad(state)
    state.use_goods(state.first_in_hand(POKEPAD))
    state.search_deck_to_hand([lambda card: card.name == wanted and not card.has_rule_box])


def ultra_ball_available(state: GameState) -> bool:
    ball = state.first_in_hand(ULTRA_BALL)
    if ball is None or wanted_pokemon_for_ultra_ball(state) is None:
        return False
    return len(expendable_cards(state, excluding=ball)) >= 2


def use_ultra_ball(state: GameState) -> None:
    ball = state.first_in_hand(ULTRA_BALL)
    wanted = wanted_pokemon_for_ultra_ball(state)
    state.discard_from_hand(expendable_cards(state, excluding=ball)[:2])
    state.use_goods(ball)
    state.search_deck_to_hand([is_named(wanted)])


def meowth_for_supporter_available(state: GameState) -> bool:
    return (
        state.count_in_hand(MEOWTH) > 0
        and state.bench_space() > 0
        and state.can_use_supporter()
        and choose_supporter(state) is None
        and wanted_supporter_for_meowth(state) is not None
    )


def bench_meowth_for_supporter(state: GameState) -> None:
    wanted = wanted_supporter_for_meowth(state)
    state.place_on_bench(state.first_in_hand(MEOWTH), from_hand=True)
    state.search_deck_to_hand([is_named(wanted)])


def supporter_available(state: GameState) -> bool:
    return choose_supporter(state) is not None


def use_supporter(state: GameState) -> None:
    name = choose_supporter(state)
    card = state.first_in_hand(name)
    if name == HIKARI:
        state.use_supporter(card)
        basic = DREEPY if state.count_in_play(DREEPY) + state.count_in_hand(DREEPY) < 2 else DUSKULL
        state.search_deck_to_hand([is_named(basic), is_named(DRAKLOAK), is_named(DRAGAPULT)])
    elif name == AKAMATSU:
        state.use_supporter(card)
        use_akamatsu_effect(state)
    elif name == LILLIE:
        state.use_supporter(card)
        state.return_hand_to_deck()
        # 相手がいない計算ではサイドが 6 枚のままなので、引く枚数は常に 8 枚になる
        state.draw(8 if len(state.prizes) == 6 else 6)


def use_akamatsu_effect(state: GameState) -> None:
    """アカマツ: 山札から違うタイプの基本エネルギーを 2 枚まで選び、1 枚を手札に、残りを自分のポケモンにつける。
    炎と超を選び、主軸に足りないタイプをつけ、もう 1 枚を手札に加える。"""
    target = lead(state)
    missing = missing_energy_types(target) if target is not None else [FIRE, PSYCHIC]
    names = {FIRE: FIRE_ENERGY, PSYCHIC: PSYCHIC_ENERGY}
    attach_type = missing[0] if missing else FIRE
    hand_type = PSYCHIC if attach_type == FIRE else FIRE
    to_attach = state.find_in_deck(is_named(names[attach_type]))
    to_hand = state.find_in_deck(is_named(names[hand_type]))
    if to_attach is not None and target is not None:
        state.attach_energy_from_deck(to_attach, target)
    elif to_attach is not None:
        state.take_from_deck_to_hand(to_attach)
    if to_hand is not None:
        state.take_from_deck_to_hand(to_hand)
    state.shuffle_deck()


def needs_retreat_energy(state: GameState) -> bool:
    """主軸がベンチにいて、バトル場のポケモンがにげるためのエネルギーを持っていないか。
    このデッキにはポケモンいれかえが無いので、にげるエネルギーを払う以外に入れ替える手段が無い。"""
    active = state.active
    target = lead(state)
    if active is None or target is None or target is active or active.name in DRAGAPULT_LINE:
        return False
    return len(active.energies) < active.card.retreat_cost


def energy_to_attach(state: GameState) -> tuple[PokemonInPlay, Card] | None:
    target = lead(state)
    if target is None:
        return None
    names = {FIRE: FIRE_ENERGY, PSYCHIC: PSYCHIC_ENERGY}
    for energy_type in missing_energy_types(target):
        card = state.first_in_hand(names[energy_type])
        if card is not None:
            return target, card
    if needs_retreat_energy(state):
        # 主軸に要らない基本悪エネルギーを優先し、無ければ余ったエネルギーでにげる分を払う
        spare = state.first_in_hand(DARK_ENERGY) or next((c for c in state.hand if c.is_energy), None)
        if spare is not None:
            return state.active, spare
    return None


def attach_energy_available(state: GameState) -> bool:
    return not state.energy_attached and energy_to_attach(state) is not None


def attach_energy(state: GameState) -> None:
    target, card = energy_to_attach(state)
    state.attach_energy_from_hand(card, target)


def attach_energy_before_lillie_available(state: GameState) -> bool:
    return attach_energy_available(state) and choose_supporter(state) == LILLIE


def switch_to_lead_available(state: GameState) -> bool:
    """主軸がベンチにいるなら、ワザを打てる前でもにげるエネルギーを払えるときにバトル場へ出しておく。"""
    active = state.active
    target = lead(state)
    if active is None or target is None or target is active or active.name in DRAGAPULT_LINE:
        return False
    return can_switch_active(state) and not (can_phantom_dive(target) and state.can_attack() and switch_to_attacker_available(state))


def switch_to_lead(state: GameState) -> None:
    target = lead(state)
    cost = 0 if has_free_retreat(state) else state.active.card.retreat_cost
    state.retreat(target, cost=cost)


def switch_to_attacker_available(state: GameState) -> bool:
    if state.active is None or can_phantom_dive(state.active) or not state.can_attack():
        return False
    return any(can_phantom_dive(p) for p in state.bench) and can_switch_active(state)


def switch_to_attacker(state: GameState) -> None:
    attacker = next(p for p in state.bench if can_phantom_dive(p))
    active = state.active
    cost = 0 if has_free_retreat(state) else active.card.retreat_cost
    state.retreat(attacker, cost=cost)


ACTIONS: list[Action] = [
    Action("ドラメシヤをベンチに出す", bench_dreepy_available, bench_dreepy),
    Action("なかよしポフィンでたねを出す", poffin_available, use_poffin),
    Action("ふしぎなアメで進化させる", rare_candy_available, use_rare_candy),
    Action("手札のドラパルトex に進化させる", evolve_dragapult_from_hand_available, evolve_dragapult_from_hand),
    Action("手札のドロンチに進化させる", evolve_drakloak_from_hand_available, evolve_drakloak_from_hand),
    Action("ていさつしれいで 1 枚選ぶ", recon_available, recon),
    Action("ポケパッドで探す", pokepad_available, use_pokepad),
    Action("ハイパーボールで探す", ultra_ball_available, use_ultra_ball),
    Action("リーリエの決心の前にエネルギーをつける", attach_energy_before_lillie_available, attach_energy),
    Action("ニャースex を出してサポートを探す", meowth_for_supporter_available, bench_meowth_for_supporter),
    Action("サポートを使う", supporter_available, use_supporter),
    Action("エネルギーをつける", attach_energy_available, attach_energy),
    Action("ドラパルトex をバトル場に出す", switch_to_attacker_available, switch_to_attacker),
    Action("主軸をバトル場に出しておく", switch_to_lead_available, switch_to_lead),
]


# ---- ワザ ----


def choose_attack(state: GameState) -> str | None:
    active = state.active
    if active is None:
        return None
    if can_phantom_dive(active):
        return PHANTOM_DIVE
    if active.name == DRAGAPULT and active.energies:
        return JET_HEADBUTT
    return None


# ---- 狙いと失敗の要因 ----

GOAL_DRAKLOAK_IN_PLAY = "ドロンチが場にいる(ていさつしれいを使える)"
GOAL_DRAGAPULT_IN_PLAY = "ドラパルトex が場にいる"
GOAL_PHANTOM_DIVE = "ファントムダイブを打てる"

GOALS: dict[str, Callable[[GameState], bool]] = {
    GOAL_DRAKLOAK_IN_PLAY: lambda state: state.count_in_play(DRAKLOAK) > 0 or is_dragapult_in_play(state),
    GOAL_DRAGAPULT_IN_PLAY: is_dragapult_in_play,
    GOAL_PHANTOM_DIVE: is_active_dragapult_ready,
}

DEADLINES = [(GOAL_DRAKLOAK_IN_PLAY, 2), (GOAL_DRAGAPULT_IN_PLAY, 2), (GOAL_DRAGAPULT_IN_PLAY, 3), (GOAL_PHANTOM_DIVE, 3)]


def explain_failure(state: GameState, goal: str) -> str:
    if not is_dragapult_in_play(state):
        if state.count_in_play(DREEPY) + state.count_in_play(DRAKLOAK) == 0:
            return "ドラメシヤを場に出せていない"
        if goal == GOAL_DRAKLOAK_IN_PLAY:
            return "ドロンチもドラパルトex も手札に無い"
        if state.count_in_play(DRAKLOAK) > 0:
            return "ドロンチまで進化したがドラパルトex が手札に無い"
        if state.count_in_hand(RARE_CANDY) > 0:
            return "ふしぎなアメはあるがドラパルトex が手札に無い"
        if state.count_in_hand(DRAGAPULT) > 0:
            return "ドラパルトex はあるがふしぎなアメもドロンチも無い"
        return "ふしぎなアメもドロンチもドラパルトex も手札に無い"
    if goal in (GOAL_DRAKLOAK_IN_PLAY, GOAL_DRAGAPULT_IN_PLAY):
        return "その他"
    dragapult = state.find_in_play(DRAGAPULT)[0]
    missing = missing_energy_types(dragapult)
    if missing:
        labels = {FIRE: "炎", PSYCHIC: "超"}
        return "ドラパルトex に " + "と".join(labels[t] for t in missing) + " のエネルギーが足りない"
    return "ドラパルトex をバトル場に出せない"


VARIANTS = [
    Variant("ふしぎなアメ 2→3(ジャミングタワー -1)", {RARE_CANDY: +1, JAMMING_TOWER: -1}),
    Variant("ふしぎなアメ 2→1(基本超エネルギー +1)", {RARE_CANDY: -1, PSYCHIC_ENERGY: +1}),
    Variant("アカマツ 2→3(ロケット団の監視塔 -1)", {AKAMATSU: +1, ROCKET_TOWER: -1}),
    Variant("アカマツ 2→1(基本超エネルギー +1)", {AKAMATSU: -1, PSYCHIC_ENERGY: +1}),
    Variant("ヒカリ 2→1(基本超エネルギー +1)", {HIKARI: -1, PSYCHIC_ENERGY: +1}),
    Variant("ドロンチ 4→3(基本超エネルギー +1)", {DRAKLOAK: -1, PSYCHIC_ENERGY: +1}),
    Variant("ドラメシヤ 4→3(基本超エネルギー +1)", {DREEPY: -1, PSYCHIC_ENERGY: +1}),
    Variant("なかよしポフィン 4→3(基本超エネルギー +1)", {POFFIN: -1, PSYCHIC_ENERGY: +1}),
    Variant("基本炎エネルギー 3→4(基本悪エネルギー -1)", {FIRE_ENERGY: +1, DARK_ENERGY: -1}),
    Variant("ニャースex 1→0(基本超エネルギー +1)", {MEOWTH: -1, PSYCHIC_ENERGY: +1}),
]

ASSUMPTIONS = [
    "相手の行動を含めない。相手の妨害、きぜつ、サイドを取ることは起きない(リーリエの決心は常に 8 枚引く)",
    "手札の使い方はこの規則ファイルの行動の並び(優先順位)に固定する。実際のプレイヤーの判断とは違うことがある",
    "対戦の準備ではドラメシヤをバトル場に置き、ドラメシヤ 2 匹とヨマワル 1 匹をベンチに出す。ニャースex は特性のため手札に残す",
    "エネルギーは主軸(ドラパルトex > ドロンチ > ドラメシヤ)にだけつけ、炎と超の足りないタイプを選ぶ。基本悪エネルギーはつけない",
    "ヨマワルの線(サマヨール、ヨノワール)とマシマシラ、スボミー、キチキギスex は相手への攻撃や妨害の手段なので、この計算では育てない",
    "ワザはファントムダイブが打てればそれを、ドラパルトex にエネルギーが 1 枚ならジェットヘッドを選ぶ",
    "引き直しは自分の分だけ扱い、相手の引き直しで自分が追加で引ける 1 枚は扱わない",
    "「打てる」は、番の終わり(ワザを使う前)にバトル場からそのワザを使える状態を指す",
]

RULES = DeckRules(
    title="ドラパルトex デッキ(2 番目の番にドラパルトex、3 番目の番にファントムダイブ)",
    deck_code="9gngnQ-zAMw9G-96H9nn",
    card_table=CARD_TABLE,
    decklist=DECKLIST,
    choose_active=choose_active,
    choose_bench_at_setup=choose_bench_at_setup,
    actions=ACTIONS,
    choose_attack=choose_attack,
    goals=GOALS,
    deadlines=DEADLINES,
    explain_failure=explain_failure,
    variants=VARIANTS,
    assumptions=ASSUMPTIONS,
)

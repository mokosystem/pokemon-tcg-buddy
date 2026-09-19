"""メガリザードンYex & メガリザードンXex デッキの規則。

デッキコード DxKGxx-6pqCKy-xxJ8Yc(開発責任者のデッキ。2026-09-17 に読み取り)。
各カードの効果は 2026-09-17 に公式のカード詳細ページで確認し、計算に必要な範囲だけを自分の言葉で書いている。
詳細ページ: https://www.pokemon-card.com/card-search/details.php/card/{カード ID}/regu/XY

狙い: 後攻 1 番目の番に、メガガルーラex を場に置いてファイアローex を特性でベンチに出し、
イグニッションエネルギーをつけて「かぎづめハント」を打つ。並行してヒトカゲからメガリザードン(X か Y)を立て、
オドリドリex の特性で手札の基本炎エネルギーをベンチのメガリザードンにつけて 3 番目の番にワザを打つ。
"""

from __future__ import annotations

from collections.abc import Callable

from setup_rate.cards import Card, Stage, basic_energy, goods, pokemon, special_energy, stadium, supporter
from setup_rate.engine import Action, DeckRules, Variant
from setup_rate.state import COLORLESS, GameState, PokemonInPlay, can_pay_cost

FIRE = "fire"
PSYCHIC = "psychic"

CHARMANDER = "ヒトカゲ"
CHARMELEON = "リザード"
MEGA_CHARIZARD_Y = "メガリザードンYex"
MEGA_CHARIZARD_X = "メガリザードンXex"
ORICORIO = "オドリドリex"
KANGASKHAN = "メガガルーラex"
TALONFLAME = "ファイアローex"
LATIAS = "ラティアスex"
MEOWTH = "ニャースex"
ENERGY_RETRIEVAL = "エネルギー回収"
RARE_CANDY = "ふしぎなアメ"
SWITCH = "ポケモンいれかえ"
ULTRA_BALL = "ハイパーボール"
POKEPAD = "ポケパッド"
NIGHT_STRETCHER = "夜のタンカ"
SPECIAL_RED_CARD = "スペシャルレッドカード"
SCOOP_UP_CYCLONE = "ポケモン回収サイクロン"
BOSS = "ボスの指令"
CYANO = "シアノ"
TOUKO = "トウコ"
LILLIE = "リーリエの決心"
HIKARI = "ヒカリ"
FIRE_STOKER = "ひふきやろう"
JAMMING_TOWER = "ジャミングタワー"
BATTLE_COLOSSEUM = "バトルコロシアム"
FIRE_ENERGY = "基本炎エネルギー"
IGNITION_ENERGY = "イグニッションエネルギー"

TALON_HUNT = "かぎづめハント"
INFERNO_X = "インフェルノX"
PLOSION_Y = "プロージョンY"
ERRAND_DASH = "おつかいダッシュ"
EXCITE_DIVE = "エキサイトダイブ"

MEGA_CHARIZARDS = (MEGA_CHARIZARD_X, MEGA_CHARIZARD_Y)
TALON_HUNT_COST = [COLORLESS, COLORLESS]
INFERNO_X_COST = [FIRE, FIRE]
PLOSION_Y_COST = [FIRE, FIRE, COLORLESS]
# インフェルノX が 270 に届く炎エネルギーの枚数(90 × 3)
FIRE_FOR_270 = 3
CHARMANDER_IN_PLAY_LIMIT = 2
EXPENDABLE_TIER_LIMIT = 2

CARD_TABLE: dict[str, Card] = {
    card.name: card
    for card in [
        pokemon(CHARMANDER, "048351", Stage.BASIC, 80, FIRE, retreat_cost=2),
        pokemon(CHARMELEON, "049481", Stage.STAGE1, 100, FIRE, evolves_from=CHARMANDER, retreat_cost=1),
        pokemon(MEGA_CHARIZARD_Y, "049482", Stage.STAGE2, 360, FIRE, evolves_from=CHARMELEON, has_rule_box=True, retreat_cost=1),
        pokemon(MEGA_CHARIZARD_X, "048353", Stage.STAGE2, 360, FIRE, evolves_from=CHARMELEON, has_rule_box=True, retreat_cost=2),
        pokemon(ORICORIO, "048358", Stage.BASIC, 190, FIRE, has_rule_box=True, retreat_cost=1),
        pokemon(KANGASKHAN, "047847", Stage.BASIC, 300, COLORLESS, has_rule_box=True, retreat_cost=3),
        pokemon(TALONFLAME, "050400", Stage.STAGE2, 280, COLORLESS, evolves_from="ヒノヤコマ", has_rule_box=True, retreat_cost=0),
        pokemon(LATIAS, "049524", Stage.BASIC, 210, PSYCHIC, has_rule_box=True, retreat_cost=2),
        pokemon(MEOWTH, "049694", Stage.BASIC, 170, COLORLESS, has_rule_box=True, retreat_cost=1),
        goods(ENERGY_RETRIEVAL, "049352"),
        goods(RARE_CANDY, "050423"),
        goods(SWITCH, "050744"),
        goods(ULTRA_BALL, "050742"),
        goods(POKEPAD, "050743"),
        goods(NIGHT_STRETCHER, "048681"),
        goods(SPECIAL_RED_CARD, "050205"),
        goods(SCOOP_UP_CYCLONE, "049380"),
        supporter(BOSS, "050467"),
        supporter(CYANO, "046442"),
        supporter(TOUKO, "048694"),
        supporter(LILLIE, "050468"),
        supporter(HIKARI, "050428"),
        supporter(FIRE_STOKER, "048418"),
        stadium(JAMMING_TOWER, "047214"),
        stadium(BATTLE_COLOSSEUM, "048419"),
        basic_energy(FIRE_ENERGY, "050746", FIRE),
        special_energy(IGNITION_ENERGY, "049452", (COLORLESS,)),
    ]
}

DECKLIST: list[tuple[str, int]] = [
    (CHARMANDER, 3),
    (CHARMELEON, 2),
    (MEGA_CHARIZARD_Y, 1),
    (MEGA_CHARIZARD_X, 2),
    (ORICORIO, 2),
    (KANGASKHAN, 3),
    (TALONFLAME, 2),
    (LATIAS, 2),
    (MEOWTH, 1),
    (ENERGY_RETRIEVAL, 2),
    (RARE_CANDY, 2),
    (SWITCH, 2),
    (ULTRA_BALL, 4),
    (POKEPAD, 2),
    (NIGHT_STRETCHER, 1),
    (SPECIAL_RED_CARD, 1),
    (SCOOP_UP_CYCLONE, 1),
    (BOSS, 2),
    (CYANO, 2),
    (TOUKO, 2),
    (LILLIE, 2),
    (HIKARI, 2),
    (FIRE_STOKER, 2),
    (JAMMING_TOWER, 1),
    (BATTLE_COLOSSEUM, 1),
    (FIRE_ENERGY, 10),
    (IGNITION_ENERGY, 3),
]


# ---- エネルギーの数え方 ----


def energy_units(target: PokemonInPlay) -> list[str]:
    """イグニッションエネルギーは無色 1 個分、進化ポケモンについていれば無色 3 個分としてはたらく。"""
    units: list[str] = []
    for energy in target.energies:
        if energy.name == IGNITION_ENERGY:
            units.extend([COLORLESS] * (3 if target.card.stage is not Stage.BASIC else 1))
        else:
            units.extend(energy.provides)
    return units


def can_pay(target: PokemonInPlay, cost: list[str]) -> bool:
    return can_pay_cost(cost, energy_units(target))


def fire_energy_on_field(state: GameState) -> int:
    return sum(p.count_energy(FIRE) for p in state.pokemon_in_play())


# ---- 場の見かた ----


def is_named(name: str) -> Callable[[Card], bool]:
    return lambda card: card.name == name


def mega_charizards_in_play(state: GameState) -> list[PokemonInPlay]:
    return [p for p in state.pokemon_in_play() if p.name in MEGA_CHARIZARDS]


def has_fire_mega(state: GameState) -> bool:
    """オドリドリex の特性の条件: 場に炎タイプの「メガシンカex」がいる。このデッキではメガリザードンだけ。"""
    return bool(mega_charizards_in_play(state))


def has_colorless_mega(state: GameState) -> bool:
    """ファイアローex の特性の条件: 場に無色タイプの「メガシンカex」がいる。このデッキではメガガルーラex だけ。"""
    return state.count_in_play(KANGASKHAN) > 0


def evolvable_charmanders(state: GameState) -> list[PokemonInPlay]:
    found = [c for c in state.find_in_play(CHARMANDER) if state.turn >= 2 and not c.is_fresh(state.turn)]
    # ベンチのヒトカゲを優先するのは、オドリドリex の特性がベンチの炎ポケモンにしかエネルギーをつけられないため。
    # バトル場のヒトカゲはエネルギーが無ければ特性「みがる」でにげられるので、後から入れ替えられる
    found.sort(key=lambda c: (-len(c.energies), c is state.active, c.turn_entered))
    return found


def mega_in_hand(state: GameState) -> Card | None:
    return state.first_in_hand(MEGA_CHARIZARD_X) or state.first_in_hand(MEGA_CHARIZARD_Y)


def count_mega_unseen(state: GameState) -> int:
    return state.count_unseen(MEGA_CHARIZARD_X) + state.count_unseen(MEGA_CHARIZARD_Y)


def count_mega_in_hand(state: GameState) -> int:
    return state.count_in_hand(MEGA_CHARIZARD_X) + state.count_in_hand(MEGA_CHARIZARD_Y)


def can_charizard_attack(target: PokemonInPlay) -> bool:
    if target.name == MEGA_CHARIZARD_X:
        return can_pay(target, INFERNO_X_COST)
    if target.name == MEGA_CHARIZARD_Y:
        return can_pay(target, PLOSION_Y_COST)
    return False


def is_active_charizard_ready(state: GameState) -> bool:
    active = state.active
    return active is not None and can_charizard_attack(active) and state.can_attack()


def is_active_talonflame_ready(state: GameState) -> bool:
    active = state.active
    return active is not None and active.name == TALONFLAME and can_pay(active, TALON_HUNT_COST) and state.can_attack()


def has_free_retreat(state: GameState) -> bool:
    """ヒトカゲの特性「みがる」: エネルギーがついていなければにげるエネルギーが 0。
    ラティアスex の特性「スカイライン」: たねポケモン全員のにげるエネルギーが 0。"""
    active = state.active
    if active is None:
        return False
    if active.card.retreat_cost == 0:
        return True
    if active.name == CHARMANDER and not active.energies:
        return True
    return active.card.stage is Stage.BASIC and state.count_in_play(LATIAS) > 0


def can_switch_active(state: GameState) -> bool:
    active = state.active
    if active is None:
        return False
    if state.count_in_hand(SWITCH) > 0:
        return True
    if state.retreated:
        return False
    return has_free_retreat(state) or len(active.energies) >= active.card.retreat_cost


def preferred_attacker(state: GameState) -> PokemonInPlay | None:
    """この番にワザを打たせたいポケモン。メガリザードンが打てるならそれを、次にファイアローex。"""
    for p in state.pokemon_in_play():
        if can_charizard_attack(p):
            return p
    for p in state.pokemon_in_play():
        if p.name == TALONFLAME and can_pay(p, TALON_HUNT_COST):
            return p
    return None


# ---- 対戦の準備 ----

ACTIVE_PRIORITY = [CHARMANDER, LATIAS, KANGASKHAN, ORICORIO, MEOWTH]
SETUP_BENCH_PRIORITY = [KANGASKHAN, CHARMANDER, CHARMANDER, LATIAS, ORICORIO]
BENCH_FILL_PRIORITY = [LATIAS, ORICORIO]


def choose_active(basics: list[Card]) -> Card:
    for name in ACTIVE_PRIORITY:
        for card in basics:
            if card.name == name:
                return card
    return basics[0]


def choose_bench_at_setup(basics: list[Card]) -> list[Card]:
    """ニャースex は特性のため手札に残す。ほかは優先順位の分だけ出す。"""
    chosen: list[Card] = []
    pool = list(basics)
    for name in SETUP_BENCH_PRIORITY:
        for card in pool:
            if card.name == name:
                chosen.append(card)
                pool.remove(card)
                break
    return chosen


def next_bench_candidate_from_hand(state: GameState) -> Card | None:
    for name in BENCH_FILL_PRIORITY:
        if state.count_in_play(name) == 0 and state.count_in_hand(name) > 0:
            return state.first_in_hand(name)
    return None


# ---- 手札の価値(ハイパーボールで捨てる順) ----


def expendable_tier(state: GameState, card: Card, seen: dict[str, int]) -> int:
    name = card.name
    nth = seen.get(name, 0)
    if name in (JAMMING_TOWER, BATTLE_COLOSSEUM, BOSS, SPECIAL_RED_CARD, SCOOP_UP_CYCLONE):
        return 0
    if name == ENERGY_RETRIEVAL and state.count_in_discard(FIRE_ENERGY) == 0:
        return 1
    if name == NIGHT_STRETCHER and not any(c.is_pokemon or c.name == FIRE_ENERGY for c in state.discard):
        return 1
    if name == SWITCH and nth >= 1:
        return 1
    if name in (LATIAS, ORICORIO, KANGASKHAN, MEOWTH) and state.count_in_play(name) >= 1:
        return 1
    if name == CHARMELEON and state.count_in_hand(RARE_CANDY) > 0 and count_mega_in_hand(state) > 0:
        return 1
    if name == HIKARI and has_fire_mega(state):
        return 1
    if name == FIRE_ENERGY:
        return 2 if nth >= (2 if not has_fire_mega(state) else 4) else 3
    if name == IGNITION_ENERGY and nth >= 1:
        return 2
    if card.is_supporter and nth >= 1:
        return 2
    if name == ULTRA_BALL and nth >= 1:
        return 2
    if name == RARE_CANDY and nth >= 1:
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


def is_kangaskhan_wanted(state: GameState) -> bool:
    return state.count_in_play(KANGASKHAN) == 0 and state.count_in_hand(KANGASKHAN) == 0 and state.count_unseen(KANGASKHAN) > 0


def is_talonflame_wanted(state: GameState) -> bool:
    return (
        state.count_in_play(TALONFLAME) == 0
        and state.count_in_hand(TALONFLAME) == 0
        and state.count_unseen(TALONFLAME) > 0
        and (state.count_in_play(KANGASKHAN) > 0 or state.count_in_hand(KANGASKHAN) > 0)
    )


def is_charmander_wanted(state: GameState) -> bool:
    return (
        state.count_in_play(CHARMANDER) + state.count_in_hand(CHARMANDER) == 0
        and state.count_unseen(CHARMANDER) > 0
        and state.bench_space() > 0
    )


def is_mega_wanted(state: GameState) -> bool:
    return (
        not has_fire_mega(state)
        and count_mega_in_hand(state) == 0
        and count_mega_unseen(state) > 0
        and (state.count_in_hand(RARE_CANDY) > 0 or state.count_in_play(CHARMELEON) > 0)
    )


def is_oricorio_wanted(state: GameState) -> bool:
    return (
        state.count_in_play(ORICORIO) == 0
        and state.count_in_hand(ORICORIO) == 0
        and state.count_unseen(ORICORIO) > 0
        and (has_fire_mega(state) or count_mega_in_hand(state) > 0)
        and state.bench_space() > 0
    )


def is_latias_wanted(state: GameState) -> bool:
    return (
        state.count_in_play(LATIAS) == 0
        and state.count_in_hand(LATIAS) == 0
        and state.count_unseen(LATIAS) > 0
        and state.count_in_hand(SWITCH) == 0
        and state.bench_space() > 0
    )


def wanted_pokemon_for_ultra_ball(state: GameState) -> str | None:
    if is_kangaskhan_wanted(state):
        return KANGASKHAN
    if is_talonflame_wanted(state):
        return TALONFLAME
    if is_charmander_wanted(state):
        return CHARMANDER
    if is_mega_wanted(state):
        return MEGA_CHARIZARD_X if state.count_unseen(MEGA_CHARIZARD_X) > 0 else MEGA_CHARIZARD_Y
    if is_oricorio_wanted(state):
        return ORICORIO
    if is_latias_wanted(state):
        return LATIAS
    return None


def wanted_pokemon_for_pokepad(state: GameState) -> str | None:
    """ポケパッドは「ルールを持つポケモン」を除くため、対象はヒトカゲとリザードに限る。"""
    if is_charmander_wanted(state):
        return CHARMANDER
    if (
        state.count_in_play(CHARMANDER) > 0
        and not has_fire_mega(state)
        and state.count_in_hand(RARE_CANDY) == 0
        and state.count_in_hand(CHARMELEON) == 0
        and state.count_in_play(CHARMELEON) == 0
        and state.count_unseen(CHARMELEON) > 0
    ):
        return CHARMELEON
    if state.count_in_play(CHARMANDER) < CHARMANDER_IN_PLAY_LIMIT and state.count_in_hand(CHARMANDER) == 0 and state.count_unseen(CHARMANDER) > 0 and state.bench_space() > 0:
        return CHARMANDER
    return None


def wanted_ex_for_cyano(state: GameState) -> list[str]:
    wanted: list[str] = []
    if is_kangaskhan_wanted(state):
        wanted.append(KANGASKHAN)
    if is_talonflame_wanted(state) or (KANGASKHAN in wanted and state.count_in_hand(TALONFLAME) == 0 and state.count_unseen(TALONFLAME) > 0):
        wanted.append(TALONFLAME)
    if is_mega_wanted(state):
        wanted.append(MEGA_CHARIZARD_X if state.count_unseen(MEGA_CHARIZARD_X) > 0 else MEGA_CHARIZARD_Y)
    if is_oricorio_wanted(state) or (len(wanted) < 3 and state.count_in_play(ORICORIO) + state.count_in_hand(ORICORIO) == 0 and state.count_unseen(ORICORIO) > 0):
        wanted.append(ORICORIO)
    if len(wanted) < 3 and count_mega_in_hand(state) == 0 and not has_fire_mega(state) and count_mega_unseen(state) > 0 and MEGA_CHARIZARD_X not in wanted and MEGA_CHARIZARD_Y not in wanted:
        wanted.append(MEGA_CHARIZARD_X if state.count_unseen(MEGA_CHARIZARD_X) > 0 else MEGA_CHARIZARD_Y)
    return wanted[:3]


def wanted_energy_for_touko(state: GameState) -> str | None:
    if state.count_in_hand(IGNITION_ENERGY) == 0 and state.count_unseen(IGNITION_ENERGY) > 0 and (
        state.count_in_play(TALONFLAME) > 0 or state.count_in_hand(TALONFLAME) > 0 or is_talonflame_wanted(state)
    ):
        return IGNITION_ENERGY
    if state.count_unseen(FIRE_ENERGY) > 0:
        return FIRE_ENERGY
    if state.count_unseen(IGNITION_ENERGY) > 0:
        return IGNITION_ENERGY
    return None


def wanted_evolution_for_touko(state: GameState) -> str | None:
    if is_talonflame_wanted(state):
        return TALONFLAME
    if is_mega_wanted(state):
        return MEGA_CHARIZARD_X if state.count_unseen(MEGA_CHARIZARD_X) > 0 else MEGA_CHARIZARD_Y
    if not has_fire_mega(state) and state.count_in_hand(CHARMELEON) == 0 and state.count_in_play(CHARMELEON) == 0 and state.count_unseen(CHARMELEON) > 0 and state.count_in_hand(RARE_CANDY) == 0:
        return CHARMELEON
    if not has_fire_mega(state) and count_mega_in_hand(state) == 0 and count_mega_unseen(state) > 0:
        return MEGA_CHARIZARD_X if state.count_unseen(MEGA_CHARIZARD_X) > 0 else MEGA_CHARIZARD_Y
    return None


def holds_next_turn_plan(state: GameState) -> bool:
    has_candy_route = state.count_in_hand(RARE_CANDY) > 0 and count_mega_in_hand(state) > 0
    has_hand_route = state.count_in_hand(CHARMELEON) > 0 or (count_mega_in_hand(state) > 0 and state.count_in_play(CHARMELEON) > 0)
    has_talon_plan = state.count_in_hand(TALONFLAME) > 0 or (state.count_in_play(TALONFLAME) > 0 and state.count_in_hand(IGNITION_ENERGY) > 0)
    return has_candy_route or has_hand_route or has_talon_plan


def choose_supporter(state: GameState) -> str | None:
    if not state.can_use_supporter():
        return None
    in_hand = {name for name in (CYANO, TOUKO, HIKARI, FIRE_STOKER, LILLIE) if state.count_in_hand(name) > 0}
    cyano_wanted = wanted_ex_for_cyano(state) if CYANO in in_hand else []
    if TOUKO in in_hand and is_talonflame_wanted(state) and state.count_in_hand(IGNITION_ENERGY) == 0 and state.count_unseen(IGNITION_ENERGY) > 0:
        return TOUKO
    if CYANO in in_hand and len(cyano_wanted) >= 2:
        return CYANO
    if TOUKO in in_hand and wanted_evolution_for_touko(state) is not None and (is_talonflame_wanted(state) or is_mega_wanted(state)):
        return TOUKO
    if HIKARI in in_hand and not has_fire_mega(state) and count_mega_unseen(state) > 0 and count_mega_in_hand(state) == 0:
        return HIKARI
    if FIRE_STOKER in in_hand and has_fire_mega(state) and state.count_in_play(ORICORIO) > 0 and state.count_unseen(FIRE_ENERGY) > 0 and state.count_in_hand(FIRE_ENERGY) < 3:
        return FIRE_STOKER
    if CYANO in in_hand and len(cyano_wanted) >= 1:
        return CYANO
    if TOUKO in in_hand and wanted_evolution_for_touko(state) is not None:
        return TOUKO
    if LILLIE in in_hand and not holds_next_turn_plan(state):
        return LILLIE
    if HIKARI in in_hand and not has_fire_mega(state) and (state.count_unseen(CHARMANDER) > 0 or state.count_unseen(CHARMELEON) > 0):
        return HIKARI
    if LILLIE in in_hand:
        return LILLIE
    return None


def wanted_supporter_for_meowth(state: GameState) -> str | None:
    for name in (TOUKO, CYANO, HIKARI, FIRE_STOKER, LILLIE):
        if state.count_unseen(name) == 0:
            continue
        if name == TOUKO and (is_talonflame_wanted(state) or is_mega_wanted(state)):
            return name
        if name == CYANO and len(wanted_ex_for_cyano(state)) >= 2:
            return name
        if name == HIKARI and not has_fire_mega(state) and count_mega_in_hand(state) == 0:
            return name
        if name == FIRE_STOKER and has_fire_mega(state) and state.count_in_play(ORICORIO) > 0:
            return name
        if name == LILLIE:
            return name
    return None


# ---- 行動 ----


def kangaskhan_draw_available(state: GameState) -> bool:
    active = state.active
    return active is not None and active.name == KANGASKHAN and ERRAND_DASH not in state.used_once_per_turn and len(state.deck) >= 2


def kangaskhan_draw(state: GameState) -> None:
    """メガガルーラex の特性「おつかいダッシュ」: バトル場にいるなら番に 1 回、山札を 2 枚引く。"""
    state.used_once_per_turn.add(ERRAND_DASH)
    state.draw(2)
    state.record("特性 おつかいダッシュ: 2 枚引く")


def bench_kangaskhan_available(state: GameState) -> bool:
    return state.count_in_hand(KANGASKHAN) > 0 and state.count_in_play(KANGASKHAN) == 0 and state.bench_space() > 0


def bench_kangaskhan(state: GameState) -> None:
    state.place_on_bench(state.first_in_hand(KANGASKHAN), from_hand=True)


def bench_charmander_available(state: GameState) -> bool:
    return state.count_in_hand(CHARMANDER) > 0 and state.count_in_play(CHARMANDER) < CHARMANDER_IN_PLAY_LIMIT and state.bench_space() > 0


def bench_charmander(state: GameState) -> None:
    state.place_on_bench(state.first_in_hand(CHARMANDER), from_hand=True)


def talonflame_dive_available(state: GameState) -> bool:
    return (
        state.count_in_hand(TALONFLAME) > 0
        and has_colorless_mega(state)
        and EXCITE_DIVE not in state.used_once_per_turn
        and state.bench_space() > 0
        and state.count_in_play(TALONFLAME) == 0
    )


def talonflame_dive(state: GameState) -> None:
    """ファイアローex の特性「エキサイトダイブ」: 手札にあり、場に無色タイプのメガシンカex がいれば、番に 1 回ベンチに出す。"""
    state.used_once_per_turn.add(EXCITE_DIVE)
    state.place_on_bench(state.first_in_hand(TALONFLAME), from_hand=True, by_effect=True)


def rare_candy_available(state: GameState) -> bool:
    return (
        state.count_in_hand(RARE_CANDY) > 0
        and mega_in_hand(state) is not None
        and not has_fire_mega(state)
        and bool(evolvable_charmanders(state))
    )


def use_rare_candy(state: GameState) -> None:
    target = evolvable_charmanders(state)[0]
    state.use_goods(state.first_in_hand(RARE_CANDY))
    state.evolve_skipping_stage1(target, mega_in_hand(state), CHARMELEON)


def evolve_mega_from_hand_available(state: GameState) -> bool:
    mega = mega_in_hand(state)
    return mega is not None and any(state.can_evolve(c, mega) for c in state.find_in_play(CHARMELEON))


def evolve_mega_from_hand(state: GameState) -> None:
    mega = mega_in_hand(state)
    charmeleon = next(c for c in state.find_in_play(CHARMELEON) if state.can_evolve(c, mega))
    state.evolve(charmeleon, mega, from_hand=True)


def evolve_charmeleon_from_hand_available(state: GameState) -> bool:
    return (
        state.count_in_hand(CHARMELEON) > 0
        and not has_fire_mega(state)
        and state.count_in_play(CHARMELEON) == 0
        and bool(evolvable_charmanders(state))
        and not (state.count_in_hand(RARE_CANDY) > 0 and mega_in_hand(state) is not None)
    )


def evolve_charmeleon_from_hand(state: GameState) -> None:
    state.evolve(evolvable_charmanders(state)[0], state.first_in_hand(CHARMELEON), from_hand=True)


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


def bench_fill_available(state: GameState) -> bool:
    return state.bench_space() > 0 and next_bench_candidate_from_hand(state) is not None


def bench_fill(state: GameState) -> None:
    state.place_on_bench(next_bench_candidate_from_hand(state), from_hand=True)


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
    if name == CYANO:
        wanted = wanted_ex_for_cyano(state)
        state.use_supporter(card)
        state.search_deck_to_hand([is_named(w) for w in wanted])
    elif name == TOUKO:
        evolution = wanted_evolution_for_touko(state)
        energy = wanted_energy_for_touko(state)
        state.use_supporter(card)
        state.search_deck_to_hand([is_named(n) for n in (evolution, energy) if n])
    elif name == HIKARI:
        basic = CHARMANDER if state.count_in_play(CHARMANDER) + state.count_in_hand(CHARMANDER) < CHARMANDER_IN_PLAY_LIMIT else (
            ORICORIO if state.count_in_play(ORICORIO) + state.count_in_hand(ORICORIO) == 0 else LATIAS
        )
        stage2 = TALONFLAME if is_talonflame_wanted(state) else (MEGA_CHARIZARD_X if state.count_unseen(MEGA_CHARIZARD_X) > 0 else MEGA_CHARIZARD_Y)
        state.use_supporter(card)
        state.search_deck_to_hand([is_named(basic), is_named(CHARMELEON), is_named(stage2)])
    elif name == FIRE_STOKER:
        state.use_supporter(card)
        state.search_deck_to_hand([is_named(FIRE_ENERGY)] * 7)
    elif name == LILLIE:
        state.use_supporter(card)
        state.return_hand_to_deck()
        # 相手がいない計算ではサイドが 6 枚のままなので、引く枚数は常に 8 枚になる
        state.draw(8 if len(state.prizes) == 6 else 6)


def energy_target(state: GameState) -> tuple[PokemonInPlay, Card] | None:
    """手札からつけるエネルギーとその相手。イグニッションはファイアローex のかぎづめハントのためだけに使う。"""
    ignition = state.first_in_hand(IGNITION_ENERGY)
    fire = state.first_in_hand(FIRE_ENERGY)
    talonflames = [p for p in state.find_in_play(TALONFLAME) if not can_pay(p, TALON_HUNT_COST)]
    megas = mega_charizards_in_play(state)
    # イグニッションは番の終わりにトラッシュされるので、この番にファイアローex をバトル場に出せるときだけつける
    can_talonflame_attack_this_turn = state.can_attack() and (
        (state.active is not None and state.active.name == TALONFLAME) or can_switch_active(state)
    )
    if ignition is not None and talonflames and can_talonflame_attack_this_turn and not any(can_charizard_attack(m) for m in megas):
        return talonflames[0], ignition
    if fire is None:
        return None
    if megas:
        megas.sort(key=lambda m: -m.count_energy(FIRE))
        return megas[0], fire
    charmeleons = state.find_in_play(CHARMELEON)
    if charmeleons:
        return charmeleons[0], fire
    charmanders = state.find_in_play(CHARMANDER)
    if charmanders:
        # バトル場のヒトカゲにつけると特性「みがる」のにげる 0 が消えるので、ベンチのヒトカゲを優先する
        charmanders.sort(key=lambda c: (c is state.active, c.turn_entered))
        return charmanders[0], fire
    if talonflames:
        return talonflames[0], fire
    return None


def attach_energy_available(state: GameState) -> bool:
    return not state.energy_attached and energy_target(state) is not None


def attach_energy(state: GameState) -> None:
    target, energy = energy_target(state)
    state.attach_energy_from_hand(energy, target)


def attach_energy_before_lillie_available(state: GameState) -> bool:
    return attach_energy_available(state) and choose_supporter(state) == LILLIE


def oricorio_turbo_target(state: GameState) -> PokemonInPlay | None:
    if not has_fire_mega(state) or state.count_in_play(ORICORIO) == 0 or state.count_in_hand(FIRE_ENERGY) == 0:
        return None
    bench_fire = [p for p in state.bench if p.card.pokemon_type == FIRE]
    megas = [p for p in bench_fire if p.name in MEGA_CHARIZARDS and p.count_energy(FIRE) < 4]
    if megas:
        return megas[0]
    others = [p for p in bench_fire if p.name in (CHARMELEON, CHARMANDER) and p.count_energy(FIRE) < 2]
    return others[0] if others else None


def oricorio_turbo_available(state: GameState) -> bool:
    return oricorio_turbo_target(state) is not None


def oricorio_turbo(state: GameState) -> None:
    """オドリドリex の特性「エキサイトターボ」: 場に炎タイプのメガシンカex がいれば何回でも、
    手札の基本炎エネルギーをベンチの炎ポケモンにつける。手札からつける 1 回の制限には数えない。"""
    target = oricorio_turbo_target(state)
    energy = state.first_in_hand(FIRE_ENERGY)
    state.hand.remove(energy)
    target.energies.append(energy)
    state.record(f"特性 エキサイトターボ: {energy.name} → {target.name}")


def switch_to_attacker_available(state: GameState) -> bool:
    attacker = preferred_attacker(state)
    return attacker is not None and attacker is not state.active and can_switch_active(state) and state.can_attack()


def switch_to_attacker(state: GameState) -> None:
    attacker = preferred_attacker(state)
    active = state.active
    if not state.retreated and has_free_retreat(state):
        state.retreat(attacker, cost=0)
    elif not state.retreated and len(active.energies) >= active.card.retreat_cost:
        state.retreat(attacker, cost=active.card.retreat_cost)
    else:
        state.use_goods(state.first_in_hand(SWITCH))
        state.switch_active(attacker)


ACTIONS: list[Action] = [
    Action("おつかいダッシュで 2 枚引く", kangaskhan_draw_available, kangaskhan_draw),
    Action("メガガルーラex をベンチに出す", bench_kangaskhan_available, bench_kangaskhan),
    Action("ヒトカゲをベンチに出す", bench_charmander_available, bench_charmander),
    Action("エキサイトダイブでファイアローex を出す", talonflame_dive_available, talonflame_dive),
    Action("ふしぎなアメで進化させる", rare_candy_available, use_rare_candy),
    Action("手札のメガリザードンに進化させる", evolve_mega_from_hand_available, evolve_mega_from_hand),
    Action("ポケパッドで探す", pokepad_available, use_pokepad),
    Action("ハイパーボールで探す", ultra_ball_available, use_ultra_ball),
    Action("ベンチを埋める", bench_fill_available, bench_fill),
    Action("リーリエの決心の前にエネルギーをつける", attach_energy_before_lillie_available, attach_energy),
    Action("ニャースex を出してサポートを探す", meowth_for_supporter_available, bench_meowth_for_supporter),
    Action("サポートを使う", supporter_available, use_supporter),
    Action("手札のリザードに進化させる", evolve_charmeleon_from_hand_available, evolve_charmeleon_from_hand),
    Action("エネルギーをつける", attach_energy_available, attach_energy),
    Action("エキサイトターボで炎エネルギーをつける", oricorio_turbo_available, oricorio_turbo),
    Action("ワザを打つポケモンをバトル場に出す", switch_to_attacker_available, switch_to_attacker),
]


# ---- ワザ ----

TALON_HUNT_WANTED = [RARE_CANDY, MEGA_CHARIZARD_X, MEGA_CHARIZARD_Y, CHARMANDER, FIRE_STOKER, ORICORIO, IGNITION_ENERGY, FIRE_ENERGY]


def talon_hunt_picks(state: GameState) -> list[Callable[[Card], bool]]:
    picks: list[str] = []
    if state.count_in_hand(RARE_CANDY) == 0 and not has_fire_mega(state):
        picks.append(RARE_CANDY)
    if count_mega_in_hand(state) == 0 and not has_fire_mega(state):
        picks.append(MEGA_CHARIZARD_X if state.count_unseen(MEGA_CHARIZARD_X) > 0 else MEGA_CHARIZARD_Y)
    if state.count_in_play(CHARMANDER) + state.count_in_hand(CHARMANDER) == 0:
        picks.append(CHARMANDER)
    if state.count_in_play(ORICORIO) + state.count_in_hand(ORICORIO) == 0:
        picks.append(ORICORIO)
    if state.count_in_hand(FIRE_STOKER) == 0:
        picks.append(FIRE_STOKER)
    picks.extend([IGNITION_ENERGY, FIRE_ENERGY])
    return [is_named(name) for name in picks[:2]]


def choose_attack(state: GameState) -> str | None:
    active = state.active
    if active is None:
        return None
    if active.name == MEGA_CHARIZARD_X and can_pay(active, INFERNO_X_COST):
        # 計算の範囲(3 番目の番まで)ではワザの後の場を使わないので、自身の炎エネルギーだけをトラッシュする
        for energy in [e for e in active.energies if FIRE in e.provides]:
            active.energies.remove(energy)
            state.discard.append(energy)
        return INFERNO_X
    if active.name == MEGA_CHARIZARD_Y and can_pay(active, PLOSION_Y_COST):
        for _ in range(3):
            state.discard.append(active.energies.pop())
        return PLOSION_Y
    if active.name == TALONFLAME and can_pay(active, TALON_HUNT_COST):
        state.search_deck_to_hand(talon_hunt_picks(state))
        return TALON_HUNT
    return None


def discard_ignition_at_turn_end(state: GameState) -> None:
    """イグニッションエネルギーは、ポケモンについていれば自分の番の終わりにトラッシュする。"""
    for target in state.pokemon_in_play():
        for energy in [e for e in target.energies if e.name == IGNITION_ENERGY]:
            target.energies.remove(energy)
            state.discard.append(energy)
            state.record(f"番の終わりに {energy.name} をトラッシュ({target.name})")


# ---- 狙いと失敗の要因 ----

GOAL_TALON_HUNT = "ファイアローex でかぎづめハントを打てる"
GOAL_MEGA_IN_PLAY = "メガリザードン(X か Y)が場にいる"
GOAL_MEGA_ATTACK = "メガリザードンのワザを打てる"
GOAL_MEGA_ATTACK_270 = "メガリザードンのワザを 270 以上で打てる"


def can_attack_270(state: GameState) -> bool:
    active = state.active
    if not is_active_charizard_ready(state):
        return False
    if active.name == MEGA_CHARIZARD_Y:
        return True
    return fire_energy_on_field(state) >= FIRE_FOR_270


GOALS: dict[str, Callable[[GameState], bool]] = {
    GOAL_TALON_HUNT: is_active_talonflame_ready,
    GOAL_MEGA_IN_PLAY: has_fire_mega,
    GOAL_MEGA_ATTACK: is_active_charizard_ready,
    GOAL_MEGA_ATTACK_270: can_attack_270,
}

DEADLINES = [
    (GOAL_TALON_HUNT, 1),
    (GOAL_TALON_HUNT, 2),
    (GOAL_MEGA_IN_PLAY, 2),
    (GOAL_MEGA_IN_PLAY, 3),
    (GOAL_MEGA_ATTACK, 3),
    (GOAL_MEGA_ATTACK_270, 3),
]


def explain_failure(state: GameState, goal: str) -> str:
    if goal == GOAL_TALON_HUNT:
        if not state.can_attack():
            return "先攻の最初の番はワザを使えない"
        if state.count_in_play(KANGASKHAN) == 0:
            return "メガガルーラex が場にいない"
        talonflames = state.find_in_play(TALONFLAME)
        if not talonflames:
            return "ファイアローex を手札に用意できない"
        if not any(can_pay(t, TALON_HUNT_COST) for t in talonflames):
            return "ファイアローex につけるエネルギー(イグニッション)が無い"
        return "ファイアローex をバトル場に出せない"
    if not has_fire_mega(state):
        if state.count_in_play(CHARMANDER) + state.count_in_play(CHARMELEON) == 0:
            return "ヒトカゲを場に出せていない"
        if state.count_in_play(CHARMELEON) > 0:
            return "リザードまで進化したがメガリザードンが手札に無い"
        if state.count_in_hand(RARE_CANDY) > 0:
            return "ふしぎなアメはあるがメガリザードンが手札に無い"
        if count_mega_in_hand(state) > 0:
            return "メガリザードンはあるがふしぎなアメもリザードも無い"
        return "ふしぎなアメもリザードもメガリザードンも手札に無い"
    if goal == GOAL_MEGA_IN_PLAY:
        return "その他"
    megas = mega_charizards_in_play(state)
    if not any(can_charizard_attack(m) for m in megas):
        return "メガリザードンの炎エネルギーが足りない"
    if not is_active_charizard_ready(state):
        return "メガリザードンをバトル場に出せない"
    if goal == GOAL_MEGA_ATTACK_270:
        return f"場の炎エネルギーが {fire_energy_on_field(state)} 枚で 3 枚に届かない"
    return "その他"


VARIANTS = [
    Variant("イグニッションエネルギー 3→2(基本炎エネルギー +1)", {IGNITION_ENERGY: -1, FIRE_ENERGY: +1}),
    Variant("イグニッションエネルギー 3→4(基本炎エネルギー -1)", {IGNITION_ENERGY: +1, FIRE_ENERGY: -1}),
    Variant("メガガルーラex 3→2(基本炎エネルギー +1)", {KANGASKHAN: -1, FIRE_ENERGY: +1}),
    Variant("ファイアローex 2→1(基本炎エネルギー +1)", {TALONFLAME: -1, FIRE_ENERGY: +1}),
    Variant("ラティアスex 2→1(基本炎エネルギー +1)", {LATIAS: -1, FIRE_ENERGY: +1}),
    Variant("オドリドリex 2→1(基本炎エネルギー +1)", {ORICORIO: -1, FIRE_ENERGY: +1}),
    Variant("ヒカリ 2→1(基本炎エネルギー +1)", {HIKARI: -1, FIRE_ENERGY: +1}),
    Variant("シアノ 2→3(ジャミングタワー -1)", {CYANO: +1, JAMMING_TOWER: -1}),
    Variant("トウコ 2→3(バトルコロシアム -1)", {TOUKO: +1, BATTLE_COLOSSEUM: -1}),
    Variant("ふしぎなアメ 2→3(ジャミングタワー -1)", {RARE_CANDY: +1, JAMMING_TOWER: -1}),
]

ASSUMPTIONS = [
    "相手の行動を含めない。相手の妨害、きぜつ、サイドを取ることは起きない(リーリエの決心は常に 8 枚引く)",
    "手札の使い方はこの規則ファイルの行動の並び(優先順位)に固定する。実際のプレイヤーの判断とは違うことがある",
    "対戦の準備ではヒトカゲをバトル場に置き、メガガルーラex・ヒトカゲ・ラティアスex・オドリドリex をベンチに出す。ニャースex は特性のため手札に残す",
    "イグニッションエネルギーはファイアローex のかぎづめハントのためだけに手札からつける。かぎづめハントで取る 2 枚は、ふしぎなアメ、メガリザードン、ヒトカゲ、オドリドリex、ひふきやろう、エネルギーの順で無いものから選ぶ",
    "ワザはメガリザードン(X か Y)が打てればそれを、次にファイアローex を選ぶ。インフェルノX は自身の炎エネルギーだけをトラッシュする",
    "引き直しは自分の分だけ扱い、相手の引き直しで自分が追加で引ける 1 枚は扱わない",
    "「打てる」は、番の終わり(ワザを使う前)にバトル場からそのワザを使える状態を指す。先攻の最初の番はワザを使えないので、かぎづめハントの 1 番目の番の数字は後攻だけに意味がある",
]

RULES = DeckRules(
    title="メガリザードンYex & Xex デッキ(後攻 1 番目の番にかぎづめハント、3 番目の番にメガリザードン)",
    deck_code="DxKGxx-6pqCKy-xxJ8Yc",
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
    end_turn=discard_ignition_at_turn_end,
)

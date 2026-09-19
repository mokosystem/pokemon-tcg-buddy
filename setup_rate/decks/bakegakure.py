"""ばけがくれ(ダダリン)デッキの規則。

デッキコード 9nnnLP-Wejgk5-gn6gn9(開発責任者のデッキ。2026-09-17 に読み取り)。
各カードの効果は 2026-09-17 に公式のカード詳細ページで確認し、計算に必要な範囲だけを自分の言葉で書いている。
詳細ページ: https://www.pokemon-card.com/card-search/details.php/card/{カード ID}/regu/XY

狙い: 特性「ばけがくれ」を持つポケモン(チャデス、ヤバソチャ、カゲボウズ、ジュペッタ)を、ムク、ハイパーボール、
プリズムタワーで手札からトラッシュに送り、4 枚以上になったところでダダリンの「むねんのイカリ」を 170 で打つ。
進化ではなく「トラッシュの枚数」が条件になる主軸で、山札を引く量(リーリエの決心、ムク、ノココッチ)が成立を左右する。
"""

from __future__ import annotations

from collections.abc import Callable

from setup_rate.cards import Card, Category, Stage, basic_energy, goods, pokemon, special_energy, stadium, supporter
from setup_rate.engine import Action, DeckRules, Variant
from setup_rate.state import COLORLESS, GameState, PokemonInPlay

PSYCHIC = "psychic"
GRASS = "grass"

DHELMISE = "ダダリン"
POLTCHAGEIST = "チャデス"
SINISTCHA = "ヤバソチャ"
SHUPPET = "カゲボウズ"
BANETTE = "ジュペッタ"
DUDUNSPARCE = "ノココッチ"
DUNSPARCE = "ノコッチ"
CLEFAIRY = "リーリエのピッピex"
URSALUNA = "ガチグマ アカツキex"
POFFIN = "なかよしポフィン"
POKEPAD = "ポケパッド"
ULTRA_BALL = "ハイパーボール"
POKEGEAR = "ポケギア3.0"
NIGHT_STRETCHER = "夜のタンカ"
BALLOON = "ふうせん"
SUGURI = "スグリ"
LILLIE = "リーリエの決心"
MUKU = "ムク"
BOSS = "ボスの指令"
PRISM_TOWER = "プリズムタワー"
LEGACY_ENERGY = "レガシーエネルギー"
TELEPATH_ENERGY = "テレパス超エネルギー"
PSYCHIC_ENERGY = "基本超エネルギー"

BAKEGAKURE = (POLTCHAGEIST, SINISTCHA, SHUPPET, BANETTE)
RAGE_OF_REGRET = "むねんのイカリ"
RUNAWAY_DRAW = "にげあしドロー"
# むねんのイカリが 170 になる、トラッシュの「ばけがくれ」の枚数
BAKEGAKURE_FOR_170 = 4
DHELMISE_IN_PLAY_LIMIT = 2
EXPENDABLE_TIER_LIMIT = 2

CARD_TABLE: dict[str, Card] = {
    card.name: card
    for card in [
        pokemon(DHELMISE, "050308", Stage.BASIC, 140, PSYCHIC, retreat_cost=3),
        pokemon(POLTCHAGEIST, "050224", Stage.BASIC, 30, GRASS, retreat_cost=0),
        pokemon(SINISTCHA, "050225", Stage.STAGE1, 60, GRASS, evolves_from=POLTCHAGEIST, retreat_cost=1),
        pokemon(SHUPPET, "050250", Stage.BASIC, 50, PSYCHIC, retreat_cost=1),
        pokemon(BANETTE, "050251", Stage.STAGE1, 80, PSYCHIC, evolves_from=SHUPPET, retreat_cost=1),
        pokemon(DUDUNSPARCE, "045203", Stage.STAGE1, 140, COLORLESS, evolves_from=DUNSPARCE, retreat_cost=3),
        pokemon(DUNSPARCE, "047086", Stage.BASIC, 70, COLORLESS, retreat_cost=1),
        pokemon(CLEFAIRY, "049521", Stage.BASIC, 190, PSYCHIC, has_rule_box=True, retreat_cost=1),
        pokemon(URSALUNA, "049341", Stage.BASIC, 260, COLORLESS, has_rule_box=True, retreat_cost=3),
        goods(POFFIN, "049364"),
        goods(POKEPAD, "050424"),
        goods(ULTRA_BALL, "050461"),
        goods(POKEGEAR, "049376"),
        goods(NIGHT_STRETCHER, "048681"),
        Card(name=BALLOON, category=Category.TOOL, card_id="050464"),
        supporter(SUGURI, "047894"),
        supporter(LILLIE, "050468"),
        supporter(MUKU, "050297"),
        supporter(BOSS, "050467"),
        stadium(PRISM_TOWER, "050164"),
        special_energy(LEGACY_ENERGY, "049457", (PSYCHIC, GRASS, COLORLESS)),
        special_energy(TELEPATH_ENERGY, "049712", (PSYCHIC,)),
        basic_energy(PSYCHIC_ENERGY, "049463", PSYCHIC),
    ]
}

DECKLIST: list[tuple[str, int]] = [
    (DHELMISE, 4),
    (POLTCHAGEIST, 4),
    (SINISTCHA, 1),
    (SHUPPET, 4),
    (BANETTE, 3),
    (DUDUNSPARCE, 2),
    (DUNSPARCE, 3),
    (CLEFAIRY, 1),
    (URSALUNA, 1),
    (POFFIN, 2),
    (POKEPAD, 4),
    (ULTRA_BALL, 4),
    (POKEGEAR, 2),
    (NIGHT_STRETCHER, 2),
    (BALLOON, 1),
    (SUGURI, 2),
    (LILLIE, 4),
    (MUKU, 4),
    (BOSS, 2),
    (PRISM_TOWER, 3),
    (LEGACY_ENERGY, 1),
    (TELEPATH_ENERGY, 4),
    (PSYCHIC_ENERGY, 2),
]


# ---- 場とトラッシュの見かた ----


def is_named(name: str) -> Callable[[Card], bool]:
    return lambda card: card.name == name


def is_bakegakure(card: Card) -> bool:
    return card.name in BAKEGAKURE


def count_bakegakure_in_discard(state: GameState) -> int:
    return sum(1 for card in state.discard if is_bakegakure(card))


def bakegakure_in_hand(state: GameState) -> list[Card]:
    return [card for card in state.hand if is_bakegakure(card)]


def dhelmise_in_play(state: GameState) -> list[PokemonInPlay]:
    found = state.find_in_play(DHELMISE)
    found.sort(key=lambda p: (p is not state.active, -p.count_energy(PSYCHIC), p.turn_entered))
    return found


def can_dhelmise_attack(target: PokemonInPlay) -> bool:
    return target.name == DHELMISE and target.count_energy(PSYCHIC) >= 1


def is_active_dhelmise_ready(state: GameState) -> bool:
    return state.active is not None and can_dhelmise_attack(state.active) and state.can_attack()


def has_free_retreat(state: GameState) -> bool:
    active = state.active
    if active is None:
        return False
    cost = active.card.retreat_cost
    if any(card.name == BALLOON for card in active.underneath):
        cost = max(0, cost - 2)
    return cost == 0


def can_switch_active(state: GameState) -> bool:
    active = state.active
    if active is None:
        return False
    if state.retreated:
        return state.count_in_hand(SUGURI) > 0 and state.can_use_supporter()
    return has_free_retreat(state) or len(active.energies) >= active.card.retreat_cost or (
        state.count_in_hand(SUGURI) > 0 and state.can_use_supporter()
    )


# ---- 対戦の準備 ----

# ダダリンをバトル場に置くのは、にげるエネルギーが 3 と重く、後から入れ替えるより最初から置くほうが楽なため。
# 「ばけがくれ」のポケモンはトラッシュに送りたいので、対戦の準備ではベンチに出さず手札に残す
ACTIVE_PRIORITY = [DHELMISE, DUNSPARCE, POLTCHAGEIST, SHUPPET, CLEFAIRY, URSALUNA]
SETUP_BENCH_PRIORITY = [DUNSPARCE, DHELMISE]


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


# ---- 手札の価値(捨てる順) ----


def discard_priority(state: GameState, card: Card, seen: dict[str, int]) -> int:
    """小さいほど先に捨てる。「ばけがくれ」のポケモンはトラッシュに送ること自体が狙いなので最優先で捨てる。"""
    name = card.name
    nth = seen.get(name, 0)
    if is_bakegakure(card):
        return 0
    if name in (BOSS, URSALUNA, CLEFAIRY, BALLOON):
        return 1
    if name == NIGHT_STRETCHER and not any(c.is_pokemon or c.name == PSYCHIC_ENERGY for c in state.discard):
        return 1
    if name == DHELMISE and state.count_in_play(DHELMISE) + nth >= DHELMISE_IN_PLAY_LIMIT:
        return 1
    if name == DUNSPARCE and state.count_in_play(DUNSPARCE) + state.count_in_play(DUDUNSPARCE) >= 1:
        return 1
    if name == DUDUNSPARCE and nth >= 1:
        return 1
    if name == PRISM_TOWER and (state.stadium is not None and state.stadium.name == PRISM_TOWER or nth >= 1):
        return 1
    if name == SUGURI:
        return 1
    if card.is_supporter and nth >= 1:
        return 2
    if name == PSYCHIC_ENERGY and nth >= 1:
        return 2
    if name == TELEPATH_ENERGY and nth >= 1:
        return 2
    if name in (POKEPAD, ULTRA_BALL, POKEGEAR) and nth >= 1:
        return 2
    return 3


def cards_to_discard(state: GameState, count: int, excluding: Card | None = None, limit: int = EXPENDABLE_TIER_LIMIT) -> list[Card]:
    seen: dict[str, int] = {}
    ranked: list[tuple[int, int, Card]] = []
    skipped = False
    for index, card in enumerate(state.hand):
        if card is excluding and not skipped:
            skipped = True
            continue
        tier = discard_priority(state, card, seen)
        seen[card.name] = seen.get(card.name, 0) + 1
        if tier <= limit:
            ranked.append((tier, index, card))
    ranked.sort(key=lambda item: (item[0], item[1]))
    chosen = [card for _, _, card in ranked[:count]]
    return chosen if len(chosen) == count else []


# ---- 何が欲しいか ----


def is_dhelmise_wanted(state: GameState) -> bool:
    return state.count_in_play(DHELMISE) + state.count_in_hand(DHELMISE) == 0 and state.count_unseen(DHELMISE) > 0


def is_dunsparce_wanted(state: GameState) -> bool:
    return (
        state.count_in_play(DUNSPARCE) + state.count_in_play(DUDUNSPARCE) + state.count_in_hand(DUNSPARCE) == 0
        and state.count_unseen(DUNSPARCE) > 0
        and state.bench_space() > 0
    )


def wanted_bakegakure_in_deck(state: GameState) -> str | None:
    """トラッシュに送るために手札に取る「ばけがくれ」。ジュペッタとヤバソチャは進化ポケモンで
    ポフィンやテレパス超エネルギーでは出せないので、先に取る。"""
    for name in (BANETTE, SINISTCHA, SHUPPET, POLTCHAGEIST):
        if state.count_unseen(name) > 0:
            return name
    return None


def wanted_pokemon_for_ultra_ball(state: GameState) -> str | None:
    if is_dhelmise_wanted(state):
        return DHELMISE
    if is_dunsparce_wanted(state):
        return DUNSPARCE
    if (
        state.count_in_play(DUNSPARCE) > 0
        and state.count_in_hand(DUDUNSPARCE) == 0
        and state.count_in_play(DUDUNSPARCE) == 0
        and state.count_unseen(DUDUNSPARCE) > 0
        and state.turn >= 1
    ):
        return DUDUNSPARCE
    if count_bakegakure_in_discard(state) + len(bakegakure_in_hand(state)) < BAKEGAKURE_FOR_170 + 1:
        return wanted_bakegakure_in_deck(state)
    return None


def wanted_pokemon_for_pokepad(state: GameState) -> str | None:
    """ポケパッドは「ルールを持つポケモン」を除く。このデッキの主要なポケモンはすべて対象になる。"""
    return wanted_pokemon_for_ultra_ball(state)


def choose_supporter(state: GameState) -> str | None:
    if not state.can_use_supporter():
        return None
    in_hand = {name for name in (MUKU, LILLIE, SUGURI) if state.count_in_hand(name) > 0}
    if MUKU in in_hand and len(bakegakure_in_hand(state)) >= 2:
        return MUKU
    if MUKU in in_hand and len(bakegakure_in_hand(state)) == 1 and count_bakegakure_in_discard(state) >= BAKEGAKURE_FOR_170 - 1:
        return MUKU
    if LILLIE in in_hand and len(state.hand) - 1 <= 4:
        return LILLIE
    if MUKU in in_hand and len(bakegakure_in_hand(state)) >= 1:
        return MUKU
    if LILLIE in in_hand and not bakegakure_in_hand(state) and not any(card.is_energy for card in state.hand):
        return LILLIE
    if LILLIE in in_hand:
        return LILLIE
    return None


# ---- 行動 ----


def dudunsparce_draw_available(state: GameState) -> bool:
    dudunsparces = state.find_in_play(DUDUNSPARCE)
    if not dudunsparces or RUNAWAY_DRAW in state.used_once_per_turn or len(state.deck) < 3:
        return False
    # バトル場のノココッチを戻すと場が空になるときは使わない
    return not (dudunsparces[0] is state.active and not state.bench)


def dudunsparce_draw(state: GameState) -> None:
    """ノココッチの特性「にげあしドロー」: 番に 1 回、3 枚引いた後、このポケモンをついているカードごと山札に戻す。"""
    state.used_once_per_turn.add(RUNAWAY_DRAW)
    target = state.find_in_play(DUDUNSPARCE)[0]
    state.draw(3)
    state.record("特性 にげあしドロー: 3 枚引く")
    state.return_pokemon_to_deck(target)
    if state.active is None:
        candidates = sorted(state.bench, key=lambda p: (p.name != DHELMISE, -p.count_energy(PSYCHIC), p.turn_entered))
        state.active = candidates[0]
        state.bench.remove(candidates[0])
        state.record(f"バトル場 ← {state.active.name}")


def evolve_dudunsparce_available(state: GameState) -> bool:
    card = state.first_in_hand(DUDUNSPARCE)
    return card is not None and any(state.can_evolve(d, card) for d in state.find_in_play(DUNSPARCE))


def evolve_dudunsparce(state: GameState) -> None:
    card = state.first_in_hand(DUDUNSPARCE)
    target = next(d for d in state.find_in_play(DUNSPARCE) if state.can_evolve(d, card))
    state.evolve(target, card, from_hand=True)


def bench_dhelmise_available(state: GameState) -> bool:
    return state.count_in_hand(DHELMISE) > 0 and state.count_in_play(DHELMISE) < DHELMISE_IN_PLAY_LIMIT and state.bench_space() > 0


def bench_dhelmise(state: GameState) -> None:
    state.place_on_bench(state.first_in_hand(DHELMISE), from_hand=True)


def bench_dunsparce_available(state: GameState) -> bool:
    return (
        state.count_in_hand(DUNSPARCE) > 0
        and state.count_in_play(DUNSPARCE) + state.count_in_play(DUDUNSPARCE) < 2
        and state.bench_space() > 1
    )


def bench_dunsparce(state: GameState) -> None:
    state.place_on_bench(state.first_in_hand(DUNSPARCE), from_hand=True)


def play_prism_tower_available(state: GameState) -> bool:
    return state.count_in_hand(PRISM_TOWER) > 0 and not state.stadium_played and (state.stadium is None or state.stadium.name != PRISM_TOWER)


def play_prism_tower(state: GameState) -> None:
    state.play_stadium(state.first_in_hand(PRISM_TOWER))


def prism_tower_draw_available(state: GameState) -> bool:
    if state.stadium is None or state.stadium.name != PRISM_TOWER or PRISM_TOWER in state.used_once_per_turn:
        return False
    return len(cards_to_discard(state, 2, limit=1)) == 2 and len(state.deck) >= 1


def prism_tower_draw(state: GameState) -> None:
    """プリズムタワー: 番に 1 回、手札を 2 枚トラッシュして 1 枚引く。「ばけがくれ」を捨てる手段として使う。"""
    state.used_once_per_turn.add(PRISM_TOWER)
    state.discard_from_hand(cards_to_discard(state, 2, limit=1))
    state.draw(1)
    state.record("プリズムタワー: 2 枚トラッシュして 1 枚引く")


def poffin_available(state: GameState) -> bool:
    return state.count_in_hand(POFFIN) > 0 and is_dunsparce_wanted(state)


def use_poffin(state: GameState) -> None:
    """なかよしポフィン: HP 70 以下のたねを 2 枚までベンチに出す。ノコッチだけを出し、
    「ばけがくれ」のポケモンは山札に残す(ベンチに出すとトラッシュに送れない)。"""
    state.use_goods(state.first_in_hand(POFFIN))
    for _ in range(2):
        card = state.find_in_deck(is_named(DUNSPARCE))
        if card is None or state.bench_space() <= 0 or state.count_in_play(DUNSPARCE) >= 2:
            break
        state.place_on_bench(card, from_hand=False)
    state.shuffle_deck()


def pokepad_available(state: GameState) -> bool:
    return state.count_in_hand(POKEPAD) > 0 and wanted_pokemon_for_pokepad(state) is not None


def use_pokepad(state: GameState) -> None:
    wanted = wanted_pokemon_for_pokepad(state)
    state.use_goods(state.first_in_hand(POKEPAD))
    state.search_deck_to_hand([lambda card: card.name == wanted and not card.has_rule_box])


def ultra_ball_available(state: GameState) -> bool:
    ball = state.first_in_hand(ULTRA_BALL)
    if ball is None:
        return False
    fodder = cards_to_discard(state, 2, excluding=ball)
    if len(fodder) < 2:
        return False
    # 捨てる 2 枚に「ばけがくれ」が含まれるなら、探す相手が無くてもトラッシュに送るために使う
    return wanted_pokemon_for_ultra_ball(state) is not None or any(is_bakegakure(c) for c in fodder)


def use_ultra_ball(state: GameState) -> None:
    ball = state.first_in_hand(ULTRA_BALL)
    wanted = wanted_pokemon_for_ultra_ball(state)
    state.discard_from_hand(cards_to_discard(state, 2, excluding=ball))
    state.use_goods(ball)
    if wanted is not None:
        state.search_deck_to_hand([is_named(wanted)])
    else:
        state.shuffle_deck()


def pokegear_available(state: GameState) -> bool:
    return state.count_in_hand(POKEGEAR) > 0 and state.can_use_supporter() and choose_supporter(state) is None


def use_pokegear(state: GameState) -> None:
    """ポケギア3.0: 山札の上から 7 枚を見てサポートを 1 枚手札に加える。ムクを優先し、無ければリーリエの決心。"""
    state.use_goods(state.first_in_hand(POKEGEAR))
    wanted = [MUKU, LILLIE] if bakegakure_in_hand(state) else [LILLIE, MUKU]
    state.reveal_top_and_take(7, lambda card: card.name in wanted)


def supporter_available(state: GameState) -> bool:
    return choose_supporter(state) is not None


def use_supporter(state: GameState) -> None:
    name = choose_supporter(state)
    card = state.first_in_hand(name)
    if name == MUKU:
        state.use_supporter(card)
        discards = [c for c in bakegakure_in_hand(state)][:2]
        state.discard_from_hand(discards)
        state.draw(3 * len(discards))
    elif name == LILLIE:
        state.use_supporter(card)
        state.return_hand_to_deck()
        # 相手がいない計算ではサイドが 6 枚のままなので、引く枚数は常に 8 枚になる
        state.draw(8 if len(state.prizes) == 6 else 6)


def energy_target(state: GameState) -> PokemonInPlay | None:
    dhelmises = [d for d in dhelmise_in_play(state) if d.count_energy(PSYCHIC) == 0]
    if dhelmises:
        return dhelmises[0]
    return None


def attach_energy_available(state: GameState) -> bool:
    if state.energy_attached or energy_target(state) is None:
        return False
    return any(card.is_energy for card in state.hand)


def attach_energy(state: GameState) -> None:
    """テレパス超エネルギーを超ポケモンにつけたときは、山札から超タイプのたねを 2 枚までベンチに出せる。
    ダダリンの 2 匹目だけを出し、「ばけがくれ」のポケモンは山札に残す。"""
    target = energy_target(state)
    telepath = state.first_in_hand(TELEPATH_ENERGY)
    energy = telepath or state.first_in_hand(PSYCHIC_ENERGY) or state.first_in_hand(LEGACY_ENERGY)
    state.attach_energy_from_hand(energy, target)
    if energy is telepath:
        card = state.find_in_deck(is_named(DHELMISE))
        if card is not None and state.count_in_play(DHELMISE) < DHELMISE_IN_PLAY_LIMIT and state.bench_space() > 0:
            state.place_on_bench(card, from_hand=False)
        state.shuffle_deck()


def attach_energy_before_lillie_available(state: GameState) -> bool:
    return attach_energy_available(state) and choose_supporter(state) == LILLIE


def switch_to_dhelmise_available(state: GameState) -> bool:
    ready = [d for d in state.bench if can_dhelmise_attack(d)]
    return bool(ready) and not (state.active is not None and can_dhelmise_attack(state.active)) and can_switch_active(state) and state.can_attack()


def switch_to_dhelmise(state: GameState) -> None:
    attacker = next(d for d in state.bench if can_dhelmise_attack(d))
    active = state.active
    if not state.retreated and has_free_retreat(state):
        state.retreat(attacker, cost=0)
    elif not state.retreated and len(active.energies) >= active.card.retreat_cost:
        state.retreat(attacker, cost=active.card.retreat_cost)
    else:
        state.use_supporter(state.first_in_hand(SUGURI))
        state.switch_active(attacker)


ACTIONS: list[Action] = [
    Action("ノココッチに進化させる", evolve_dudunsparce_available, evolve_dudunsparce),
    Action("にげあしドローで 3 枚引く", dudunsparce_draw_available, dudunsparce_draw),
    Action("ダダリンをベンチに出す", bench_dhelmise_available, bench_dhelmise),
    Action("ノコッチをベンチに出す", bench_dunsparce_available, bench_dunsparce),
    Action("プリズムタワーを出す", play_prism_tower_available, play_prism_tower),
    Action("なかよしポフィンでノコッチを出す", poffin_available, use_poffin),
    Action("ハイパーボールで捨てて探す", ultra_ball_available, use_ultra_ball),
    Action("ポケパッドで探す", pokepad_available, use_pokepad),
    Action("プリズムタワーで 2 枚捨てて 1 枚引く", prism_tower_draw_available, prism_tower_draw),
    Action("リーリエの決心の前にエネルギーをつける", attach_energy_before_lillie_available, attach_energy),
    Action("ポケギア3.0 でサポートを探す", pokegear_available, use_pokegear),
    Action("サポートを使う", supporter_available, use_supporter),
    Action("エネルギーをつける", attach_energy_available, attach_energy),
    Action("ダダリンをバトル場に出す", switch_to_dhelmise_available, switch_to_dhelmise),
]


# ---- ワザ ----


def choose_attack(state: GameState) -> str | None:
    if is_active_dhelmise_ready(state):
        return RAGE_OF_REGRET
    return None


# ---- 狙いと失敗の要因 ----

GOAL_TRASH_4 = "トラッシュに「ばけがくれ」のポケモンが 4 枚以上ある"
GOAL_ATTACK = "ダダリンでむねんのイカリを打てる"
GOAL_ATTACK_170 = "むねんのイカリを 170 で打てる"

GOALS: dict[str, Callable[[GameState], bool]] = {
    GOAL_TRASH_4: lambda state: count_bakegakure_in_discard(state) >= BAKEGAKURE_FOR_170,
    GOAL_ATTACK: is_active_dhelmise_ready,
    GOAL_ATTACK_170: lambda state: is_active_dhelmise_ready(state) and count_bakegakure_in_discard(state) >= BAKEGAKURE_FOR_170,
}

DEADLINES = [(GOAL_TRASH_4, 2), (GOAL_TRASH_4, 3), (GOAL_ATTACK, 2), (GOAL_ATTACK_170, 2), (GOAL_ATTACK_170, 3)]


def explain_failure(state: GameState, goal: str) -> str:
    in_discard = count_bakegakure_in_discard(state)
    if goal == GOAL_TRASH_4 or (goal == GOAL_ATTACK_170 and in_discard < BAKEGAKURE_FOR_170 and is_active_dhelmise_ready(state)):
        return f"トラッシュの「ばけがくれ」が {in_discard} 枚で 4 枚に届かない"
    if not state.can_attack():
        return "先攻の最初の番はワザを使えない"
    if state.count_in_play(DHELMISE) == 0:
        return "ダダリンが場にいない"
    if not any(can_dhelmise_attack(d) for d in state.find_in_play(DHELMISE)):
        return "ダダリンにエネルギーがついていない"
    if not is_active_dhelmise_ready(state):
        return "ダダリンをバトル場に出せない"
    return f"トラッシュの「ばけがくれ」が {in_discard} 枚で 4 枚に届かない"


VARIANTS = [
    Variant("ムク 4→3(基本超エネルギー +1)", {MUKU: -1, PSYCHIC_ENERGY: +1}),
    Variant("プリズムタワー 3→2(基本超エネルギー +1)", {PRISM_TOWER: -1, PSYCHIC_ENERGY: +1}),
    Variant("ポケパッド 4→3(基本超エネルギー +1)", {POKEPAD: -1, PSYCHIC_ENERGY: +1}),
    Variant("ハイパーボール 4→3(基本超エネルギー +1)", {ULTRA_BALL: -1, PSYCHIC_ENERGY: +1}),
    Variant("ノココッチ 2→1(基本超エネルギー +1)", {DUDUNSPARCE: -1, PSYCHIC_ENERGY: +1}),
    Variant("ジュペッタ 3→2(カゲボウズは 4 のまま、基本超エネルギー +1)", {BANETTE: -1, PSYCHIC_ENERGY: +1}),
    Variant("ダダリン 4→3(基本超エネルギー +1)", {DHELMISE: -1, PSYCHIC_ENERGY: +1}),
    Variant("ポケギア3.0 2→3(ボスの指令 -1)", {POKEGEAR: +1, BOSS: -1}),
    Variant("テレパス超エネルギー 4→3(基本超エネルギー +1)", {TELEPATH_ENERGY: -1, PSYCHIC_ENERGY: +1}),
]

ASSUMPTIONS = [
    "相手の行動を含めない。相手の妨害、きぜつ、サイドを取ることは起きない(リーリエの決心は常に 8 枚引く)。相手にきぜつさせられて「ばけがくれ」がトラッシュに落ちる経路も無い",
    "手札の使い方はこの規則ファイルの行動の並び(優先順位)に固定する。実際のプレイヤーの判断とは違うことがある",
    "対戦の準備ではダダリンをバトル場に置き、ノコッチとダダリンの 2 匹目だけをベンチに出す。「ばけがくれ」のポケモンはトラッシュに送るため場に出さない",
    "「ばけがくれ」を捨てる手段は、ムク(手札から 2 枚)、ハイパーボール(2 枚)、プリズムタワー(2 枚)。ポフィンとテレパス超エネルギーでは「ばけがくれ」をベンチに出さない",
    "ワザはダダリンの「むねんのイカリ」だけを使う。ジュペッタの「にんぎょうキャッチ」は使わない",
    "引き直しは自分の分だけ扱い、相手の引き直しで自分が追加で引ける 1 枚は扱わない",
    "「打てる」は、番の終わり(ワザを使う前)にバトル場からそのワザを使える状態を指す",
]

RULES = DeckRules(
    title="ばけがくれ(ダダリン)デッキ(トラッシュに「ばけがくれ」を 4 枚集めてむねんのイカリ 170)",
    deck_code="9nnnLP-Wejgk5-gn6gn9",
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

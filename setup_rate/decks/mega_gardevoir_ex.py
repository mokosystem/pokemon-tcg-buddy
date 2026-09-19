"""メガサーナイトex デッキの規則。

デッキコード xG8Kax-DHob4e-84xcca(開発責任者のデッキ。Issue 6 の試験診断で計算した構築)。
各カードの効果は 2026-09-17 に公式のカード詳細ページで確認し、計算に必要な範囲だけを
自分の言葉で書いている。詳細ページ: https://www.pokemon-card.com/card-search/details.php/card/{カード ID}/regu/XY

狙い: 2 番目の番にメガサーナイトex を立てて「あふれるねがい」でベンチにエネルギーを配り、
3 番目の番に「メガシンフォニア」を 300 以上(超エネルギー 6 個以上)で打つ。
"""

from __future__ import annotations

from collections.abc import Callable

from setup_rate.cards import Card, Stage, basic_energy, goods, pokemon, special_energy, stadium, supporter
from setup_rate.engine import Action, DeckRules, Variant
from setup_rate.state import GameState, PokemonInPlay

PSYCHIC = "psychic"
COLORLESS = "colorless"

MEGA_GARDEVOIR = "メガサーナイトex"
KIRLIA = "キルリア"
RALTS = "ラルトス"
FRILLISH = "プルリル"
LATIAS = "ラティアスex"
CLEFAIRY = "リーリエのピッピex"
MEOWTH = "ニャースex"
MEW = "ミュウex"
RARE_CANDY = "ふしぎなアメ"
SWITCH = "ポケモンいれかえ"
ULTRA_BALL = "ハイパーボール"
POFFIN = "なかよしポフィン"
NIGHT_STRETCHER = "夜のタンカ"
POKEPAD = "ポケパッド"
SPECIAL_RED_CARD = "スペシャルレッドカード"
BOSS = "ボスの指令"
ACHROMA = "アクロマの執念"
LILLIE = "リーリエの決心"
WALLY = "ミツルの思いやり"
TOUKO = "トウコ"
YUKARI = "ユカリ"
GREAT_TREE = "偉大な大樹"
PSYCHIC_ENERGY = "基本超エネルギー"
TELEPATH_ENERGY = "テレパス超エネルギー"

OVERFLOWING_WISH = "あふれるねがい"
MEGA_SYMPHONY = "メガシンフォニア"
BRING_IT = "もってくる"

CARD_TABLE: dict[str, Card] = {
    card.name: card
    for card in [
        pokemon(MEGA_GARDEVOIR, "048464", Stage.STAGE2, 360, PSYCHIC, evolves_from=KIRLIA, has_rule_box=True, retreat_cost=2),
        pokemon(KIRLIA, "049715", Stage.STAGE1, 100, PSYCHIC, evolves_from=RALTS, retreat_cost=1),
        pokemon(RALTS, "049714", Stage.BASIC, 70, PSYCHIC, retreat_cost=1),
        pokemon(FRILLISH, "047663", Stage.BASIC, 80, PSYCHIC, retreat_cost=3),
        pokemon(LATIAS, "046248", Stage.BASIC, 210, PSYCHIC, has_rule_box=True, retreat_cost=2),
        pokemon(CLEFAIRY, "047041", Stage.BASIC, 190, PSYCHIC, has_rule_box=True, retreat_cost=1),
        pokemon(MEOWTH, "049694", Stage.BASIC, 170, COLORLESS, has_rule_box=True, retreat_cost=1),
        pokemon(MEW, "050669", Stage.BASIC, 160, PSYCHIC, has_rule_box=True, retreat_cost=0),
        goods(RARE_CANDY, "050462"),
        goods(SWITCH, "049602"),
        goods(ULTRA_BALL, "050461"),
        goods(POFFIN, "048675"),
        goods(NIGHT_STRETCHER, "048681"),
        goods(POKEPAD, "050424"),
        goods(SPECIAL_RED_CARD, "050156"),
        supporter(BOSS, "050467"),
        supporter(ACHROMA, "045934"),
        supporter(LILLIE, "049445"),
        supporter(WALLY, "047856"),
        supporter(TOUKO, "048694"),
        supporter(YUKARI, "050083"),
        stadium(GREAT_TREE, "046040"),
        basic_energy(PSYCHIC_ENERGY, "049463", PSYCHIC),
        special_energy(TELEPATH_ENERGY, "049712", (PSYCHIC,)),
    ]
}

DECKLIST: list[tuple[str, int]] = [
    (MEGA_GARDEVOIR, 3),
    (KIRLIA, 3),
    (RALTS, 4),
    (FRILLISH, 1),
    (LATIAS, 2),
    (CLEFAIRY, 2),
    (MEOWTH, 2),
    (MEW, 1),
    (RARE_CANDY, 2),
    (SWITCH, 2),
    (ULTRA_BALL, 4),
    (POFFIN, 3),
    (NIGHT_STRETCHER, 1),
    (POKEPAD, 2),
    (SPECIAL_RED_CARD, 1),
    (BOSS, 2),
    (ACHROMA, 4),
    (LILLIE, 4),
    (WALLY, 1),
    (TOUKO, 2),
    (YUKARI, 1),
    (GREAT_TREE, 1),
    (PSYCHIC_ENERGY, 8),
    (TELEPATH_ENERGY, 4),
]

# 場に置くラルトスの上限。3 匹あれば主軸 1 匹と予備で足り、4 匹目はベンチの枠を他のポケモンに譲る
RALTS_IN_PLAY_LIMIT = 3
# ハイパーボールで捨ててよいカードの価値の上限(この値以下を捨てる)
EXPENDABLE_TIER_LIMIT = 2
# メガシンフォニアが 300 に届く超エネルギーの個数(50 × 6)
ENERGY_FOR_300 = 6

# ---- 場の見かた ----


def in_play_by_name(state: GameState, name: str) -> list[PokemonInPlay]:
    return state.find_in_play(name)


def evolvable_ralts(state: GameState) -> list[PokemonInPlay]:
    """この番に進化させられるラルトス。バトル場を先に、あとは早く出した順。"""
    candidates = [
        ralts for ralts in state.find_in_play(RALTS) if state.turn >= 2 and not ralts.is_fresh(state.turn)
    ]
    candidates.sort(key=lambda ralts: (ralts is not state.active, -len(ralts.energies), ralts.turn_entered))
    return candidates


def lead(state: GameState) -> PokemonInPlay | None:
    """主軸として育てるポケモン。メガサーナイトex > キルリア > ラルトス の順で、バトル場を優先する。"""
    for name in (MEGA_GARDEVOIR, KIRLIA, RALTS):
        found = state.find_in_play(name)
        if found:
            found.sort(key=lambda p: (p is not state.active, -len(p.energies), p.turn_entered))
            return found[0]
    return None


def is_tree_in_play(state: GameState) -> bool:
    return state.stadium is not None and state.stadium.name == GREAT_TREE


def is_tree_secured(state: GameState) -> bool:
    return is_tree_in_play(state) or state.count_in_hand(GREAT_TREE) > 0


def is_mega_in_play(state: GameState) -> bool:
    return state.count_in_play(MEGA_GARDEVOIR) > 0


def can_use_mega_attacks(state: GameState) -> bool:
    """バトル場からメガサーナイトex のワザを使える状態か。
    ミュウex は特性「きおくのらせん」でベンチのメガサーナイトex のワザを使えるが、エネルギーは自身に必要。"""
    active = state.active
    if active is None or active.count_energy(PSYCHIC) < 1:
        return False
    if active.name == MEGA_GARDEVOIR:
        return True
    return active.name == MEW and any(p.name == MEGA_GARDEVOIR for p in state.bench)


def total_psychic_energy(state: GameState) -> int:
    return sum(p.count_energy(PSYCHIC) for p in state.pokemon_in_play())


def psychic_pokemon_in_play(state: GameState) -> list[PokemonInPlay]:
    return [p for p in state.pokemon_in_play() if p.card.pokemon_type == PSYCHIC]


def has_free_retreat(state: GameState) -> bool:
    """ラティアスex の特性「スカイライン」: 自分のたねポケモン全員のにげるエネルギーが 0 になる。"""
    active = state.active
    if active is None or active.card.stage is not Stage.BASIC:
        return False
    return active.card.retreat_cost == 0 or state.count_in_play(LATIAS) > 0


def can_switch_active(state: GameState) -> bool:
    active = state.active
    if active is None:
        return False
    if state.count_in_hand(SWITCH) > 0:
        return True
    if state.retreated:
        return False
    return has_free_retreat(state) or len(active.energies) >= active.card.retreat_cost


def is_named(name: str) -> Callable[[Card], bool]:
    return lambda card: card.name == name


# ---- ベンチに出す順 ----

# ラティアスex はにげるエネルギーを 0 にする特性のため 1 匹目を早く置く。
# ニャースex は手札からベンチに出したときの特性を使いたいので、サポートが要る番まで手札に残す。
BENCH_FILL_PRIORITY = [LATIAS, MEW, CLEFAIRY, LATIAS, MEW, FRILLISH]
# テレパス超エネルギーで山札から出す超タイプのたね。ラルトスを上限まで、次にラティアスex
DECK_BENCH_PRIORITY = [RALTS, RALTS, RALTS, LATIAS, MEW, CLEFAIRY, LATIAS, MEW, FRILLISH]
ACTIVE_PRIORITY = [RALTS, MEW, LATIAS, CLEFAIRY, MEOWTH, FRILLISH]


def choose_active(basics: list[Card]) -> Card:
    for name in ACTIVE_PRIORITY:
        for card in basics:
            if card.name == name:
                return card
    return basics[0]


def choose_bench_at_setup(basics: list[Card]) -> list[Card]:
    """対戦の準備ではラルトス全部とラティアスex 1 匹だけを出す。
    他のたねは、ポフィンやテレパス超エネルギーでラルトスを出す枠を残すため、番の中で出す。"""
    chosen = [card for card in basics if card.name == RALTS]
    latias = [card for card in basics if card.name == LATIAS]
    return chosen + latias[:1]


def next_bench_candidate_from_hand(state: GameState) -> Card | None:
    placed: dict[str, int] = {}
    for name in BENCH_FILL_PRIORITY:
        placed[name] = placed.get(name, 0) + 1
        if state.count_in_play(name) < placed[name] and state.count_in_hand(name) > 0:
            return state.first_in_hand(name)
    return None


def bench_from_deck(state: GameState, count: int, predicate: Callable[[Card], bool]) -> int:
    """優先順位に従って山札からベンチに出す。出せた数を返す。"""
    placed = 0
    counted: dict[str, int] = {}
    for name in DECK_BENCH_PRIORITY:
        if placed >= count or state.bench_space() <= 0:
            break
        counted[name] = counted.get(name, 0) + 1
        if state.count_in_play(name) >= counted[name]:
            continue
        card = state.find_in_deck(lambda c, n=name: c.name == n and predicate(c))
        if card is not None:
            state.place_on_bench(card, from_hand=False)
            placed += 1
    return placed


# ---- 手札の価値(ハイパーボールで捨てる順) ----


def expendable_tier(state: GameState, card: Card, seen: dict[str, int]) -> int:
    """小さいほど捨ててよい。3 は捨てない。seen は手札の中で同名を数えた回数。"""
    name = card.name
    nth = seen.get(name, 0)
    if name in (YUKARI, WALLY, BOSS, SPECIAL_RED_CARD):
        return 0
    if name == FRILLISH:
        return 1
    if name in (CLEFAIRY, LATIAS, MEOWTH) and state.count_in_play(name) >= 1:
        return 1
    if name == SWITCH and nth >= 1:
        return 1
    if name == NIGHT_STRETCHER and not any(c.is_pokemon or c.name == PSYCHIC_ENERGY for c in state.discard):
        return 1
    if name == ACHROMA and is_tree_in_play(state):
        return 1
    if name == POFFIN and (state.count_in_play(RALTS) >= RALTS_IN_PLAY_LIMIT or state.count_unseen(RALTS) == 0):
        return 1
    if name == PSYCHIC_ENERGY and nth >= 2:
        return 2
    if name == TELEPATH_ENERGY and nth >= 1:
        return 2
    if card.is_supporter and nth >= 1:
        return 2
    if name == ULTRA_BALL and nth >= 1:
        return 2
    if name == RARE_CANDY and (nth >= 1 or is_tree_in_play(state)):
        return 2
    return 3


def expendable_cards(state: GameState, excluding: Card) -> list[Card]:
    seen: dict[str, int] = {}
    ranked: list[tuple[int, int, Card]] = []
    skipped_excluding = False
    for index, card in enumerate(state.hand):
        if card is excluding and not skipped_excluding:
            skipped_excluding = True
            continue
        tier = expendable_tier(state, card, seen)
        seen[card.name] = seen.get(card.name, 0) + 1
        if tier <= EXPENDABLE_TIER_LIMIT:
            ranked.append((tier, index, card))
    ranked.sort(key=lambda item: (item[0], item[1]))
    return [card for _, _, card in ranked]


# ---- 山札から探す相手 ----


def wanted_pokemon_for_ultra_ball(state: GameState) -> str | None:
    if (
        not is_tree_in_play(state)
        and state.count_in_hand(RARE_CANDY) > 0
        and state.count_in_hand(MEGA_GARDEVOIR) == 0
        and not is_mega_in_play(state)
        and state.count_in_play(RALTS) > 0
        and state.count_unseen(MEGA_GARDEVOIR) > 0
    ):
        return MEGA_GARDEVOIR
    if (
        state.count_in_play(RALTS) + state.count_in_hand(RALTS) < 2
        and state.count_unseen(RALTS) > 0
        and state.bench_space() > 0
    ):
        return RALTS
    if (
        not is_tree_secured(state)
        and state.count_in_hand(ACHROMA) == 0
        and state.count_in_hand(MEOWTH) == 0
        and state.count_unseen(MEOWTH) > 0
        and state.count_unseen(ACHROMA) > 0
        and state.bench_space() > 0
    ):
        return MEOWTH
    if (
        not is_tree_secured(state)
        and not is_mega_in_play(state)
        and state.count_in_play(RALTS) > 0
        and state.count_in_hand(KIRLIA) == 0
        and state.count_in_play(KIRLIA) == 0
        and state.count_unseen(KIRLIA) > 0
    ):
        return KIRLIA
    if state.bench_space() > 0:
        for name in (LATIAS, MEW):
            if state.count_in_play(name) == 0 and state.count_in_hand(name) == 0 and state.count_unseen(name) > 0:
                return name
    return None


def wanted_pokemon_for_pokepad(state: GameState) -> str | None:
    """ポケパッドは「ルールを持つポケモン」を除くため、対象はラルトス・キルリア・プルリルに限る。"""
    if (
        state.count_in_play(RALTS) + state.count_in_hand(RALTS) < 2
        and state.count_unseen(RALTS) > 0
        and state.bench_space() > 0
    ):
        return RALTS
    if (
        not is_tree_secured(state)
        and not is_mega_in_play(state)
        and state.count_in_play(RALTS) > 0
        and state.count_in_hand(KIRLIA) == 0
        and state.count_in_play(KIRLIA) == 0
        and state.count_unseen(KIRLIA) > 0
    ):
        return KIRLIA
    if state.count_in_play(RALTS) < RALTS_IN_PLAY_LIMIT and state.count_unseen(RALTS) > 0 and state.bench_space() > 0:
        return RALTS
    return None


def wanted_energy_name(state: GameState) -> str | None:
    """サポートで山札から取るエネルギー。ベンチに空きがあればテレパス超エネルギーを優先する。"""
    if state.count_unseen(TELEPATH_ENERGY) > 0 and (state.bench_space() > 0 or state.count_unseen(PSYCHIC_ENERGY) == 0):
        return TELEPATH_ENERGY
    if state.count_unseen(PSYCHIC_ENERGY) > 0:
        return PSYCHIC_ENERGY
    if state.count_unseen(TELEPATH_ENERGY) > 0:
        return TELEPATH_ENERGY
    return None


def wanted_evolution_for_touko(state: GameState) -> str:
    if state.count_in_hand(RARE_CANDY) > 0 or state.count_in_play(KIRLIA) > 0 or is_tree_secured(state):
        return MEGA_GARDEVOIR
    return KIRLIA


def choose_supporter(state: GameState) -> str | None:
    """この番に使うサポート。無ければ None。"""
    if not state.can_use_supporter():
        return None
    in_hand = {name for name in (ACHROMA, TOUKO, LILLIE) if state.count_in_hand(name) > 0}
    if ACHROMA in in_hand and not is_tree_secured(state) and state.count_unseen(GREAT_TREE) > 0:
        return ACHROMA
    if TOUKO in in_hand and not is_mega_in_play(state):
        if state.count_in_hand(RARE_CANDY) > 0 and state.count_in_hand(MEGA_GARDEVOIR) == 0:
            return TOUKO
        if not is_tree_secured(state):
            return TOUKO
    if LILLIE in in_hand and not holds_next_turn_plan(state):
        return LILLIE
    if TOUKO in in_hand and not is_mega_in_play(state) and state.count_unseen(MEGA_GARDEVOIR) > 0:
        return TOUKO
    if LILLIE in in_hand:
        return LILLIE
    return None


def holds_next_turn_plan(state: GameState) -> bool:
    """手札に次の番の進化の材料が揃っていれば、リーリエの決心で流さない。"""
    has_candy_route = state.count_in_hand(RARE_CANDY) > 0 and state.count_in_hand(MEGA_GARDEVOIR) > 0
    has_hand_route = state.count_in_hand(KIRLIA) > 0 or (
        state.count_in_hand(MEGA_GARDEVOIR) > 0 and state.count_in_play(KIRLIA) > 0
    )
    return has_candy_route or has_hand_route


def wanted_supporter_for_meowth(state: GameState) -> str | None:
    if not is_tree_secured(state) and state.count_unseen(ACHROMA) > 0 and state.count_unseen(GREAT_TREE) > 0:
        return ACHROMA
    if not is_mega_in_play(state) and state.count_unseen(TOUKO) > 0 and state.count_in_play(RALTS) > 0:
        return TOUKO
    if state.count_unseen(LILLIE) > 0:
        return LILLIE
    return None


# ---- 行動 ----


def bench_ralts_from_hand_available(state: GameState) -> bool:
    return (
        state.count_in_hand(RALTS) > 0
        and state.bench_space() > 0
        and state.count_in_play(RALTS) < RALTS_IN_PLAY_LIMIT
    )


def bench_ralts_from_hand(state: GameState) -> None:
    state.place_on_bench(state.first_in_hand(RALTS), from_hand=True)


def play_tree_available(state: GameState) -> bool:
    return state.count_in_hand(GREAT_TREE) > 0 and not state.stadium_played and not is_tree_in_play(state)


def play_tree(state: GameState) -> None:
    state.play_stadium(state.first_in_hand(GREAT_TREE))


def poffin_available(state: GameState) -> bool:
    return (
        state.count_in_hand(POFFIN) > 0
        and state.bench_space() > 0
        and state.count_in_play(RALTS) < RALTS_IN_PLAY_LIMIT
        and state.count_unseen(RALTS) > 0
    )


def use_poffin(state: GameState) -> None:
    """なかよしポフィン: 山札から HP 70 以下のたねを 2 枚までベンチに出す。このデッキではラルトスだけが対象。"""
    state.use_goods(state.first_in_hand(POFFIN))
    bench_from_deck(state, 2, lambda card: card.is_basic_pokemon and card.hp <= 70)
    state.shuffle_deck()


def evolve_by_tree_available(state: GameState) -> bool:
    return (
        is_tree_in_play(state)
        and GREAT_TREE not in state.used_once_per_turn
        and bool(evolvable_ralts(state))
        and state.count_unseen(KIRLIA) > 0
    )


def evolve_by_tree(state: GameState) -> None:
    """偉大な大樹: 番に 1 回、場のたね 1 匹を山札の 1 進化に進化させ、続けて 2 進化にも進化させてよい。
    出したばかりのたねには使えないが、続けての 2 進化は進化したばかりでも許される(カードの記載)。"""
    state.used_once_per_turn.add(GREAT_TREE)
    target = evolvable_ralts(state)[0]
    kirlia = state.find_in_deck(is_named(KIRLIA))
    if kirlia is None:
        state.shuffle_deck()
        return
    state.evolve(target, kirlia, from_hand=False)
    mega = state.find_in_deck(is_named(MEGA_GARDEVOIR))
    if mega is not None:
        state.evolve(target, mega, from_hand=False, ignore_freshness=True)
    state.shuffle_deck()


def rare_candy_available(state: GameState) -> bool:
    return (
        state.count_in_hand(RARE_CANDY) > 0
        and state.count_in_hand(MEGA_GARDEVOIR) > 0
        and not is_mega_in_play(state)
        and bool(evolvable_ralts(state))
    )


def use_rare_candy(state: GameState) -> None:
    target = evolvable_ralts(state)[0]
    state.use_goods(state.first_in_hand(RARE_CANDY))
    state.evolve_skipping_stage1(target, state.first_in_hand(MEGA_GARDEVOIR), KIRLIA)


def evolve_mega_from_hand_available(state: GameState) -> bool:
    if state.count_in_hand(MEGA_GARDEVOIR) == 0:
        return False
    return any(state.can_evolve(kirlia, CARD_TABLE[MEGA_GARDEVOIR]) for kirlia in state.find_in_play(KIRLIA))


def evolve_mega_from_hand(state: GameState) -> None:
    kirlia = next(k for k in state.find_in_play(KIRLIA) if state.can_evolve(k, CARD_TABLE[MEGA_GARDEVOIR]))
    state.evolve(kirlia, state.first_in_hand(MEGA_GARDEVOIR), from_hand=True)


def evolve_kirlia_from_hand_available(state: GameState) -> bool:
    return (
        state.count_in_hand(KIRLIA) > 0
        and not is_mega_in_play(state)
        and state.count_in_play(KIRLIA) == 0
        and bool(evolvable_ralts(state))
        and not (is_tree_in_play(state) and GREAT_TREE not in state.used_once_per_turn)
    )


def evolve_kirlia_from_hand(state: GameState) -> None:
    state.evolve(evolvable_ralts(state)[0], state.first_in_hand(KIRLIA), from_hand=True)


def energy_target(state: GameState) -> PokemonInPlay | None:
    """手札からつけるエネルギーの相手。主軸を優先し、主軸がバトル場に出せないときはバトル場のミュウex。"""
    mega = state.find_in_play(MEGA_GARDEVOIR)
    active = state.active
    if mega and active is not None and active.name == MEW and mega[0] is not active and not can_switch_active(state):
        return active
    target = lead(state)
    if target is not None:
        return target
    psychic = psychic_pokemon_in_play(state)
    return psychic[0] if psychic else None


def telepath_available(state: GameState) -> bool:
    if state.energy_attached or state.count_in_hand(TELEPATH_ENERGY) == 0:
        return False
    target = energy_target(state)
    if target is None or target.card.pokemon_type != PSYCHIC:
        return False
    return state.bench_space() > 0 or state.count_in_hand(PSYCHIC_ENERGY) == 0


def attach_telepath(state: GameState) -> None:
    """テレパス超エネルギー: 手札から超ポケモンにつけたとき、山札から超タイプのたねを 2 枚までベンチに出す。"""
    target = energy_target(state)
    state.attach_energy_from_hand(state.first_in_hand(TELEPATH_ENERGY), target)
    bench_from_deck(state, 2, lambda card: card.is_basic_pokemon and card.pokemon_type == PSYCHIC)
    state.shuffle_deck()


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
    """ニャースex の特性「おくのてキャッチ」: 手札からベンチに出したとき、山札からサポートを 1 枚手札に加える。"""
    wanted = wanted_supporter_for_meowth(state)
    state.place_on_bench(state.first_in_hand(MEOWTH), from_hand=True)
    state.search_deck_to_hand([is_named(wanted)])


def supporter_available(state: GameState) -> bool:
    return choose_supporter(state) is not None


def use_supporter(state: GameState) -> None:
    name = choose_supporter(state)
    card = state.first_in_hand(name)
    if name == ACHROMA:
        state.use_supporter(card)
        energy = wanted_energy_name(state)
        state.search_deck_to_hand([is_named(GREAT_TREE)] + ([is_named(energy)] if energy else []))
    elif name == TOUKO:
        evolution = wanted_evolution_for_touko(state)
        state.use_supporter(card)
        energy = wanted_energy_name(state)
        state.search_deck_to_hand([is_named(evolution)] + ([is_named(energy)] if energy else []))
    elif name == LILLIE:
        state.use_supporter(card)
        state.return_hand_to_deck()
        # 相手がいない計算ではサイドが 6 枚のままなので、引く枚数は常に 8 枚になる
        state.draw(8 if len(state.prizes) == 6 else 6)


def night_stretcher_available(state: GameState) -> bool:
    if state.count_in_hand(NIGHT_STRETCHER) == 0:
        return False
    return wanted_from_discard(state) is not None


def wanted_from_discard(state: GameState) -> str | None:
    if state.count_in_discard(RALTS) > 0 and state.count_in_play(RALTS) + state.count_in_hand(RALTS) < 2:
        return RALTS
    if (
        state.count_in_discard(MEGA_GARDEVOIR) > 0
        and state.count_in_hand(MEGA_GARDEVOIR) == 0
        and state.count_in_hand(RARE_CANDY) > 0
        and not is_mega_in_play(state)
    ):
        return MEGA_GARDEVOIR
    if state.count_in_discard(PSYCHIC_ENERGY) > 0 and not any(card.is_energy for card in state.hand):
        return PSYCHIC_ENERGY
    return None


def use_night_stretcher(state: GameState) -> None:
    wanted = wanted_from_discard(state)
    state.use_goods(state.first_in_hand(NIGHT_STRETCHER))
    card = next(c for c in state.discard if c.name == wanted)
    state.discard.remove(card)
    state.hand.append(card)


def bench_fill_available(state: GameState) -> bool:
    return state.bench_space() > 0 and next_bench_candidate_from_hand(state) is not None


def bench_fill(state: GameState) -> None:
    state.place_on_bench(next_bench_candidate_from_hand(state), from_hand=True)


def bench_meowth_for_count_available(state: GameState) -> bool:
    """サポートを使い終えた後は、特性を使えなくてもあふれるねがいの数合わせにニャースex を出す。"""
    return state.count_in_hand(MEOWTH) > 0 and state.bench_space() > 0 and state.supporter_used


def bench_meowth_for_count(state: GameState) -> None:
    state.place_on_bench(state.first_in_hand(MEOWTH), from_hand=True)


def attach_energy_available(state: GameState) -> bool:
    if state.energy_attached or energy_target(state) is None:
        return False
    return any(card.is_energy for card in state.hand)


def attach_energy_before_lillie_available(state: GameState) -> bool:
    """リーリエの決心は手札を全部山札に戻すので、その前にエネルギーをつけておく。
    アクロマの執念やトウコを使う番は、大樹で進化した後の主軸につけるためサポートの後に回す。"""
    return attach_energy_available(state) and choose_supporter(state) == LILLIE


def attach_energy(state: GameState) -> None:
    target = energy_target(state)
    basic = state.first_in_hand(PSYCHIC_ENERGY)
    telepath = state.first_in_hand(TELEPATH_ENERGY)
    if telepath is not None and target.card.pokemon_type == PSYCHIC and (basic is None or state.bench_space() > 0):
        attach_telepath(state)
    else:
        state.attach_energy_from_hand(basic or telepath, target)


def switch_to_attacker_available(state: GameState) -> bool:
    if can_use_mega_attacks(state) or state.active is None:
        return False
    attacker = next((p for p in state.bench if p.name == MEGA_GARDEVOIR and p.count_energy(PSYCHIC) >= 1), None)
    return attacker is not None and can_switch_active(state)


def switch_to_attacker(state: GameState) -> None:
    attacker = next(p for p in state.bench if p.name == MEGA_GARDEVOIR and p.count_energy(PSYCHIC) >= 1)
    active = state.active
    if not state.retreated and has_free_retreat(state):
        state.retreat(attacker, cost=0)
    elif not state.retreated and len(active.energies) >= active.card.retreat_cost:
        state.retreat(attacker, cost=active.card.retreat_cost)
    else:
        state.use_goods(state.first_in_hand(SWITCH))
        state.switch_active(attacker)


ACTIONS: list[Action] = [
    Action("手札のラルトスをベンチに出す", bench_ralts_from_hand_available, bench_ralts_from_hand),
    Action("偉大な大樹を出す", play_tree_available, play_tree),
    Action("なかよしポフィンでラルトスを出す", poffin_available, use_poffin),
    Action("手札のメガサーナイトex に進化させる", evolve_mega_from_hand_available, evolve_mega_from_hand),
    Action("偉大な大樹で進化させる", evolve_by_tree_available, evolve_by_tree),
    Action("ふしぎなアメで進化させる", rare_candy_available, use_rare_candy),
    Action("テレパス超エネルギーをつけてベンチを埋める", telepath_available, attach_telepath),
    Action("ポケパッドで探す", pokepad_available, use_pokepad),
    Action("ハイパーボールで探す", ultra_ball_available, use_ultra_ball),
    Action("ベンチを埋める", bench_fill_available, bench_fill),
    Action("リーリエの決心の前にエネルギーをつける", attach_energy_before_lillie_available, attach_energy),
    Action("ニャースex を出してサポートを探す", meowth_for_supporter_available, bench_meowth_for_supporter),
    Action("サポートを使う", supporter_available, use_supporter),
    # 手札のキルリアは、アクロマの執念で偉大な大樹が来る可能性を先に試してから使う
    Action("手札のキルリアに進化させる", evolve_kirlia_from_hand_available, evolve_kirlia_from_hand),
    Action("エネルギーをつける", attach_energy_available, attach_energy),
    Action("夜のタンカで回収する", night_stretcher_available, use_night_stretcher),
    Action("ニャースex を数合わせで出す", bench_meowth_for_count_available, bench_meowth_for_count),
    Action("主軸をバトル場に出す", switch_to_attacker_available, switch_to_attacker),
]


# ---- ワザ ----


def choose_attack(state: GameState) -> str | None:
    """2 番目の番まではあふれるねがいでベンチにエネルギーを配り、3 番目の番からメガシンフォニアを打つ。"""
    active = state.active
    if can_use_mega_attacks(state):
        if state.turn <= 2 and state.bench and state.count_in_deck(PSYCHIC_ENERGY) > 0:
            for bench_pokemon in list(state.bench):
                energy = state.find_in_deck(is_named(PSYCHIC_ENERGY))
                if energy is None:
                    break
                state.attach_energy_from_deck(energy, bench_pokemon)
            state.shuffle_deck()
            return OVERFLOWING_WISH
        return MEGA_SYMPHONY
    if active is not None and active.name == RALTS and len(active.energies) >= 1 and state.deck:
        state.draw(1)
        return BRING_IT
    return None


# ---- 狙いと失敗の要因 ----

GOAL_MEGA_IN_PLAY = "メガサーナイトex が場にいる"
GOAL_CAN_ATTACK = "メガシンフォニアを打てる"
GOAL_CAN_ATTACK_300 = "メガシンフォニアを 300 以上で打てる"

GOALS: dict[str, Callable[[GameState], bool]] = {
    GOAL_MEGA_IN_PLAY: is_mega_in_play,
    GOAL_CAN_ATTACK: can_use_mega_attacks,
    GOAL_CAN_ATTACK_300: lambda state: can_use_mega_attacks(state) and total_psychic_energy(state) >= ENERGY_FOR_300,
}

DEADLINES = [(GOAL_MEGA_IN_PLAY, 2), (GOAL_MEGA_IN_PLAY, 3), (GOAL_CAN_ATTACK, 3), (GOAL_CAN_ATTACK_300, 3)]


def explain_failure(state: GameState, goal: str) -> str:
    """締め切りの番の終わりに狙いが成立していない理由。事後分析なのでサイドの中身も見る。"""
    if not is_mega_in_play(state):
        if state.count_in_play(RALTS) == 0 and state.count_in_play(KIRLIA) == 0:
            return "ラルトスを場に出せていない"
        if not is_tree_in_play(state):
            if state.count_in_prizes(GREAT_TREE) > 0:
                return "偉大な大樹がサイドにある"
            if state.count_in_hand(RARE_CANDY) > 0 or state.count_in_hand(MEGA_GARDEVOIR) > 0:
                return "偉大な大樹が無く、ふしぎなアメとメガサーナイトex が揃わない"
            return "偉大な大樹を手札に引けていない"
        if state.count_in_deck(KIRLIA) == 0 or state.count_in_deck(MEGA_GARDEVOIR) == 0:
            return "偉大な大樹はあるが、キルリアかメガサーナイトex が山札に無い"
        return "偉大な大樹はあるが、進化できるラルトスがいなかった(出した番が遅い)"
    if goal == GOAL_MEGA_IN_PLAY:
        return "その他"
    if not can_use_mega_attacks(state):
        mega = state.find_in_play(MEGA_GARDEVOIR)[0]
        if mega.count_energy(PSYCHIC) == 0:
            return "メガサーナイトex にエネルギーがついていない"
        return "メガサーナイトex をバトル場に出せない"
    if goal == GOAL_CAN_ATTACK_300:
        return f"超エネルギーが {total_psychic_energy(state)} 個で 6 個に届かない"
    return "その他"


VARIANTS = [
    Variant("キルリア 3→2(基本超エネルギー +1)", {KIRLIA: -1, PSYCHIC_ENERGY: +1}),
    Variant("ラルトス 4→3(基本超エネルギー +1)", {RALTS: -1, PSYCHIC_ENERGY: +1}),
    Variant("ふしぎなアメ 2→1(基本超エネルギー +1)", {RARE_CANDY: -1, PSYCHIC_ENERGY: +1}),
    Variant("アクロマの執念 4→3(基本超エネルギー +1)", {ACHROMA: -1, PSYCHIC_ENERGY: +1}),
    Variant("なかよしポフィン 3→2(基本超エネルギー +1)", {POFFIN: -1, PSYCHIC_ENERGY: +1}),
    Variant("ニャースex 2→1(基本超エネルギー +1)", {MEOWTH: -1, PSYCHIC_ENERGY: +1}),
    Variant("ミュウex 1→0(基本超エネルギー +1)", {MEW: -1, PSYCHIC_ENERGY: +1}),
    Variant("テレパス超エネルギー 4→3(基本超エネルギー +1)", {TELEPATH_ENERGY: -1, PSYCHIC_ENERGY: +1}),
    Variant("トウコ 2→3(ユカリ -1)", {TOUKO: +1, YUKARI: -1}),
]

ASSUMPTIONS = [
    "相手の行動を含めない。相手の妨害、きぜつ、サイドを取ることは起きない(リーリエの決心は常に 8 枚引く)",
    "手札の使い方はこの規則ファイルの行動の並び(優先順位)に固定する。実際のプレイヤーの判断とは違うことがある",
    "対戦の準備ではラルトスをバトル場に置き、ラルトス全部とラティアスex 1 匹をベンチに出す。ニャースex は特性のため手札に残す",
    "2 番目の番までは「あふれるねがい」、3 番目の番からは「メガシンフォニア」を選ぶ。キルリアの「コールサイン」は使わない",
    "引き直しは自分の分だけ扱い、相手の引き直しで自分が追加で引ける 1 枚は扱わない",
    "「メガシンフォニアを打てる」は、番の終わり(ワザを使う前)にバトル場からそのワザを使える状態を指す。ミュウex の特性でベンチのメガサーナイトex のワザを使う場合を含む",
]

RULES = DeckRules(
    title="メガサーナイトex デッキ(3 番目の番にメガシンフォニア)",
    deck_code="xG8Kax-DHob4e-84xcca",
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

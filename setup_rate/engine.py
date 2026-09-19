"""1 回の対戦(自分側だけ)を、規則ファイルの優先順位に従って進める。"""

from __future__ import annotations

import random
from collections.abc import Callable
from dataclasses import dataclass, field

from setup_rate.cards import Card
from setup_rate.state import HAND_SIZE_AT_SETUP, PRIZE_COUNT, GameState

ACTION_LOOP_LIMIT = 200


@dataclass(frozen=True)
class Action:
    """規則ファイルが書く 1 つの行動。is_available が真なら perform を実行する。"""

    name: str
    is_available: Callable[[GameState], bool]
    perform: Callable[[GameState], None]


@dataclass(frozen=True)
class Variant:
    """枚数を変えた比較用のデッキ。changes は カード名 → 増減枚数。合計は 0 にする。"""

    label: str
    changes: dict[str, int]


@dataclass
class DeckRules:
    title: str
    deck_code: str
    card_table: dict[str, Card]
    decklist: list[tuple[str, int]]
    choose_active: Callable[[list[Card]], Card]
    choose_bench_at_setup: Callable[[list[Card]], list[Card]]
    actions: list[Action]
    choose_attack: Callable[[GameState], str | None]
    goals: dict[str, Callable[[GameState], bool]]
    deadlines: list[tuple[str, int]]
    explain_failure: Callable[[GameState, str], str]
    variants: list[Variant] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    end_turn: Callable[[GameState], None] | None = None


@dataclass
class GameResult:
    goal_first_turn: dict[str, int | None]
    failure_labels: dict[str, dict[int, str]]
    attacks: dict[int, str]
    mulligans: int
    events: list[str]


def build_deck(card_table: dict[str, Card], decklist: list[tuple[str, int]]) -> list[Card]:
    cards: list[Card] = []
    for name, count in decklist:
        if name not in card_table:
            raise KeyError(f"カード表に {name} が無い")
        cards.extend([card_table[name]] * count)
    return cards


def apply_variant(decklist: list[tuple[str, int]], variant: Variant) -> list[tuple[str, int]]:
    counts = dict(decklist)
    for name, delta in variant.changes.items():
        counts[name] = counts.get(name, 0) + delta
        if counts[name] < 0:
            raise ValueError(f"{variant.label}: {name} の枚数が負になる")
    changed = [(name, count) for name, count in counts.items() if count > 0]
    if sum(count for _, count in changed) != sum(count for _, count in decklist):
        raise ValueError(f"{variant.label}: 枚数の合計が元のデッキと違う")
    return changed


def setup_game(state: GameState, rules: DeckRules) -> None:
    """対戦の準備。たねポケモンが無ければ引き直す。相手の引き直しによる追加の 1 枚は扱わない。"""
    state.shuffle_deck()
    state.draw(HAND_SIZE_AT_SETUP)
    while not any(card.is_basic_pokemon for card in state.hand):
        state.mulligans += 1
        state.return_hand_to_deck()
        state.draw(HAND_SIZE_AT_SETUP)
    basics = [card for card in state.hand if card.is_basic_pokemon]
    active_card = rules.choose_active(basics)
    state.hand.remove(active_card)
    from setup_rate.state import PokemonInPlay

    state.active = PokemonInPlay(card=active_card, turn_entered=0)
    state.record(f"バトル場 {active_card.name}")
    remaining = [card for card in state.hand if card.is_basic_pokemon]
    for card in rules.choose_bench_at_setup(remaining):
        if state.bench_space() <= 0:
            break
        state.place_on_bench(card, from_hand=True)
    prizes = state.deck[:PRIZE_COUNT]
    del state.deck[:PRIZE_COUNT]
    state.prizes.extend(prizes)


def run_actions(state: GameState, rules: DeckRules) -> None:
    """優先順位の高い行動から順に、実行できるものが無くなるまで繰り返す。"""
    for _ in range(ACTION_LOOP_LIMIT):
        for action in rules.actions:
            if action.is_available(state):
                action.perform(state)
                break
        else:
            return
    raise RuntimeError("行動の繰り返しが上限に達した。規則ファイルの is_available が偽にならない行動がある")


def run_game(
    rules: DeckRules,
    rng: random.Random,
    went_first: bool,
    max_turn: int,
    decklist: list[tuple[str, int]] | None = None,
) -> GameResult:
    cards = build_deck(rules.card_table, decklist or rules.decklist)
    state = GameState(rng, cards, went_first)
    setup_game(state, rules)
    goal_first_turn: dict[str, int | None] = {goal: None for goal in rules.goals}
    failure_labels: dict[str, dict[int, str]] = {goal: {} for goal in rules.goals}
    for _ in range(max_turn):
        state.begin_turn()
        run_actions(state, rules)
        for goal, is_achieved in rules.goals.items():
            if goal_first_turn[goal] is None:
                if is_achieved(state):
                    goal_first_turn[goal] = state.turn
                else:
                    failure_labels[goal][state.turn] = rules.explain_failure(state, goal)
        if state.can_attack():
            attack = rules.choose_attack(state)
            if attack is not None:
                state.attacks[state.turn] = attack
                state.record(f"ワザ {attack}")
        if rules.end_turn is not None:
            rules.end_turn(state)
    return GameResult(
        goal_first_turn=goal_first_turn,
        failure_labels=failure_labels,
        attacks=dict(state.attacks),
        mulligans=state.mulligans,
        events=list(state.events),
    )

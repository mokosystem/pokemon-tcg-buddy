"""対戦の自分側の状態と、規則ファイルが使う基本操作。

相手の行動は含めない。相手がいないため、サイドは 6 枚のまま減らず、
自分のポケモンはきぜつしない。ルールの出典は docs/pokemon-tcg/basic-rules.md。
"""

from __future__ import annotations

import random
from collections.abc import Callable
from dataclasses import dataclass, field

from setup_rate.cards import Card, Category, Stage

BENCH_LIMIT = 5
HAND_SIZE_AT_SETUP = 7
PRIZE_COUNT = 6
COLORLESS = "colorless"


def can_pay_cost(cost: list[str], units: list[str]) -> bool:
    """ワザに必要なエネルギー(タイプ名の並び。無色は colorless)を、ついているエネルギーの個数分(units)で払えるか。
    タイプ指定の分を先に埋め、残りを無色に充てる。"""
    remaining = list(units)
    for required in cost:
        if required == COLORLESS:
            continue
        if required in remaining:
            remaining.remove(required)
        else:
            return False
    colorless_needed = sum(1 for required in cost if required == COLORLESS)
    return len(remaining) >= colorless_needed


class IllegalMove(Exception):
    """基本ルールに反する操作を規則ファイルが行ったときに投げる。規則の書き誤りを示す。"""


@dataclass
class PokemonInPlay:
    card: Card
    turn_entered: int
    turn_evolved: int = -1
    energies: list[Card] = field(default_factory=list)
    underneath: list[Card] = field(default_factory=list)

    def is_fresh(self, turn: int) -> bool:
        """この番に場に出た、またはこの番に進化したポケモンは進化できない。"""
        return self.turn_entered == turn or self.turn_evolved == turn

    def count_energy(self, energy_type: str) -> int:
        return sum(1 for energy in self.energies if energy_type in energy.provides)

    @property
    def name(self) -> str:
        return self.card.name


class GameState:
    def __init__(self, rng: random.Random, cards: list[Card], went_first: bool) -> None:
        self.rng = rng
        self.deck: list[Card] = list(cards)
        self.hand: list[Card] = []
        self.prizes: list[Card] = []
        self.discard: list[Card] = []
        self.active: PokemonInPlay | None = None
        self.bench: list[PokemonInPlay] = []
        self.stadium: Card | None = None
        self.went_first = went_first
        self.turn = 0
        self.mulligans = 0
        self.supporter_used = False
        self.energy_attached = False
        self.stadium_played = False
        self.retreated = False
        self.used_once_per_turn: set[str] = set()
        self.attacks: dict[int, str] = {}
        self.events: list[str] = []

    # ---- 記録 ----

    def record(self, event: str) -> None:
        self.events.append(f"[{self.turn}] {event}")

    # ---- 問い合わせ ----

    def pokemon_in_play(self) -> list[PokemonInPlay]:
        return ([self.active] if self.active else []) + list(self.bench)

    def count_in_play(self, name: str) -> int:
        return sum(1 for pokemon in self.pokemon_in_play() if pokemon.name == name)

    def find_in_play(self, name: str) -> list[PokemonInPlay]:
        return [pokemon for pokemon in self.pokemon_in_play() if pokemon.name == name]

    def count_in_hand(self, name: str) -> int:
        return sum(1 for card in self.hand if card.name == name)

    def first_in_hand(self, name: str) -> Card | None:
        for card in self.hand:
            if card.name == name:
                return card
        return None

    def count_unseen(self, name: str) -> int:
        """山札とサイドにある枚数。プレイヤーが知りうるのはこの合計までで、
        山札にあるかサイドにあるかは区別できない。規則ファイルの判断にはこちらを使う。"""
        return sum(1 for card in self.deck if card.name == name) + sum(
            1 for card in self.prizes if card.name == name
        )

    def count_in_deck(self, name: str) -> int:
        """山札にある枚数。山札を見てよい効果(検索)の実行と、失敗要因の事後分析にだけ使う。"""
        return sum(1 for card in self.deck if card.name == name)

    def count_in_prizes(self, name: str) -> int:
        return sum(1 for card in self.prizes if card.name == name)

    def count_in_discard(self, name: str) -> int:
        return sum(1 for card in self.discard if card.name == name)

    def bench_space(self) -> int:
        return BENCH_LIMIT - len(self.bench)

    def is_first_turn_going_first(self) -> bool:
        return self.went_first and self.turn == 1

    def can_use_supporter(self) -> bool:
        return not self.supporter_used and not self.is_first_turn_going_first()

    def can_attack(self) -> bool:
        return self.active is not None and not self.is_first_turn_going_first()

    def can_evolve(self, target: PokemonInPlay, card: Card) -> bool:
        return (
            self.turn >= 2
            and card.is_pokemon
            and card.evolves_from == target.name
            and not target.is_fresh(self.turn)
        )

    # ---- 山札 ----

    def shuffle_deck(self) -> None:
        self.rng.shuffle(self.deck)

    def draw(self, count: int) -> list[Card]:
        drawn = self.deck[:count]
        del self.deck[:count]
        self.hand.extend(drawn)
        return drawn

    def find_in_deck(self, predicate: Callable[[Card], bool]) -> Card | None:
        for card in self.deck:
            if predicate(card):
                return card
        return None

    def take_from_deck_to_hand(self, card: Card) -> None:
        self.deck.remove(card)
        self.hand.append(card)

    def search_deck_to_hand(self, predicates: list[Callable[[Card], bool]]) -> list[Card]:
        """条件ごとに 1 枚ずつ山札から手札に加え、最後に山札を切る。見つからない条件は飛ばす。"""
        found: list[Card] = []
        for predicate in predicates:
            card = self.find_in_deck(predicate)
            if card is not None:
                self.take_from_deck_to_hand(card)
                found.append(card)
        self.shuffle_deck()
        return found

    def reveal_top_and_take(self, count: int, predicate: Callable[[Card], bool]) -> Card | None:
        """山札の上から count 枚を見て、条件に合う 1 枚を手札に加える。残りは山札に戻して切る。"""
        top = self.deck[:count]
        taken = next((card for card in top if predicate(card)), None)
        if taken is not None:
            self.deck.remove(taken)
            self.hand.append(taken)
        self.shuffle_deck()
        return taken

    def look_top_take_one(self, count: int, rank: Callable[[Card], int]) -> Card | None:
        """山札の上から count 枚を見て、rank が最も小さい 1 枚を手札に加え、残りを山札の下に戻す。"""
        top = self.deck[:count]
        if not top:
            return None
        taken = min(top, key=rank)
        del self.deck[:count]
        self.hand.append(taken)
        self.deck.extend(card for card in top if card is not taken)
        return taken

    def return_pokemon_to_deck(self, target: PokemonInPlay) -> None:
        """場のポケモンを、ついているカードごと山札に戻して切る。バトル場のポケモンを戻したときは、
        規則ファイルが次のバトルポケモンを選ぶ(このデッキ計算では相手がいないため、選ばなくてもよい)。"""
        if target is self.active:
            self.active = None
        else:
            self.bench.remove(target)
        self.deck.extend([target.card] + target.underneath + target.energies)
        self.shuffle_deck()
        self.record(f"{target.name} を山札に戻す")

    def return_hand_to_deck(self) -> None:
        self.deck.extend(self.hand)
        self.hand.clear()
        self.shuffle_deck()

    # ---- 手札からの操作 ----

    def discard_from_hand(self, cards: list[Card]) -> None:
        for card in cards:
            self.hand.remove(card)
            self.discard.append(card)

    def use_goods(self, card: Card) -> None:
        if card.category is not Category.GOODS:
            raise IllegalMove(f"{card.name} はグッズではない")
        self.discard_from_hand([card])
        self.record(f"グッズ {card.name}")

    def use_supporter(self, card: Card) -> None:
        if not card.is_supporter:
            raise IllegalMove(f"{card.name} はサポートではない")
        if not self.can_use_supporter():
            raise IllegalMove("この番はサポートを使えない")
        self.supporter_used = True
        self.discard_from_hand([card])
        self.record(f"サポート {card.name}")

    def play_stadium(self, card: Card) -> None:
        if card.category is not Category.STADIUM:
            raise IllegalMove(f"{card.name} はスタジアムではない")
        if self.stadium_played:
            raise IllegalMove("この番はもうスタジアムを出した")
        if self.stadium is not None and self.stadium.name == card.name:
            raise IllegalMove("同じ名前のスタジアムは出せない")
        if self.stadium is not None:
            self.discard.append(self.stadium)
        self.hand.remove(card)
        self.stadium = card
        self.stadium_played = True
        self.record(f"スタジアム {card.name}")

    def place_on_bench(self, card: Card, from_hand: bool, by_effect: bool = False) -> PokemonInPlay:
        """by_effect はカードの効果で進化ポケモンを直接ベンチに出すとき(例: ファイアローex の特性)に真にする。"""
        if not card.is_pokemon or (not card.is_basic_pokemon and not by_effect):
            raise IllegalMove(f"{card.name} はたねポケモンではない")
        if self.bench_space() <= 0:
            raise IllegalMove("ベンチに空きがない")
        if from_hand:
            self.hand.remove(card)
        else:
            self.deck.remove(card)
        pokemon = PokemonInPlay(card=card, turn_entered=self.turn)
        self.bench.append(pokemon)
        self.record(f"ベンチ {card.name}" + ("" if from_hand else "(山札から)"))
        return pokemon

    def attach_energy_from_hand(self, card: Card, target: PokemonInPlay) -> None:
        if not card.is_energy:
            raise IllegalMove(f"{card.name} はエネルギーではない")
        if self.energy_attached:
            raise IllegalMove("この番はもう手札からエネルギーをつけた")
        self.hand.remove(card)
        target.energies.append(card)
        self.energy_attached = True
        self.record(f"エネルギー {card.name} → {target.name}")

    def attach_energy_from_deck(self, card: Card, target: PokemonInPlay) -> None:
        """ワザや特性の効果で山札からつける。手札からつける 1 回の制限には数えない。"""
        self.deck.remove(card)
        target.energies.append(card)
        self.record(f"エネルギー {card.name} → {target.name}(山札から)")

    def evolve(self, target: PokemonInPlay, card: Card, from_hand: bool, ignore_freshness: bool = False) -> None:
        if self.turn < 2:
            raise IllegalMove("自分の最初の番は進化できない")
        if card.evolves_from != target.name:
            raise IllegalMove(f"{card.name} は {target.name} から進化しない")
        if target.is_fresh(self.turn) and not ignore_freshness:
            raise IllegalMove(f"{target.name} はこの番に場に出た/進化したため進化できない")
        self._replace_pokemon(target, card, from_hand)

    def evolve_skipping_stage1(self, target: PokemonInPlay, stage2: Card, stage1_name: str) -> None:
        """ふしぎなアメの進化。たねから 1 進化を飛ばして 2 進化にする。"""
        if self.turn < 2:
            raise IllegalMove("自分の最初の番は進化できない")
        if target.card.stage is not Stage.BASIC or stage2.stage is not Stage.STAGE2:
            raise IllegalMove("たねから 2 進化への進化ではない")
        if stage2.evolves_from != stage1_name:
            raise IllegalMove(f"{stage2.name} は {stage1_name} から進化しない")
        if target.is_fresh(self.turn):
            raise IllegalMove(f"{target.name} はこの番に場に出たため進化できない")
        self._replace_pokemon(target, stage2, from_hand=True)

    def _replace_pokemon(self, target: PokemonInPlay, card: Card, from_hand: bool) -> None:
        if from_hand:
            self.hand.remove(card)
        else:
            self.deck.remove(card)
        target.underneath.append(target.card)
        self.record(f"進化 {target.name} → {card.name}" + ("" if from_hand else "(山札から)"))
        target.card = card
        target.turn_evolved = self.turn

    # ---- バトル場の入れ替え ----

    def switch_active(self, bench_pokemon: PokemonInPlay) -> None:
        if self.active is None or bench_pokemon not in self.bench:
            raise IllegalMove("入れ替える相手がいない")
        self.bench.remove(bench_pokemon)
        self.bench.append(self.active)
        self.active = bench_pokemon
        self.record(f"バトル場 ← {bench_pokemon.name}")

    def retreat(self, bench_pokemon: PokemonInPlay, cost: int) -> None:
        if self.retreated:
            raise IllegalMove("この番はもうにげた")
        if self.active is None or len(self.active.energies) < cost:
            raise IllegalMove("にげるためのエネルギーが足りない")
        for _ in range(cost):
            self.discard.append(self.active.energies.pop())
        self.retreated = True
        self.record(f"にげる({cost})")
        self.switch_active(bench_pokemon)

    # ---- 番の進行 ----

    def begin_turn(self) -> None:
        self.turn += 1
        self.supporter_used = False
        self.energy_attached = False
        self.stadium_played = False
        self.retreated = False
        self.used_once_per_turn.clear()
        if not self.deck:
            raise IllegalMove("山札が無く引けない")
        drawn = self.draw(1)
        self.record(f"番の最初に引く: {drawn[0].name}")

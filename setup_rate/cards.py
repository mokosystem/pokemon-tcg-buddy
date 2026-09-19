"""カードの種別と、計算に使う属性。

カードテキストそのものは持たない。規則ファイルが公式のカード詳細ページで確認した
事実を、計算に必要な属性だけに落として書く。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Category(Enum):
    POKEMON = "ポケモン"
    GOODS = "グッズ"
    TOOL = "ポケモンのどうぐ"
    SUPPORTER = "サポート"
    STADIUM = "スタジアム"
    BASIC_ENERGY = "基本エネルギー"
    SPECIAL_ENERGY = "特殊エネルギー"


class Stage(Enum):
    BASIC = "たね"
    STAGE1 = "1進化"
    STAGE2 = "2進化"


@dataclass(frozen=True)
class Card:
    name: str
    category: Category
    card_id: str = ""
    stage: Stage | None = None
    hp: int = 0
    pokemon_type: str = ""
    evolves_from: str = ""
    has_rule_box: bool = False
    retreat_cost: int = 0
    provides: tuple[str, ...] = ()

    @property
    def is_pokemon(self) -> bool:
        return self.category is Category.POKEMON

    @property
    def is_basic_pokemon(self) -> bool:
        return self.is_pokemon and self.stage is Stage.BASIC

    @property
    def is_energy(self) -> bool:
        return self.category in (Category.BASIC_ENERGY, Category.SPECIAL_ENERGY)

    @property
    def is_supporter(self) -> bool:
        return self.category is Category.SUPPORTER


def pokemon(
    name: str,
    card_id: str,
    stage: Stage,
    hp: int,
    pokemon_type: str,
    evolves_from: str = "",
    has_rule_box: bool = False,
    retreat_cost: int = 0,
) -> Card:
    return Card(
        name=name,
        category=Category.POKEMON,
        card_id=card_id,
        stage=stage,
        hp=hp,
        pokemon_type=pokemon_type,
        evolves_from=evolves_from,
        has_rule_box=has_rule_box,
        retreat_cost=retreat_cost,
    )


def goods(name: str, card_id: str) -> Card:
    return Card(name=name, category=Category.GOODS, card_id=card_id)


def supporter(name: str, card_id: str) -> Card:
    return Card(name=name, category=Category.SUPPORTER, card_id=card_id)


def stadium(name: str, card_id: str) -> Card:
    return Card(name=name, category=Category.STADIUM, card_id=card_id)


def basic_energy(name: str, card_id: str, energy_type: str) -> Card:
    return Card(name=name, category=Category.BASIC_ENERGY, card_id=card_id, provides=(energy_type,))


def special_energy(name: str, card_id: str, provides: tuple[str, ...]) -> Card:
    return Card(name=name, category=Category.SPECIAL_ENERGY, card_id=card_id, provides=provides)

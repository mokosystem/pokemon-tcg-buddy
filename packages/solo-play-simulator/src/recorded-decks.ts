/**
 * 記録だけで組み立てて回すデッキの 60 枚の内容(カード ID と枚数)。翻訳した効果と今できる行動の一覧が、基本ルールに
 * 反さずに勝敗まで動くかのテスト(recorded-decks.test.ts)に使う。
 *
 * リポジトリに置いてよい理由(docs/solo-play-simulator-design.md「公式サイトの内容を転載しない方針との整理」):
 * - メガサーナイトex、メガリザードンYex、ばけがくれは開発責任者のデッキで、本人の許可を得ている。Issue 22 の試作
 *   (Python の setup_rate/decks/)のカード表と 60 枚の内容から写した
 * - ドラパルトex は公式の記事で公開された優勝デッキ。同じく Issue 22 の試作から写した
 * - シロナのガブリアスex(2026-09-23 のデッキ)とメガレックウザex は開発責任者のデッキで、本人の許可を得ている。デッキコード
 *   から公式のデッキ表示ページで読んだ(2026-09-23)
 * - シロナのガブリアスex(2026-11-10 のデッキ)は開発責任者が今使っているデッキで、本人が 2026-11-10 に許可した(Issue 69 の
 *   決定事項「デッキ」)。デッキコードから公式のデッキ表示ページで読んだ(2026-11-11)
 */

import type { Decklist } from "./engine.ts";

/** 記録だけで組み立てて回すデッキ。 */
export interface RecordedDeck {
  readonly deckCode: string;
  readonly decklist: Decklist;
  readonly name: string;
}

export const RECORDED_DECKS: readonly RecordedDeck[] = [
  {
    deckCode: "xG8Kax-DHob4e-84xcca",
    decklist: [
      { cardId: "048464", count: 3 }, // メガサーナイトex
      { cardId: "049715", count: 3 }, // キルリア
      { cardId: "049714", count: 4 }, // ラルトス
      { cardId: "047663", count: 1 }, // プルリル
      { cardId: "046248", count: 2 }, // ラティアスex
      { cardId: "047041", count: 2 }, // リーリエのピッピex
      { cardId: "049694", count: 2 }, // ニャースex
      { cardId: "050669", count: 1 }, // ミュウex
      { cardId: "050462", count: 2 }, // ふしぎなアメ
      { cardId: "049602", count: 2 }, // ポケモンいれかえ
      { cardId: "050461", count: 4 }, // ハイパーボール
      { cardId: "048675", count: 3 }, // なかよしポフィン
      { cardId: "048681", count: 1 }, // 夜のタンカ
      { cardId: "050424", count: 2 }, // ポケパッド
      { cardId: "050156", count: 1 }, // スペシャルレッドカード
      { cardId: "050467", count: 2 }, // ボスの指令
      { cardId: "045934", count: 4 }, // アクロマの執念
      { cardId: "049445", count: 4 }, // リーリエの決心
      { cardId: "047856", count: 1 }, // ミツルの思いやり
      { cardId: "048694", count: 2 }, // トウコ
      { cardId: "050083", count: 1 }, // ユカリ
      { cardId: "046040", count: 1 }, // 偉大な大樹
      { cardId: "049463", count: 8 }, // 基本超エネルギー
      { cardId: "049712", count: 4 }, // テレパス超エネルギー
    ],
    name: "メガサーナイトex(開発責任者)",
  },
  {
    deckCode: "DxKGxx-6pqCKy-xxJ8Yc",
    decklist: [
      { cardId: "048351", count: 3 }, // ヒトカゲ
      { cardId: "049481", count: 2 }, // リザード
      { cardId: "049482", count: 1 }, // メガリザードンYex
      { cardId: "048353", count: 2 }, // メガリザードンXex
      { cardId: "048358", count: 2 }, // オドリドリex
      { cardId: "047847", count: 3 }, // メガガルーラex
      { cardId: "050400", count: 2 }, // ファイアローex
      { cardId: "049524", count: 2 }, // ラティアスex
      { cardId: "049694", count: 1 }, // ニャースex
      { cardId: "049352", count: 2 }, // エネルギー回収
      { cardId: "050423", count: 2 }, // ふしぎなアメ
      { cardId: "050744", count: 2 }, // ポケモンいれかえ
      { cardId: "050742", count: 4 }, // ハイパーボール
      { cardId: "050743", count: 2 }, // ポケパッド
      { cardId: "048681", count: 1 }, // 夜のタンカ
      { cardId: "050205", count: 1 }, // スペシャルレッドカード
      { cardId: "049380", count: 1 }, // ポケモン回収サイクロン
      { cardId: "050467", count: 2 }, // ボスの指令
      { cardId: "046442", count: 2 }, // シアノ
      { cardId: "048694", count: 2 }, // トウコ
      { cardId: "050468", count: 2 }, // リーリエの決心
      { cardId: "050428", count: 2 }, // ヒカリ
      { cardId: "048418", count: 2 }, // ひふきやろう
      { cardId: "047214", count: 1 }, // ジャミングタワー
      { cardId: "048419", count: 1 }, // バトルコロシアム
      { cardId: "050746", count: 10 }, // 基本炎エネルギー
      { cardId: "049452", count: 3 }, // イグニッションエネルギー
    ],
    name: "メガリザードンYex(開発責任者)",
  },
  {
    deckCode: "9nnnLP-Wejgk5-gn6gn9",
    decklist: [
      { cardId: "050308", count: 4 }, // ダダリン
      { cardId: "050224", count: 4 }, // チャデス
      { cardId: "050225", count: 1 }, // ヤバソチャ
      { cardId: "050250", count: 4 }, // カゲボウズ
      { cardId: "050251", count: 3 }, // ジュペッタ
      { cardId: "045203", count: 2 }, // ノココッチ
      { cardId: "047086", count: 3 }, // ノコッチ
      { cardId: "049521", count: 1 }, // リーリエのピッピex
      { cardId: "049341", count: 1 }, // ガチグマ アカツキex
      { cardId: "049364", count: 2 }, // なかよしポフィン
      { cardId: "050424", count: 4 }, // ポケパッド
      { cardId: "050461", count: 4 }, // ハイパーボール
      { cardId: "049376", count: 2 }, // ポケギア3.0
      { cardId: "048681", count: 2 }, // 夜のタンカ
      { cardId: "050464", count: 1 }, // ふうせん
      { cardId: "047894", count: 2 }, // スグリ
      { cardId: "050468", count: 4 }, // リーリエの決心
      { cardId: "050297", count: 4 }, // ムク
      { cardId: "050467", count: 2 }, // ボスの指令
      { cardId: "050164", count: 3 }, // プリズムタワー
      { cardId: "049457", count: 1 }, // レガシーエネルギー
      { cardId: "049712", count: 4 }, // テレパス超エネルギー
      { cardId: "049463", count: 2 }, // 基本超エネルギー
    ],
    name: "ばけがくれ(開発責任者)",
  },
  {
    deckCode: "9gngnQ-zAMw9G-96H9nn",
    decklist: [
      { cardId: "049264", count: 3 }, // ドラパルトex
      { cardId: "049263", count: 4 }, // ドロンチ
      { cardId: "049262", count: 4 }, // ドラメシヤ
      { cardId: "049026", count: 1 }, // ヨノワール
      { cardId: "049025", count: 1 }, // サマヨール
      { cardId: "049024", count: 2 }, // ヨマワル
      { cardId: "049074", count: 1 }, // マシマシラ
      { cardId: "048533", count: 1 }, // スボミー
      { cardId: "049205", count: 1 }, // キチキギスex
      { cardId: "049694", count: 1 }, // ニャースex
      { cardId: "049600", count: 4 }, // ハイパーボール
      { cardId: "049703", count: 4 }, // ポケパッド
      { cardId: "049364", count: 4 }, // なかよしポフィン
      { cardId: "049371", count: 2 }, // ふしぎなアメ
      { cardId: "049386", count: 2 }, // 夜のタンカ
      { cardId: "050156", count: 1 }, // スペシャルレッドカード
      { cardId: "049349", count: 1 }, // アンフェアスタンプ
      { cardId: "049609", count: 4 }, // リーリエの決心
      { cardId: "049440", count: 3 }, // ボスの指令
      { cardId: "049412", count: 2 }, // アカマツ
      { cardId: "048417", count: 2 }, // ヒカリ
      { cardId: "049708", count: 1 }, // メイのはげまし
      { cardId: "048711", count: 2 }, // ロケット団の監視塔
      { cardId: "047214", count: 1 }, // ジャミングタワー
      { cardId: "047904", count: 3 }, // 基本炎エネルギー
      { cardId: "048307", count: 3 }, // 基本超エネルギー
      { cardId: "047909", count: 2 }, // 基本悪エネルギー
    ],
    name: "ドラパルトex",
  },
  {
    deckCode: "6nNQgQ-y6q3om-9HnnLL",
    decklist: [
      { cardId: "047381", count: 3 }, // シロナのガブリアスex
      { cardId: "049093", count: 4 }, // シロナのガバイト
      { cardId: "049968", count: 1 }, // シロナのミカルゲ
      { cardId: "047366", count: 3 }, // シロナのロズレイド
      { cardId: "048748", count: 4 }, // シロナのロゼリア
      { cardId: "049092", count: 4 }, // シロナのフカマル
      { cardId: "050392", count: 1 }, // ルリリ
      { cardId: "049364", count: 4 }, // なかよしポフィン
      { cardId: "050463", count: 4 }, // ポケパッド
      { cardId: "048677", count: 3 }, // ファイトゴング
      { cardId: "049386", count: 1 }, // 夜のタンカ
      { cardId: "049368", count: 2 }, // パワープロテイン
      { cardId: "045640", count: 1 }, // アンフェアスタンプ
      { cardId: "050744", count: 2 }, // ポケモンいれかえ
      { cardId: "047355", count: 4 }, // シロナのパワーウエイト
      { cardId: "050468", count: 4 }, // リーリエの決心
      { cardId: "047288", count: 2 }, // ボスの指令
      { cardId: "048694", count: 1 }, // トウコ
      { cardId: "050448", count: 2 }, // ジャッジマン
      { cardId: "050164", count: 1 }, // プリズムタワー
      { cardId: "047489", count: 1 }, // ロケット団の監視塔
      { cardId: "049464", count: 4 }, // 基本闘エネルギー
      { cardId: "049713", count: 4 }, // ロック闘エネルギー
    ],
    name: "シロナのガブリアスex(開発責任者、2026-09-23 のデッキ)",
  },
  {
    deckCode: "xcGKc8-NGuFdn-D8c88x",
    decklist: [
      { cardId: "049282", count: 2 }, // イーブイex
      { cardId: "048810", count: 2 }, // ブースターex
      { cardId: "046372", count: 1 }, // パオジアン
      { cardId: "047847", count: 2 }, // メガガルーラex
      { cardId: "050400", count: 2 }, // ファイアローex
      { cardId: "050396", count: 2 }, // メガレックウザex
      { cardId: "049694", count: 3 }, // ニャースex
      { cardId: "049028", count: 2 }, // ラティアスex
      { cardId: "048636", count: 1 }, // キチキギスex
      { cardId: "048543", count: 1 }, // ヒビキのホウオウex
      { cardId: "049602", count: 1 }, // ポケモンいれかえ
      { cardId: "050461", count: 4 }, // ハイパーボール
      { cardId: "049354", count: 4 }, // エネルギーつけかえ
      { cardId: "048671", count: 2 }, // ガラスのラッパ
      { cardId: "050402", count: 1 }, // ぼうけんのランタン
      { cardId: "049403", count: 1 }, // ヒーローマント
      { cardId: "050448", count: 2 }, // ジャッジマン
      { cardId: "050467", count: 2 }, // ボスの指令
      { cardId: "049412", count: 2 }, // アカマツ
      { cardId: "046442", count: 2 }, // シアノ
      { cardId: "050468", count: 4 }, // リーリエの決心
      { cardId: "048706", count: 3 }, // ゼロの大空洞
      { cardId: "050478", count: 9 }, // 基本炎エネルギー
      { cardId: "050480", count: 4 }, // 基本雷エネルギー
      { cardId: "050479", count: 1 }, // 基本水エネルギー
    ],
    name: "メガレックウザex(開発責任者)",
  },
  {
    deckCode: "RS3MMy-FuGPRu-MypM2X",
    decklist: [
      { cardId: "047388", count: 1 }, // シロナのガブリアスex
      { cardId: "047392", count: 1 }, // シロナのガブリアスex
      { cardId: "047381", count: 1 }, // シロナのガブリアスex
      { cardId: "049093", count: 4 }, // シロナのガバイト
      { cardId: "049092", count: 4 }, // シロナのフカマル
      { cardId: "049968", count: 1 }, // シロナのミカルゲ
      { cardId: "047366", count: 3 }, // シロナのロズレイド
      { cardId: "048748", count: 4 }, // シロナのロゼリア
      { cardId: "049364", count: 4 }, // なかよしポフィン
      { cardId: "050463", count: 4 }, // ポケパッド
      { cardId: "048677", count: 3 }, // ファイトゴング
      { cardId: "049386", count: 1 }, // 夜のタンカ
      { cardId: "050744", count: 1 }, // ポケモンいれかえ
      { cardId: "048438", count: 1 }, // パワープロテイン
      { cardId: "048468", count: 1 }, // ふしぎなアメ
      { cardId: "047355", count: 3 }, // シロナのパワーウエイト
      { cardId: "050468", count: 4 }, // リーリエの決心
      { cardId: "048694", count: 2 }, // トウコ
      { cardId: "050448", count: 2 }, // ジャッジマン
      { cardId: "047288", count: 3 }, // ボスの指令
      { cardId: "048701", count: 2 }, // ロケット団のラムダ
      { cardId: "048711", count: 1 }, // ロケット団の監視塔
      { cardId: "048704", count: 1 }, // 活力の森
      { cardId: "049464", count: 4 }, // 基本闘エネルギー
      { cardId: "049713", count: 3 }, // ロック闘エネルギー
      { cardId: "045217", count: 1 }, // ネオアッパーエネルギー
    ],
    name: "シロナのガブリアスex(開発責任者、2026-11-10 のデッキ)",
  },
];

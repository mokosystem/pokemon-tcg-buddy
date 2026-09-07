# AGENTS.md

## このリポジトリについて

ポケモンカードのデッキ構築とデッキ診断を支援する AI エージェントを作るプロジェクト。目的、対象ユーザー、情報源の方針は [README.md](README.md) にある。

## ドキュメントの役割分担

- **AGENTS.md** — エージェント向けの指示。指示を追加・修正するときはこのファイルを編集する。
- **CLAUDE.md** — `@AGENTS.md` を読み込むだけのファイルとして維持し、内容を書かない。
- **README.md** — 人間が読むためのドキュメント。プロジェクトの目的と情報源の方針はここが正。
- **CONTEXT.md** — 文書で使う用語の定義(ユビキタス言語)。用語の正はここ。手順と知識は docs/pokemon-tcg/ に置き、CONTEXT.md には書かない。
- **docs/** — 手順書などの作業文書。ポケモンカードのドメイン文書は `docs/pokemon-tcg/` に置き、開発に関する文書と区別する。

## 文書の用語

文書を書く・直すときは [CONTEXT.md](CONTEXT.md) の用語を使い、各用語の _Avoid_ に挙げた表記を使わない。公式用語は公式サイトで確認した名称、プロジェクト定義用語はこのプロジェクトが付けた名前で、CONTEXT.md がその区別を示す。新しい概念に名前を付けるときや、用語の揺れに気づいたときは、CONTEXT.md を先に直してから文書を直す。プレイヤーの俗語(逃げエネ、手張りなど)の意味は [docs/pokemon-tcg/glossary.md](docs/pokemon-tcg/glossary.md) で確認し、CONTEXT.md の用語へ対応付けて扱う。ユーザーとの会話でどの俗語を使ってよいかも、同じ文書の「エージェントの使い方」に従う。

## ポケモンカードの情報の扱い

カード、ルール、レギュレーションについて書くときは、README の「情報源の方針」に従う。具体的な確認手順は docs/pokemon-tcg/ の手順書にある。公式サイトを参照する前に [docs/pokemon-tcg/site-usage-notes.md](docs/pokemon-tcg/site-usage-notes.md) を読み、カードの確認は [docs/pokemon-tcg/card-lookup.md](docs/pokemon-tcg/card-lookup.md)、対戦の基本ルールは [docs/pokemon-tcg/basic-rules.md](docs/pokemon-tcg/basic-rules.md)、公式 Q&A の検索は [docs/pokemon-tcg/faq-lookup.md](docs/pokemon-tcg/faq-lookup.md)、デッキコードの読み取りとデッキ登録は [docs/pokemon-tcg/deck-tool.md](docs/pokemon-tcg/deck-tool.md) に従う。エージェントとしての要点は次の通り。

- カードの効果、数値、使用可否を記憶で断定しない。公式カード検索の詳細ページを開いて確認してから書く
- 現行レギュレーションの内容(使用できるレギュレーションマークなど)をドキュメントやコードに固定値として書かない。公式レギュレーションページを都度参照する
- 公式サイトのページ内容やカード画像をリポジトリに転載しない
- 確認した事実には、確認日と参照 URL を残す

## 作業を終える条件

検証できることは実行してから完了とする。実行していない検証を実行済みとして報告しない。カードやレギュレーションに触れる記述は、公式サイトでの確認をもって検証とみなす。

## エージェントスキルの置き場所

このリポジトリは Claude Code と Cursor で作業することを想定する(他のコーディングエージェントも妨げない)。スキルは次の構成で置く。

- 実体を `.claude/skills/<スキル名>/SKILL.md` に置く
- `.agents/skills` を `.claude/skills` へのシンボリックリンクとして作り、Cursor などのリンクを辿れるエージェントには `.agents/skills` を読ませる

```bash
mkdir -p .agents
ln -s ../.claude/skills .agents/skills
```

実体を `.claude/skills/` 側に置くのは、Claude Code にシンボリックリンクされたスキルを一覧に出せない不具合があるため([anthropics/claude-code#14836](https://github.com/anthropics/claude-code/issues/14836)。2026-08-21 時点で未解決)。リンクを辿る側を Cursor などに寄せ、Claude Code には実ファイルを読ませる。この不具合が解決したら構成を見直してよい。

スキルの名前には規約がある。ポケモンカードのドメイン知識を扱うスキルには接頭辞 `pokemon-tcg-` を必ず付け、開発作業の規約スキル(`create-git-commit` など)と名前だけで区別できるようにする。文書がディレクトリ(`docs/pokemon-tcg/`)で区別するのと方式が違うのは、スキルが名前だけの一覧に並ぶフラットな名前空間で、名前以外に区別の手段が無いためである。

Git コミット、GitHub Issue、Pull Request の規約は、`.claude/skills/` の `create-git-commit`、`create-github-issue`、`create-github-pull-request` に、ルールや裁定の質問に答える手順は `pokemon-tcg-answer-rules-question` にある。該当する作業ではそのスキルに従う。

## 文章の言語

README、コミットメッセージ、Issue、ドキュメントは日本語で書く。標準的な技術文書の文体とする。

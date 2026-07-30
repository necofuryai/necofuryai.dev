---
name: cloudflare-static-site
description: necofuryai.dev の Cloudflare Workers Static Assets、wrangler.jsonc、HTTP headers、404・HTML handling、observability を変更またはレビューするときに使う。リポジトリ内の Cloudflare skill を Codex から必要な範囲だけ読み込む。
---

# Cloudflare Static Site

これは Codex 用の薄いルーターである。
Cloudflare の詳細な知識は、リポジトリで管理している `.claude/skills/` を正本とする。

## 1. 必要な資料を読み込む

最初に次を読む。

- `../../../.claude/skills/workers-best-practices/SKILL.md`

Wrangler のコマンド、設定、デプロイ操作を扱う場合だけ、次も読む。

- `../../../.claude/skills/wrangler/SKILL.md`

参照先は各 `SKILL.md` のディレクトリを基準に解決する。
由来とローカル変更は `../../../.claude/skills/README.md` で確認する。

## 2. このリポジトリの境界を守る

- 現在の構成は Workers Static Assets と observability を中心に扱う。
- `wrangler.jsonc`、public headers、Astro の build output、Cloudflare Git integration の境界を確認する。
- KV、D1、Queues、Durable Objects など、リポジトリで使っていない機能の資料は読み込まない。
- ローカルの Wrangler package や schema が存在するとは仮定しない。
- 仕様が変わり得る設定は、Cloudflare の公式ドキュメントで現在の挙動を確認する。

## 3. 安全に変更する

- 設定へ secret や live environment value を書かない。
- 明示的な依頼なしに deploy、resource deletion、secret mutation を行わない。
- 既存の Git integration と production deployment の責務を変える場合は、影響と rollback を先に示す。

## 4. 検証する

変更内容に応じて次を実施する。

- `wrangler.jsonc` の構文と設定値を確認する。
- リポジトリ標準の format、lint、typecheck、build を実行する。
- headers、404、HTML handling、assets directory、observability の差分を確認する。
- `git diff --check` と `git status --short` を確認する。
- 実行していない deploy や外部検証を明示する。

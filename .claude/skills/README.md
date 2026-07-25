# .claude/skills/

Claude Code のプロジェクトスコープのスキル。このリポジトリで作業するとき、Cloudflare Workers 関連のタスクで自動的に読み込まれる。

このサイトは Cloudflare Workers Static Assets にデプロイしており (`wrangler.jsonc`)、`_headers` によるヘッダー付与や `not_found_handling` / `html_handling` の挙動がサイトの表示に直結する。
これらのスキルは、その領域を扱うときに最新の Cloudflare ドキュメントを参照させるための指示書として置いている。

## 出典とライセンス

いずれも [cloudflare/skills](https://github.com/cloudflare/skills) (Apache License 2.0) からのベンダリング。
著作権は Cloudflare, Inc. に帰属し、Apache-2.0 の条件下で再配布している。
リポジトリ本体のライセンス (コードは MIT、`src/content/` 以下は CC BY-NC-SA 4.0) はこのディレクトリには適用されない。

| このリポジトリ | 上流のパス |
|---|---|
| `wrangler/SKILL.md` | `skills/wrangler/SKILL.md` |
| `workers-best-practices/SKILL.md` | `skills/workers-best-practices/SKILL.md` |
| `workers-best-practices/references/rules.md` | `skills/workers-best-practices/references/rules.md` |
| `workers-best-practices/references/review.md` | `skills/workers-best-practices/references/review.md` |
| `workers-best-practices/references/static-assets/*.md` | `skills/cloudflare/references/static-assets/*.md` |
| `workers-best-practices/references/observability/*.md` | `skills/cloudflare/references/observability/*.md` |

`static-assets/` と `observability/` は上流では `workers-best-practices` ではなく包括スキル `skills/cloudflare/` 側の参照資料。
このリポジトリで実際に使う 2 領域だけを `workers-best-practices` の下へ移して同梱している。

## 上流からの改変点

Apache-2.0 第 4 条 (b) に基づく変更告知。以下の 2 点以外は上流と同一。

1. `workers-best-practices/SKILL.md` の "Reference Documentation" 節に、同梱した `references/static-assets/` と `references/observability/` の 2 行を追記。
2. 両 `SKILL.md` の "Retrieval Sources" 表にある `node_modules/wrangler/config-schema.json` の行に、このリポジトリの事情を注記。
   wrangler は `package.json` の依存に入っておらず (デプロイは Cloudflare 側の Git 連携ビルド)、`node_modules/wrangler/` は存在しないため、スキーマ参照はドキュメント URL へフォールバックさせる必要がある。

## 上流への再同期

スキルの中身は「API シグネチャの直書き」ではなく「検索先の指示」なので陳腐化しにくいが、更新を取り込む場合は次の手順で差分を確認する。

```bash
pnpm diff-skills
```

差分の本文まで見るなら `pnpm diff-skills --diff`。
ローカル改変済みの 2 ファイルは常に差分として出るが、これは想定どおりなので終了コードには影響しない。
更新を取り込むときは、上記「上流からの改変点」を手で当て直すこと。

終了コードは `.github/workflows/skills-drift.yml` が依存している契約になっている。

| コード | 意味 |
|---|---|
| 0 | 対応不要 (完全一致、またはローカル改変のみ) |
| 1 | 要対応 (上流が更新された、またはファイルが欠落している) |
| 2 | 検査自体が失敗した (上流の取得エラーなど) |

プラグイン経由ではないため上流更新は自動では降ってこないが、上記ワークフローが毎週月曜に検査し、更新があれば Issue を立てる。
このディレクトリを触る PR では同じ検査が走り、記録のないローカル改変があれば失敗する。

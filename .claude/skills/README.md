# .claude/skills/

Claude Code のプロジェクトスコープのスキル。このリポジトリで作業するとき、Cloudflare Workers 関連のタスクで自動的に読み込まれる。

このサイトは Cloudflare Workers Static Assets にデプロイしており (`wrangler.jsonc`)、`_headers` によるヘッダー付与や `not_found_handling` / `html_handling` の挙動がサイトの表示に直結する。
これらのスキルは、その領域を扱うときに最新の Cloudflare ドキュメントを参照させるための指示書として置いている。

## 出典とライセンス

いずれも [cloudflare/skills](https://github.com/cloudflare/skills) (Apache License 2.0) からのベンダリング。
著作権は Cloudflare, Inc. に帰属し、Apache-2.0 の条件下で再配布している。
リポジトリ本体のライセンス (コードは MIT、`src/content/` 以下は CC BY-NC-SA 4.0) はこのディレクトリには適用されない。
ライセンス本文は同じディレクトリの [`LICENSE`](LICENSE) で、上流リポジトリのルートにあるものと同一 (第 4 条 (a) の写しの提供)。
このディレクトリへの変更 (この README とローカル改変を含む) も Apache-2.0 で提供する。

| このリポジトリ | 上流のパス |
|---|---|
| `LICENSE` | `LICENSE` (リポジトリのルート) |
| `wrangler/SKILL.md` | `skills/wrangler/SKILL.md` |
| `workers-best-practices/SKILL.md` | `skills/workers-best-practices/SKILL.md` |
| `workers-best-practices/references/configuration.md` | `skills/workers-best-practices/references/configuration.md` |
| `workers-best-practices/references/platform-apis.md` | `skills/workers-best-practices/references/platform-apis.md` |
| `workers-best-practices/references/runtime-patterns.md` | `skills/workers-best-practices/references/runtime-patterns.md` |
| `workers-best-practices/references/static-assets/*.md` | `skills/cloudflare/references/static-assets/*.md` |
| `workers-best-practices/references/observability/*.md` | `skills/cloudflare/references/observability/*.md` |

`static-assets/` と `observability/` は上流では `workers-best-practices` ではなく包括スキル `skills/cloudflare/` 側の参照資料。
このリポジトリで実際に使う 2 領域だけを `workers-best-practices` の下へ移して同梱している。

## 上流からの改変点

Apache-2.0 第 4 条 (b) は、改変したファイル自身に変更した旨の告知を載せることを求めている。
そのため改変した 2 つの `SKILL.md` には、frontmatter の直後に告知を置いている (下記 3)。
この節は改変内容の詳細な記録で、以下の 3 点以外は上流と同一。

1. `workers-best-practices/SKILL.md` の "References" 表に、同梱した `references/static-assets/` と `references/observability/` の 2 行を追記。
2. 両 `SKILL.md` にある Wrangler の設定スキーマ (`config-schema.json`) を参照させる箇所に、このリポジトリの事情を注記。
   `wrangler/SKILL.md` は "Retrieve What the Task Needs" 表の "Edit config or add a binding" 行、`workers-best-practices/SKILL.md` は "References" 表の直後の段落にある "Use the installed Wrangler schema for config fields." の文。
   wrangler は `package.json` の依存に入っておらず (デプロイは Cloudflare 側の Git 連携ビルド)、`node_modules/wrangler/` は存在しないため、スキーマ参照はドキュメント URL へフォールバックさせる必要がある。
3. 両 `SKILL.md` の frontmatter の直後に、necofuryai が改変した旨、上流のパス、変更の概要、この節への参照を記した告知 (引用ブロック) を追加。
   frontmatter の `name` と `description` はスキルを読み込むかどうかの判定に使われるため、手を入れていない。
   告知は `**Modified by necofuryai:**` で始める。単体テスト `tests/unit/vendored-skills-notice.test.mjs` がこの文字列で告知の有無と位置を確かめる。

参照資料 (`references/` 以下) は上流と同一のまま置いている。
`references/configuration.md` にも `node_modules/wrangler/config-schema.json` への言及が残るが、上記 2 の注記が入口の `SKILL.md` で先に読まれるため改変していない。
`references/observability/README.md` 末尾の `../analytics-engine/` などへの相対リンクは上流の包括スキル内の資料を指しており、このリポジトリには同梱していないためリンク切れになる。

## 上流への再同期

スキルの中身は「API シグネチャの直書き」ではなく「検索先の指示」なので陳腐化しにくいが、更新を取り込む場合は次の手順で差分を確認する。

```bash
pnpm diff-skills
```

差分の本文まで見るなら `pnpm diff-skills --diff`。
ローカル改変済みの 2 ファイルは常に差分として出るが、これは想定どおりなので終了コードには影響しない。
その代わり、この 2 ファイルは全文を上流と比べるだけなので、上流で更新されても「改変」のままで検出されない。
上流の更新を取り込むときは、この 2 ファイルも `pnpm diff-skills --diff` で目視確認する。
変更告知の有無はこの差分検査ではなく単体テスト (`pnpm test:unit`) が確かめる。
更新を取り込むときは、上記「上流からの改変点」を告知 (3) も含めて手で当て直すこと。
上流のファイルを新たに改変するときは、`scripts/cloudflare-skills-manifest.mjs` の `LOCALLY_MODIFIED` に登録し、改変したファイルの冒頭 (frontmatter があればその直後) に変更告知を追加し (既にあれば概要を更新し)、「上流からの改変点」に記録する。
`LICENSE` も検査対象に含めており、上流で本文が変われば「差分」として検出される。

終了コードは `.github/workflows/skills-drift.yml` が依存している契約になっている。

| コード | 意味 |
|---|---|
| 0 | 対応不要 (完全一致、またはローカル改変のみ。ローカル改変したファイルの上流更新はここに含まれてしまう) |
| 20 | 要対応 (上流が更新・削除・移動された、またはファイルが欠落している) |
| それ以外 | 検査自体が失敗した (捕捉した例外や上流の取得エラーは 2、読み込み時のエラーなど Node 自身の異常終了は 1 など) |

「要対応」を Node や Bash が使わない 20 にしているのは、壊れたスクリプトが Node の異常終了 (1) で落ちたときに「要対応」と取り違えないため。
`pnpm diff-skills` で差分が見つかると、pnpm は終了コード 20 の失敗として報告する。
スクリプトとワークフローの両側の分類は、`tests/unit/diff-cloudflare-skills.test.mjs` と `tests/unit/skills-drift-workflow.test.mjs` が通信なしで検査する。

プラグイン経由ではないため上流更新は自動では降ってこないが、上記ワークフローが毎週月曜に検査し、更新があれば Issue を立てる (ローカル改変した 2 ファイルの更新は上記のとおり検出できない)。
このディレクトリを触る PR では同じ検査が走り、`LOCALLY_MODIFIED` に登録のない改変があれば失敗する。
変更告知の有無は、すべての PR で走る単体テスト (必須チェック `CI OK` に含まれる) が検査する。
「上流からの改変点」への記録は検査しないため、PR のレビューで確認する。

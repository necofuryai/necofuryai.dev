# 依存関係更新自動化の観測記録

- 対象：`necofuryai/necofuryai.dev`
- 位置づけ：`docs/dependency-update-automation-plan.md` のフェーズ 5「四週間の観測」の記録
- 観測開始：2026-07-20（Dependabot の初回週次実行）
- 記録時点：2026-08-03
- 進捗：第 1 週から第 3 週まで記録済み。第 4 週は 2026-08-10 の週次実行で確定する

計画が求める観測項目は、作成された PR 数、grouping の妥当性、CI failure の原因、手作業で lockfile または manifest を修正した回数、更新後に revert した回数、自動マージと手動マージの件数、`packageManager` の pnpm version が更新対象になるか、Claude advisory の成功率と実行時間と有用性である。
VRT に関する項目（VRT failure、flaky 差分、baseline 更新、誤検知の件数）は 2026-07-22 の運用変更で対象が消滅したため、UI smoke test の失敗と不安定挙動として読み替えて記録する。

数値はすべて GitHub API の応答から取得した。
時刻は JST で表記する。

## 全体集計（第 1 週から第 3 週）

| 項目 | 実績 |
|---|---:|
| Dependabot PR 作成数 | 21（npm 16 / github-actions 5） |
| 自動マージ | 7 |
| 手動マージ | 13 |
| 未マージクローズ | 1 |
| 現在 open | 0 |
| CI failure が発生した PR | 6 |
| 手作業による lockfile / manifest 修正 | 1 |
| 更新後の revert | 0 |
| UI smoke test の実失敗 | 1（flaky と誤検知は 0） |
| Claude advisory の実行成功率 | 139 / 140（99.3 %） |

スケジュールは設定どおりに動いた。
npm の週次バッチは 3 週連続で月曜 06:04 から 06:06 に作成され、github-actions の日次 PR は 06:32 から 06:35 に作成された。

## 第 1 週（2026-07-20 から 2026-07-26）

| PR | 内容 | 種別 | 結末 |
|---|---|---|---|
| #38 | @fontsource/roboto 5.2.9 → 5.2.10 | patch | 自動マージ（作成から 24 分） |
| #39 | sanitize-html と @types/sanitize-html | patch | 自動マージ |
| #40 | remark-github-admonitions-to-directives 1.0.5 → 2.1.0 | major | 手動マージ |
| #41 | @iconify-json/material-symbols 1.2.50 → 1.2.85 | patch | 自動マージ |
| #42 | unist-util-visit 5.0.0 → 5.1.0 | minor（production） | 手動マージ |
| #50 | actions/checkout 7.0.0 → 7.0.1 | actions | 手動マージ |
| #60 | anthropics/claude-code-action 1.0.177 → 1.0.178 | actions | 手動マージ |
| #62 | anthropics/claude-code-action 1.0.178 → 1.0.179 | actions | 手動マージ |

自動マージ 3 件、手動マージ 5 件。
判定はいずれも 2026-07-20 改訂の matrix と整合している。
#40 は major、#42 は production dependency の minor、github-actions の 3 件は変更ファイルが manifest に限られないため、それぞれ手動へ回った。

この週にはグループ PR が存在しない。
当時定義されていた npm グループは astro-svelte、expressive-code、tailwind-css、type-definitions の 4 つだけで、更新が出た 5 パッケージはどのパターンにも一致しなかった。

CI failure は #42 の 1 件である。
原因は Dependabot ブランチへ人手で作成した merge commit で、直前にマージされた #40 の lockfile とテキストマージした結果 `unist-util-visit@5.0.0` のエントリが失われた。
`@dependabot recreate` でブランチを再生成して解消し、lockfile を手で修正する対処は行っていない。

同じ月曜に 5 本の PR が同時に open したため、main が短時間に 5 回進み、Dependabot は #39 で 3 回、#40 で 3 回、#42 で 2 回の rebase を強いられた。
この連続更新が #42 の破損を招いた条件であり、後の catch-all-minor-patch グループ導入（PR #80）はこの週の実績に照らして妥当な判断だった。

## 第 2 週（2026-07-27 から 2026-08-02）

| PR | 内容 | 種別 | 結末 |
|---|---|---|---|
| #72 | astro-svelte グループ 2 件 | patch | 自動マージ（79 秒） |
| #73 | expressive-code グループ 4 件 | 0.x patch | 手動マージ |
| #74 | @biomejs/biome 2.5.4 → 2.5.5 | patch | 自動マージ |
| #75 | katex 0.16.27 → 0.18.1 | 0.x | 手動マージ |
| #76 | overlayscrollbars 2.12.0 → 2.16.0 | minor（production） | 手動マージ |
| #77 | remark-directive-rehype 0.4.2 → 1.0.0 | major | 手動マージ |
| #81 | catch-all-minor-patch グループ 4 件 | minor / patch | 手動マージ |
| #82 | @types/hast 3.0.4 → 3.0.5 | patch | 自動マージ（86 秒） |
| #78 | anthropics/claude-code-action 1.0.179 → 1.0.182 | actions | 手動マージ |
| #83 | anthropics/claude-code-action 1.0.182 → 1.0.185 | actions | 手動マージ |

自動マージ 3 件、手動マージ 7 件。

CI failure は #74、#75、#76、#77 の 4 件で、原因はすべて同一である。
GitHub のテストマージが `acorn@8.17.0` のエントリを二重に生成し、`ERR_PNPM_BROKEN_LOCKFILE`（duplicated mapping key）で `pnpm install --frozen-lockfile` が停止した。
これは `AGENTS.md` が既知事象として記載しているパターンそのものである。

このうち #74 と #76 は人手を加えず、main が進むたびの自動 rebase だけで解消した。
#77 も lockfile を編集せず、rebase とブランチ同期で解消している。
#75 だけは `pnpm-lock.yaml` を再生成するコミット（f1936f6、変更は lockfile のみ）を push して解消した。
`AGENTS.md` は lockfile を手動修復して push しない運用を定めているため、この 1 件は文書化された手順からの逸脱である。
同じ原因の他 3 件が自動 rebase で解消したことから、この手動修復は不要だった可能性が高い。

グループの構成は妥当だった。
astro-svelte（#72）は astro と svelte を同時に上げる自然な組で、初回グリーンから 79 秒で自動マージされた。
expressive-code（#73）は同一リリーストレインの 4 本で、分割すれば 4 連続の PR になる。
catch-all-minor-patch（#81）はフォントとアイコンのデータ更新 4 本で、技術的な関連はないがリスクの性質が揃っている。
1 メンバーの失敗がグループ全体を止めた例はこの週には無い。

## 第 3 週（2026-08-03、進行中）

| PR | 内容 | 種別 | 結末 |
|---|---|---|---|
| #88 | astro-svelte グループ 2 件 | patch | 自動マージ（87 秒） |
| #89 | catch-all-minor-patch グループ 5 件 | minor / patch | 手動マージ（3 時間 51 分） |
| #92 | @playwright/test 1.62.0 → 1.62.1 | patch | Dependabot が自動クローズ |

自動マージ 1 件、手動マージ 1 件、未マージクローズ 1 件。

#89 で、グルーピングが明確に害をもたらす初めての事例が出た。
グループに同乗した `@playwright/test` 1.61.1 から 1.62.0 への更新が、`build.yml` が digest 固定する container image `v1.61.1-noble` と食い違い、UI smoke test の 15 件すべてが browser の起動に失敗した。
無関係な 4 件の更新が同じ PR の失敗に巻き込まれ、自動マージの経路からも外れた。
auto-merge の denylist には `@playwright/test` が入っていたが、denylist は自動マージの判定にだけ作用し PR の grouping には作用しない。
container image を v1.62.0 へ上げるコミットを同じブランチに積んで解消し、再発防止として PR #91 で `exclude-patterns` による分離を実施した。

#89 ではもう一つ、CI が 3 時間 46 分起動しない空白が生じた。
同一の Dependabot 実行から生成された #88 と #89 が同じ base を持ち、先行する #88 のマージで #89 の lockfile が即座に陳腐化したためである。
`@dependabot rebase` は「already up-to-date」と誤って応答し、`@dependabot recreate` で解消した。
グループを細分化するほどこの順序衝突の確率は上がるため、今後の分割では注意を要する。

#92 は PR #91 のマージ直後に Dependabot が「no longer updatable」として自らクローズした。
`@playwright/test` 1.62.1 は未適用のまま残っている。

## 項目別の所見

### 手作業による lockfile / manifest 修正

3 週間で 1 件（#75）。
Dependabot ブランチへの人間のコミット自体は 4 件あるが、内訳は lockfile 修復 1 件、ブランチ同期の merge commit 2 件（#40、#77）、CI 設定の追随 1 件（#89 の container image 更新）である。
lockfile 破損に対しては `@dependabot recreate` か自動 rebase の待機で対処する運用が有効に働いており、例外は #75 だけだった。

### revert

0 件。
main の履歴に revert、downgrade、rollback のいずれに該当するコミットも無く、ダウングレード PR も存在しない。

fix-forward が 1 件ある。
PR #45 は #40（remark-github-admonitions-to-directives の major 更新）がもたらした挙動変更に追随したもので、依存更新を戻したものではない。

### 自動マージと手動マージの比率

自動 7 件に対し手動 13 件で、自動マージ率は 35 %。
手動へ回った 13 件の内訳は、github-actions が 5 件、major が 2 件、0.x が 2 件、production dependency の minor が 2 件、グループ内に不適格メンバーを含むものが 2 件である。
すべて判定 matrix の設計どおりで、意図しない自動マージも、条件を満たしながら止まった PR も無い。

github-actions の 5 件が構造的に自動マージ対象外である点は設計どおりである。
auto-merge ワークフローの preflight が変更ファイルを `package.json` と `pnpm-lock.yaml` に限っているため、workflow ファイルを変更する PR は判定に進まない。

### `packageManager` の pnpm version

Dependabot は 3 週間で一度も更新を提案しなかった。
21 件すべての差分を検査しても `packageManager` への変更は 0 件である。
計画の予測は成り立った。

現在の pin は `pnpm@10.34.5` で、上流の最新は 11.18.0 である。
この値が 9.14.4 から動いたのは 2026-07-22 の人手のコミットで、依存更新とは無関係な作業の副産物だった。
計画が求める四半期ごとの手動確認は、まだ運用として実施されていない。

### UI smoke test

実失敗 1 件、flaky 0 件、誤検知 0 件。
唯一の失敗は #89 の container image 不整合で、環境設定の実不具合を正しく検出した。

lockfile 破損に巻き込まれて UI smoke test の job が落ちた事例は 5 件あるが、いずれも `pnpm install` の段階で停止しており Playwright は起動していない。
テストの品質を示す指標としては失敗に数えない。

### Claude advisory

3 週間で 140 回実行し、成功 139 回、失敗 1 回で成功率は 99.3 %。
rate limit に起因する失敗は無い。

実行時間は二極化している。
preflight で拒否された 92 回は中央値 9 秒、analyze まで到達した 48 回は中央値 184 秒（最長 461 秒）である。
拒否の大半は、workflow が `Build and Check` の完了ごとに起動し、main への push や Dependabot 以外の PR を preflight が正しく弾いた結果である。

コメントは 21 件の Dependabot PR のうち 15 件に投稿された。
投稿されなかった 6 件の理由は 2 つに分かれる。
#38、#39、#41 は導入初日に `--max-turns` の上限に達して出力が空になった。
#72、#82、#88 は 79 秒から 87 秒で自動マージされ、advisory が動く前に PR が閉じた。

内容を 3 件読んだ範囲では、判断に使える具体性がある。
#50 のコメントは、この PR が Dependabot をレビューする特権パイプライン自体の checkout pin を差し替える点を指摘し、他の更新より確認の価値が高いと述べていた。
#77 のコメントは、更新対象のパッケージがコードのどこからも import されていないという事実を指摘していた。
どちらも Dependabot の PR 本文からは導けない指摘である。

タイミングには限界がある。
15 件のうちマージ前に届いたのは 12 件で、#42、#89、#92 の 3 件はマージまたはクローズの後に到着した。
計画はこの順序を許容すると明記しており（自動マージの安全性は決定論的な CI にだけ依存させる設計）、設計どおりの挙動である。

## 継続課題

1. `@playwright/test` 1.62.1 が未適用である。PR #91 の除外設定により、次回の週次実行で個別 PR として届く見込みである。
2. `packageManager` の pnpm が 1 メジャー遅れている。四半期ごとの手動確認を運用に組み込む必要がある。
3. 計画本文と実装が食い違っている箇所が 3 つある。Node.js 22 と 24 の matrix（PR #79 で Node 22 を廃止）、Actions による PR 作成と承認の可否（プレイリスト週次 PR のため有効化済み）、`--max-turns` の値（4 と記載、実装は 12）。いずれも実装が正で、計画の記述が古い。
4. 自動マージのゲート job が、rebase による concurrency キャンセルを failure として記録する。第 1 週に 6 件の監査ノイズを生んだ。マージ可否には影響しない。

## 判断

Renovate へ移行する条件はいずれも満たしていない。
package ecosystem は 2 つのままで、monorepo 化も、独立した lockfile maintenance の必要も生じていない。
Dependabot の運用を継続する。

第 4 週（2026-08-10）の実績を追記した時点で、フェーズ 5 の観測を完了とする。

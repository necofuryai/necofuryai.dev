# 依存更新と自動化の調査

調査日: 2026-09-08
調査時の main: `9e22147c7c1d94fc573d8008f7b11a40a6576e5b`

## Markdown processor の固定更新が遅れた理由

`@astrojs/markdown-remark` の更新が最初の PR に含まれなかった直接の理由は、マイナー更新に設定した7日間の cooldown だった。
Astro 本体はパッチ更新なので3日間の待機で更新対象になり、両者を同時に更新するグループ設定もなかった。
CI は既存の lockfile を検証してビルドする構成で、peer dependency の不一致を必須チェックとして止める処理はなかった。
Claude の参考コメントは最初から不一致を指摘していたが、自動修正やマージ停止を行う役割ではなかった。
以下は公開日時、Dependabot の実行ログ、コメントの編集履歴、当時の workflow に基づく確認結果である。

### 公開日時と Dependabot の選別

当時の設定では npm 更新を月曜日06:00 JSTに確認し、マイナー更新は7日、パッチ更新は3日待つ。
`astro-svelte` グループの対象は `astro`、`@astrojs/svelte`、`svelte` の3件だけで、`@astrojs/markdown-remark` は後続の `catch-all-minor-patch` に分類されていた。
これは更新対象からの除外ではなく、別グループへの振り分けだった。
GitHub の仕様でも、複数グループに一致する依存は最初のグループに入り、cooldown 中のバージョンは更新対象から外れる。[当時の設定](https://github.com/necofuryai/necofuryai.dev/blob/99c4defdbbac04ec154e692d4b0cddfaf432a480/.github/dependabot.yml)、[GitHub のグループ仕様](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference#groups)、[cooldown 仕様](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference#cooldown)

| 出来事 | UTC | JST | 根拠 |
| --- | --- | --- | --- |
| Markdown `7.3.0` 公開 | 2026-08-31 19:38:27.422 | 2026-09-01 04:38:27.422 | [npm registry の `time["7.3.0"]`](https://registry.npmjs.org/@astrojs%2Fmarkdown-remark) |
| Astro `7.2.10` 公開 | 2026-08-31 19:39:50.142 | 2026-09-01 04:39:50.142 | [npm registry の `time["7.2.10"]`](https://registry.npmjs.org/astro) |
| Markdown 更新候補を cooldown で除外 | 2026-09-06 21:05:50 | 2026-09-07 06:05:50 | [Dependabot run 34059847771](https://github.com/necofuryai/necofuryai.dev/actions/runs/34059847771/job/101558295991) |
| Markdown の7日間の待機が終了 | 2026-09-07 19:38:27.422 | 2026-09-08 04:38:27.422 | 公開日時と設定値から計算 |
| 再検査で Markdown `7.3.0` を選択 | 2026-09-08 10:32:55 | 2026-09-08 19:32:55 | [Dependabot run 34215970035](https://github.com/necofuryai/necofuryai.dev/actions/runs/34215970035/job/102027669978) |
| 5件の更新を含む #139 を作成 | 2026-09-08 10:35:09 | 2026-09-08 19:35:09 | [PR #139](https://github.com/necofuryai/necofuryai.dev/pull/139) |

初回の検査は Markdown 公開から6日1時間27分後で、7日間の待機期間内だった。
該当ログには `Checking if @astrojs/markdown-remark 7.2.4 needs updating` に続き、`Filtered out 1 versions due to cooldown` と記録され、選択された版は `7.2.4` だった。
同時刻の Astro `7.2.10` はパッチ更新の3日間を過ぎていたため、#132 に含まれた。
したがって、今回の取りこぼしを cooldown に結び付ける根拠は日時の推測だけでなく、対象パッケージを処理した実行ログにある。[初回更新ログ](https://github.com/necofuryai/necofuryai.dev/actions/runs/34059847771/job/101558295991)、[PR #132 の更新対象](https://github.com/necofuryai/necofuryai.dev/pull/132)

再検査は公開から7日14時間54分後で、ログは最新候補を `7.3.0` として選択している。
Dependabot は更新対象の集合が変わったことを `dependencies_changed` と記録し、4件の #135 を閉じ、Markdown を加えた5件の #139 を作成した。
なお、この run は10:32:12 UTCに始まり、`@dependabot recreate` コメントは10:32:32 UTCに投稿されている。
この時刻関係から、当該コメントだけを run の起動原因と断定することはできない。[再計算ログ](https://github.com/necofuryai/necofuryai.dev/actions/runs/34215970035/job/102027669978)、[recreate コメント](https://github.com/necofuryai/necofuryai.dev/pull/135#issuecomment-5583766650)

最終的に #139 が10:38:47 UTC（19:38:47 JST）に固定版を `7.3.0` へ更新し、#132 が10:43:28 UTC（19:43:28 JST）に Astro を `7.2.10` へ更新した。
現在の組み合わせは Astro の要求範囲 `^7.3.0` を満たしている。[PR #139](https://github.com/necofuryai/necofuryai.dev/pull/139)、[PR #132](https://github.com/necofuryai/necofuryai.dev/pull/132)、[Astro の公開 package metadata](https://registry.npmjs.org/astro/7.2.10)

### CI と参考コメントの役割

当時の CI は `contents: read` で動作し、依存を `pnpm install --frozen-lockfile` で導入していた。
manifest を書き換えて PR を更新する処理はなく、その担当は Dependabot だった。
`--frozen-lockfile` は manifest と lockfile の同期を確認するための指定で、最新の依存バージョンへ更新する指定ではない。[当時の build workflow](https://github.com/necofuryai/necofuryai.dev/blob/8f3031f342bdc614a126516f92b3cbd41f9d3337/.github/workflows/build.yml)、[pnpm install の仕様](https://pnpm.io/cli/install#--frozen-lockfile)

#132 の実際のインストールログでも、依存解決を省略したことと、Markdown `7.2.4` を導入したことが確認できる。
pnpm の `strictPeerDependencies` の既定値は `false` で、リポジトリにも追加の厳格検証はなかった。
今回の不整合は `.md` の描画 API を破壊していなかったため、型検査とビルドの成功だけでは検出できなかった。[CI の実行ログ](https://github.com/necofuryai/necofuryai.dev/actions/runs/34060210631/job/101559274470)、[pnpm v11.20.0 の既定値](https://github.com/pnpm/pnpm/blob/v11.20.0/pnpm11/installing/deps-installer/src/install/extendInstallOptions.ts)、[Markdown processor の変更](https://github.com/withastro/astro/pull/17262)

Claude advisory は、2026-09-06 21:07:49 UTC（2026-09-07 06:07:49 JST）の最初のコメントですでに、Astro が `^7.3.0` を要求する一方で直接依存が `7.2.4` に固定されている点を指摘していた。
これは現在のコメント本文からの推測ではなく、GitHub の編集履歴の最初の版で確認した。
そのため、LLM が不一致を検出しなかったとはいえない。
workflow は出力を参考コメントとして投稿する設計で、指摘を必須チェックの失敗や依存の修正に結び付ける処理を持っていなかった。[advisory コメントの編集履歴](https://github.com/necofuryai/necofuryai.dev/pull/132#issuecomment-5562181285)、[当時の advisory workflow](https://github.com/necofuryai/necofuryai.dev/blob/67ba49ab556b3c1f4f79a395e714175efcb8b5c6/.github/workflows/dependabot-advisory-review.yml)

### 再発防止の検証

pnpm `11.20.0` と Node.js `24` で、当時の #132 と修正後の main から `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` だけを一時ディレクトリへ複製し、次の再現確認を行った。
`.env` とユーザーの `.npmrc` は参照せず、lifecycle script も実行していない。
いずれの試行でも `node_modules` は作成されず、パッケージのダウンロードと追加は0件だった。

| 入力 | 検証コマンドの主要な指定 | 結果 |
| --- | --- | --- |
| #132 `8f3031f`：Astro `7.2.10`、Markdown `7.2.4` | `install --frozen-lockfile --lockfile-only --strict-peer-dependencies --ignore-scripts` | exit 0。不一致を見逃す。 |
| 同じ #132 | `install --resolution-only --no-frozen-lockfile --strict-peer-dependencies --ignore-scripts` | exit 1。`ERR_PNPM_PEER_DEP_ISSUES` で、導入版 `7.2.4` と要求範囲 `^7.3.0` の不一致を検出。 |
| main `9e22147`：Astro `7.2.10`、Markdown `7.3.0` | 同じ `--resolution-only` の指定 | exit 0。peer dependency 検証に成功。 |

`--strict-peer-dependencies` を frozen install に追加するだけでは、今回の再発防止にならない。
依存解決を行う指定なら不一致を検出できるが、修正後の main を検査した際には一時ディレクトリ内の lockfile が書き換わった。
したがって、CI では3ファイルの一時コピーを検証し、検証側の lockfile を元の checkout へ戻さない方法を採る。
`--dry-run` は今回使用した pnpm `11.20.0` では `Unknown option` となったため、対策には採用しない。
これらは実行結果であり、将来 pnpm を更新するときは同じ不整合 fixture と整合済み fixture の両方で再確認する。

最小の再発防止は次の2点である。

1. `astro-svelte` グループへ `@astrojs/markdown-remark` を追加し、互換性を共有する依存を同じ PR に集める。
   ただし、グループへの追加だけではマイナー版の cooldown を解除しないため、同時更新を保証する対策にはならない。[グループと cooldown の仕様](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)
2. 上記の3ファイルを一時ディレクトリへコピーし、`pnpm install --resolution-only --no-frozen-lockfile --strict-peer-dependencies --ignore-scripts` を必須 CI の一部として実行する。
   実際の #132 で失敗し、修正後の main で成功することを確認済みであり、advisory の文章を機械判定する必要はない。

検証対象の fixture は、旧 #132 の要求範囲 `^7.3.0` と固定版 `7.2.4` を保持する不整合例、および固定版を `7.3.0` へ更新した整合例とする。
継続的なテストへ取り込む場合は、終了コードに加えて対象パッケージの不一致を検出したことを確認し、ネットワーク障害や別の依存エラーを検出成功として扱わない。
今回の修正ではグループ追加と、一時コピーを検証する step を `Build and Check` の `Astro Check` job に実装した。
既存の `CI OK` がこの job の成功を要求するため、新しい必須チェック名を branch protection に登録する必要はない。

## fast-uri の自動セキュリティ更新が失敗した理由

Dependabot は修正版の公開を認識していたが、pnpm `11.20.0` へ渡した更新コマンドが間接依存の解決を変更しなかった。
その結果、修正前の `fast-uri 3.1.5` が lockfile に残り、`security_update_not_possible` として終了した。
以下の調査対象は [run 34215615379](https://github.com/necofuryai/necofuryai.dev/actions/runs/34215615379) で、2026-09-08 10:28 UTC（19:28 JST）に実行されたセキュリティ更新である。

### 修正版の取得と更新コマンド

対象リポジトリの依存経路は `ajv@8.20.0 → fast-uri@3.1.5` だった。
Ajv の要求範囲は `^3.0.1` なので、修正版の `3.1.6` と `3.1.7` を導入できる。
調査開始時のリポジトリには `fast-uri` を古い版に固定する override もなかった。[Ajv の package metadata](https://registry.npmjs.org/ajv/8.20.0)、[調査時の lockfile](https://github.com/necofuryai/necofuryai.dev/blob/9e22147c7c1d94fc573d8008f7b11a40a6576e5b/pnpm-lock.yaml)

`3.1.6` の npm 公開日は2026-08-23で、調査対象の run より16日以上前だった。
実行ログでも `fast-uri-3.1.6.tgz` に対する HTTP 200 を記録している。
GitHub の cooldown はセキュリティ更新には適用されず、今回の再現でも待機設定を緩めずに修正版を取得できたため、Markdown 更新と同じ cooldown 問題には分類しない。[npm の公開日時](https://registry.npmjs.org/fast-uri)、[cooldown の適用範囲](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#cooldown)

Dependabot が実行した主要なコマンドは次のとおりだった。

```sh
pnpm update fast-uri@4.1.4 --lockfile-only --no-save -r
```

このコマンドは終了コード0だったが、Dependabot が後で読み取った版は `3.1.5` のままだった。
ジョブの最終結果は、解決可能な版を `3.1.5`、最初の修正版を `3.1.6` とする `security_update_not_possible` だった。
ここで示される「解決可能な版」は当該更新処理の結果であり、Ajv の要求範囲が `3.1.6` を禁止していることを意味しない。[失敗ログ](https://github.com/necofuryai/necofuryai.dev/actions/runs/34215615379)

### 同じ pnpm による最小再現

リポジトリの manifest、lockfile、workspace 設定を一時ディレクトリへ複製し、同じ pnpm `11.20.0` で再現した。
続いて、直接依存を `ajv: "8.20.0"` だけに減らし、Ajv とその依存4件を含む lockfile でも同じ結果を確認した。
すべて `--lockfile-only --no-save -r --ignore-scripts` を付け、lifecycle script と認証設定の読み込みを避けた。

| 更新対象の指定 | pnpm の終了コード | 更新後の fast-uri | 判定 |
| --- | --- | --- | --- |
| `fast-uri@4.1.4` | 0 | `3.1.5` | 更新されない |
| `fast-uri@3.1.6` | 0 | `3.1.5` | 親の要求範囲内でも更新されない |
| `fast-uri@^3.1.6` | 0 | `3.1.5` | 範囲指定でも更新されない |
| `fast-uri` | 0 | `3.1.7` | 親の要求範囲内の修正版へ更新される |

この比較から、原因を「Dependabot が新しいメジャー版を選んだこと」だけでは説明できない。
この pnpm の版では、間接依存にバージョン指定を付けたコマンドが更新を行わず、そのコマンドを使う Dependabot の処理も修正版へ進めなかった。
再現後はコマンドの終了コードだけでなく、lockfile に残った版が修正済みの3系であることを assertion で確認した。
この結果は pnpm `11.20.0` に対する実測であり、他の版まで同じ挙動と断定しない。

## fast-uri の脆弱性対応

今回表示されていた High 4件は、いずれも `3.1.6` で修正されたものだった。

| Dependabot alert | Advisory | 問題 |
| --- | --- | --- |
| [#83](https://github.com/necofuryai/necofuryai.dev/security/dependabot/83) | [GHSA-5jgf-p345-68v8](https://github.com/advisories/GHSA-5jgf-p345-68v8) | scheme-relative URI の IDN 正規化による host confusion |
| [#84](https://github.com/necofuryai/necofuryai.dev/security/dependabot/84) | [GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf) | ホスト名の percent-decoding の重複 |
| [#85](https://github.com/necofuryai/necofuryai.dev/security/dependabot/85) | [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc) | 不正な IPv6 表記の正規化 |
| [#86](https://github.com/necofuryai/necofuryai.dev/security/dependabot/86) | [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp) | percent-encoded scheme の正規化による host confusion |

修正先には `3.1.7` を選んだ。
同じ3系で Ajv の要求範囲を満たし、`3.1.6` の修正に加えて port と IP-literal の検証に関する追加のセキュリティ修正を含むためである。
これは上流が3系の利用者へ推奨している版でもある。[v3.1.7 のリリース](https://github.com/fastify/fast-uri/releases/tag/v3.1.7)

`pnpm-workspace.yaml` に次の override を追加し、lockfile の `fast-uri` を `3.1.5` から `3.1.7` へ更新した。
既存の overrides と他の依存バージョンは保持した。
pnpm による lockfile 再生成で生じた無関係な PostCSS の解決変更は取り込んでいない。

```yaml
overrides:
  "fast-uri@>=3.0.0 <3.1.7": "^3.1.7"
```

修正前後の lockfile を同じ npm audit endpoint で調べた結果、`pnpm audit --json` の High は4件から0件となり、修正後は全 severity が0件だった。
frozen lockfile の検証と、修正済み3系だけが残ることを確認する assertion も成功した。
この override はリポジトリ側の対処であり、Dependabot サービスや pnpm の実装そのものを修正したものではない。
GitHub 上の alert の解消は、main への反映後に別途確認する。

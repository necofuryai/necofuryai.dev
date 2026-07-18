# 依存関係とセキュリティ更新自動化の実装計画

- 調査基準日：2026-07-18
- 対象：`necofuryai/necofuryai.dev`
- 開発フロー：GitHub Flow（既定ブランチは `main`）
- 参考実装：`/Users/masyusakai/necofuryai-personal-website/.github/workflows/*`
- 実装担当：Claude Code
- 採用方式：Dependabot

## 結論

依存ライブラリと GitHub Actions の更新には、GitHub 組み込みの **Dependabot version updates** と **Dependabot security updates** を採用する。

このリポジトリは単一の `package.json` と `pnpm-lock.yaml`、および GitHub Actions だけで構成されている。
Dependabot は pnpm v9、更新グループ、リリース後の cooldown、full-length SHA で固定した GitHub Actions の更新に対応しており、現時点の要件を GitHub 内で完結できる。
[Dependabot が対応するエコシステム](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)

Renovate は採用しない。
Dependency Dashboard、独立した lockfile maintenance、細かな automerge 制御は Renovate の利点だが、現状では Mend Renovate App にコード、Workflow、Pull request、Issue などの書き込み権限を与える追加コストが上回る。
Self-hosted Renovate は App 権限を避けられる一方、bot credential、定期実行基盤、Renovate 自体の更新運用が増えるため、単一 package ecosystem の現状には過剰である。
[Renovate が要求する権限](https://docs.renovatebot.com/security-and-permissions/)

Dependabot と Renovate は併用しない。
同じ依存関係に対する重複 PR と、異なる更新方針による競合を避けるためである。

初期導入では **明示的に許可した direct development dependency の npm patch update だけを自動マージ** し、それ以外は手動で判断する。
自動マージは required checks を迂回せず、`CI OK`、`quality`、`Dependency Review`、`Dependabot Auto-merge Policy` が成功した後に squash merge する。

`CI OK` の内部には Playwright による Visual Regression Testing を追加し、desktop、mobile-width、dark theme の画像差分を自動マージの必須条件にする。
Claude Code の依存更新レビューと画像診断も導入するが、生成モデルの判断、credential、外部 API の可用性をマージ条件には使わず、advisory comment に限定する。

## 現状監査

### リポジトリと GitHub の状態

| 項目 | 2026-07-18 の確認結果 | 目標 |
|---|---|---|
| 既定ブランチ | `main` | 維持 |
| マージ方式 | squash merge のみ | 維持 |
| required checks | `CI OK`、`quality`、`strict=true` | `Dependency Review` と `Dependabot Auto-merge Policy` を追加 |
| conversation resolution | 無効 | 有効化 |
| repository auto-merge | 無効 | CI 強化後に有効化 |
| Dependabot alerts | 無効 | 有効化 |
| Dependabot security updates | 無効 | CI 強化後に有効化 |
| 依存更新 bot | 未導入 | Dependabot に一本化 |
| package manager | `pnpm@9.14.4`、lockfile v9 | 維持し、別途更新状況を監視 |
| package manager guard | `npx only-allow pnpm` | lockfile 外の package を実行しない local script へ置換 |
| GitHub Actions の参照 | すべて full-length SHA と tag コメント | 維持 |
| Actions の SHA pin 強制 | 無効 | 有効化 |
| 実行可能な Actions | すべて許可 | core 六つ、Claude 有効時は推移的依存を含む最大九つだけを許可 |
| `GITHUB_TOKEN` の既定権限 | read-only | 維持 |
| Actions による PR 作成と承認 | 無効 | 維持 |
| Playwright VRT | 未導入 | `CI OK` 配下の blocking job として追加 |
| Claude Code review | 未導入 | CI 後に自動実行する advisory review として追加 |

現在の CI は Node.js 22 と 24 で `pnpm install --frozen-lockfile`、Astro Check、TypeScript type check、Biome、Astro build を実行する。

ただし、`.github/workflows/build.yml` は `pnpm astro build` を実行している。
`package.json` の `pnpm build` に含まれる `pagefind --site dist` は CI で検証されていない。

`.github/workflows/biome.yml` には明示的な `permissions` がない。
リポジトリ既定値は read-only だが、Workflow 側にも `contents: read` を明記する。

### 既存脆弱性

`pnpm audit --audit-level high` は終了コード 1 で、次の結果を返した。

| Severity | 件数 |
|---|---:|
| critical | 1 |
| high | 43 |
| moderate | 25 |
| low | 5 |

監査対象は 1176 dependencies である。
critical の一例は `astro-icon -> @iconify/tools -> axios -> form-data` の経路で検出された。

この件数は npm advisory の現在値であり、GitHub Dependabot alerts の結果と一致するとは限らない。
Dependency graph と Dependabot alerts を有効化した後、双方を照合する。

監査時には Node.js の `DEP0169` deprecation warning も出た。
脆弱性件数の取得は完了しているため導入計画の blocker ではないが、pnpm 更新後も残る場合は別途調査する。

## 目標とする運用

| 更新種別 | PR の作成 | 待機 | grouping | マージ |
|---|---|---|---|---|
| 修正版のある security update | アラート検出後に随時 | cooldown 対象外 | 初期は個別 | 条件を満たす patch だけ自動 |
| npm patch | 毎週月曜 | リリース後 3 日 | 関連パッケージだけ | 条件を満たす個別 PR だけ自動 |
| npm minor | 毎週月曜 | リリース後 7 日 | 関連パッケージだけ | 手動 |
| npm major | 毎週月曜 | リリース後 14 日 | 個別 | 手動 |
| GitHub Actions | 毎日 | リリース後 3 日 | 個別 | 手動 |

Dependabot version updates は既定でも 3 日の cooldown を適用し、security updates には cooldown を適用しない。
本計画では minor と major の待機期間を延ばし、供給網上の問題や早期リグレッションを検出する時間を確保する。
[Dependabot の cooldown](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#cooldown)

security update の PR 作成対象を severity で制限しない。
Dependabot は manifest または lockfile に記録された脆弱な依存関係について、安全な version へ更新できる場合に PR を作成する。
同時に開ける security update PR は内部上限の 10 件であり、`open-pull-requests-limit` では変更できない。
critical と high は PR 作成条件ではなく、対応順序と期限を決める triage 基準として扱う。
[Dependabot security updates の動作](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates)

GitHub Actions には例外がある。
GitHub は semantic version 参照の Action にだけ Dependabot alert を生成し、SHA 参照には alert を生成しない。
本リポジトリは改ざん耐性を優先して SHA 固定を維持するため、Action の脆弱性修正も実質的には version update 経由で受け取る。
検出遅延を抑えるため、GitHub Actions だけは毎日確認し、cooldown を 3 日、open PR 上限を 10 件にする。
[Dependency graph における GitHub Actions の制約](https://docs.github.com/en/code-security/reference/supply-chain-security/dependency-graph-supported-package-ecosystems#supported-package-ecosystems)

全依存関係を一つの PR にまとめない。
Astro、Expressive Code、Tailwind CSS のように互換性を揃える意味がある系列だけを minor と patch でまとめ、major は個別に確認する。
[Dependabot の grouping](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/optimizing-pr-creation-version-updates)

security updates も初期はまとめない。
既存の critical と high が多いため、一括 PR にすると原因と修正効果を追跡しにくい。
ベースライン解消後に PR 数が運用負荷になった場合だけ、`applies-to: security-updates` の group を追加する。
[Dependabot の grouped security updates](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-security-updates)

## GitHub Flow への適合

`.github/dependabot.yml` に `target-branch` を書かない。
Dependabot は省略時に既定ブランチを使うため、version update と security update はどちらも `main` 宛てになる。

`target-branch` を明示すると、その package ecosystem の設定が security updates に適用されなくなる。
このため、`target-branch: main` も追加しない。
[Dependabot の target-branch](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#target-branch)

参考リポジトリからは、関連パッケージの grouping、frozen lockfile を使う CI、最小権限、更新種別ごとの扱い分けだけを採用する。

Playwright の Visual Regression Testing も、`main` 向けの blocking job に作り替えて採用する。
Claude Code review は `develop` 専用 trigger をコピーせず、`main` 向け Dependabot PR の CI 完了後に自動実行する advisory review として採用する。
VRT failure 時だけ expected、actual、diff PNG を追加し、Claude に画像差分の確認箇所を説明させる。
参考実装でも Claude Code review は `continue-on-error` であり、Playwright の pixel diff とは独立している。

次の git-flow 固有実装は採用しない。

- `develop` を更新先にする設定
- `develop` から `main` への promotion Workflow
- 長寿命ブランチ間の drift check
- `develop` を base とする Claude review の trigger と prompt
- major update、GitHub Actions、lockfile の無条件 automerge

通常 PR と Dependabot PR は同じ `main` 向け required checks を通す。
依存更新専用に build Workflow を複製しない。
Claude Code の verdict は `Dependabot Auto-merge Policy` の入力にしない。

## 実装する変更

### 1. `.github/dependabot.yml`

次の設定を初期値とする。

```yaml
version: 2

updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "06:00"
      timezone: "Asia/Tokyo"
    open-pull-requests-limit: 5
    versioning-strategy: "increase-if-necessary"
    cooldown:
      default-days: 7
      semver-major-days: 14
      semver-minor-days: 7
      semver-patch-days: 3
      include:
        - "*"
    labels:
      - "dependencies"
    assignees:
      - "necofuryai"
    commit-message:
      prefix: "chore(deps)"
      prefix-development: "chore(deps-dev)"
    groups:
      astro-svelte:
        applies-to: "version-updates"
        patterns:
          - "astro"
          - "@astrojs/svelte"
          - "svelte"
        update-types:
          - "minor"
          - "patch"
      expressive-code:
        applies-to: "version-updates"
        patterns:
          - "@expressive-code/*"
          - "astro-expressive-code"
        update-types:
          - "minor"
          - "patch"
      tailwind-css:
        applies-to: "version-updates"
        patterns:
          - "tailwindcss"
          - "@tailwindcss/*"
        update-types:
          - "minor"
          - "patch"
      type-definitions:
        applies-to: "version-updates"
        patterns:
          - "@types/*"
        update-types:
          - "minor"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "daily"
      time: "06:30"
      timezone: "Asia/Tokyo"
    open-pull-requests-limit: 10
    cooldown:
      default-days: 3
      include:
        - "*"
    labels:
      - "dependencies"
      - "github-actions"
    assignees:
      - "necofuryai"
    commit-message:
      prefix: "chore(actions)"
```

`versioning-strategy: increase-if-necessary` により、既存 range が新しい version を許容する場合は `package.json` を不要に書き換えず、lockfile の解決結果だけを更新する。
[Dependabot の versioning-strategy](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#versioning-strategy)

Dependabot は同一行の tag コメントが付いた commit 参照を認識して更新できる。
既存の full-length SHA と `# vX.Y.Z` コメントを維持する。
[SHA 固定した GitHub Actions の更新](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories#github-actions)

`dependencies` と `github-actions` label は現在存在しないため、設定を merge する前に作成する。

`astro-svelte` group は Astro 本体、Svelte integration、Svelte 本体だけに限定する。
リリース系列が独立している `@astrojs/check`、`@astrojs/rss`、`@astrojs/sitemap`、`@astrojs/markdown-remark` は、初期運用では個別 PR とする。

`type-definitions` group は minor update だけをまとめる。
allowlist に含める `@types/*` の patch update を個別 PR にし、自動マージの単位を一 dependency に保つためである。

### 2. `.github/workflows/dependency-review.yml`

すべての pull request について、追加または更新される依存関係に moderate 以上の既知脆弱性がないか検査する。
Dependency Review Action は public repository で利用できる。
[GitHub の dependency review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review)

2026-07-18 時点の候補は次のとおりである。
実装直前に各 tag と SHA の対応、および署名状態を公式リポジトリで再確認する。

```yaml
name: Dependency Review

on:
  pull_request:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: dependency-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  dependency-review:
    name: Dependency Review
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false

      - name: Review dependency changes
        uses: actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294 # v5.0.0
        with:
          fail-on-severity: "moderate"
          fail-on-scopes: "runtime, development, unknown"
          license-check: false
```

この検査 Workflow では `pull_request_target` を使わない。
特権を持つイベントで外部 PR のコードを実行する経路を作らないためである。

Dependency Review は base と head の依存関係差分を検査するため、既存の moderate 脆弱性だけを理由にすべての PR を失敗させない。
一方、新規または更新された依存関係が moderate 以上の脆弱性を持つ場合は merge を止める。

ライセンス判定は、許可または禁止するライセンスの方針が未定のため初期スコープから外す。
ライセンス方針を決めた後、独立した変更として有効化する。

GitHub は third-party Action の full-length commit SHA 固定を、不変参照を使う唯一の方法としている。
[GitHub Actions の secure use](https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions)

### 3. `.github/workflows/dependabot-automerge.yml`

Dependabot が作成した単一 dependency の npm patch PR のうち、明示的な allowlist に一致するものだけに GitHub の auto-merge を設定する。
auto-merge は即時マージではなく、branch protection が要求する check をすべて満たした後に GitHub がマージする予約である。
[Dependabot と GitHub Actions による自動化](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions)

Dependabot が `pull_request` Workflow を開始した場合、`GITHUB_TOKEN` は既定で read-only だが、Workflow の `permissions` で必要な scope だけを write に引き上げられる。
GitHub の公式 auto-merge 例と同じく `pull_request` を使い、Dependabot 専用 job だけに `contents: write` と `pull-requests: write` を与える。

`pull_request_target` は使わない。
現行仕様では Dependabot が作成した PR の `pull_request_target` は、明示した `permissions` にかかわらず `GITHUB_TOKEN` が read-only になり、secrets も利用できないためである。
[Dependabot PR の token permission を変更する方法](https://docs.github.com/en/code-security/reference/supply-chain-security/troubleshoot-dependabot/dependabot-on-actions#changing-github_token-permissions)
[Dependabot と GitHub Actions による auto-merge](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions#enabling-automerge-on-a-pull-request)

書き込み権限を持つ job は PR head を checkout せず、PR 由来の script、install、build、test を実行しない。
CI、Dependency Review、Playwright VRT は権限の弱い `pull_request` job で別に実行する。

2026-07-18 時点では `dependabot/fetch-metadata` v3.1.0 の署名済み commit を固定する。
実装直前に tag と SHA の対応、および署名状態を再確認する。

```yaml
name: Dependabot Auto-merge

on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, edited, ready_for_review, converted_to_draft]

permissions:
  contents: read

concurrency:
  group: dependabot-automerge-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  preflight:
    name: Inspect pull request without executing its code
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
      pull-requests: read
    outputs:
      is_dependabot: ${{ steps.inspect.outputs.is_dependabot }}
      manifest_only: ${{ steps.inspect.outputs.manifest_only }}
    steps:
      - name: Inspect author, repository, base, and changed files
        id: inspect
        env:
          GH_TOKEN: ${{ github.token }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          PR_AUTHOR: ${{ github.event.pull_request.user.login }}
          BASE_BRANCH: ${{ github.event.pull_request.base.ref }}
          HEAD_REPOSITORY: ${{ github.event.pull_request.head.repo.full_name }}
        shell: bash
        run: |
          set -euo pipefail

          is_dependabot=false
          manifest_only=false

          if [[ "$PR_AUTHOR" == "dependabot[bot]" &&
                "$BASE_BRANCH" == "main" &&
                "$HEAD_REPOSITORY" == "$GITHUB_REPOSITORY" &&
                "$GITHUB_REPOSITORY" == "necofuryai/necofuryai.dev" ]]; then
            is_dependabot=true

            changed_files_output="$(
              gh api --paginate \
                "/repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/files?per_page=100" \
                --jq '.[].filename'
            )"
            [[ -n "$changed_files_output" ]]
            mapfile -t changed_files <<< "$changed_files_output"

            if (( ${#changed_files[@]} >= 1 && ${#changed_files[@]} <= 2 )); then
              manifest_only=true
              for changed_file in "${changed_files[@]}"; do
                case "$changed_file" in
                  package.json|pnpm-lock.yaml) ;;
                  *) manifest_only=false ;;
                esac
              done
            fi
          fi

          echo "is_dependabot=$is_dependabot" >> "$GITHUB_OUTPUT"
          echo "manifest_only=$manifest_only" >> "$GITHUB_OUTPUT"

  clear:
    name: Clear stale Dependabot auto-merge request
    needs: preflight
    if: needs.preflight.outputs.is_dependabot == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: write
      pull-requests: write
    steps:
      - name: Clear and verify an existing auto-merge request
        id: clear
        env:
          GH_TOKEN: ${{ github.token }}
          PR_URL: ${{ github.event.pull_request.html_url }}
        shell: bash
        run: |
          set -euo pipefail

          for attempt in 1 2 3; do
            if [[ "$(gh pr view "$PR_URL" --json autoMergeRequest --jq '.autoMergeRequest == null')" == "true" ]]; then
              exit 0
            fi

            gh pr merge --disable-auto "$PR_URL" || true
            sleep "$attempt"
          done

          [[ "$(gh pr view "$PR_URL" --json autoMergeRequest --jq '.autoMergeRequest == null')" == "true" ]]

  metadata:
    name: Evaluate Dependabot auto-merge eligibility
    needs: preflight
    if: >-
      needs.preflight.outputs.is_dependabot == 'true' &&
      needs.preflight.outputs.manifest_only == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
      pull-requests: read
    outputs:
      eligible: ${{ steps.policy.outputs.eligible }}
    steps:
      - name: Fetch Dependabot metadata
        id: metadata
        continue-on-error: true
        uses: dependabot/fetch-metadata@25dd0e34f4fe68f24cc83900b1fe3fe149efef98 # v3.1.0
        with:
          github-token: ${{ github.token }}

      - name: Evaluate auto-merge policy
        id: policy
        if: always()
        env:
          METADATA_OUTCOME: ${{ steps.metadata.outcome }}
          IS_DRAFT: ${{ github.event.pull_request.draft }}
          HEAD_REPOSITORY: ${{ github.event.pull_request.head.repo.full_name }}
          DEPENDENCY_NAME: ${{ steps.metadata.outputs.dependency-names }}
          DEPENDENCY_TYPE: ${{ steps.metadata.outputs.dependency-type }}
          UPDATE_TYPE: ${{ steps.metadata.outputs.update-type }}
          DIRECTORY: ${{ steps.metadata.outputs.directory }}
          PACKAGE_ECOSYSTEM: ${{ steps.metadata.outputs.package-ecosystem }}
          TARGET_BRANCH: ${{ steps.metadata.outputs.target-branch }}
          PREVIOUS_VERSION: ${{ steps.metadata.outputs.previous-version }}
          NEW_VERSION: ${{ steps.metadata.outputs.new-version }}
          MAINTAINER_CHANGES: ${{ steps.metadata.outputs.maintainer-changes }}
          DEPENDENCY_GROUP: ${{ steps.metadata.outputs.dependency-group }}
        shell: bash
        run: |
          set -euo pipefail

          deny() {
            echo "eligible=false" >> "$GITHUB_OUTPUT"
            echo "Auto-merge denied by policy."
            exit 0
          }

          [[ "$METADATA_OUTCOME" == "success" ]] || deny
          [[ "$IS_DRAFT" == "false" ]] || deny
          [[ "$HEAD_REPOSITORY" == "$GITHUB_REPOSITORY" ]] || deny
          [[ "$PACKAGE_ECOSYSTEM" == "npm_and_yarn" ]] || deny
          [[ "$DIRECTORY" == "/" ]] || deny
          [[ "$TARGET_BRANCH" == "main" ]] || deny
          [[ "$DEPENDENCY_TYPE" == "direct:development" ]] || deny
          [[ "$UPDATE_TYPE" == "version-update:semver-patch" ]] || deny
          [[ -z "$DEPENDENCY_GROUP" ]] || deny
          [[ "$MAINTAINER_CHANGES" == "false" ]] || deny
          [[ "$PREVIOUS_VERSION" =~ ^v?[1-9][0-9]*\.[0-9]+\.[0-9]+$ ]] || deny
          [[ "$NEW_VERSION" =~ ^v?[1-9][0-9]*\.[0-9]+\.[0-9]+$ ]] || deny

          case "$DEPENDENCY_NAME" in
            "@astrojs/ts-plugin"|"@biomejs/biome"|"@types/hast"|"@types/markdown-it"|"@types/mdast"|"@types/sanitize-html") ;;
            *) deny ;;
          esac

          echo "eligible=true" >> "$GITHUB_OUTPUT"

  enable:
    name: Enable eligible Dependabot auto-merge
    needs: [preflight, clear, metadata]
    if: >-
      needs.clear.result == 'success' &&
      needs.metadata.result == 'success' &&
      needs.metadata.outputs.eligible == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: write
      pull-requests: write
    steps:
      - name: Enable squash auto-merge
        env:
          GH_TOKEN: ${{ github.token }}
          PR_URL: ${{ github.event.pull_request.html_url }}
          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
        shell: bash
        run: |
          set -euo pipefail
          gh pr merge --auto --squash --match-head-commit "$HEAD_SHA" "$PR_URL"
          [[ "$(gh pr view "$PR_URL" --json autoMergeRequest --jq '.autoMergeRequest != null')" == "true" ]]

  result:
    name: Dependabot Auto-merge Policy
    if: always()
    needs: [preflight, clear, metadata, enable]
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions: {}
    env:
      IS_DEPENDABOT: ${{ needs.preflight.outputs.is_dependabot }}
      MANIFEST_ONLY: ${{ needs.preflight.outputs.manifest_only }}
      PREFLIGHT_RESULT: ${{ needs.preflight.result }}
      CLEAR_RESULT: ${{ needs.clear.result }}
      METADATA_RESULT: ${{ needs.metadata.result }}
      ELIGIBLE: ${{ needs.metadata.outputs.eligible }}
      ENABLE_RESULT: ${{ needs.enable.result }}
    steps:
      - name: Require every applicable policy stage to succeed
        shell: bash
        run: |
          set -euo pipefail

          [[ "$PREFLIGHT_RESULT" == "success" ]]

          if [[ "$IS_DEPENDABOT" == "true" ]]; then
            [[ "$CLEAR_RESULT" == "success" ]]
            if [[ "$MANIFEST_ONLY" == "true" ]]; then
              [[ "$METADATA_RESULT" == "success" ]]
              if [[ "$ELIGIBLE" == "true" ]]; then
                [[ "$ENABLE_RESULT" == "success" ]]
              else
                [[ "$ENABLE_RESULT" == "skipped" ]]
              fi
            else
              [[ "$METADATA_RESULT" == "skipped" ]]
              [[ "$ENABLE_RESULT" == "skipped" ]]
            fi
          else
            [[ "$CLEAR_RESULT" == "skipped" ]]
            [[ "$METADATA_RESULT" == "skipped" ]]
            [[ "$ENABLE_RESULT" == "skipped" ]]
          fi
```

`dependabot/fetch-metadata` は、PR 作成者と Dependabot commit の検証を既定で行う。
`skip-verification` と `skip-commit-verification` は指定しない。

`Dependabot Auto-merge Policy` という集約 job を全 PR の required context にする。
通常 PR は read-only の preflight と集約 job だけを通り、Dependabot PR だけが固定 shell の clear job と enable job を通る。
外部 fork の通常 PR に write token を渡さず、同じ required context を報告できる。

changed file が `package.json` と `pnpm-lock.yaml` だけであることを read-only の preflight で確認してから、`dependabot/fetch-metadata` を実行する。
`dependabot/fetch-metadata` と policy 判定は read-only の metadata job に隔離し、write token を持つ enable job では third-party Action、checkout、PR code を実行しない。
これにより、GitHub Actions を更新する Dependabot PR が Workflow 内の Action SHA を変更しても、その PR が提案した Action code を write token と一緒に実行しない。

対象イベントのたびに既存の auto-merge request を最大三回解除し、API で `autoMergeRequest == null` を確認する。
解除確認に失敗した場合は clear job と集約 job が失敗し、古い auto-merge request が残っても branch protection がマージを止める。
最新 head SHA は以前の SHA の成功 check を引き継がないため、maintainer commit の追加時も再判定まで fail-closed になる。

metadata 検証の失敗は自動マージ不適格として扱う。
古い auto-merge request の解除を確認できた場合だけ対象外 PR の policy job を成功させるため、手動マージは妨げない。
[required status checks の性質](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks)

自動マージの初期 allowlist は、現在 `devDependencies` にある次の六件である。

- `@astrojs/ts-plugin`
- `@biomejs/biome`
- `@types/hast`
- `@types/markdown-it`
- `@types/mdast`
- `@types/sanitize-html`

これらの direct development dependency に対する、stable major version 1 以上の個別 patch PR だけを対象にする。
変更ファイルは root の `package.json` と `pnpm-lock.yaml` だけに制限し、direct dependency の lockfile-only update は許可する。
`--match-head-commit` で判定時の head SHA とマージ対象が一致することも要求する。

`dependabot.yml` では `package-ecosystem: "npm"` を使うが、固定した `fetch-metadata` v3.1.0 の出力は Dependabot branch 名に由来する `npm_and_yarn` である。
実装時は `npm` に読み替えず、positive fixture と実際の最初の PR でこの値を確認する。
[fetch-metadata v3.1.0 の package ecosystem 生成処理](https://github.com/dependabot/fetch-metadata/blob/25dd0e34f4fe68f24cc83900b1fe3fe149efef98/src/dependabot/update_metadata.ts)

次の更新は自動マージしない。

- npm minor と major
- 0.x package
- group 化された複数 dependency の更新
- indirect dependency と production dependency
- allowlist 外の dependency
- maintainer が commit を追加または変更した PR
- GitHub Actions
- source、Workflow、設定ファイルを含む PR

`update-type` は SemVer の変更幅を示す値であり、security update と version update の区別には使えない。
そのため、条件を満たす security patch と version patch には同じ自動マージ方針を適用する。
security update を判定できる `alert-state`、`ghsa-id`、`cvss` は `alert-lookup: true` で取得できるが、PAT または GitHub App token が必要になる。
初期実装では長寿命 credential と custom secret を追加しない。
[fetch-metadata の入力と出力](https://github.com/dependabot/fetch-metadata#usage-instructions)

### 4. Playwright Visual Regression Testing

type check、build、HTTP smoke test は、CSS、font、hydration、responsive layout による UI 崩れを検出できない。
Playwright の `toHaveScreenshot()` を追加し、再現可能な pixel diff を `CI OK` の必須条件にする。
[Playwright の visual comparison](https://playwright.dev/docs/test-snapshots)

2026-07-18 時点の候補として `@playwright/test` 1.61.1 を exact version で `devDependencies` に追加する。
`package.json` には `"test:vrt": "playwright test"` を追加し、`playwright-report/` と `test-results/` は Git 管理から除外する。

`@playwright/test` 自体は自動マージ allowlist に含めない。
更新時は package version、Chromium を含む container image、image digest、baseline を同じ手動 PR で確認する。

`playwright.config.ts` の初期値は次のとおりとする。

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/vrt",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  ignoreSnapshots: !process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : "list",
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFileName}/{arg}-{projectName}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4321",
    locale: "ja-JP",
    reducedMotion: "reduce",
    timezoneId: "Asia/Tokyo",
  },
  projects: [
    {
      name: "desktop-light",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        colorScheme: "light",
      },
    },
    {
      name: "mobile-width-light",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        colorScheme: "light",
      },
    },
    {
      name: "desktop-dark",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        colorScheme: "dark",
      },
    },
  ],
  webServer: {
    command: "pnpm preview --host 127.0.0.1 --port 4321",
    url: "http://127.0.0.1:4321/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

参考実装の `maxDiffPixelRatio: 0.01` はコピーしない。
full-page screenshot の一パーセントはページが長いほど許容 pixel 数を増やし、狭い領域の崩れを見逃し得るためである。
初期値は mismatch pixel を許容しない Playwright の既定値とし、実測した rendering noise が残る場合だけ route ごとの小さい `maxDiffPixels` を追加する。

`tests/vrt/pages.spec.ts` では、次の四 route を desktop light、mobile-width light、desktop dark で検査し、合計十二枚の baseline を管理する。
mobile-width project は mobile device emulation ではなく、Chromium の device scale factor を固定したまま 390 x 844 の responsive layout を検査する。

- `/`
- `/about/`
- `/archive/`
- `/posts/hello-world/`

```ts
import { expect, test } from "@playwright/test";

const cases = [
  { path: "/", name: "home", ready: 'a[href="/posts/hello-world/"]' },
  { path: "/about/", name: "about", ready: "main h1" },
  {
    path: "/archive/",
    name: "archive",
    ready: 'a[aria-label="Hello World"]',
  },
  {
    path: "/posts/hello-world/",
    name: "hello-world",
    ready: "#post-container",
  },
] as const;

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    const remoteHttp = (url.protocol === "http:" || url.protocol === "https:") && !local;
    await (remoteHttp ? route.abort() : route.continue());
  });
});

for (const item of cases) {
  test(`visual: ${item.path}`, async ({ page }) => {
    await page.goto(item.path, { waitUntil: "load" });
    await page.locator(item.ready).first().waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      () => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
    );
    await expect(page).toHaveScreenshot(`${item.name}.png`, { fullPage: true });
  });
}
```

外部 network response を baseline に混ぜず、route 固有の visible element、local font、二回の animation frame を待ってから撮影する。
可変要素が見つかった場合は要素の存在を確認してから限定的に mask または `stylePath` で除外し、広い領域を隠さない。
[Playwright の `stylePath`](https://playwright.dev/docs/test-snapshots#stylepath)

baseline PNG は `tests/vrt/__screenshots__/` に commit する。
Dependabot PR 内で `--update-snapshots` を自動実行せず、差分を新しい正解画像で上書きして check を green にしない。
`ignoreSnapshots: !process.env.CI` により、macOS の local run は Linux baseline を比較または生成せず、snapshot の合否は pinned CI container に一本化する。

### 5. `.github/workflows/build.yml`

build job の `pnpm astro build` は `pnpm build` へ変更し、Astro build に加えて Pagefind index の生成まで required CI に含める。

Node.js 24 の build 後に、公開 URL が安定している route と Pagefind index を smoke test する。
記事 URL はコンテンツの追加や削除で変わるため、HTTP smoke test の固定対象にしない。

```yaml
      - name: Smoke test stable routes
        if: matrix.node == 24
        shell: bash
        run: |
          set -euo pipefail

          pnpm astro preview --host 127.0.0.1 --port 4321 &
          preview_pid=$!
          trap 'kill "$preview_pid" 2>/dev/null || true' EXIT

          curl --fail --silent --show-error \
            --retry 20 --retry-connrefused --retry-delay 1 \
            http://127.0.0.1:4321/ > /dev/null

          for route in / /about/ /archive/ /robots.txt /rss.xml; do
            curl --fail --silent --show-error \
              "http://127.0.0.1:4321${route}" > /dev/null
          done

          test -f dist/pagefind/pagefind.js
```

同じ Workflow に `visual-regression` job を追加する。
Playwright package と browser image を同じ 1.61.1 に揃え、container digest まで固定して baseline の実行環境を一定にする。
[Playwright の CI container](https://playwright.dev/docs/ci#via-containers)

```yaml
  visual-regression:
    name: Visual regression test
    runs-on: ubuntu-latest
    timeout-minutes: 15
    container:
      image: mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48
      options: --ipc=host
    steps:
      - name: Checkout
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false

      - name: Setup Node.js
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24

      - name: Setup pnpm
        uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6.0.9
        with:
          run_install: false

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build production site
        run: pnpm build

      - name: Compare screenshots
        id: vrt
        run: pnpm test:vrt

      - name: Upload visual regression evidence
        if: failure() && steps.vrt.outcome == 'failure'
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: vrt-failure-${{ github.run_id }}
          path: |
            playwright-report/
            test-results/
            tests/vrt/__screenshots__/
          if-no-files-found: warn
          retention-days: 7
```

Playwright の browser cache は使わない。
公式文書も、download 時間と大差がなく OS dependency は cache できないため browser binary の cache を推奨していない。
[Playwright の browser caching](https://playwright.dev/docs/ci#caching-browsers)

`CI OK` は `check`、`build`、`visual-regression` のいずれかが `skipped` でも成功扱いにしない。
集約 job の `needs` と判定を次のように変更する。

```yaml
  ci-ok:
    name: CI OK
    if: always()
    needs: [check, build, visual-regression]
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Require all checks to succeed
        env:
          CHECK_RESULT: ${{ needs.check.result }}
          BUILD_RESULT: ${{ needs.build.result }}
          VRT_RESULT: ${{ needs.visual-regression.result }}
        shell: bash
        run: |
          set -euo pipefail
          test "$CHECK_RESULT" = "success"
          test "$BUILD_RESULT" = "success"
          test "$VRT_RESULT" = "success"
```

branch protection には `Visual regression test` を別 context として重複登録せず、既存の required context `CI OK` から推移的に必須化する。
`check` と `build` job には `timeout-minutes: 15` を追加する。
Node.js 22 と 24 の matrix、frozen lockfile、Astro Check、TypeScript type check、`CI OK` の check 名は維持する。
PR code を実行する `check`、`build`、`visual-regression` と `quality` の checkout には `persist-credentials: false` を指定する。

2026-07-18 時点では、`actions/checkout` v7.0.0、`actions/setup-node` v7.0.0、`pnpm/action-setup` v6.0.9 の tag が指す verified commit を上記の SHA で固定する。
既存の `check`、`build`、`quality` job に残る v4 pin も同じ PR でこの三 SHA へ更新し、実装直前に tag、commit、signature を再確認する。
[checkout v7.0.0](https://github.com/actions/checkout/releases/tag/v7.0.0)
[setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0)
[pnpm/action-setup v6.0.9](https://github.com/pnpm/action-setup/releases/tag/v6.0.9)

### 6. `.github/workflows/vrt-update-baselines.yml`

意図した UI 変更と Playwright 更新に使う baseline candidate generator を、書き込み権限のない手動 Workflow として追加する。
この Workflow は runner workspace で snapshot を更新して PNG と changed/new/deleted manifest を artifact にするが、repository への commit、push、PR 作成は行わない。

```yaml
name: Generate VRT baseline candidates

on:
  workflow_dispatch:
    inputs:
      commit_sha:
        description: Full commit SHA to render
        required: true
        type: string

permissions:
  contents: read

jobs:
  generate:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    container:
      image: mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48
      options: --ipc=host
    steps:
      - name: Validate requested commit
        env:
          REQUESTED_SHA: ${{ inputs.commit_sha }}
        shell: bash
        run: |
          set -euo pipefail
          [[ "$REQUESTED_SHA" =~ ^[0-9a-f]{40}$ ]]

      - name: Checkout selected revision
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          ref: ${{ inputs.commit_sha }}
          persist-credentials: false

      - name: Setup Node.js
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24

      - name: Setup pnpm
        uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6.0.9
        with:
          run_install: false

      - name: Install and build
        run: |
          pnpm install --frozen-lockfile
          pnpm build

      - name: Generate candidates
        shell: bash
        run: |
          set -euo pipefail
          pnpm test:vrt --update-snapshots
          git status --short --untracked-files=all -- \
            tests/vrt/__screenshots__/ > "$RUNNER_TEMP/vrt-baseline-manifest.txt"

      - name: Upload candidates
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: vrt-baseline-candidates-${{ github.run_id }}
          path: |
            tests/vrt/__screenshots__/
            ${{ runner.temp }}/vrt-baseline-manifest.txt
          if-no-files-found: error
          retention-days: 7
```

初回導入 PR は baseline がない状態で VRT が一度失敗し、生成された候補 PNG を failure artifact として取得する。
人間が十二枚を確認して同じ PR に commit し、同一 SHA の Workflow を二回実行して差分が再現しないことを確認してから merge する。

通常の baseline 更新も、candidate を確認して対象 branch へ明示的に commit する。
Dependabot PR と baseline generator 自身には repository write token を渡さず、画像更新だけで regression を成功扱いにする経路を作らない。

### 7. `.github/workflows/dependabot-advisory-review.yml`

Claude Code による依存差分レビューと、VRT failure 時の screenshot 診断を自動実行する。
ただし、この Workflow は branch protection の required context にせず、失敗、credential 不在、rate limit、モデルの判断でマージ可否を変更しない。

通常の起点は `Build and Check` 完了後の `workflow_run` とする。
画像診断の初回検証と、通常 PR の VRT failure を owner が調べる用途に限り、source run ID と PR number を必須入力にした `workflow_dispatch` も用意する。
Dependabot PR の `pull_request` 実行では通常の Actions secrets を使えず、`pull_request_target` でも token と secrets が制限されるため、特権処理を別 Workflow に分離する。
[Dependabot が起動する Actions の制約](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions#restrictions-when-dependabot-triggers-events)

```yaml
name: Dependabot Advisory Review

on:
  workflow_run:
    workflows: ["Build and Check"]
    types: [completed]
  workflow_dispatch:
    inputs:
      source_run_id:
        description: Failed Build and Check run ID
        required: true
        type: string
      pull_request_number:
        description: Pull request number associated with the run
        required: true
        type: string

permissions: {}
```

`workflow_run` は secrets と write token を利用できる反面、前段の artifact と PR metadata を untrusted input として扱う必要がある。
GitHub と Anthropic の privileged trigger guidance に従い、次の四 job に分離する。
[GitHub の `workflow_run` event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
[Claude Code Action の privileged trigger guidance](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md#using-this-action-with-pull_request_target-or-workflow_run)

1. `preflight` は `actions: read`、`contents: read`、`pull-requests: read` だけを持ち、起点 event、base、head repository、author、draft、PR number、current head SHA を GitHub API で確認し、API data と source artifact を解釈せず raw bundle として同じ Workflow run へ upload する。
2. `sanitize` は `contents: read` 以外の repository permission、secret、`id-token` を持たず、`persist-credentials: false` で取得した trusted な `main` の sanitizer だけで raw bundle を検査し、再 encode 済みの入力 bundle を同じ Workflow run の artifact として upload する。
3. `analyze` は `actions: read`、`contents: read`、`pull-requests: read`、`id-token: write` を持ち、`persist-credentials: false` で trusted な `main` だけを checkout し、sanitized bundle を `actions/download-artifact` で取得する。
4. `comment` は Claude の structured output を長さ制限付きの body file として一件だけ upsert し、shell command、HTML、artifact 内の file を実行しない。

四 job の filesystem は共有されない前提とし、job 間の file は同一 Workflow run 内の artifact だけで受け渡す。
`preflight` は `claude-raw-input-${{ github.run_id }}` を作成し、`sanitize` は current Workflow run のその artifact だけを取得する。
`sanitize` は `actions/upload-artifact` で `claude-sanitized-input-${{ github.run_id }}` を作成し、`analyze` は current Workflow run の同名 artifact だけを pinned `actions/download-artifact` v8.0.1 で取得する。
download は `actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` に固定する。
bundle には source run ID、PR number、head SHA、各 file の SHA-256 を含む manifest を付け、`analyze` 側でも一致を再検証する。

自動 `workflow_run` の `preflight` は次の全条件を満たす場合だけ `analyze` を許可する。

- 起点 Workflow の event が `pull_request` である。
- base branch が `main` である。
- head repository が `necofuryai/necofuryai.dev` である。
- PR author が `dependabot[bot]` である。
- current head SHA と起点 Workflow の head SHA が一致する。
- PR が draft ではない。

手動 `workflow_dispatch` は `github.actor == 'necofuryai'` を要求する。
`source_run_id` と `pull_request_number` は decimal digit だけを受理し、URL や path として連結する前に正規表現で検証する。
さらに、指定 run がこの repository の `Build and Check`、event が `pull_request`、base が `main`、指定 PR が run に関連付くこと、current head SHA と run の head SHA が一致すること、VRT job が失敗していることを API で再検証する。
入力値だけを信頼せず、条件を満たさない run や PR には credential を使わない。

Claude へ渡す dependency review の入力は、GitHub API から取得した PR diff、Dependabot metadata、required checks の結果、package name、old version、new version、および 64 KiB 以下に切った Dependabot PR body の release note 抜粋に限定する。
PR body、release notes、diff、画像内の文字列は instruction ではなく untrusted data と明記する。
diff は 1 MiB と二千行を上限にし、超過時は内容を切り捨てて「manual review required」とだけ報告する。

`Compare screenshots` step の outcome が `failure` で、`vrt-failure-*` artifact に検証可能な PNG がある場合だけ、expected、actual、diff と短い Playwright error summary を追加する。
install または build で止まり VRT step が `skipped` になった場合は画像診断を行わず、check result の text summary だけを対象にする。
`preflight` は source run に属する exact artifact ID を API で解決し、新しい temporary directory に opaque file として download するが、展開または decode しない。
download 前に artifact name、source run ID、repository、`expired == false`、同名 artifact が一件だけであること、および GitHub API の `size_in_bytes` が 100 MiB 以下であることを検証する。
download は二段階に分ける。
最初の認証付き request は、検証済みの numeric artifact ID を埋め込んだ `https://api.github.com/repos/necofuryai/necofuryai.dev/actions/artifacts/{artifact_id}/zip` だけを対象とし、自動 redirect を無効にする。
GitHub API が返す一件の `302 Location` は、一分だけ有効な外部 blob storage URL になり得るため、HTTPS、userinfo なし、fragment なしを確認してから、Authorization header と cookie を一切付けずに一度だけ取得し、追加 redirect は拒否する。
両 request に connection timeout 十秒、合計 timeout 六十秒を設定し、blob download には受信上限 100 MiB を適用して、完了後も実 file size が 100 MiB 以下であることを確認する。
metadata が欠ける、最初の response が期待する `302` でない、signed URL の形式が不正、転送量が上限を超える、または timeout した場合は、raw bundle を後段へ渡さず診断を skip する。
[GitHub artifact download REST API](https://docs.github.com/en/rest/actions/artifacts#download-an-artifact)
`sanitize` は raw bundle 内の ZIP central directory を展開前に検査し、absolute path、`..`、symlink、file count、圧縮前後 size の上限を拒否してから、固定名の PNG だけを抽出する。
artifact 内の HTML、JavaScript、trace、shell script は Claude job で開かず、Anthropic credential と write token のない `sanitize` job で PNG を decode し、metadata と ancillary chunk を除いた新しい PNG へ再 encode する。
sanitizer の実行 dependency は trusted `main` の frozen lockfile からだけ install し、PR head、PR の package manifest、cache を使わない。
初期上限は PNG 十二件、一件 10 MiB、合計 60 MiB、幅 4,096 pixel、高さ 20,000 pixel、一件 40 megapixel、合計 200 megapixel、plain-text summary 32 KiB とし、超過時は診断を skip する。
decoder には input pixel limit を設定し、一 file ずつ再 encode して memory 使用量を抑える。
十二件を超える場合は route、project、expected、actual、diff の順で決定的に選び、除外件数を text summary に残す。
検証と再 encode を通過した入力だけを sanitized bundle に含め、`analyze` はそれを workspace 内の `.claude-review-input/` に download して Claude へ渡す。

Claude の出力は、更新影響、release note で確認すべき点、画像差分の位置、関連 component の候補、人間の確認事項に限定する。
approve、merge、label、branch update、file edit、baseline 更新、および「自動マージ可能」という verdict は禁止する。
Claude が問題なしと説明しても、失敗した `Visual regression test` と `CI OK` は赤のまま維持する。

`analyze` job の GitHub token は `contents: read` と `pull-requests: read` に制限し、`id-token: write` は付与しない (WIF を使わないため OIDC は不要)。
Anthropic credential は repository Actions secret の `CLAUDE_CODE_OAUTH_TOKEN` を `claude_code_oauth_token` input として渡す。
Claude Code Action の既定 GitHub App token は job-level `permissions` と別物なので使わず、read-only の組み込み token を `github_token` input へ明示的に渡す。
コメント投稿は `pull-requests: write` だけを持つ後段の固定 script に分離し、Claude 自身へ write token を渡さない。
`--allowedTools` は tool の可用性を狭める設定ではないため、それだけに依存しない。
`--tools "Read,Glob,Grep"`、`--permission-mode dontAsk`、`--bare` を併用し、`Bash`、Edit、Write、Web access、Agent、MCP、GitHub tool を model context から外す。
permission settings は default branch の Workflow に固定した JSON を `settings` input へ渡し、PR の `CLAUDE.md`、`.claude/`、plugin、hook を読み込まない。
trusted settings では project 内の `Glob` と `Grep`、および project-relative の `src/**`、package files、Workflow、sanitized input だけを allow にする。
`.git/**`、`.env*`、`.npmrc`、`//proc/**`、`//sys/**`、`//dev/**`、`//etc/**`、`//run/**`、`//tmp/**`、`//github/**`、`//home/runner/.claude/**`、`//home/runner/.config/**`、`//home/runner/.cache/claude/**`、`//home/runner/work/_temp/**` は Read deny にする。
pinned Action は WIF 利用時に `RUNNER_TEMP/claude-workload-identity/identity-token` へ token を書く実装を持つ。本設計では WIF を使わないため書き込みは発生しないが、GitHub-hosted `ubuntu-24.04` の `//home/runner/work/_temp/claude-workload-identity/**` の deny rule は defense in depth として維持する。
`GITHUB_ENV`、`GITHUB_OUTPUT`、`GITHUB_PATH`、`GITHUB_STEP_SUMMARY` が指す `_runner_file_commands` も `//home/runner/work/_temp/**` の deny 対象であることを fixture で確認する。
[Pinned Action の WIF token file 実装](https://github.com/anthropics/claude-code-action/blob/3553f84341b92da26052e28acf1aa898f9511f32/base-action/src/workload-identity.ts)
[Claude Code の permission 設定](https://code.claude.com/docs/en/permissions)
`allowed_bots` と `allowed_non_write_users` はどちらも `dependabot[bot]` だけとし、wildcard は使わない。
`allowed_non_write_users` を明示して Action の environment scrubbing と Linux subprocess isolation を有効にする。
`track_progress`、`show_full_output`、`display_report`、`classify_inline_comments`、`include_fix_links` は `false`、`plugins` と `plugin_marketplaces` は空、`--max-turns` は 4 とする。
repository の `ACTIONS_STEP_DEBUG` が `true` だと full output が有効化されるため、`analyze` は `runner.debug == '1'` の場合に Claude Action を実行せず、管理者確認でも debug secret または variable が未設定であることを確認する。
実装 PR では、実 credential ではない相互に異なる偽 canary を `RUNNER_TEMP/claude-workload-identity/permission-canary`、`RUNNER_TEMP/_runner_file_commands/permission-canary`、process environment、`.env` に配置し、悪意ある PR diff と画像内 prompt からそれらの読み取りを要求する leakage fixture を実行する。
また、Action log、structured output、PR comment のいずれにも OAuth token の接頭辞 `sk-ant-oat` が現れないことを同じ fixture で確認し、GitHub の secret masking と Action の environment scrubbing への依存を実測で裏取りする。
実行前に `RUNNER_TEMP` が GitHub-hosted runner の `/home/runner/work/_temp` と一致することを固定 script で検証し、一致しない runner image では Claude Action を起動しない。
structured output、Action log、PR comment、sanitized artifact のいずれにも canary が現れず、deny rule により読み取りが拒否されたことを確認する。
一つでも漏えいする、または pinned Action と runner image の組み合わせで拒否を再現できない場合、Claude advisory Workflow は merge せず延期する。

structured output は固定 JSON Schema で生成し、UTF-8 byte 数と field 長を検査してから base64 の一行 job output として渡す。
`comment` job はそれを body file へ復号し、`<!-- claude-dependabot-advisory -->` marker を持つ既存 comment を GitHub API で更新する。
投稿直前に PR author と current head SHA を再取得し、sanitized manifest の値と一致しなければ comment を skip する。
固定 renderer は raw HTML、Markdown link、GitHub mention、制御文字、bidi override を escape し、schema の field だけを定型 section へ埋め込む。
LLM 出力を `eval`、shell command、path、API endpoint として解釈しない。
Action failure、schema 不一致、空出力の場合は comment job を skip し、既存の required checks には触れない。

credential は owner の判断 (2026-07-19、Issue #25) により、Max プランに紐づく `CLAUDE_CODE_OAUTH_TOKEN` を repository Actions secret として採用する。
当初案の Workload Identity Federation は Anthropic Console (API クレジット課金) が前提であり、サブスクリプション課金を維持するため見送った。将来 API 課金へ移行する場合は WIF を再評価する。
長寿命 secret を repository に置くことになるため、次を運用条件とする。

- token は owner だけが `claude setup-token` で発行し、`gh secret set` で登録する。token 値は Claude Code との会話にも共有しない。
- secret は Actions secret にだけ置き、Dependabot secrets へは複製しない (Dependabot event の直接実行では advisory を動かさない設計のため不要)。
- token は claude.ai 側でいつでも失効できることを確認し、四半期ごとに rotate する。漏えいの疑いがあれば即時 revoke する。
- `ANTHROPIC_API_KEY` と個人 PAT は引き続き使わない。credential の選択肢は OAuth token 一つに固定する。
- advisory の実行は Max プランの利用枠を消費するため、対話利用への影響が観測されたら `--max-turns` と実行頻度を見直す。
- `--bare` mode と OAuth token の組み合わせは実装時に fixture で動作確認する。

[Claude Code Action の setup](https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md)

2026-07-18 時点の `anthropics/claude-code-action@v1` は `3553f84341b92da26052e28acf1aa898f9511f32` を指していた。
実装時に release、source、tag の指す commit を再確認し、移動可能な `@v1` ではなく full-length SHA を固定する。
この commit と tag は GitHub 上で verified signature を確認できなかったため、採用時は公式 repository の unsigned commit を使う例外として owner が明示的に受容し、受容しない場合は Claude advisory を延期する。
[確認した Claude Code Action commit](https://github.com/anthropics/claude-code-action/commit/3553f84341b92da26052e28acf1aa898f9511f32)

Claude Action の実行は `timeout-minutes: 15` と `continue-on-error: true` にする。
同じ PR と head SHA には marker 付き comment 一件を更新し、`synchronize` ごとにコメントを増殖させない。

自動マージ対象の patch PR は、required checks が先に完了すると Claude comment より前に merge される可能性がある。
初期設計ではこの順序を許容し、自動マージの安全性は deterministic な CI、Dependency Review、VRT にだけ依存させる。
Claude comment の到着を常に merge より先に保証したくなった場合は、モデルの verdict ではなく advisory attempt の完了だけを表す別 check を設計し、外部 API 障害時の timeout と fail-open を独立に検証してから required 化する。

### 8. `.github/workflows/biome.yml`

Workflow 全体に次を追加する。

```yaml
permissions:
  contents: read
```

`quality` job には `timeout-minutes: 10` を追加する。
実行コマンドは repository 全体を対象にする非破壊の `pnpm exec biome ci . --reporter=github` を維持する。

### 9. Node.js と package manager 制約の整合

`README.md` は Node.js 20 以上と記載しているが、現在の Astro 7.1.1 は Node.js 22.12.0 以上を要求し、CI も Node.js 22 と 24 を使っている。

依存更新の判定基準を機械可読にするため、CI 強化 PR で次を行う。

- `package.json` に `engines.node: ">=22.12.0"` を追加する。
- `README.md` のローカル要件を Node.js 22.12.0 以上へ揃える。

これは新しい要件の導入ではなく、現在の実行要件を明文化する変更である。

現在の `preinstall` は `npx only-allow pnpm` を実行する。
`only-allow` は manifest と lockfile に固定されていないため、clean install のたびに registry 上の最新コードを取得して実行し得る。
frozen lockfile の外側にある実行経路をなくすため、外部依存のない local script へ置き換える。

`scripts/check-package-manager.js` を次の内容で追加する。

```js
const userAgent = process.env.npm_config_user_agent ?? "";

if (!userAgent.startsWith("pnpm/")) {
  console.error("This project requires pnpm. Use pnpm install.");
  process.exit(1);
}
```

`package.json` の `preinstall` は `node scripts/check-package-manager.js` に変更する。
この guard は誤操作の防止であり、install script を明示的に無効化する利用者に対する security boundary とはみなさない。

## GitHub 側の管理者操作

ファイル変更だけでは導入は完了しない。
Claude Code が `gh api` などで変更する場合は、外部状態を書き換える前に対象、理由、リスクを提示して承認を得る。

実施順は次のとおりとする。

1. Dependency graph を有効にする。
2. Dependabot alerts を有効にする。
3. Dependabot security updates はまだ無効のままにする。
4. `dependencies` と `github-actions` label を作成する。
5. CI と merge guardrails の PR を merge する。
6. 実行可能な Actions を core automation で使用する六つに限定する。
7. `Require actions to be pinned to a full-length commit SHA` を有効にする。
8. `.github/dependabot.yml` の PR を開く。
9. その PR で `Dependency Review` と `Dependabot Auto-merge Policy` を一度成功させる。
10. この二つを既存 context に追加し、`strict=true` を維持する。
11. `Dependabot Auto-merge Policy` の expected source には GitHub Actions を選ぶ。
12. `Require conversation resolution before merging` を有効にする。
13. critical と high の全 alert に、修正、受容、または期限付き追跡を割り当てる。
14. repository の `Allow auto-merge` を有効にする。
15. `.github/dependabot.yml` の PR を squash merge する。
16. Dependabot security updates を有効にする。

Actions の allowlist は `github_owned_allowed: false`、`verified_allowed: false` とする。
core automation の `patterns_allowed` には `actions/checkout@*`、`actions/setup-node@*`、`actions/dependency-review-action@*`、`actions/upload-artifact@*`、`pnpm/action-setup@*`、`dependabot/fetch-metadata@*` だけを指定する。
Claude advisory を有効にする maintenance window で、`anthropics/claude-code-action@*`、その composite Action が呼ぶ `oven-sh/setup-bun@*`、sanitized bundle 用の `actions/download-artifact@*` を追加する。
固定予定の Claude Action は `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6` を内部で呼ぶため、この verified full SHA も source review の対象にする。
`actions/download-artifact` は verified commit `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` の v8.0.1 に固定する。
実装直前に composite Action と reusable Workflow の `uses:` を再帰的に棚卸しし、未許可または moving ref の推移的依存が一件でもあれば Claude phase を止める。
repository policy の `allowed_actions` は `selected` に変更する。
この二つの管理者操作は同じ作業時間内に連続して行い、直後に既存 Workflow を再実行する。
将来 third-party Action を追加する場合は、Workflow の SHA 固定と allowlist 更新を同じ PR と管理者作業で扱う。
[GitHub Actions permissions REST API](https://docs.github.com/en/rest/actions/permissions#set-allowed-actions-and-reusable-workflows-for-a-repository)

Claude advisory の `CLAUDE_CODE_OAUTH_TOKEN` secret 登録と unsigned Action commit の受容は、ファイル変更では完結しない独立した承認事項である。
どちらも 2026-07-19 に owner が承認済みで、経緯と実施チェックリストは Issue #25 に記録した。secret の発行と登録は owner だけが行う。

Dependabot alerts と security updates は別の機能である。
alerts を先に有効化すれば、即座に自動修正 PR を流さずに既存の脆弱性を可視化できる。
[Dependabot security updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates)

grouped security updates の repository setting は初期段階では有効にしない。
`.github/dependabot.yml` にも security group を定義しない。

既存の required checks である `CI OK` と `quality`、および `strict=true` を保持する。
required check の追加時に既存 context を上書きしない。
conversation resolution も有効にし、未解決の review conversation がある PR を自動マージしない。

`Dependabot Auto-merge Policy` は Workflow が default branch に入った後の PR で初めて発行される。
GitHub は直近七日以内に成功した status check だけを required context の候補にできるため、`.github/dependabot.yml` の PR を観測用に使う。
[required status check の追加条件](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)

auto-merge は required checks と branch protection を迂回しない。
`CI OK`、`quality`、`Dependency Review`、`Dependabot Auto-merge Policy` のいずれかが失敗または未完了なら、対象 PR はマージされない。
[GitHub の auto-merge](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request)

現在は required review 数が 0 であるため、auto-approve Workflow は追加しない。
将来 review を必須にする場合は、`github-actions[bot]` の自己承認で保護を弱めず、自動マージ方針を再設計する。
repository の `Allow GitHub Actions to create and approve pull requests` も無効のまま維持する。

個別の Dependabot PR を一時停止する場合は draft に戻す。
`converted_to_draft` イベントで既存の auto-merge request が解除され、`ready_for_review` で現在の head を再判定する。

Merge Queue は導入しない。
組み込みの `GITHUB_TOKEN` は PR を Merge Queue に追加できず、PAT または GitHub App token が別途必要になるためである。

## 実装手順

### フェーズ 0：再確認と検出経路の有効化

1. `git rev-parse --show-toplevel` と `git status --short --branch` で対象と既存変更を確認する。
2. GitHub の既定ブランチ、merge settings、branch protection、Actions permissions、Dependabot 設定を再取得する。
3. Dependency graph と Dependabot alerts だけを有効にする。
4. `pnpm audit --json` と Dependabot alerts を照合し、critical と high の一覧を作る。
5. 各 critical と high に、修正、受容、または期限付き追跡を割り当てる。
6. 巨大な audit JSON や private な GitHub 応答をリポジトリへ保存しない。

### フェーズ 1：CI と merge guardrails の PR

1. `main` から `feature/dependency-update-guardrails` を作る。
2. `@playwright/test` の exact version、`test:vrt` script、`.gitignore` を追加する。
3. `playwright.config.ts` と四 route の test を追加する。
4. `build.yml` を production build、stable route、Pagefind index、VRT の検証へ変更する。
5. `vrt-update-baselines.yml` を read-only の candidate generator として追加する。
6. `dependency-review.yml` と `dependabot-automerge.yml` を追加する。
7. `biome.yml` の権限と timeout、Node.js 要件、local package manager guard を整合させる。
8. draft pull request を作成する。
9. baseline がない初回 VRT の failure artifact を人間が確認する。
10. 候補 PNG 十二枚を同じ PR へ commit する。
11. 同一 SHA で VRT を二回実行し、flaky な差分が出ないことを確認する。
12. ローカル検証と GitHub 上の VRT artifact 検証を実行する。
13. ready に変更し、`CI OK`、`quality`、`Dependency Review`、`Dependabot Auto-merge Policy` を通す。
14. squash merge する。
15. core automation の六 Action allowlist と full-length SHA pin policy を有効にする。

### フェーズ 2：Claude advisory review

1. current Claude Code Action release、source、full SHA、signature 表示を再確認する。
2. unsigned commit を使う例外を受容するか、owner の判断を記録する。
3. owner が `claude setup-token` で OAuth token を発行し、`gh secret set CLAUDE_CODE_OAUTH_TOKEN` で repository Actions secret に登録する。
4. `anthropics/claude-code-action@*`、`oven-sh/setup-bun@*`、`actions/download-artifact@*` を Actions allowlist に追加する。
5. `main` から `feature/dependabot-advisory-review` を作る。
6. `dependabot-advisory-review.yml`、credentialless sanitizer、fixture test を追加する。
7. non-Dependabot PR、draft、head SHA 不一致、fork が preflight で skip される fixture を確認する。
8. VRT artifact の事前 metadata 上限と transfer timeout、および parser が HTML、trace、script、symlink、path traversal、zip bomb、dimension と pixel 上限超過を拒否し、PNG を metadata なしで再 encode する fixture を確認する。
9. runner command files、process environment、`.env` に置いた非 secret の偽 canary と、実 token の接頭辞 `sk-ant-oat` のいずれも、悪意ある diff と画像内 prompt から output へ取得できない leakage fixture を確認する。
10. この Workflow を required context に追加せず、squash merge する。
11. retention 内に残るフェーズ 1 の初回 VRT failure run と PR number を使い、owner が raw、sanitized、analysis、comment の handoff を手動検証する。
12. expected、actual、diff の三点が初回 artifact にない場合は、owner の承認を得て一時的な visual mismatch PR を作る。
13. Claude が read-only token で画像を分析し、固定 comment job だけが一件の advisory comment を更新し、元の VRT failure を変更しないことを確認する。
14. 一時検証 PR は merge せず閉じ、branch と artifact の retention を確認する。

フェーズ 1 の failure artifact が期限切れの場合も、同じ一時検証 PR を使う。

OAuth token を用意できない場合、unsigned commit の受容が得られない場合、または credential leakage fixture が失敗する場合は、理由を記録してこのフェーズだけを延期する。
core automation と Playwright は credential に依存しないため、次のフェーズへ進める。
Claude Workflow の PR を merge しない場合は、先に追加した三つの Action pattern と登録済みの secret を同じ maintenance window で戻す。

### フェーズ 3：Dependabot 導入 PR

1. `main` から `feature/dependabot` を作る。
2. `.github/dependabot.yml` を追加する。
3. YAML 構文、group の重複、`target-branch` がないことを確認する。
4. pull request を作成する。
5. `Dependency Review` と `Dependabot Auto-merge Policy` が成功することを確認する。
6. この二つを既存 required context に追加し、expected source と `strict=true` を確認する。
7. conversation resolution を有効にする。
8. repository の `Allow auto-merge` を有効にする。
9. すべての required checks を通す。
10. squash merge する。
11. Insights の Dependency graph から Dependabot update logs を確認する。
12. Dependabot security updates を有効にする。

最初の Dependabot PR では、Claude の dependency review comment が一件だけ投稿されることも確認する。

### フェーズ 4：既存脆弱性の解消

1. 自動マージ対象外の security PR を手動で確認する。
2. critical は 24 時間以内、high は 7 日以内の処置判断を初期目標とする。
3. `pnpm why <package>` で vulnerable package を導入する direct dependency を特定する。
4. direct dependency または互換性を共有する package family ごとに小さく修正する。
5. `pnpm audit --fix --force` で一括変更しない。
6. 修正版がない場合は、到達可能性、実行時点、暫定対策、upstream、再評価日を Issue に残す。
7. 各 PR で `pnpm audit` の件数差分と required checks を確認する。

監査 severity だけで exploitability を断定しない。
ただし、build-time dependency であっても CI 上ではコードが実行されるため、理由なく ignore しない。

### フェーズ 5：四週間の観測

次を四回の週次実行で記録する。

- 作成された PR 数
- grouping の妥当性
- CI failure の原因
- 手作業で lockfile または manifest を修正した回数
- 更新後に revert した回数
- 自動マージされた PR 数と手動へ回した PR 数
- `packageManager` の pnpm version が更新対象になるか
- VRT failure、flaky 差分、baseline 更新、誤検知の件数
- Claude advisory の成功率、rate limit、実行時間、comment が判断に役立った件数

Dependabot が `packageManager` field の pnpm version を更新しない場合は、四半期ごとの手動確認を運用に加える。
この不足だけを理由に Renovate と併用しない。

## 検証コマンド

Claude Code は各 PR で、実行したコマンド、終了コード、警告を PR 本文へ記録する。

```bash
git diff --check
ruby -e 'require "yaml"; ARGV.each { |path| YAML.parse_file(path); puts "#{path}: ok" }' \
  .github/dependabot.yml \
  .github/workflows/*.yml
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
env npm_config_user_agent=pnpm/9 node scripts/check-package-manager.js
pnpm install --frozen-lockfile
pnpm exec biome ci . --reporter=github
pnpm astro check
pnpm type-check
pnpm build
pnpm exec playwright test --list
pnpm audit --audit-level high
```

package manager guard の拒否側も確認する。

```bash
env npm_config_user_agent=npm/11 node scripts/check-package-manager.js
```

このコマンドだけは終了コード 1 と、pnpm を要求する message が期待値である。

フェーズ 1 と 2 では `.github/workflows/*.yml` を解析し、フェーズ 3 では `.github/dependabot.yml` も解析対象に加える。
Ruby の parse は YAML 構文だけを確認するため、GitHub expression、event、permission、Action input は actionlint v1.7.12 でも検証する。
[actionlint v1.7.12](https://github.com/rhysd/actionlint/releases/tag/v1.7.12)

`pnpm test:vrt` の合否は、baseline と同じ pinned Playwright container で判定する。
macOS 上の screenshot は OS、font rendering、browser environment が異なるため、CI baseline の更新根拠にしない。
[Playwright の visual comparison](https://playwright.dev/docs/test-snapshots)

`pnpm audit --audit-level high` は既存脆弱性が残る間は終了コード 1 になる。
失敗を無視せず、severity 件数、主要な導入経路、前回からの増減を報告する。

それ以外のコマンドは終了コード 0 を merge 条件とする。

GitHub 側では次を確認する。

- Dependabot PR の base が `main` である。
- npm の security update が週次 schedule と cooldown を待たずに作成される。
- npm の version update が月曜の指定時刻以降に作成される。
- GitHub Actions の version update が毎日の指定時刻以降に確認される。
- SHA 固定した GitHub Actions には Dependabot alert が生成されない制約が運用上明示されている。
- major update が他の update と group 化されない。
- GitHub Actions の PR が full-length SHA と tag コメントを維持する。
- `CI OK`、`quality`、`Dependency Review`、`Dependabot Auto-merge Policy` がすべて required である。
- `CI OK` が `check`、`build`、`visual-regression` の `skipped`、`cancelled`、`failure` を成功扱いしない。
- Node.js 24 で stable route と Pagefind index の smoke test が成功する。
- 四 route と三 project の baseline PNG 十二枚が Git 管理されている。
- VRT failure で expected、actual、diff PNG と Playwright report が七日間の artifact になる。
- baseline candidate Workflow が commit、push、PR 作成を行わない。
- conversation resolution が有効である。
- Dependabot PR へ Actions secrets を渡していない。
- Claude advisory が Dependabot PR と current head SHA だけを対象にし、PR head の code を実行しない。
- Claude Action は read-only GitHub token を使い、comment job だけが `pull-requests: write` を持つ。
- Claude review と screenshot 診断が失敗または省略されても required checks の結論が変わらない。
- Claude の診断 comment が、失敗した VRT を green に変更しない。
- allowlist にある direct development dependency の patch 個別 PR にだけ squash auto-merge が設定される。
- minor、major、0.x、group、indirect、production、GitHub Actions、allowlist 外 package の PR に auto-merge が設定されない。
- manifest と lockfile 以外を変更する PR に auto-merge が設定されない。
- draft 化、maintainer commit、head SHA の変更後は、古い auto-merge request が残っても policy status がマージを止める。
- auto-merge request の解除確認後だけ policy status が success に戻る。
- required check が未完了または失敗している間は、auto-merge が設定済みでも PR がマージされない。

最初の自動マージ候補では、required checks の完了前に `autoMergeRequest` が設定され、merge されていないことを確認する。
checks の成功後に squash merge されたことを確認し、通常の Dependabot PR と同じ CI が実行された証跡を残す。

```bash
gh pr view "$PR_URL" --json autoMergeRequest,mergeStateStatus,statusCheckRollup
```

最初の minor または GitHub Actions PR では、`autoMergeRequest` が `null` のままであることを確認する。

実装前に auto-merge 判定を fixture で検証する。
positive fixture は allowlist 内の `direct:development`、stable 1.x 以上、patch、root npm、変更ファイル二件以内とする。
negative fixture は 0.x、minor、production、indirect、group、maintainer change、allowlist 外、追加ファイル、head SHA 不一致を最低一件ずつ含める。
auto-merge request の解除 API が失敗する fixture では、`Dependabot Auto-merge Policy` が失敗し、merge が拒否されることを確認する。
通常 PR の fixture では同じ context が success になり、Dependabot 専用 policy が通常開発を止めないことを確認する。

## 完了条件

初期実装は、次の条件を満たした時点で完了とする。

- Dependency graph、Dependabot alerts、Dependabot security updates が有効である。
- `.github/dependabot.yml` が npm と GitHub Actions を認識している。
- version update と security update の作成者が Dependabot に一本化されている。
- GitHub Flow に従い、すべての bot PR が `main` を対象にする。
- `CI OK`、`quality`、`Dependency Review`、`Dependabot Auto-merge Policy` が required checks である。
- `CI OK` が `check`、`build`、`visual-regression` の明示的な成功だけを受理する。
- `pnpm build` と stable route smoke test により Pagefind と主要な公開経路が検証される。
- pinned Playwright container で四 route、三 project、十二枚の baseline が比較される。
- baseline 更新は artifact の人間確認と明示 commit を必要とし、Dependabot が自動更新しない。
- conversation resolution が有効である。
- install 時に lockfile 外の `only-allow` を取得して実行しない。
- GitHub Actions の full-length SHA pin が repository setting でも強制される。
- core automation の六つと、承認済みの場合だけ Claude 用の三つを加えた最大九つ以外の Action が allowlist で拒否される。
- `Dependabot Auto-merge Policy` の expected source が GitHub Actions に限定される。
- repository auto-merge が有効であり、対象外 PR には auto-merge が設定されない。
- 自動マージ対象と対象外の Dependabot PR をそれぞれ一件以上観測し、判定と merge 結果が方針どおりである。
- 既存 critical と high の全項目に、修正、受容、または期限付き追跡のいずれかが記録されている。
- 残る失敗と警告が隠されていない。

`pnpm audit` の全 severity がゼロであることは、修正版のない transitive dependency が存在し得るため機械的な完了条件にしない。
critical と high を未分類のまま残さないことを完了条件にする。

Claude advisory phase の完了条件は別に管理する。
OAuth token secret の登録と失効・rotate 手順、full SHA、read-only analysis job、write-only comment job、Dependabot author と head SHA の preflight、artifact の転送上限、credential leakage fixture、comment の重複防止を確認し、VRT failure の PNG 診断が required check を変更しないことを実証した時点で完了とする。
OAuth token を用意できない、credential leakage fixture が失敗する、または unsigned Action commit の受容が得られず延期した場合、core automation は完了扱いにできるが、Claude review と画像診断は未完了として明記する。

## 自動マージ範囲を広げる条件

初期自動マージは、type check、production build、stable route smoke test、Dependency Review、Playwright VRT で異常を検出しやすく、変更幅を限定できる allowlist 内の npm patch 個別 PR だけを対象にする。

allowlist の追加は、少なくとも四週間を観測し、かつ成功した自動マージが十件に達した後に再評価する。
minor、group、0.x package、production dependency を追加する場合は、対象ごとの failure mode、検出可能な test、rollback を独立した PR で記録する。
Astro、Svelte、Tailwind CSS、Sharp、GitHub Actions は上記の観測後も自動マージ範囲へ加えず、個別に再評価する。

security update だけを SemVer 方針と分ける必要が生じた場合は、`alert-lookup` のための GitHub App を設計する。
個人 PAT は失効、権限過多、所有者依存のリスクがあるため既定案にしない。

## Renovate へ移行する条件

次のいずれかが継続的な運用問題になった場合だけ Renovate を再評価する。

- package ecosystem が三つ以上に増える。
- monorepo 化し、複数 directory をまたぐ更新制御が必要になる。
- independent lockfile maintenance が必要になる。
- major update を Dashboard で承認してから PR 化したい。
- package manager version の自動更新が必要になる。
- 十分な CI を整備した後、細かな allowlist automerge が必要になる。

移行時は Dependabot version updates と security updates を止め、Dependabot alerts だけを検出経路として残す。
Renovate の onboarding が完了する前に Dependabot を止めず、セキュリティ通知の空白期間を作らない。

## ロールバック

自動マージを緊急停止する場合は、repository の `Allow auto-merge` を無効にする。
すでに auto-merge が設定された未マージ PR については、対象を列挙して `gh pr merge --disable-auto <PR URL>` を実行する。

Workflow を残す場合は、通常 PR 用の pass-through status も継続するため required context を維持できる。
`.github/workflows/dependabot-automerge.yml` を無効化または削除する場合は、同じ管理時間内に `Dependabot Auto-merge Policy` を required context から外す。
このとき `CI OK`、`quality`、`Dependency Review`、`strict=true` は保持し、required context 全体を上書きしない。
required context を外してから Workflow 削除 PR を merge し、将来の通常 PR が未報告 status で停止する状態を避ける。

通常の version update PR だけを止める場合は、`.github/dependabot.yml` を削除する PR を作る。

security update PR を止める場合でも Dependabot alerts は有効のままにする。
検出経路まで無効にしない。

誤った依存更新を merge した場合は、squash commit を revert する PR を作る。
`package.json` と `pnpm-lock.yaml` は同じ revert に含める。

VRT を緊急停止する場合は、単に test を `continue-on-error` にしない。
原因と影響を Issue に記録し、`visual-regression` job と `CI OK` の `needs` および明示成功判定を同じ PR で変更する。
`CI OK` 自体は required context のまま維持し、復旧条件と期限を決める。

Claude advisory を停止する場合は、claude.ai 側で OAuth token を revoke して repository secret `CLAUDE_CODE_OAUTH_TOKEN` を削除し、Workflow を削除する PR を merge した後に `anthropics/claude-code-action@*`、`oven-sh/setup-bun@*`、`actions/download-artifact@*` を Actions allowlist から外す。
Claude advisory は required context ではないため、branch protection の変更は不要である。
既存 comment は監査記録として残し、credential や provider identifier が含まれていないことを確認する。

Dependency Review が GitHub 側の障害で全 PR を止めた場合は、required check を無言で外さない。
障害、影響、解除時刻、復旧後に戻す条件を Issue に記録したうえで、一時的な保護変更として扱う。

## 公式資料

- [Dependabot supported ecosystems and repositories](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)
- [Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
- [Dependabot version updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates)
- [Dependabot security updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates)
- [Configuring Dependabot security updates](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-security-updates)
- [Dependency graph supported package ecosystems](https://docs.github.com/en/code-security/reference/supply-chain-security/dependency-graph-supported-package-ecosystems)
- [Dependency review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review)
- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use)
- [Automating Dependabot with GitHub Actions](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions)
- [Dependabot on GitHub Actions](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions)
- [dependabot/fetch-metadata](https://github.com/dependabot/fetch-metadata)
- [Automatically merging a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request)
- [About status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks)
- [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)
- [GitHub Actions permissions REST API](https://docs.github.com/en/rest/actions/permissions)
- [GitHub Actions `workflow_run` event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
- [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)
- [Playwright continuous integration](https://playwright.dev/docs/ci)
- [Playwright Docker image](https://playwright.dev/docs/docker)
- [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions)
- [Claude Code Action security](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md)
- [Claude Code Action setup and WIF](https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md)
- [Pinned Claude Code Action definition](https://github.com/anthropics/claude-code-action/blob/3553f84341b92da26052e28acf1aa898f9511f32/action.yml)
- [actions/download-artifact v8.0.1](https://github.com/actions/download-artifact/releases/tag/v8.0.1)
- [oven-sh/setup-bun v2.2.0](https://github.com/oven-sh/setup-bun/releases/tag/v2.2.0)
- [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow)
- [Renovate security and permissions](https://docs.renovatebot.com/security-and-permissions/)
- [Renovate config:best-practices](https://docs.renovatebot.com/presets-config/#configbest-practices)

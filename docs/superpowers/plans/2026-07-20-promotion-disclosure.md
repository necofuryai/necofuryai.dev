# スピーク招待リンク掲載と PR 表記基盤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 収益リンクを含む記事への PR 表記と `rel="sponsored"` 付与の共通基盤を作り、スピーク体験記事の雛形 (draft) を置く。

**Architecture:** frontmatter フラグ `promotion` で記事単位に PR 表記を出し分け、rehype プラグインで指定ドメインへのリンクに `rel` 属性をビルド時に自動付与する。記事雛形は `draft: true` でコミットし、本番ビルドと UI smoke に影響させない。

**Tech Stack:** Astro 7 (unified ベースの Markdown パイプライン)、Zod (content schema)、node:test (unit テスト、追加依存なし)

**Spec:** `docs/superpowers/specs/2026-07-20-promotion-disclosure-design.md`

## Global Constraints

- パッケージマネージャは pnpm 必須。Node.js >= 22.12.0
- Biome がリポジトリ全体を検査する。タブインデント、ダブルクォート (`pnpm lint` で確認)
- 内部リンクは必ず末尾スラッシュ付き (`trailingSlash: "always"`)
- コミットメッセージは英語で `<type>: <description>` 形式
- PR 表記の文言は「本記事はプロモーション (紹介リンク) を含みます」で固定。タイトル直下に表示し、小さすぎる文字や薄い色を避ける (景表法運用基準の明瞭性要件)
- 招待リンクは `https://app.usespeak.com/jp-ja/i/LGZDMD`
- `astro.config.mjs` の unified パイプライン指定を外さない (自作プラグインが Rust プロセッサ非対応)
- ナビゲーションバー (`src/config.ts` の navBarConfig) は変更しない

---

### Task 1: `promotion` frontmatter フラグと記事雛形

**Files:**
- Modify: `src/content.config.ts:11` (draft フィールドの下に promotion を追加)
- Create: `src/content/posts/speak-review.md`

**Interfaces:**
- Produces: `entry.data.promotion: boolean` (default false)。Task 3 が `entry.data.promotion` を条件表示に使う

- [ ] **Step 1: スキーマに promotion フィールドを追加**

`src/content.config.ts` の postsCollection スキーマで、`draft` の行の直後に 1 行追加する。

```ts
		draft: z.boolean().optional().default(false),
		promotion: z.boolean().optional().default(false),
```

- [ ] **Step 2: 記事雛形を生成**

Run: `pnpm new-post speak-review`
Expected: `Post src/content/posts/speak-review.md created`

- [ ] **Step 3: 雛形の内容を全文置換**

`src/content/posts/speak-review.md` を次の内容で上書きする。体験パートの本文は運営者が後日執筆するため、構成と招待リンク部分だけを完成させる。

```markdown
---
title: AI 英会話アプリ「スピーク」を使ってみた (仮)
published: 2026-07-20
description: OpenAI の技術を使った英会話アプリ「スピーク」の体験レビューと、招待リンクによる割引の案内
image: ''
tags: [English, Review]
category: Learning
draft: true
lang: ja
promotion: true
---

<!-- 執筆メモ: 各節の本文は体験に基づいて執筆する。この雛形のまま公開しない -->

## 英語学習の背景

(なぜ英語を学んでいるか、これまでの学習方法を書く)

## スピークの使い方と体験

(実際の使い方と、続けてみた体験を書く)

## 良かった点と合わなかった点

(両方を正直に書く)

## 招待リンク

以下の招待リンクから登録し、7 日以内に年間プラン (プレミアム、プレミアムプラス) を Web ブラウザで決済すると、1,000 円割引が適用されます。

[スピーク招待リンク](https://app.usespeak.com/jp-ja/i/LGZDMD)

:::note
- 割引の対象は年間プランの Web 決済のみです。アプリ内決済では割引が適用されません
- 割引は会員登録後 7 日間有効です
- 特典の内容と条件は 2026 年 7 月時点のものであり、予告なく変更されることがあります
- 招待リンク経由で登録すると、登録したメールアドレスの一部が紹介者 (運営者) に共有されます
- 紹介リンク経由の登録により、運営者に紹介特典が入ります
:::
```

- [ ] **Step 4: スキーマと記事の整合を検証**

Run: `pnpm check`
Expected: エラー 0 件で完了 (`astro check` が frontmatter をスキーマで検証する)

- [ ] **Step 5: Commit**

```bash
git add src/content.config.ts src/content/posts/speak-review.md
git commit -m "feat: add promotion frontmatter flag and speak review draft"
```

---

### Task 2: rehype-sponsored-links プラグイン (TDD)

**Files:**
- Create: `src/plugins/rehype-sponsored-links.mjs`
- Create: `tests/unit/rehype-sponsored-links.test.mjs`
- Modify: `package.json:19` 付近 (scripts に test:unit を追加)
- Modify: `astro.config.mjs` (import 追加と rehypePlugins 登録)

**Interfaces:**
- Produces: `rehypeSponsoredLinks(options: { domains?: string[] })` — hast ツリーの transformer を返す rehype プラグイン。指定ドメインへの `<a>` に `rel="sponsored nofollow noopener"` と `target="_blank"` を付与する

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/rehype-sponsored-links.test.mjs` を作成する。unified パイプラインを組まず、プラグインの transformer に手書きの hast ツリーを渡して検証する (追加依存なし)。

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { rehypeSponsoredLinks } from "../../src/plugins/rehype-sponsored-links.mjs";

function link(href) {
	return {
		type: "element",
		tagName: "a",
		properties: { href },
		children: [],
	};
}

function run(tree, options) {
	rehypeSponsoredLinks(options)(tree);
	return tree;
}

test("adds sponsored rel and target to links on configured domains", () => {
	const tree = {
		type: "root",
		children: [link("https://app.usespeak.com/jp-ja/i/LGZDMD")],
	};
	run(tree, { domains: ["app.usespeak.com"] });
	assert.deepEqual(tree.children[0].properties.rel, [
		"sponsored",
		"nofollow",
		"noopener",
	]);
	assert.equal(tree.children[0].properties.target, "_blank");
});

test("leaves other external links untouched", () => {
	const tree = { type: "root", children: [link("https://example.com/")] };
	run(tree, { domains: ["app.usespeak.com"] });
	assert.equal(tree.children[0].properties.rel, undefined);
	assert.equal(tree.children[0].properties.target, undefined);
});

test("leaves relative links untouched", () => {
	const tree = { type: "root", children: [link("/about/")] };
	run(tree, { domains: ["app.usespeak.com"] });
	assert.equal(tree.children[0].properties.rel, undefined);
});

test("ignores anchors without href", () => {
	const tree = {
		type: "root",
		children: [{ type: "element", tagName: "a", properties: {}, children: [] }],
	};
	run(tree, { domains: ["app.usespeak.com"] });
	assert.equal(tree.children[0].properties.rel, undefined);
});
```

- [ ] **Step 2: package.json に test:unit スクリプトを追加**

`package.json` の scripts で `"test:ui"` の行の直後に追加する。

```json
		"test:unit": "node --test tests/unit/",
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `pnpm test:unit`
Expected: FAIL (`Cannot find module` で rehype-sponsored-links.mjs が未存在)

- [ ] **Step 4: プラグインを実装**

`src/plugins/rehype-sponsored-links.mjs` を作成する。`unist-util-visit` は既存の直接依存。

```js
import { visit } from "unist-util-visit";

/**
 * Adds rel="sponsored nofollow noopener" and target="_blank" to anchors
 * pointing at the given promotion domains, so that paid or referral links
 * are always marked per Google's outbound-link guidance.
 *
 * @param {{ domains?: string[] }} options
 * @returns {(tree: import("hast").Root) => void}
 */
export function rehypeSponsoredLinks(options = {}) {
	const domains = new Set(options.domains ?? []);
	return (tree) => {
		visit(tree, "element", (node) => {
			if (node.tagName !== "a") return;
			const href = node.properties?.href;
			if (typeof href !== "string") return;
			let hostname;
			try {
				hostname = new URL(href).hostname;
			} catch {
				// Relative and invalid URLs cannot be external promotion links.
				return;
			}
			if (!domains.has(hostname)) return;
			node.properties.rel = ["sponsored", "nofollow", "noopener"];
			node.properties.target = "_blank";
		});
	};
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm test:unit`
Expected: PASS (4 tests)

- [ ] **Step 6: astro.config.mjs に登録**

import 群の自作プラグイン部分 (`import { remarkReadingTime } ...` の下) に追加する。

```js
import { rehypeSponsoredLinks } from "./src/plugins/rehype-sponsored-links.mjs";
```

`rehypePlugins` 配列の末尾 (`rehypeAutolinkHeadings` の設定ブロックの後) に追加する。

```js
				[
					rehypeSponsoredLinks,
					{
						// Promotion-link domains: anchors to these hosts get
						// rel="sponsored nofollow noopener" at build time.
						domains: ["app.usespeak.com"],
					},
				],
```

- [ ] **Step 7: dev サーバーで実際の出力を確認**

```bash
pnpm dev &
sleep 8
curl -s http://localhost:4321/posts/speak-review/ | grep -o '<a[^>]*usespeak[^>]*>'
kill %1
```

Expected: 出力に `rel="sponsored nofollow noopener"` と `target="_blank"` が含まれる

- [ ] **Step 8: Commit**

```bash
git add src/plugins/rehype-sponsored-links.mjs tests/unit/rehype-sponsored-links.test.mjs package.json astro.config.mjs
git commit -m "feat: auto-mark promotion links with rel=sponsored"
```

---

### Task 3: PromotionNotice コンポーネントと記事ページ組み込み

**Files:**
- Create: `src/components/PromotionNotice.astro`
- Modify: `src/pages/posts/[...slug].astro:95` 付近 (metadata ブロックの直後)

**Interfaces:**
- Consumes: `entry.data.promotion` (Task 1)
- Produces: `<PromotionNotice class?: string>` — PR 表記の表示コンポーネント

- [ ] **Step 1: コンポーネントを作成**

`src/components/PromotionNotice.astro` を作成する。文言は法的表記のため日本語固定とし、i18n には載せない。可読性はステマ規制運用基準の明瞭性要件を満たすよう、text-sm と /75 の不透明度を下限とする。

```astro
---
interface Props {
	class?: string;
}

const className = Astro.props.class;
---

<!-- Legal disclosure (景表法ステマ規制対応): keep the wording in Japanese
     and keep it clearly readable — do not shrink or fade this text. -->
<div
	class:list={[
		"flex items-center gap-2 rounded-xl border border-[var(--line-divider)] px-4 py-2.5",
		"text-sm text-black/75 dark:text-white/75",
		className,
	]}
>
	本記事はプロモーション (紹介リンク) を含みます
</div>
```

- [ ] **Step 2: 記事ページに組み込む**

`src/pages/posts/[...slug].astro` で、まず import 群 (`import PostMetadata from "../../components/PostMeta.astro";` の下) に追加する。

```astro
import PromotionNotice from "../../components/PromotionNotice.astro";
```

次に metadata ブロックの直後 (`{!entry.data.image && <div class="border-...">}` を含む `</div>` の後、カバー画像の条件式の前) に追加する。

```astro
            {entry.data.promotion && <PromotionNotice class="mb-5 onload-animation" />}
```

- [ ] **Step 3: dev サーバーで表示を確認**

```bash
pnpm dev &
sleep 8
curl -s http://localhost:4321/posts/speak-review/ | grep -c "本記事はプロモーション"
curl -s http://localhost:4321/posts/hello-world/ | grep -c "本記事はプロモーション"
kill %1
```

Expected: speak-review は `1` 以上、hello-world は `0` (grep -c は不一致時に exit 1 を返すが出力 `0` が確認できればよい)

- [ ] **Step 4: 型と整形を確認**

Run: `pnpm check && pnpm lint`
Expected: どちらもエラー 0 件

- [ ] **Step 5: Commit**

```bash
git add src/components/PromotionNotice.astro "src/pages/posts/[...slug].astro"
git commit -m "feat: show promotion notice under post title"
```

---

### Task 4: プライバシーポリシーへの開示追記

**Files:**
- Modify: `src/content/spec/privacy.md` (「免責事項」節の前に追加、末尾の日付に改定日を追記)

**Interfaces:**
- Consumes: なし
- Produces: なし (公開文書の変更のみ)

- [ ] **Step 1: 開示の節を追加**

`src/content/spec/privacy.md` の `## 免責事項` の直前に次を挿入する。

```markdown
## 広告・紹介リンクについて

本サイトの一部の記事には、サービスの友達紹介プログラムによる紹介リンクが含まれます。
紹介リンクを経由してサービスに登録すると、運営者に紹介特典が入ることがあります。
紹介リンクを含む記事には、記事の冒頭にその旨を表記します。

```

- [ ] **Step 2: 改定日を追記**

末尾の `制定日: 2026年7月19日` の直後に 1 行追加する。

```markdown
改定日: 2026年7月20日
```

- [ ] **Step 3: ビルドを確認**

Run: `pnpm build`
Expected: エラーなく完了 (Pagefind のインデックス生成まで通る)

- [ ] **Step 4: Commit**

```bash
git add src/content/spec/privacy.md
git commit -m "docs: add referral link disclosure to privacy policy"
```

---

### Task 5: 総合検証

**Files:**
- なし (検証のみ。修正が出た場合は該当タスクのファイルに戻る)

**Interfaces:**
- Consumes: Task 1〜4 の全成果物

- [ ] **Step 1: 全チェックを実行**

```bash
pnpm lint && pnpm check && pnpm test:unit && pnpm build
```

Expected: すべてエラー 0 件で完了

- [ ] **Step 2: draft 記事が本番ビルドに含まれないことを確認**

```bash
ls dist/posts/ | grep speak-review || echo "not in production build (expected)"
```

Expected: `not in production build (expected)` (draft: true は本番ビルドから除外される)

- [ ] **Step 3: UI smoke をローカル実行**

Run: `pnpm test:ui`
Expected: 全テスト PASS (draft 記事は production preview の対象外)

- [ ] **Step 4: 修正が出た場合はコミット**

修正がなければこのステップはスキップする。修正した場合:

```bash
git add -A
git commit -m "fix: address verification findings"
```

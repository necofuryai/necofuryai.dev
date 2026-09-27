# Contributing

necofuryai.dev への貢献に関心を持っていただきありがとうございます。

## 歓迎する貢献

- **記事の誤りの指摘**: 技術的な間違い・誤字脱字・リンク切れなど。[記事の誤り報告](https://github.com/necofuryai/necofuryai.dev/issues/new?template=01-article-correction.yml) からどうぞ
- **サイト不具合の報告**: 表示崩れ・動作不良など。[サイトの不具合報告](https://github.com/necofuryai/necofuryai.dev/issues/new?template=02-site-issue.yml) からどうぞ
- **typo 修正などの小さな PR**: Issue を立てずに直接 PR を送っていただいて構いません

大きな変更 (機能追加・デザイン変更など) は、作業前に Issue で相談してください。個人ブログという性質上、お受けできない場合があります。

## 開発環境

```sh
pnpm install
pnpm dev        # 開発サーバー
pnpm check      # Astro check
pnpm build      # 本番ビルド
pnpm lint       # Biome (自動修正込み)
pnpm format     # フォーマット
```

PR を送る前に `pnpm check` と `pnpm build` が通ることを確認してください。

## ライセンス

- **コード**: [MIT License](LICENSE) に従います。コードへの貢献は MIT License で提供されたものとみなします (`.claude/skills/` 以下を除く)
- **記事本文** (`src/content/` 以下): [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ja) です。記事本文への貢献は同ライセンスで提供されたものとみなします
- **同梱スキル** (`.claude/skills/` 以下): [cloudflare/skills](https://github.com/cloudflare/skills) から取り込んだもので、[Apache License 2.0](.claude/skills/LICENSE) に従います。このディレクトリへの貢献は Apache License 2.0 で提供されたものとみなします。上流のファイルを改変する場合は、`scripts/cloudflare-skills-manifest.mjs` の `LOCALLY_MODIFIED` に登録し、改変したファイルの冒頭 (frontmatter があればその直後) に変更告知を追加 (既にあれば更新) したうえで、[.claude/skills/README.md](.claude/skills/README.md) の「上流からの改変点」に記録してください

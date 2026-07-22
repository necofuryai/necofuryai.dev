# Apple Music プレイリスト公開方法の調査

- 調査基準日：2026-07-19
- 対象：necofuryai.io/hobbies/ で公開中の Apple Music プレイリスト表示の刷新（necofuryai.dev への移設を想定）
- 対象プレイリスト：`pl.u-gxblk30u5RvoRr`（自作、300 曲）、`pl.rp-lellcVyY1yj`（リプレイ 2026、77 曲）
- 対象スタック：Astro 7、Svelte 5 islands、Tailwind CSS 4、Swup、Cloudflare Workers Static Assets（予定）
- 本ドキュメントの範囲：調査結果と推薦まで。実装は範囲外（実装方針スケッチのみ含む）
- 実測値はすべて 2026-07-19 の計測。API 仕様や規約は変更される可能性がある

## 2026-07-22 追記: 埋め込みプレイヤーの廃止

実装後の見直しにより、クリックで読み込む公式埋め込み iframe は廃止した。
静的なトラックリストに 30 秒プレビューを実装したため、埋め込みプレイヤーは試聴機能と重複し、カードを縦に広げる追加操作になっていた。
ページ内ではトラックリストと 30 秒プレビューを提供し、フル再生は「Apple Music で聴く」リンクに集約する。
以下の候補比較と当初の結論は、2026-07-19 時点の判断記録として残す。

## 2026-07-19 追記: 採用決定

本ドキュメントの調査後に Apple Developer Program へ加入したため、前提が変わり採用構成を次のとおり確定した。

- データ取得は候補 5 の serialized-server-data ではなく、公式 Apple Music API (`GET /v1/catalog/{storefront}/playlists/{id}`) をビルド外スクリプト (`scripts/fetch-playlists.mjs`) で叩く方式に変更した。
  カタログプレイリストの取得は developer token のみで認証され、ユーザーのサインインは不要である ([Get a Catalog Playlist](https://developer.apple.com/documentation/applemusicapi/get-a-catalog-playlist))。
  これにより「規約と法的リスク」で灰色と評価したスクレイピング依存が消える。
- developer token は実行のたびに ES256 で短命 (1 時間) 生成するため、候補 3 の弱点とした 6 ヶ月ローテーション運用は発生しない。
- API レスポンスの `previews[].url` に 30 秒プレビュー URL が含まれるため、候補 4 (iTunes Search API) の併用も不要になった。
  初期実装ではプレビューはデータ保持のみで、プレイヤー UI は実装していない。
- 表示は候補 5 の静的生成 UI + 候補 2 の facade 併設のままで、Artwork オブジェクトの `bgColor` / `textColor1〜4` (optional) をテーマカラーに使う。
- クライアント側 MusicKit JS (候補 3 のフル形態) は、性能面の理由から引き続き不採用。
- `pl.rp-`(リプレイ) がカタログエンドポイントで解決できるかは、資格情報を用いた初回実行時に要確認である。
  取得スクリプトはプレイリスト単位の失敗を許容し、失敗時はコミット済みの前回 JSON を保持する。

## 2026-07-19 時点の結論

プレイリストページは、**ビルド時にトラックリストを取得して静的生成する自作 UI**（候補 5）を軸に作る。
30 秒プレビュー再生は初期実装に含めず、各曲から Apple Music へリンクする構成で始める。
公式埋め込み iframe は廃止せず、クリックで読み込む facade（候補 2）として「Apple Music で聴く」導線と障害時の保険に残す。

この構成は無料で、現状 446 リクエストの初期ロードを 15 前後まで減らし、アートワークと Apple 算出のテーマカラーを使ったサイト統一デザインにできる。
一方、トラックリストの取得手段（music.apple.com ページ内の `serialized-server-data` JSON）は Apple Media Services 利用規約のスクレイピング禁止条項に文言上抵触する。
執行された前例は見つからず、robots.txt もプレイリストページのクロールを許可しているが、リスクの評価は「規約と法的リスク」の節で述べるとおり灰色である。
規約リスクを実質ゼロにしたい場合は、候補 2（facade + 公式 iframe）単体を採用する（undocumented な oEmbed の利用も避けるなら、サムネイルを手動配置すれば完全に白にできる）。

MusicKit JS（候補 3）は採用しない。
フル再生ができる唯一の公式手段だが、Apple Developer Program（99 USD/年）と 6 ヶ月ごとの developer token 再発行が恒久運用として必要になり、非商用の趣味ページに対してコストが釣り合わない。

SaaS ウィジェット（候補 6）は採用しない。
Apple Music プレイリストに実対応するのは SociableKIT のみで、無料プランは表示 100 アイテム上限のため 300 曲を表示できず、解除には 10 USD/月かかる。

## 現状の課題

現行実装は素の iframe を 2 本並べただけの構成である。
`loading` 属性がなく、モバイルでは縦積みになって 2 本目が初期ビューポート外にあるにもかかわらず、両方が即時ロードされる。

```html
<!-- necofuryai-personal-website/src/pages/hobbies.astro（抜粋） -->
<iframe allow="autoplay *; encrypted-media *;" height="450" class="w-full"
  sandbox="..." src="https://embed.music.apple.com/jp/playlist/.../pl.u-gxblk30u5RvoRr"></iframe>
```

DevTools でページロードを実測した結果は次のとおり（デスクトップ、ネットワークスロットリングなし）。

| 項目 | 実測値 |
|---|---|
| 総リクエスト数 | 446 件 |
| 内訳 | 画像 165、XHR/fetch 229、スクリプト 41、document 3、その他 8 |
| うちサイト本体 | 10 件前後（残り約 430 件が埋め込み 2 本由来） |
| 埋め込みの中核 JS | musickit.js v3（gzip 140〜172KB、raw 約 600KB）+ Stencil 製 UI（entry 116KB gzip + チャンク約 17 本） |
| 埋め込み資材の cache-control | `max-age=46〜178`（約 1〜3 分） |
| ページ本体の LCP | 248 ms |

この数字から課題を三つに腑分けできる。

第一に、公式埋め込みは内部で MusicKit JS v3 と Web Components ランタイムを丸ごとロードする本格的なアプリケーションであり、iframe が 2 本あるため実行コンテキストも二重になる。
musickit.js の gzip サイズが計測経路により 140,651 バイトと 172,472 バイトの二通り観測されたのは、配信バージョン（3.2526.0 と 3.2628.0）の差によるとみられる。

第二に、埋め込み資材の cache-control が数分以下のため、再訪問でもほぼ毎回再ダウンロードになる。

第三に、ページ本体の LCP は 248 ms と高速であり、体感の遅さはページではなく iframe 内部の読み込みに由来する。
つまりページ側の最適化では解決せず、埋め込みの読み込み方そのものを変える必要がある。

見た目の面でも、450px 固定の枠が 2 つ並ぶだけでサイトのデザインから独立しており、「魅力的に公開する」という目的に対する自由度がない。

## 候補手法

各候補は「仕組み、コスト、UX、リスク、このリポジトリでの実装イメージ」の順で述べる。

### 1. 公式埋め込み iframe（現状）

`embed.music.apple.com` の iframe を貼るだけの、Apple が明示的にサポートする掲載形態である。
Apple Music Identity Guidelines も公式埋め込みウィジェットの利用を案内している。
[Apple Music Identity Guidelines](https://marketing.services.apple/apple-music-identity-guidelines)

コストはゼロ、実装工数もゼロに近い。
UX 面では、訪問者が Apple Music 購読者ならフル再生、非購読者でも 30 秒プレビューが再生でき、機能面では最も充実している。
リスクは規約面では皆無だが、前節の実測どおり性能面の問題がすべてこの方式に由来する。
比較の基準となるベースラインであり、単体での継続採用は推薦しない。

### 2. 公式 iframe + facade

facade は、埋め込みと同じ見た目の静的要素（サムネイル + 再生ボタン）を先に表示し、クリックされた時点で本物の iframe に差し替える手法である。
YouTube 向けの lite-youtube-embed（スター約 6,300）が代表例で、README は通常埋め込み比で約 224 倍高速と述べている。
[lite-youtube-embed](https://github.com/paulirish/lite-youtube-embed)

Apple Music 専用の facade OSS は GitHub 検索の範囲では存在しない。
汎用の click-to-load ライブラリ vb/lazyframe（スター 384）は任意の iframe に適用できるが、最終更新が 2023 年で実質メンテナンス停止している。
自作する場合のプレースホルダ素材は、music.apple.com の oEmbed エンドポイント（`https://music.apple.com/api/oembed?url=...`）から取得できる。
このエンドポイントは undocumented だが、対象 2 プレイリストの両方でタイトル、300x300 サムネイル、埋め込み iframe HTML を返すことを実測で確認した。
[vb/lazyframe](https://github.com/vb/lazyframe)

`loading="lazy"` だけの緩和は限定的である。
MDN が明記するとおり、ビューポート内にある iframe は `loading="lazy"` を付けてもページロード時に取得されるため、ファーストビューに置く埋め込みの転送は facade でしか防げない。
モバイルで画面外になる 2 本目には効くので、最小工数の応急処置としては意味がある。
[MDN: HTMLIFrameElement.loading](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/loading)

リスクは二つある。
lite-youtube-embed 系では iOS で「1 タップ目は iframe 読み込みのみ、2 タップ目で再生」となる問題が報告されており、自動再生 API を持たない Apple Music embed でも同様の 2 段階操作になる可能性が高い。
また、Lighthouse の third-party-facades 監査は Lighthouse 13 で削除されており、facade はもはや「Lighthouse が推奨する手法」ではない（削除理由は facade 貫通の技術的問題と UX 劣化への懸念）。
転送量削減の効果自体は依然として大きい（YouTube の例で facade 3KB 対プレイヤー 540KB）。
[Lighthouse: third-party-facades](https://developer.chrome.com/docs/lighthouse/performance/third-party-facades)

このリポジトリでは、ビルド時に oEmbed からサムネイルとタイトルを取得して Astro コンポーネントとして静的生成し、クリックで iframe を注入する小さなスクリプトを添える形になる。
規約リスクなしで初期ロードを解決できる、最小工数の改善案である。

### 3. MusicKit JS / Apple Music API

MusicKit on the Web は Apple の公式 JavaScript SDK で、v3 が現行である。
初期化には ES256 署名の developer token が必須で、トークン発行に必要な Media ID と秘密鍵の作成は Apple Developer Program（99 USD/年）のアカウントに実質限定される。
トークンの有効期限は最大 15,777,000 秒（6 ヶ月）のため、静的サイトでは最低 6 ヶ月ごとにトークンを再生成して再デプロイする恒久運用が必要になる。
期限切れトークンでは `MusicKit.configure()` 自体が失敗することが実機で確認されている。
[Generating Developer Tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)

UX は候補中で最も高機能である。
購読者が authorize すればフル再生、未 authorize や非購読者でもプレビュー再生と認証不要のデータ取得ができると v3 ドキュメントに明記されている。
[MusicKit v3 ドキュメント](https://js-cdn.music.apple.com/musickit/v3/docs/index.html)

一方で負担も大きい。
musickit.js 本体は gzip 約 140KB（140,651 バイト）で、ライセンスヘッダにより再ホストが禁止されているため Apple CDN から読む必要があり、その CDN の cache-control も数分以下と短い。
v3 ドキュメントには 2026 年 7 月現在も「Beta Software」の注記が残り、`data-web-components` 属性で有効化できる 8 種の Web Components（apple-music-card-player など）は公式リファレンスが見つからない（v3 ドキュメント本文に解説がない）。
また、developer token のみで購読連携なしのプレビュー専用サイトを運用することが規約の目的規定に適合するかは、開発者フォーラムで質問が出ているが Apple の公式回答が確認できなかった。

このリポジトリでは、Svelte island に MusicKit を組み込む形になるが、年額課金とトークンローテーションという恒久コストが趣味ページの要件に釣り合わない。

### 4. iTunes Search/Lookup API

itunes.apple.com の検索 API は無料かつ認証不要で、曲単位のメタデータ（曲名、アーティスト、アルバム、再生時間、ストア URL、30 秒プレビュー URL、アートワーク URL）を返す。
レート制限は公式に「約 20 calls/分」と明記され、大規模サイトにはキャッシュ実装が推奨されているため、ビルド時取得との相性はよい。
[iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html)

実測で確認した仕様上の注意点が三つある。
lookup の `id` パラメータへのカンマ区切り複数指定は公式ドキュメントに例がなく（公式例があるのは `amgArtistId` など）、実測では 210 件で頭打ちになる undocumented な挙動だった。1 バッチ 150〜200 件に分割するのが安全である。
`country=JP` は事実上必須で、指定なしでは日本ストアの曲 200 件中 21 件（10.5%）がヒットしなかった。
previewUrl は署名や期限パラメータを持たない静的 URL で、2018 年公開の記事に載った URL が 2026 年現在も生きている（8 年生存）ため、ビルド時取得で実用上十分である。

制約は、プレイリストという単位をこの API が扱えないことである。
トラックリスト（曲 ID の一覧）は別の手段で入手する必要があり、単体では成立しない。候補 5 の補完部品として位置づける。

規約面では、プレビューとアートワークは「Promo Content」としてプロモーション目的に限り利用が許諾されており、条件は次のとおり厳格である。

- ストア内コンテンツのプロモーション目的に限定し、プロモーションから独立した娯楽目的で使わない
- コンテンツへ直接リンクする Apple 承認バッジを近接配置する
- プレビュー音源を含む場合は「provided courtesy of iTunes」の帰属表示を付す（現行の Performance Partners 規約では「provided courtesy of Apple」に更新されているが、同プログラムは限られたパートナーのみ受け入れており、非参加の個人にどちらの文言が適用されるかは明文がない）
- プレビューはストリーミングのみで、ダウンロード、保存、キャッシュを禁止（セルフホストは明確に規約違反。API が返す audio-ssl.itunes.apple.com などの配信 URL への直リンク再生が唯一の許容形）

アートワークはキャッシュ禁止条項の対象外だが、再配布の明示許諾もないため、API が返す mzstatic.com URL への直リンクで使うのが最も安全な読みになる。

### 5. serialized-server-data のビルド時取得と静的生成

music.apple.com のプレイリストページの生 HTML には `<script id="serialized-server-data">` として、ページ描画用の JSON がサーバーサイドレンダリングの産物として埋め込まれている。
対象 2 プレイリストで実測したところ、全曲分の曲名、アーティスト、アルバム、再生時間（ミリ秒）、曲 ID（storeAdamID）、ストア URL、アートワーク URL テンプレート（`{w}x{h}bb.{f}` 形式）に加えて、Apple が算出したテーマカラー（bgColor と textColor1〜4）まで含まれていた。
ログインや API キーは不要で、自作プレイリスト（300 曲、JSON 単体で約 1.3MB）とリプレイ 2026（77 曲、ページ HTML 全体で約 545KB。JSON 単体は未計測）の両方で取得できた。
30 秒プレビュー URL は含まれないため、必要なら storeAdamID を候補 4 の lookup に渡して補完する。

ビルド時にこの JSON を取得して静的 HTML に変換すれば、訪問者には画像とマークアップだけが届く。
コストはゼロ、見た目の自由度は最大で、Apple 提供のテーマカラーによるアートワーク連動デザインまで作れる。

運用実態の調査結果は次のとおり。
この手法を production で使う現役実装として navidrome/apple-music-plugin（スター 208、2026-06 更新）があり、同じタグを正規表現でパースしている。
JSON の構造（`data[0].data.sections[*].items[*]`）に変更履歴を追える changelog はなく、無告知で変わるリスクは残る。
GitHub Actions などデータセンター IP からの取得が music.apple.com に特定的にブロックされた報告は見つからず、本調査のデータセンター相当環境からも取得に成功したが、将来の保証はない。
[navidrome/apple-music-plugin](https://github.com/navidrome/apple-music-plugin)

重要な特性は、壊れる場所がビルド時に限られることである。
取得やパースが失敗してもビルドを止めず、リポジトリにコミット済みの前回取得分 JSON にフォールバックすれば、訪問者に障害が露出することはなく、データの鮮度が落ちるだけで済む。

変種として、Apple Music Web が内部で使う `amp-api.music.apple.com` を匿名 Bearer token で叩く手法もある。
トークンはメイン JS バンドルに平文で埋め込まれており正規表現で抽出でき、応答にはプレビュー URL と再生時間がインラインで含まれる。
ただしトークンは約 35 日で失効して月次ローテーションされ、`Origin: https://music.apple.com` ヘッダーがないと 401 になるなど、serialized-server-data より偽装の度合いが強い。
採用するとしても主経路にはせず、言及にとどめる。

リスクは規約面に集中する。
Apple Media Services 利用規約はスクレイピングを明文で禁止しており（詳細は「規約と法的リスク」）、この候補のデータ取得は文言上それに抵触する。
なお、調査エージェントがカタログ編集プレイリスト（Apple 公式の Today's Hits）で計測した際は JSON が約 244KB で再生時間が含まれないという結果であり、本調査のユーザー自作プレイリストの実測と差異があった。
プレイリストの種類によって JSON の内容が異なる可能性があり、実装時には対象プレイリストでの再確認を要する。

### 6. サードパーティ SaaS ウィジェット

Apple Music プレイリストを直接ソースにできる SaaS は、調査した 4 社（SociableKIT、Elfsight、POWR、Common Ninja）のうち SociableKIT のみだった。
Elfsight と POWR の音楽プレイヤーは MP3 アップロードや SoundCloud がソースで、Apple Music はリンクボタン対応にとどまる。
[SociableKIT Apple Music playlist widget](https://www.sociablekit.com/apple-music-playlist-widget/)

SociableKIT の無料プランはブランディング表示、月間 2,000 ビュー、表示 100 アイテム、手動同期という制限があり、300 曲の自作プレイリストは全曲表示できない。
制限解除には Pro プラン（10 USD/月 = 年 120 USD）が必要で、MusicKit の 99 USD/年より高い。
ウィジェット内でプレビュー再生できるかは公式ページから確認できず、公式 iframe に対する機能面の優位も立証できなかった。
第三者への依存（script または iframe の埋め込み）とベンダーロックインを増やす一方で付加価値の根拠がなく、この用途では採用理由がない。

### 7. リンクアウト（静的画像 + リンク）

再生をあきらめ、アートワーク画像と「Listen on Apple Music」バッジだけを置いて Apple Music へ送客する下限の選択肢である。
JS ゼロ、規約リスクゼロ（バッジはガイドライン遵守が条件）で最軽量になる。

部品の調査結果は次のとおり。
Songlink/Odesli はプレイリスト URL に未対応で、Web と API のどちらもエラーを返すことを実測で確認した（対応は songs、albums、podcasts のみ）。
Apple 公式のマーケティングツール（toolbox.marketingtools.apple.com）はプレイリストへの短縮リンク、42 言語の「Listen on Apple Music」バッジ（Web 用 SVG）、QR コードを生成できるが、プレイリスト固有のリンク画像は作れない。
バッジは改変禁止、デジタル最小 30px、オンライン利用時は Apple Music へのリンク必須で、通常の Web 利用に Apple の事前承認は不要である。
サムネイルは候補 2 と同じく oEmbed から取得できる。
[Apple Music マーケティングツール](https://toolbox.marketingtools.apple.com/apple-music)

単体では「魅力的に公開」の要件を満たさないが、候補 5 の各曲リンクやバッジ表示はこの候補の部品を流用する。

## 比較表

評価の重みは、無料であること > 見た目の自由度 > 初期ロード性能 > 保守リスク > 実装工数、の順とする（結論の前提）。
◎○△× の 4 段階で、規約リスクは「明文上の位置づけ」を評価し、執行可能性の議論は次節に委ねる。

| 候補 | 初期転送量 | 金銭コスト | 実装工数 | 保守リスク | 規約リスク | 再生機能 | 見た目の自由度 |
|---|---|---|---|---|---|---|---|
| 1. 公式 iframe（現状） | ×（約 430 リクエスト） | ◎ $0 | ◎ ゼロ | ◎ Apple 管理 | ◎ 公式サポート | ◎ フル/プレビュー | × 固定枠 |
| 2. iframe + facade | ◎（クリックまで数 KB） | ◎ $0 | ○ 小 | ○ oEmbed が undocumented | ◎（oEmbed のみ灰色小） | ◎ クリック後は同上 | △ 枠の外側のみ |
| 3. MusicKit JS | △（gzip 137KB + API） | × $99/年 | △ 中 + token 運用 | △ 6 ヶ月毎に失効、beta | ◎ 公式 SDK | ◎ フル（購読者） | ○ 高い |
| 4. iTunes API 単体 | ◎（静的生成） | ◎ $0 | △ トラックリスト別途 | ○ 公式 API | ○ Promo 条件付き | △ 30 秒のみ | ◎ 最大 |
| 5. 静的生成（本命） | ◎（画像 + HTML のみ） | ◎ $0 | △ 中（取得スクリプト + UI） | △ 構造変更リスク（ビルド時に検知可） | △ ToS 文言抵触の灰色 | △ 30 秒（候補 4 併用時） | ◎ 最大 |
| 6. SaaS（SociableKIT） | △（第三者 script/iframe） | ×（実質 $10/月） | ○ 小 | △ ベンダー依存 | ○ ベンダー責任 | 不明 | △ テンプレート内 |
| 7. リンクアウト | ◎（画像のみ） | ◎ $0 | ○ 小 | ◎ ほぼなし | ◎（バッジ規約のみ） | × なし | ○ 高い |

保守リスクの列は「壊れる場所」の違いが重要である。
候補 5 はビルド時に壊れる（デプロイ前に検知でき、フォールバックで訪問者に露出しない）のに対し、候補 3 のトークン失効と候補 6 のベンダー障害は閲覧時に壊れ、訪問者に直接露出する。

## 規約と法的リスク

候補 5 の成立条件なので、調査結果を主張と出典つきで整理する。

### スクレイピング禁止条項

Apple Media Services 利用規約のセクション F は、「コンテンツや本サービスのいかなる部分もスクレイピング、コピー、測定、分析、監視するために、ソフトウェア、デバイス、自動プロセス、または類似もしくは同等の手動プロセスを使用すること」を明文で禁止している。
日本語版にも同一条項があり、あわせて「本サービスとコンテンツの利用は、個人利用および非商用利用のみに限られます」という目的限定がある（非商用の個人ブログはこの目的限定自体には抵触しない）。
[Apple メディアサービス利用規約（日本語版）](https://www.apple.com/legal/internet-services/itunes/jp/terms.html)

apple.com の Website Terms of Use にも「page-scrape」「robot」等の禁止条項があるが、適用対象は「www.apple.com および Apple がリンクする関連サイト」と定義され、music.apple.com への適用は明示されていない（文書自体の最終更新も 2009 年である）。
[Apple Website Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html)

### 禁止条項と矛盾する側の事実

一方で、music.apple.com の robots.txt はプレイリストページを Disallow しておらず、プレイリスト専用のサイトマップまで公開している。
Apple 自身が検索エンジンによる自動取得を前提にページを公開している、ということである。
また、Apple がこの種の Web ページ取得を理由に個人や小規模サイトへ法的措置やアカウント停止を行った公知の前例は、今回の調査では見つからなかった（見つからないことは存在しないことの証明ではない）。
実務上の防御はレート制限が中心で、開発者フォーラムには毎分 20 リクエスト超で 403 が返るという報告がある。

判例の状況は次のとおり。
米国では Meta v. Bright Data（N.D. Cal. 2024）が、ログオフ状態での公開データ取得には利用規約の契約拘束力が及ばないと判断し、hiQ v. LinkedIn では CFAA（不正アクセス）違反は否定されたものの、アカウント保有者としての規約同意に基づく契約違反は認定された。
日本法では、スクレイピング自体は一律に違法ではなく、対象、方法、利用条件、利用態様で個別判断されるというのが弁護士実務の一般的整理で、曲名やアーティスト名といった事実データの表示自体が著作権侵害になる可能性は低い（アートワークとプレビュー音源の複製は別論点）。
規約違反は著作権と別個の債務不履行（契約）の問題として残る。
[Web スクレイピングの適法性（IT 弁護士解説）](https://www.ys-law.jp/IT/column/column-11384/)

### プレビュー音源とアートワークの利用条件

候補 4 の節で述べた Promo Content 条件がそのまま適用される。
設計に落とすと次の 4 点になる。

1. プレビュー音源は mzstatic / audio-ssl.itunes.apple.com への直リンクでストリーミング再生し、自サイトへの複製（セルフホスト）はしない
2. アートワークは mzstatic への直リンク（ホットリンク）で表示する
3. 「Listen on Apple Music」バッジを近接配置し、各曲とプレイリストから Apple Music へ直接リンクする
4. プレビューを載せる場合は「provided courtesy of iTunes」（または Apple）の帰属表示を添え、UI を「プレイリストの紹介と送客」の体裁に保つ（サイト内で聴き込ませる「独立した娯楽」にしない）

### 総合評価

候補 5 のデータ取得は「執行される現実的可能性は極めて低いが、規約文言には抵触する灰色」と評価する。
灰色の程度を下げる手段は、取得頻度を月数回に抑える、User-Agent を偽装しない、レート制限を尊重する、上記 4 点の Promo Content 条件を守る、の四つである。
灰色自体を許容しない場合の白い経路は、候補 2（facade。ページ取得は undocumented な oEmbed 1 回のみで、それも避けるならサムネイルの手動配置で足りる）と、トラックリストを Music アプリから手動エクスポートして候補 4 で解決する方法（自作プレイリストには可能だが、自動更新されるリプレイ 2026 には現実的でない）である。

## 推薦と条件分岐

```
Q1: Apple Developer Program（99 USD/年）に加入する？
├─ Yes → 候補 3: MusicKit JS（公式・フル再生。token 6 ヶ月ローテの CI 運用を併設）
└─ No → Q2: 規約文言上の灰色（スクレイピング禁止条項への抵触）を許容する？
    ├─ No → 候補 2: facade + 公式 iframe（oEmbed でサムネイル取得、クリックで本物に差し替え）
    └─ Yes → Q3: 30 秒プレビュー再生は必要？
        ├─ No → 候補 5 単体（トラックリスト + テーマカラー UI + 各曲リンクアウト）★第一推薦
        └─ Yes → 候補 5 + 候補 4（storeAdamID → lookup で previewUrl 補完、Promo Content 4 条件を遵守）
```

第一推薦は、Q3 で No から始める段階的な構成である。
プレビュー再生は規約上の制約（帰属表示、バッジ、娯楽目的の禁止）が最も重い部分なので、まずリンクアウト構成で公開し、欲しくなった時点で候補 4 を追加する。
どの分岐でも、公式 iframe の facade を「Apple Music で聴く」ボタンとして併設する。
これはフル再生の受け皿であると同時に、serialized-server-data の構造変更で静的データが陳腐化した際の保険 UI でもある。

## 実装方針スケッチ

第一推薦（候補 5 単体 + facade 併設）を、このリポジトリの既存パターンに合わせて具体化する。
実装 PR の下書きとなる粒度で書くが、本タスクでは実装しない。

### データ層

- `scripts/fetch-playlists.mjs`（新規）：プレイリスト URL 2 件の HTML を取得し、`serialized-server-data` をパースして曲名、アーティスト、アルバム、再生時間、storeAdamID、アートワーク URL テンプレート、テーマカラーを抽出、`src/data/playlists/*.json` に書き出す
- 取得失敗またはスキーマ不一致の場合はエラーで落とさず、コミット済みの前回 JSON を使ってビルドを続行する（鮮度が落ちるだけで訪問者に露出しない）
- 実行は手動または月次の workflow_dispatch とし、`pnpm build` には組み込まない（ビルドの決定性を保ち、CI からの外部アクセスを避ける）
- oEmbed からサムネイルとタイトルも取得し、facade 用データとして同じ JSON に含める

### 表示層

- ページは `src/pages/` に新設し、`MainGridLayout` + `card-base` の既存流儀に従う（[about.astro](../src/pages/about.astro) と [archive.astro](../src/pages/archive.astro) が参照実装）
- プレイリストヘッダー：アートワーク大表示 + Apple 算出の bgColor/textColor を CSS 変数に展開したグラデーション背景 + タイトル + 曲数 + 「Listen on Apple Music」バッジ
- トラックリスト：静的 HTML で最初の 20〜30 曲 + 「すべて表示」で展開（300 曲は `<details>` か Svelte island での展開表示。仮想スクロールが必要になった場合、TanStack Virtual は Svelte 5 未対応の既知 issue があるため virtua 等の代替を検討する）
- 各曲は曲名、アーティスト、再生時間、アートワーク（mzstatic 直リンク、`{w}x{h}` テンプレートから srcset 生成、`loading="lazy"`）を表示し、行全体を Apple Music の曲 URL へリンク
- facade：公式 iframe と同寸のカード（oEmbed サムネイル + 再生ボタン風オーバーレイ）を置き、クリックで iframe に差し替える。スクリプトは [Layout.astro](../src/layouts/Layout.astro) の Swup イディオム（`swup:enable` で初期化、`page:view` で再初期化）に従う

### Swup とテーマの整合

- ページ本文は swup コンテナ内のため、facade の差し替えスクリプトは再訪時にも動くよう Swup フックで登録する（PhotoSwipe の破棄/再生成パターンが参照実装）
- 将来プレビュー再生を足す場合、`content:replace` の before フックで `audio.pause()` と破棄を行い、ページ遷移後に音が鳴り続けることを防ぐ
- テーマカラーは Apple 提供値をそのまま使うとダークモードと衝突しうるため、bgColor を CSS `color-mix()` で既存の hue システムに寄せる補正を検討する

### セキュリティと検証

- 将来 `_headers` で CSP を導入する場合の許可先：`img-src` に `*.mzstatic.com`、`frame-src` に `embed.music.apple.com`、プレビュー導入時は `media-src` に `*.mzstatic.com` と `audio-ssl.itunes.apple.com`
- UI smoke（`tests/ui/pages.spec.ts`）に新ページを追加し、主要要素の表示と操作を semantic assertion で検証する
- 帰属表示：フッターに「Apple and Apple Music are trademarks of Apple Inc., registered in the U.S. and other countries」のクレジットライン、プレビュー導入時は「provided courtesy of iTunes」を追加

## 未解決の論点

- serialized-server-data の JSON 構造が変わる頻度は予測できない（changelog が存在しない）。navidrome plugin の運用履歴が唯一の近い指標で、構造自体の破壊は 2026-06 時点で報告されていない
- カタログ編集プレイリストとユーザー自作プレイリストで JSON の内容（再生時間の有無、サイズ）に差異が観測された。実装時に対象プレイリストで再確認する
- GitHub Actions の runner IP からの取得が長期に安定するかは未検証（本調査のデータセンター相当環境からは成功）
- oEmbed エンドポイントは undocumented であり、規約上の位置づけと長期安定性が不明。ビルド時利用なら失敗検知は容易
- Promo Content の帰属表示文言が、Performance Partners 非参加の個人に対して旧文言（provided courtesy of iTunes）と新文言（provided courtesy of Apple）のどちらで適用されるかは明文がない
- MusicKit をプレビュー専用（購読連携なし）で使うことの規約適合性は Apple の公式回答がない
- facade クリック後の Apple Music iframe が iOS で 2 タップ問題を再現するかは実機検証が必要
- リプレイ 2026 は自動更新されるプレイリストのため、取得頻度（月次で足りるか）は運用しながら判断する

## 公式資料

- [Apple メディアサービス利用規約（日本語版）](https://www.apple.com/legal/internet-services/itunes/jp/terms.html)
- [Apple Media Services Terms（英語版）](https://www.apple.com/legal/internet-services/itunes/)
- [Apple Website Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html)
- [iTunes Search API ドキュメント（アーカイブ）](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html)
- [iTunes Search API パラメータ仕様](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html)
- [Generating Developer Tokens（Apple Music API）](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)
- [Create a media identifier and private key](https://developer.apple.com/help/account/configure-app-capabilities/create-a-media-identifier-and-private-key/)
- [MusicKit v3 ドキュメント](https://js-cdn.music.apple.com/musickit/v3/docs/index.html)
- [Apple Music API: Artwork オブジェクト](https://developer.apple.com/documentation/applemusicapi/artwork)
- [Apple Music Identity Guidelines](https://marketing.services.apple/apple-music-identity-guidelines)
- [Apple Music マーケティングツール](https://toolbox.marketingtools.apple.com/apple-music)
- [Lighthouse: third-party-facades（削除済み監査）](https://developer.chrome.com/docs/lighthouse/performance/third-party-facades)
- [MDN: iframe の loading 属性](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/loading)
- [web.dev: iframe の遅延読み込み](https://web.dev/articles/iframe-lazy-loading)
- [navidrome/apple-music-plugin（serialized-server-data の現役パース実装）](https://github.com/navidrome/apple-music-plugin)
- [lite-youtube-embed](https://github.com/paulirish/lite-youtube-embed)
- [vb/lazyframe](https://github.com/vb/lazyframe)
- [SociableKIT Apple Music playlist widget](https://www.sociablekit.com/apple-music-playlist-widget/)
- [Web スクレイピングの適法性（IT 弁護士解説）](https://www.ys-law.jp/IT/column/column-11384/)

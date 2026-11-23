<script lang="ts">
import { onMount } from "svelte";

import I18nKey from "../i18n/i18nKey";
import { i18n } from "../i18n/translation";
import {
	type ArchiveFilter,
	filterArchivePosts,
	formatArchiveDate,
	groupArchivePostsByYear,
	parseArchiveFilter,
} from "../utils/archive-utils.mjs";
import { getPostUrlBySlug } from "../utils/url-utils";

interface Post {
	slug: string;
	data: {
		title: string;
		tags: string[];
		category: string | null;
		published: Date;
	};
}

interface Props {
	sortedPosts?: Post[];
}

const { sortedPosts = [] }: Props = $props();

// 初期描画 (SSR とハイドレーション初回) は全記事を UTC 基準で表示し、クエリ文字列の
// 絞り込みはハイドレーション後の onMount で反映する。トップレベルで window を参照せず、
// SSR とクライアント初回描画の DOM を一致させるため。
let filter = $state<ArchiveFilter>({
	tags: [],
	categories: [],
	uncategorized: false,
});

const groups = $derived(
	groupArchivePostsByYear(filterArchivePosts(sortedPosts, filter)),
);

function formatTag(tagList: string[]) {
	return tagList.map((t) => `#${t}`).join(" ");
}

onMount(() => {
	const nextFilter = parseArchiveFilter(window.location.search);
	if (
		nextFilter.tags.length > 0 ||
		nextFilter.categories.length > 0 ||
		nextFilter.uncategorized
	) {
		filter = nextFilter;
	}
});
</script>

<div class="card-base px-8 py-6">
    {#each groups as group (group.year)}
        <div>
            <div class="flex flex-row w-full items-center h-[3.75rem]">
                <div class="w-[15%] md:w-[10%] transition text-2xl font-bold text-right text-75">
                    {group.year}
                </div>
                <div class="w-[15%] md:w-[10%]">
                    <div
                            class="h-3 w-3 bg-none rounded-full outline outline-[var(--primary)] mx-auto
                  -outline-offset-[2px] z-50 outline-3"
                    ></div>
                </div>
                <div class="w-[70%] md:w-[80%] transition text-left text-50">
                    {group.posts.length} {i18n(group.posts.length === 1 ? I18nKey.postCount : I18nKey.postsCount)}
                </div>
            </div>

            {#each group.posts as post (post.slug)}
                <a
                        href={getPostUrlBySlug(post.slug)}
                        aria-label={post.data.title}
                        class="group btn-plain block! h-10 w-full rounded-lg hover:text-[initial]"
                >
                    <div class="flex flex-row justify-start items-center h-full">
                        <!-- date -->
                        <div class="w-[15%] md:w-[10%] transition text-sm text-right text-50">
                            {formatArchiveDate(post.data.published)}
                        </div>

                        <!-- dot and line -->
                        <div class="w-[15%] md:w-[10%] relative dash-line h-full flex items-center">
                            <div
                                    class="transition-all mx-auto w-1 h-1 rounded-sm group-hover:h-5
                       bg-[oklch(0.5_0.05_var(--hue))] group-hover:bg-[var(--primary)]
                       outline outline-4 z-50
                       outline-[var(--card-bg)]
                       group-hover:outline-[var(--btn-plain-bg-hover)]
                       group-active:outline-[var(--btn-plain-bg-active)]"
                            ></div>
                        </div>

                        <!-- post title -->
                        <div
                                class="w-[70%] md:max-w-[65%] md:w-[65%] text-left font-bold
                     group-hover:translate-x-1 transition-all group-hover:text-[var(--primary-text)]
                     text-75 pr-8 whitespace-nowrap text-ellipsis overflow-hidden"
                        >
                            {post.data.title}
                        </div>

                        <!-- tag list -->
                        <div
                                class="hidden md:block md:w-[15%] text-left text-sm transition
                     whitespace-nowrap text-ellipsis overflow-hidden text-30"
                        >
                            {formatTag(post.data.tags)}
                        </div>
                    </div>
                </a>
            {/each}
        </div>
    {/each}
</div>

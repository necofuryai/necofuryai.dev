<script lang="ts">
import { AUTO_MODE, DARK_MODE, LIGHT_MODE } from "@constants/constants.ts";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import Icon from "@iconify/svelte";
import {
	applyThemeToDocument,
	getStoredTheme,
	setTheme,
} from "@utils/setting-utils.ts";
import { onMount } from "svelte";
import type { LIGHT_DARK_MODE } from "@/types/config.ts";

const seq: LIGHT_DARK_MODE[] = [LIGHT_MODE, DARK_MODE, AUTO_MODE];
let mode = $state<LIGHT_DARK_MODE>(AUTO_MODE);
let panelOpen = $state(false);
let schemeSwitchButton = $state<HTMLButtonElement | undefined>();

onMount(() => {
	mode = getStoredTheme();
	const darkModePreference = window.matchMedia("(prefers-color-scheme: dark)");
	const changeThemeWhenSchemeChanged: Parameters<
		typeof darkModePreference.addEventListener<"change">
	>[1] = (_e) => {
		applyThemeToDocument(mode);
	};
	darkModePreference.addEventListener("change", changeThemeWhenSchemeChanged);
	return () => {
		darkModePreference.removeEventListener(
			"change",
			changeThemeWhenSchemeChanged,
		);
	};
});

function switchScheme(newMode: LIGHT_DARK_MODE) {
	mode = newMode;
	setTheme(newMode);
}

function toggleScheme() {
	let i = 0;
	for (; i < seq.length; i++) {
		if (seq[i] === mode) {
			break;
		}
	}
	switchScheme(seq[(i + 1) % seq.length]);
}

// パネルは閉じている間も opacity: 0 になるだけでタブ順に残るため、
// フォーカスが入ってきた時点で開く。開かないままだと、キーボード利用者は
// 見えないボタンにフォーカスが乗った状態になる (WCAG 2.4.7 Focus Visible)。
//
// 開閉を切り替えるのはフォーカスがこのコンポーネントを出入りしたときだけで、
// 内部での移動 (トグルボタン <-> パネル内のボタン) では何もしない。
// これにより Escape で閉じた直後にトグルボタンへフォーカスを戻しても、
// その focusin でパネルが開き直してしまうことがない。
function handleFocusIn(event: FocusEvent) {
	const wrapper = event.currentTarget as HTMLElement;
	const previous = event.relatedTarget;
	if (previous instanceof Node && wrapper.contains(previous)) return;
	panelOpen = true;
}

function handleFocusOut(event: FocusEvent) {
	const wrapper = event.currentTarget as HTMLElement;
	// relatedTarget は次にフォーカスを受け取る要素。ドキュメント外へ出た場合は null。
	const next = event.relatedTarget;
	if (next instanceof Node && wrapper.contains(next)) return;
	panelOpen = false;
}

function handleMouseLeave(event: MouseEvent) {
	const wrapper = event.currentTarget as HTMLElement;
	// パネル内のボタンをクリックするとフォーカスがそこに残る。そのまま閉じると
	// 見えない要素にフォーカスリングが乗るので、開く起点のボタンへ戻してから閉じる。
	if (wrapper.contains(document.activeElement)) {
		schemeSwitchButton?.focus();
	}
	panelOpen = false;
}

function handleKeyDown(event: KeyboardEvent) {
	if (event.key !== "Escape") return;
	panelOpen = false;
	schemeSwitchButton?.focus();
}
</script>

<!-- z-50 make the panel higher than other float panels -->
<!-- ARIA の menu ロールは付けない。menu は子に menuitem 系しか許さない
     (Lighthouse の aria-required-children に落ちる) うえ、矢印キーでの移動や
     Escape での閉じるといった menu ウィジェットの操作も実装していない。
     ここはトグルボタンとテーマ選択ボタンの並びでしかないので、
     ネイティブの button のセマンティクスをそのまま使う。 -->
<!-- biome-ignore lint/a11y/noStaticElementInteractions: この div 自体は操作対象ではなく、
     内側の button 群を出入りするホバーとフォーカスをまとめて受けるためだけに
     ハンドラを持つ (focusin / focusout は bubble するのでここで拾える)。
     操作は内側の button が担う。ルールを黙らせる目的でロールを足すと
     (以前の role="menu" がまさにそれ) 支援技術に誤ったセマンティクスを渡すことになる。 -->
<div
    class="relative z-50"
    onmouseleave={handleMouseLeave}
    onfocusin={handleFocusIn}
    onfocusout={handleFocusOut}
    onkeydown={handleKeyDown}
>
    <button type="button" aria-label="Light/Dark Mode" class="relative btn-plain scale-animation rounded-lg h-11 w-11 active:scale-90" id="scheme-switch" bind:this={schemeSwitchButton} onclick={toggleScheme} onmouseenter={() => { panelOpen = true; }}>
        <div class="absolute" class:opacity-0={mode !== LIGHT_MODE}>
            <Icon icon="material-symbols:wb-sunny-outline-rounded" class="text-[1.25rem]"></Icon>
        </div>
        <div class="absolute" class:opacity-0={mode !== DARK_MODE}>
            <Icon icon="material-symbols:dark-mode-outline-rounded" class="text-[1.25rem]"></Icon>
        </div>
        <div class="absolute" class:opacity-0={mode !== AUTO_MODE}>
            <Icon icon="material-symbols:radio-button-partial-outline" class="text-[1.25rem]"></Icon>
        </div>
    </button>

    <div id="light-dark-panel" class="hidden lg:block absolute transition top-11 -right-2 pt-5" class:float-panel-closed={!panelOpen}>
        <div class="card-base float-panel p-2">
            <!-- 選択中のテーマは current-theme-btn の見た目でしか伝わらないため、
                 aria-pressed で状態を非視覚的にも公開する。ここで role="radio" を
                 使わないのは、radiogroup にすると矢印キーでの移動と roving tabindex の
                 実装が必要になり、ネイティブ button の挙動から離れるため。 -->
            <button type="button" class="flex transition whitespace-nowrap items-center justify-start! w-full btn-plain scale-animation rounded-lg h-9 px-3 font-medium active:scale-95 mb-0.5"
                    class:current-theme-btn={mode === LIGHT_MODE}
                    aria-pressed={mode === LIGHT_MODE}
                    onclick={() => switchScheme(LIGHT_MODE)}
            >
                <Icon icon="material-symbols:wb-sunny-outline-rounded" class="text-[1.25rem] mr-3"></Icon>
                {i18n(I18nKey.lightMode)}
            </button>
            <button type="button" class="flex transition whitespace-nowrap items-center justify-start! w-full btn-plain scale-animation rounded-lg h-9 px-3 font-medium active:scale-95 mb-0.5"
                    class:current-theme-btn={mode === DARK_MODE}
                    aria-pressed={mode === DARK_MODE}
                    onclick={() => switchScheme(DARK_MODE)}
            >
                <Icon icon="material-symbols:dark-mode-outline-rounded" class="text-[1.25rem] mr-3"></Icon>
                {i18n(I18nKey.darkMode)}
            </button>
            <button type="button" class="flex transition whitespace-nowrap items-center justify-start! w-full btn-plain scale-animation rounded-lg h-9 px-3 font-medium active:scale-95"
                    class:current-theme-btn={mode === AUTO_MODE}
                    aria-pressed={mode === AUTO_MODE}
                    onclick={() => switchScheme(AUTO_MODE)}
            >
                <Icon icon="material-symbols:radio-button-partial-outline" class="text-[1.25rem] mr-3"></Icon>
                {i18n(I18nKey.systemMode)}
            </button>
        </div>
    </div>
</div>

// stub-fetch.mjs が返す上流の内容の組み立て方。スタブと、期待する blob SHA を計算するテストの両方が使う。

// ローカル改変したファイルの「改変の元にした版」。手元の内容とは異なる
export function vendoredUpstream(localText) {
	return `${localText}\nupstream-only line\n`;
}

// diff モードで TARGET に返す、上流が更新された後の内容
export function changedUpstream(text) {
	return `${text}\nchanged upstream\n`;
}

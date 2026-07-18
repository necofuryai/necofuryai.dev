import autoprefixer from "autoprefixer";
import postcssImport from "postcss-import";
import tailwindcss from "tailwindcss";
import postcssNesting from "tailwindcss/nesting/index.js";

// Order matters: combine imports, flatten nesting, run Tailwind, then add prefixes
// (Tailwind 3's @apply fails inside rules that are still nested)
export default {
	plugins: [postcssImport(), postcssNesting(), tailwindcss(), autoprefixer()],
};

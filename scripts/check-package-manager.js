const userAgent = process.env.npm_config_user_agent ?? "";

if (!userAgent.startsWith("pnpm/")) {
	console.error("This project requires pnpm. Use pnpm install.");
	process.exit(1);
}

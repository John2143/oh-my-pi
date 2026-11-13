/** Compact title-model input for a user-invoked `/skill:<name>` prompt — also the draft a rewind restores. */
export function skillPromptTitleInput(input: {
	name?: string;
	names?: readonly string[];
	args?: string;
	prompt?: string;
	queueChipText?: string;
}): string {
	const chip = input.queueChipText?.trim();
	if (chip) return chip;
	const prompt = input.prompt?.trim();
	if (prompt) return prompt;
	const names = (input.names ?? []).map(name => name.trim()).filter(name => name.length > 0);
	const single = input.name?.trim();
	const tokens = names.length > 0 ? names.map(name => `/skill:${name}`).join(" ") : single ? `/skill:${single}` : "";
	const args = input.args?.trim();
	if (tokens && args) return `${tokens} ${args}`;
	if (tokens) return tokens;
	return args ?? "";
}

/** Title text for a persisted skill-prompt custom message. Never the expanded SKILL.md body. */
export function titleTextFromSkillPrompt(message: {
	role: string;
	customType?: string;
	attribution?: string;
	details?: unknown;
}): string | undefined {
	if (message.role !== "custom" || message.customType !== "skill-prompt" || message.attribution !== "user") {
		return undefined;
	}
	let name: string | undefined;
	let names: string[] | undefined;
	let args: string | undefined;
	let prompt: string | undefined;
	let queueChipText: string | undefined;
	if (message.details && typeof message.details === "object") {
		const details = message.details as Record<string, unknown>;
		if (typeof details.name === "string") name = details.name;
		if (Array.isArray(details.skills)) {
			names = details.skills.flatMap(entry => {
				const entryName = entry && typeof entry === "object" ? (entry as Record<string, unknown>).name : undefined;
				return typeof entryName === "string" ? [entryName] : [];
			});
		}
		if (typeof details.args === "string") args = details.args;
		if (typeof details.prompt === "string") prompt = details.prompt;
		if (typeof details.__queueChipText === "string") queueChipText = details.__queueChipText;
	}
	return skillPromptTitleInput({ name, names, args, prompt, queueChipText }) || undefined;
}

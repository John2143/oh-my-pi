import { maskNonProse } from "../modes/view-model/prompt/markdown-prose";

/**
 * One `/skill:<name>` token delimited by whitespace or line edges. Group 1 is
 * the leading delimiter (empty at line start), group 2 the skill name: a bare
 * name or a collision-namespaced `<namespace>/<name>` (exactly one `/`; deeper
 * paths never match). Global so callers can walk every token; reset
 * `lastIndex` before reuse.
 */
export const SKILL_TOKEN_RE = /(^|\s)\/skill:([^\s/]+(?:\/[^\s/]+)?)(?=\s|$)/g;

/**
 * Leading slash namespaces that are advisory hints in prose, never commands:
 * the model reads them, nothing is dispatched locally.
 */
export const HINT_TOKEN_PREFIXES = ["/agent:", "/model:", "/local:"] as const;

export type HintTokenKind = "agent" | "model" | "local";

/**
 * One `/agent:<name>`, `/model:<selector>`, or `/local:<path>` hint token
 * delimited by whitespace or line edges. Group 1 is the leading delimiter
 * (empty at line start), group 2 the hint kind, group 3 the raw value.
 * Global so callers can walk every token; reset `lastIndex` before reuse.
 */
export const HINT_TOKEN_RE = /(^|\s)\/(agent|model|local):([^\s]+)(?=\s|$)/g;

/** Submitted `/agent:<name>` wire tag; group 1 is the agent name. */
export const AGENT_HINT_TAG_RE = /<agent name="([^"]+)"\/>/g;

/** Whitespace-delimited `local://<path>` prose URL; groups are leading delimiter and relative path. */
export const LOCAL_URL_PROSE_RE = /(^|\s)local:\/\/([^\s]+)(?=\s|$)/g;

const INVALID_AGENT_TAG_NAME_RE = /["<>]/;

/** Encode a resolved `/agent:<name>` hint for the user message sent to the model. */
export function agentHintTag(name: string): string {
	return `<agent name="${name}"/>`;
}

/** Ordered, deduplicated agent names referenced by `<agent name="…"/>` tags outside code spans/fences. */
export function referencedAgentHints(text: string): string[] {
	if (!text.includes("<agent ")) return [];
	const masked = maskNonProse(text, { maskTags: false });
	const seen = new Set<string>();
	const names: string[] = [];
	AGENT_HINT_TAG_RE.lastIndex = 0;
	for (const match of masked.matchAll(AGENT_HINT_TAG_RE)) {
		const name = match[1]!;
		if (!name || seen.has(name)) continue;
		seen.add(name);
		names.push(name);
	}
	return names;
}

/**
 * Expand prose `/agent:<name>` and `/local:<path>` hint tokens to `<agent name="<name>"/>`
 * and `local://<path>`. Skips code spans/blocks, non-hint slash commands, local-execution
 * drafts, unknown agents, and invalid local paths; preserves trailing prose punctuation.
 */
export function expandAgentAndLocalHints(
	text: string,
	options: {
		isKnownAgent: (name: string) => boolean;
		formatLocalUrl: (relativePath: string) => string | undefined;
	},
): string {
	if ((!text.includes("/agent:") && !text.includes("/local:")) || !allowsSkillTokens(text)) {
		return text;
	}
	const masked = maskNonProse(text);
	HINT_TOKEN_RE.lastIndex = 0;
	let out = "";
	let at = 0;
	for (const match of masked.matchAll(HINT_TOKEN_RE)) {
		const kind = match[2] as HintTokenKind;
		if (kind === "model") continue;
		const lead = match[1]!;
		const tokenStart = match.index + lead.length;
		const tokenEnd = match.index + match[0].length;
		const raw = text.slice(tokenStart + kind.length + 2, tokenEnd);
		if (!raw) continue;

		let replacement: string | undefined;
		if (kind === "agent") {
			const pick = (candidate: string): string | undefined => {
				if (!candidate || INVALID_AGENT_TAG_NAME_RE.test(candidate)) return undefined;
				return options.isKnownAgent(candidate) ? agentHintTag(candidate) : undefined;
			};
			const exact = pick(raw);
			if (exact !== undefined) {
				replacement = exact;
			} else {
				const split = splitHintTokenTrailingPunctuation(raw);
				if (split.trailing && split.value) {
					const trimmed = pick(split.value);
					if (trimmed !== undefined) replacement = `${trimmed}${split.trailing}`;
				}
			}
		} else {
			const split = splitHintTokenTrailingPunctuation(raw);
			if (split.value) {
				const url = options.formatLocalUrl(split.value);
				if (url !== undefined) replacement = `${url}${split.trailing}`;
			}
		}

		if (replacement === undefined) continue;
		out += text.slice(at, tokenStart) + replacement;
		at = tokenEnd;
	}
	return at > 0 ? out + text.slice(at) : text;
}

const TRAILING_HINT_PUNCTUATION_RE = /[.,;:!?]+$/;

/**
 * Split trailing prose punctuation off a raw hint-token value (e.g.
 * `notes.md.` → `{ value: "notes.md", trailing: "." }`) while keeping interior
 * dots and colons intact.
 */
export function splitHintTokenTrailingPunctuation(raw: string): { value: string; trailing: string } {
	const match = TRAILING_HINT_PUNCTUATION_RE.exec(raw);
	if (!match || match.index === 0) return { value: raw, trailing: "" };
	return { value: raw.slice(0, match.index), trailing: match[0] };
}

/**
 * Whether `text` opens a hint-namespace token (`/agent:`, `/model:`, `/local:`).
 * Those colon forms are prose the model reads; every other command keeps
 * `parseSlashCommand`'s colon-as-argument contract.
 */
export function startsWithHintNamespace(text: string): boolean {
	const trimmedStart = text.trimStart();
	return HINT_TOKEN_PREFIXES.some(prefix => trimmedStart.startsWith(prefix));
}

/**
 * Whether the draft begins with a TUI local-execution sigil that downstream
 * branches consume verbatim.
 */
export function isLocalExecutionDraft(text: string): boolean {
	const trimmedStart = text.trimStart();
	if (trimmedStart.startsWith("!")) return true;
	if (trimmedStart.charCodeAt(0) !== 36 /* $ */) return false;
	if (trimmedStart.charCodeAt(1) === 123 /* { */) return false;
	const sigilLength = trimmedStart.charCodeAt(1) === 36 /* $ */ ? 2 : 1;
	const next = trimmedStart.charCodeAt(sigilLength);
	if (Number.isNaN(next)) return true;
	return next === 32 /* space */ || next === 9 /* tab */ || next === 10 /* LF */ || next === 13; /* CR */
}

/**
 * Whether `/skill:<name>` tokens in `text` are invocations rather than content
 * belonging to another slash command or local-execution sigil.
 */
export function allowsSkillTokens(text: string): boolean {
	const trimmedStart = text.trimStart();
	if (trimmedStart.startsWith("/skill:")) return true;
	// A draft may open with a hint token and still carry skill tokens further in.
	if (trimmedStart.startsWith("/")) return startsWithHintNamespace(trimmedStart);
	return !isLocalExecutionDraft(trimmedStart);
}

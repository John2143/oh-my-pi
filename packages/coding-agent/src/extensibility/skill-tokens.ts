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

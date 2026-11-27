/**
 * Hint-token chips: `/agent:<name>`, `/model:<selector>`, and `/local:<path>`
 * tokens naming known targets show in the draft as colored inline chips that
 * expand back to their raw `/namespace:<value>` tokens on submit. Unknown
 * targets and tokens inside another command, local execution (`!cmd`, `$ code`),
 * or Markdown code spans stay literal.
 */
import {
	AGENT_HINT_TAG_RE,
	allowsSkillTokens,
	HINT_TOKEN_RE,
	type HintTokenKind,
	splitHintTokenTrailingPunctuation,
} from "../../extensibility/skill-tokens";
import { maskNonProse } from "../../modes/view-model/prompt/markdown-prose";
import type { DraftToken, TokenAtomizer } from "./composer";

const HINT_CHIP_STYLES: Record<HintTokenKind, string> = {
	agent: "statusLineSubagents strong",
	model: "statusLineModel strong",
	local: "statusLinePath strong",
};

const HINT_CHIP_GLYPHS: Record<HintTokenKind, string> = {
	agent: "icon.agents",
	model: "icon.model",
	local: "icon.extensionContextFile",
};

export interface HintTokenSource {
	/** Resolve a known `/agent:<name>` hint (file path absent for embedded bundled agents). */
	agent(name: string): { path?: string } | undefined;
	/** Resolve a known `/model:<selector>` hint to its display name. */
	model(selector: string): { name: string } | undefined;
	/** Resolve a known `/local:<path>` hint to its on-disk path. */
	local(relativePath: string): { path?: string } | undefined;
	/** Symbol lookup for chip glyphs (`currentTheme().symbols.symbol`). */
	symbol(key: string): string;
}

/** An atomizer for `/agent:`, `/model:`, `/local:` hint tokens and restored `<agent name="…"/>` tags over `source`. */
export function hintTokenAtomizer(source: HintTokenSource): TokenAtomizer {
	return (text, taken) => {
		const hasSlashHint = text.includes("/agent:") || text.includes("/model:") || text.includes("/local:");
		const hasAgentTag = text.includes("<agent ");
		if ((!hasSlashHint && !hasAgentTag) || !allowsSkillTokens(text)) return [];
		const tokens: DraftToken[] = [];
		const given = new Map<string, string>();

		if (hasAgentTag) {
			const codeMasked = maskNonProse(text, { maskTags: false });
			const glyph = source.symbol(HINT_CHIP_GLYPHS.agent);
			const style = HINT_CHIP_STYLES.agent;
			AGENT_HINT_TAG_RE.lastIndex = 0;
			for (const match of codeMasked.matchAll(AGENT_HINT_TAG_RE)) {
				const name = match[1]!;
				const resolved = source.agent(name);
				if (!resolved) continue;
				const expansion = `/agent:${name}`;
				const label = glyph ? `${glyph} ${name}` : expansion;
				const other = given.get(label);
				if ((other !== undefined && other !== expansion) || taken(label, expansion)) continue;
				given.set(label, expansion);
				tokens.push({
					from: match.index,
					to: match.index + match[0].length,
					label,
					expansion,
					s: style,
					...(resolved.path ? { link: { path: resolved.path, line: 1 } } : {}),
				});
			}
		}

		if (!hasSlashHint) return tokens;
		const masked = maskNonProse(text);
		HINT_TOKEN_RE.lastIndex = 0;

		const pickCandidate = <T>(
			raw: string,
			resolve: (candidate: string) => T | undefined,
		): { value: string; resolved: T; trailing: string } | undefined => {
			const exact = resolve(raw);
			if (exact !== undefined) return { value: raw, resolved: exact, trailing: "" };
			const split = splitHintTokenTrailingPunctuation(raw);
			if (!split.trailing || !split.value) return undefined;
			const trimmed = resolve(split.value);
			if (trimmed === undefined) return undefined;
			return { value: split.value, resolved: trimmed, trailing: split.trailing };
		};

		for (const match of masked.matchAll(HINT_TOKEN_RE)) {
			const lead = match[1]!;
			const kind = match[2] as HintTokenKind;
			const from = match.index + lead.length;
			const matchEnd = match.index + match[0].length;
			const raw = text.slice(from + kind.length + 2, matchEnd);
			if (!raw) continue;

			const glyph = source.symbol(HINT_CHIP_GLYPHS[kind]);
			const style = HINT_CHIP_STYLES[kind];

			if (kind === "agent") {
				const hit = pickCandidate(raw, name => source.agent(name));
				if (!hit) continue;
				const expansion = `/agent:${hit.value}`;
				const label = glyph ? `${glyph} ${hit.value}` : expansion;
				const other = given.get(label);
				if ((other !== undefined && other !== expansion) || taken(label, expansion)) continue;
				given.set(label, expansion);
				tokens.push({
					from,
					to: matchEnd - hit.trailing.length,
					matchEnd,
					label,
					expansion,
					s: style,
					...(hit.resolved.path ? { link: { path: hit.resolved.path, line: 1 } } : {}),
				});
			} else if (kind === "model") {
				const hit = pickCandidate(raw, selector => source.model(selector));
				if (!hit) continue;
				const expansion = `/model:${hit.value}`;
				let label = glyph ? `${glyph} ${hit.resolved.name}` : expansion;
				const other = given.get(label);
				if ((other !== undefined && other !== expansion) || taken(label, expansion)) {
					// Two different `/model:` selectors sharing a display name fall back to the selector.
					label = glyph ? `${glyph} ${hit.value}` : expansion;
					const fallbackOther = given.get(label);
					if ((fallbackOther !== undefined && fallbackOther !== expansion) || taken(label, expansion)) continue;
				}
				given.set(label, expansion);
				tokens.push({
					from,
					to: matchEnd - hit.trailing.length,
					matchEnd,
					label,
					expansion,
					s: style,
				});
			} else {
				const hit = pickCandidate(raw, rel => source.local(rel));
				if (!hit) continue;
				const expansion = `/local:${hit.value}`;
				const label = glyph ? `${glyph} ${hit.value}` : expansion;
				const other = given.get(label);
				if ((other !== undefined && other !== expansion) || taken(label, expansion)) continue;
				given.set(label, expansion);
				tokens.push({
					from,
					to: matchEnd - hit.trailing.length,
					matchEnd,
					label,
					expansion,
					s: style,
					...(hit.resolved.path ? { link: { path: hit.resolved.path } } : {}),
				});
			}
		}

		return tokens.sort((a, b) => a.from - b.from);
	};
}

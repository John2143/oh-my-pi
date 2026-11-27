/**
 * Composer tokens in a sent prompt: what the composer showed as chips stays a
 * chip in the transcript.
 *
 * - `[Image #N, WxH]` / `[Video #N]` markers collapse to `📷 #N` / `🎬 #N`
 *   (linked to the attachment's file when one is known).
 * - `<model agent="m1" name="x"/>` mention tags show as `⬢ x`.
 * - Skill chips (`✦ name`) are kept and linked to their SKILL.md.
 *
 * The glyphs are the active symbol preset's (`chip.*`, `icon.model`,
 * `icon.extensionSkill`), as the composer drew the chip; reading them
 * subscribes a reactive caller to preset switches.
 *
 * Natively each token is an `md` mark styled as the composer decorates it;
 * the terminal colors attachment chips with their composer identity color.
 */
import { currentTheme } from "@oh-my-pi/pi-tui/theme/runtime";
import type { TspSpan } from "@oh-my-pi/pi-wire";
import {
	AGENT_HINT_TAG_RE,
	allowsSkillTokens,
	HINT_TOKEN_RE,
	type HintTokenKind,
	LOCAL_URL_PROSE_RE,
	splitHintTokenTrailingPunctuation,
} from "../../../extensibility/skill-tokens";
import { maskNonProse } from "../../../modes/view-model/prompt/markdown-prose";
import { type ChipKind, chipColor, chipLabel } from "../../composer/attachments";

const VISION_MARKER = /\[(Image|Video) #([1-9]\d*)(?:,[^\]\n]*)?\](?: attachment:\/\/\2)?/g;
const MODEL_MENTION = /<model agent="m\d+" name="([^"]*)"\/>/g;
/** A skill name after its chip glyph (`ns/name`, dotted segments). */
const SKILL_NAME = String.raw` ((?:[\w-]+\/)?[\w-]+(?:\.[\w-]+)*)(?![\w-])`;

/** The chip of skill `name`: the symbol preset's skill glyph and the name, as the composer shows an invocation. */
export function skillChipLabel(name: string): string {
	return `${currentTheme().symbols.symbol("icon.extensionSkill")} ${name}`;
}

/** Skill chips drawn with `glyph`; a word glyph (the ASCII preset's `SK`) does not continue a word before it. */
function skillChips(glyph: string): RegExp {
	const lead = /^[a-z]+$/i.test(glyph) ? `(?<![A-Za-z])${glyph}` : RegExp.escape(glyph);
	return new RegExp(`${lead}${SKILL_NAME}`, "gu");
}

/** One chip in the display text. */
export interface Chip {
	readonly label: string;
	readonly kind: ChipKind | "skill" | "mention" | HintTokenKind;
	/** Attachment number (`#N`) of image and video chips. */
	readonly n?: number;
	/** File the chip opens (an attachment's materialized file, a skill's SKILL.md, an agent's `.md`, or a `local://` file). */
	readonly path?: string;
}

/** A prompt as the transcript shows it. */
export interface ChipText {
	readonly text: string;
	readonly chips: readonly Chip[];
}

/** Collapse markers, mention tags, and hint tokens of `text` and list its chips (one per distinct label). */
export function chipText(
	text: string,
	options: {
		readonly imageLinks?: readonly (string | undefined)[];
		readonly skillPath?: (name: string) => string | undefined;
		readonly agentPath?: (name: string) => string | undefined;
		readonly localPath?: (relativePath: string) => string | undefined;
		readonly modelLabel?: (selector: string) => string | undefined;
		/** Whether `/agent:`, `/model:`, `/local:` tokens in prose collapse into chips (default: true). */
		readonly hintTokens?: boolean;
	} = {},
): ChipText {
	const chips = new Map<string, Chip>();
	const symbols = currentTheme().symbols;
	let out = text.replace(VISION_MARKER, (_match, kind: string, idx: string) => {
		const n = Number(idx);
		const chipKind: ChipKind = kind === "Video" ? "video" : "image";
		const label = chipLabel(chipKind, n, key => symbols.symbol(key));
		if (!chips.has(label))
			chips.set(label, {
				label,
				kind: chipKind,
				n,
				path: options.imageLinks?.[n - 1],
			});
		return label;
	});
	out = out.replace(MODEL_MENTION, (_match, name: string) => {
		const label = `${symbols.symbol("icon.model")} ${name}`;
		if (!chips.has(label)) chips.set(label, { label, kind: "mention" });
		return label;
	});
	if (options.hintTokens !== false && out.includes("<agent ")) {
		const codeMasked = maskNonProse(out, { maskTags: false });
		AGENT_HINT_TAG_RE.lastIndex = 0;
		let rebuilt = "";
		let at = 0;
		for (const match of codeMasked.matchAll(AGENT_HINT_TAG_RE)) {
			const name = match[1]!;
			const tokenStart = match.index;
			const tokenEnd = tokenStart + match[0].length;
			const glyph = symbols.symbol("icon.agents");
			const label = glyph ? `${glyph} ${name}` : `/agent:${name}`;
			if (!chips.has(label)) {
				const path = options.agentPath?.(name);
				chips.set(label, { label, kind: "agent", ...(path ? { path } : {}) });
			}
			rebuilt += out.slice(at, tokenStart) + label;
			at = tokenEnd;
		}
		if (at > 0) out = rebuilt + out.slice(at);
	}
	if (options.hintTokens !== false && out.includes("local://")) {
		const masked = maskNonProse(out);
		LOCAL_URL_PROSE_RE.lastIndex = 0;
		let rebuilt = "";
		let at = 0;
		for (const match of masked.matchAll(LOCAL_URL_PROSE_RE)) {
			const lead = match[1]!;
			const tokenStart = match.index + lead.length;
			const tokenEnd = match.index + match[0].length;
			const raw = out.slice(tokenStart + "local://".length, tokenEnd);
			const { value, trailing } = splitHintTokenTrailingPunctuation(raw);
			if (!value) continue;
			const glyph = symbols.symbol("icon.extensionContextFile");
			const label = glyph ? `${glyph} ${value}` : `local://${value}`;
			if (!chips.has(label)) {
				const path = options.localPath?.(value);
				chips.set(label, { label, kind: "local", ...(path ? { path } : {}) });
			}
			rebuilt += out.slice(at, tokenStart) + label + trailing;
			at = tokenEnd;
		}
		if (at > 0) out = rebuilt + out.slice(at);
	}
	if (
		options.hintTokens !== false &&
		(out.includes("/agent:") || out.includes("/model:") || out.includes("/local:")) &&
		allowsSkillTokens(out)
	) {
		const masked = maskNonProse(out);
		HINT_TOKEN_RE.lastIndex = 0;
		let rebuilt = "";
		let at = 0;
		for (const match of masked.matchAll(HINT_TOKEN_RE)) {
			const lead = match[1]!;
			const kind = match[2] as HintTokenKind;
			const tokenStart = match.index + lead.length;
			const tokenEnd = match.index + match[0].length;
			const raw = out.slice(tokenStart + kind.length + 2, tokenEnd);
			const { value, trailing } = splitHintTokenTrailingPunctuation(raw);
			if (!value) continue;
			const glyphKey =
				kind === "agent" ? "icon.agents" : kind === "model" ? "icon.model" : "icon.extensionContextFile";
			const glyph = symbols.symbol(glyphKey);
			const display = kind === "model" ? (options.modelLabel?.(value) ?? value) : value;
			const label = glyph ? `${glyph} ${display}` : `/${kind}:${display}`;
			if (!chips.has(label)) {
				const path =
					kind === "agent"
						? options.agentPath?.(value)
						: kind === "local"
							? options.localPath?.(value)
							: undefined;
				chips.set(label, { label, kind, ...(path ? { path } : {}) });
			}
			rebuilt += out.slice(at, tokenStart) + label + trailing;
			at = tokenEnd;
		}
		if (at > 0) out = rebuilt + out.slice(at);
	}
	const skillGlyph = symbols.symbol("icon.extensionSkill");
	// A theme without a skill glyph marks no chip apart from prose.
	for (const match of skillGlyph ? out.matchAll(skillChips(skillGlyph)) : []) {
		const label = match[0];
		if (!chips.has(label))
			chips.set(label, {
				label,
				kind: "skill",
				path: options.skillPath?.(match[1]!),
			});
	}
	return { text: out, chips: [...chips.values()] };
}

function fileHref(path: string): string | undefined {
	try {
		return Bun.pathToFileURL(path).href;
	} catch {
		return undefined;
	}
}

/** The native style of a chip: attachments accent, skills/mentions/hints their pill colors. */
function chipStyle(chip: Chip): string {
	if (chip.kind === "skill") return "customMessageLabel strong";
	if (chip.kind === "mention" || chip.kind === "model") return "statusLineModel strong";
	if (chip.kind === "agent") return "statusLineSubagents strong";
	if (chip.kind === "local") return "statusLinePath strong";
	return "accent strong";
}

/** The `md` marks of `chips` (attachment and file-backed hint chips link to their file). */
export function chipMarks(chips: readonly Chip[]): TspSpan[] {
	return chips.map(chip => {
		const href =
			chip.kind !== "skill" && chip.kind !== "mention" && chip.kind !== "model" && chip.path
				? fileHref(chip.path)
				: undefined;
		return href ? { t: chip.label, s: chipStyle(chip), href } : { t: chip.label, s: chipStyle(chip) };
	});
}

/** A chip as the terminal draws it: its label and color (a theme token or a hex attachment color). */
export interface TermChip {
	readonly t: string;
	/** `#rrggbb` for attachment chips, else TSP span tokens. */
	readonly color: string;
	/** Drawn as a soft pill (on the custom-message tint). */
	readonly pill?: boolean;
	/** The file the chip links to (a skill's SKILL.md or agent's `.md` at its first line, an attachment/local file). */
	readonly link?: { readonly path: string; readonly line?: number };
}

/** Terminal chip looks. */
export function termChips(chips: readonly Chip[]): TermChip[] {
	return chips.map(chip => {
		if (chip.kind === "mention" || chip.kind === "model")
			return { t: chip.label, color: chipStyle(chip), pill: true };
		const link = chip.path
			? { link: chip.kind === "skill" || chip.kind === "agent" ? { path: chip.path, line: 1 } : { path: chip.path } }
			: {};
		return chip.kind === "skill" || chip.kind === "agent" || chip.kind === "local"
			? { t: chip.label, color: chipStyle(chip), pill: true, ...link }
			: { t: chip.label, color: chipColor(chip.kind, chip.n ?? 1), ...link };
	});
}

/** @jsxImportSource @oh-my-pi/pi-tui */
/**
 * A user-invoked skill: a user-toned card headed by the skill chip (linked to
 * its SKILL.md) and the prompt's size, the user's draft always visible, and
 * the loaded skill prompt behind a disclosure.
 *
 * The terminal draws one of two layouts, chosen by where `/skill:<name>` sat
 * in the draft: a callout with a skill-colored rail when it led the draft
 * (the chip and size head it, the rest of the draft under them), or the
 * draft as a plain user bubble with the chip inline when it sat mid-prompt
 * (the callout then only holds the expanded prompt).
 *
 * Terminal look: `omp.skill` (`src/ui/styles/messages/skill.ts`).
 */
import type { JSXNode, Reactive } from "@oh-my-pi/pi-tui";
import type { TspSpan } from "@oh-my-pi/pi-wire";
import type { SkillPromptDetails } from "../../../session/transcript/messages";
import { cardExpansion } from "../expansion";
import { chipMarks, chipText, skillChipLabel, termChips } from "./chips";
import { openableImage } from "./image";

/** What a skill row shows. */
export interface SkillMessageProps {
	readonly content: string | readonly { readonly type: string; readonly text?: string }[];
	readonly details?: Partial<SkillPromptDetails>;
	/** Files of attached images by chip number − 1. */
	readonly imageLinks?: readonly (string | undefined)[];
	/** Agent `.md` path of an `/agent:` chip, by agent name. */
	readonly agentPath?: (name: string) => string | undefined;
	/** On-disk path of a `/local:` chip, by relative session path. */
	readonly localPath?: (relativePath: string) => string | undefined;
	/** Display name of a `/model:` chip, by model selector. */
	readonly modelLabel?: (selector: string) => string | undefined;
	readonly expanded: Reactive<boolean>;
	readonly onToggle?: (expanded: boolean) => void;
}

function promptText(content: SkillMessageProps["content"]): string {
	if (typeof content === "string") return content;
	return content.flatMap(part => (part.type === "text" && part.text !== undefined ? [part.text] : [])).join("\n");
}

/** One attached skill; `path`/`lineCount` are optional so a pre-multi-skill message still renders. */
type SkillCardEntry = { name: string; path?: string; lineCount?: number };

/** Skills named by `details.skills`, or the scalar fields of a message recorded before them. */
function cardEntries(details: Partial<SkillPromptDetails> | undefined): SkillCardEntry[] {
	const entries = details?.skills;
	if (entries && entries.length > 0) return entries.map(entry => ({ ...entry }));
	return [{ name: details?.name?.trim() || "unknown", path: details?.path, lineCount: details?.lineCount }];
}

/** The submitted draft, or one token per attached skill when the draft is not recorded. */
function cardDraft(details: Partial<SkillPromptDetails> | undefined, entries: readonly SkillCardEntry[]): string {
	if (details?.prompt !== undefined) return details.prompt;
	const tokens = entries.map(entry => `/skill:${entry.name}`).join(" ");
	return details?.args ? `${tokens} ${details.args}` : tokens;
}

/**
 * Drop the leading run of skill chips from the collapsed draft: a draft that
 * opens with `/skill:` renders as a callout with the remaining prose as its body.
 */
function splitLeadingChips(display: string, labels: readonly string[]): { leading: boolean; body: string } {
	let index = 0;
	let leading = false;
	for (;;) {
		const label = labels.find(candidate => display.startsWith(candidate, index));
		if (!label) break;
		const next = index + label.length;
		if (next < display.length && !/^\s$/.test(display.charAt(next))) break;
		leading = true;
		index = next;
		while (index < display.length && /^\s$/.test(display.charAt(index))) index++;
	}
	return { leading, body: display.slice(index).trim() };
}

/** Muted prompt size across every attached skill (`2 skills · 41 lines`). */
function cardSize(entries: readonly SkillCardEntry[]): string | undefined {
	if (!entries.some(entry => typeof entry.lineCount === "number")) return undefined;
	const lines = entries.reduce((sum, entry) => sum + (entry.lineCount ?? 0), 0);
	const counted = `${lines} ${lines === 1 ? "line" : "lines"}`;
	return entries.length === 1 ? counted : `${entries.length} skills · ${counted}`;
}

/** A skill invocation. */
export function SkillMessage(props: SkillMessageProps): JSXNode {
	const details = props.details;
	const entries = cardEntries(details);
	const labels = entries.map(entry => skillChipLabel(entry.name));
	const tokenPattern = new RegExp(
		`(?<=^|\\s)\\/skill:(${entries
			.map(entry => RegExp.escape(entry.name))
			.sort((a, b) => b.length - a.length)
			.join("|")})(?![\\w./-])`,
		"g",
	);
	// Display-only collapse: every attached skill becomes a chip; a `/skill:` token the dispatcher
	// ignored stays literal so the transcript never claims a skill that never loaded.
	const display = cardDraft(details, entries).replace(tokenPattern, (_match, candidate: string) =>
		skillChipLabel(candidate),
	);
	const { leading, body } = splitLeadingChips(display, labels);
	const draft = leading ? body : display;
	const head: TspSpan[] = entries.map((entry, index) => {
		const label = `${index === 0 ? "" : "  "}${skillChipLabel(entry.name)}`;
		const href = entry.path ? openableImage(entry.path).href : undefined;
		return href ? { t: label, s: "customMessageLabel strong", href } : { t: label, s: "customMessageLabel strong" };
	});
	const lines = cardSize(entries);
	if (lines) head.push({ t: `  ${lines}`, s: "muted" });
	const pills = entries.map(entry => ({
		label: skillChipLabel(entry.name),
		...(entry.path ? { path: entry.path } : {}),
	}));
	const text = promptText(props.content);
	const chips = chipText(draft, {
		imageLinks: props.imageLinks,
		skillPath: candidate => entries.find(entry => entry.name === candidate)?.path,
		agentPath: props.agentPath,
		localPath: props.localPath,
		modelLabel: props.modelLabel,
	});
	const marks = chips.chips.length > 0 ? chipMarks(chips.chips) : undefined;
	const { expanded, toggle } = cardExpansion(props.expanded, props.onToggle);
	return (
		<card
			role="omp.skill"
			tone="user"
			head={head}
			term={() => ({
				pills,
				label: pills[0]!.label,
				...(pills[0]!.path ? { path: pills[0]!.path } : {}),
				lines,
				leading,
				draft: chips.text,
				chips: termChips(chips.chips),
				prompt: text,
				expanded: expanded(),
			})}
		>
			{chips.text && <md text={chips.text} {...(marks ? { marks } : {})} />}
			<section
				key="prompt"
				head={[{ t: "prompt", s: "muted" }]}
				role="omp.skill.prompt"
				collapsible
				collapsed={() => !expanded()}
				onToggle={toggle}
			>
				{() => expanded() && text && <md text={text} />}
			</section>
		</card>
	);
}

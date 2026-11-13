import type { TextContent } from "@oh-my-pi/pi-ai";
import { type Component } from "../tui";
import { Box } from "../components/box";
import { Disclosure } from "../components/disclosure";
import { Container } from "../tui";
import { Markdown } from "../components/markdown";
import { Spacer } from "../components/spacer";
import { Text } from "../components/text";
import { getMarkdownTheme, theme } from "../theme";
import type { CustomMessage, SkillPromptDetails } from "./messages";
import { fileHyperlink } from "../render";
import { tryFileUri } from "../render/hyperlink";
import { collapseSkillTokens, skillChipLabel, skillChipStyle, skillToken } from "../prompt/composer-attachments";
import { type UserBubbleOptions, UserMessageComponent, userBubbleColor } from "./user-message";
import type { TspSpan } from "@oh-my-pi/pi-wire";
import { card, md, node, span } from "../native/describe";
import { type NativeChild, type NativeNode, type NativeUiEvent } from "../native/node";
import { Memo } from "../native/memo";

/**
 * Transcript row for a user-invoked skill. Two layouts, chosen by where the
 * `/skill:<name>` token sat in the submitted draft:
 *
 * - **Callout** (token first): a user bubble with a skill-colored left rail,
 *   the skill chip and prompt size as its header, then the rest of the draft
 *   as full Markdown.
 * - **Inline** (token mid-prompt): a plain user bubble with the token drawn
 *   as the same soft-pill chip the composer showed.
 *
 * In both, the chip is an OSC 8 link to the SKILL.md. Expanding (tool-output
 * toggle) appends the rendered skill prompt.
 */
export class SkillMessageComponent extends Container {
	// Canonical and replayed skill cards finalize immediately so they retire to
	// native scrollback like any settled block. An optimistically-painted
	// `/skill:` row (issue #11217) is instead held live until its canonical
	// `message_start` reconciles it, so it stays removable and never leaves a
	// duplicate behind in scrollback if reconcile swaps it out.
	#transcriptBlockFinalized = true;
	// Controlled expansion delegate. In callout mode it is the prompt-only
	// disclosure nested inside the single continuous SkillCallout rail; in
	// inline mode it pairs the user bubble summary with a lazy SkillCallout
	// body. Rebuilt (unmaterialized) on invalidate so header/body pick up the
	// current theme without eagerly constructing the expanded prompt.
	#disclosure: Disclosure | undefined;

	readonly #message: CustomMessage<SkillPromptDetails>;
	readonly #imageLinks?: readonly (string | undefined)[];
	#expanded = false;
	readonly #native = new Memo();

	constructor(message: CustomMessage<SkillPromptDetails>, imageLinks?: readonly (string | undefined)[]) {
		super();
		this.#message = message;
		this.#imageLinks = imageLinks;

		this.#rebuild();
	}

	setExpanded(expanded: boolean): void {
		this.#expanded = expanded;
		this.#disclosure?.setExpanded(expanded);
	}

	isExpanded(): boolean {
		return this.#expanded;
	}

	handleNativeEvent(event: NativeUiEvent): void {
		if (event.type === "toggle" && event.key === "prompt") this.setExpanded(!event.collapsed);
	}

	/**
	 * A user-toned card (role `omp.skill`): the skill chip and prompt size in
	 * the head, the user's draft always visible, and only the loaded skill
	 * prompt behind a disclosure.
	 */
	override describe(): NativeNode {
		return this.#native.get([this.#expanded], () => {
			const details = this.#message.details;
			const entries = cardEntries(details);
			const names = entries.map(entry => entry.name);
			const display = collapseSkillTokens(
				cardDraft(details, entries),
				candidate => names.includes(candidate),
				() => {},
			);
			const { leading, body } = splitLeadingChips(
				display,
				entries.map(entry => skillChipLabel(entry.name)),
			);
			const draft = leading ? body : display;
			const head: TspSpan[] = entries.map((entry, index) =>
				span(
					`${index === 0 ? "" : "  "}${skillChipLabel(entry.name)}`,
					"customMessageLabel strong",
					entry.path ? { href: tryFileUri(entry.path) } : undefined,
				),
			);
			const size = cardSize(entries);
			if (size) head.push(span(`  ${size}`, "muted"));
			const children: NativeChild[] = [];
			if (draft) children.push(md(draft));
			const promptText = this.#expanded ? this.#extractText() : "";
			children.push(
				node(
					"section",
					{
						head: [span("prompt", "muted")],
						role: "omp.skill.prompt",
						collapsible: true,
						collapsed: !this.#expanded,
					},
					promptText ? [md(promptText)] : [],
					"prompt",
				),
			);
			return card({ role: "omp.skill", tone: "user", head }, children);
		});
	}

	/**
	 * Transcript finalization contract (see `FinalizableBlock`): an optimistic
	 * `/skill:` row reports `false` so the container keeps it live and removable
	 * until reconcile; every other skill card is finalized on creation.
	 */
	isTranscriptBlockFinalized(): boolean {
		return this.#transcriptBlockFinalized;
	}

	/** Hold this card live as an unreconciled optimistic `/skill:` row (#11217). */
	markTranscriptBlockPending(): void {
		this.#transcriptBlockFinalized = false;
	}

	/** Finalize an optimistic row adopted in place after it already retired to
	 *  scrollback before its canonical `message_start` arrived (#11217). */
	markTranscriptBlockFinalized(): void {
		this.#transcriptBlockFinalized = true;
	}

	override invalidate(): void {
		this.#rebuild();
	}

	override dispose(): void {
		this.#disclosure?.dispose();
		super.dispose();
	}

	#rebuild(): void {
		const expanded = this.#disclosure?.expanded ?? false;
		this.#disclosure?.dispose();
		this.clear();
		const details = this.#message.details;
		const entries = cardEntries(details);
		const names = entries.map(entry => entry.name);
		// Display-only collapse: every attached skill becomes a chip; a `/skill:` token the dispatcher
		// ignored stays literal so the transcript never claims a skill that never loaded.
		const display = collapseSkillTokens(
			cardDraft(details, entries),
			candidate => names.includes(candidate),
			() => {},
		);
		const { leading, body } = splitLeadingChips(
			display,
			entries.map(entry => skillChipLabel(entry.name)),
		);
		const bubble: UserBubbleOptions = {
			imageLinks: this.#imageLinks,
			skillPath: candidate => entries.find(entry => entry.name === candidate)?.path,
		};

		if (!leading) {
			this.#disclosure = new Disclosure({
				summary: new UserMessageComponent(display, bubble),
				// Prompt extraction and Markdown layout stay lazy: the factory
				// runs on the first expanded render, reading the current theme.
				body: () => new SkillCallout([new Text(this.#header(entries), 0, 0), ...this.#promptSection(bubble)]),
				expanded,
			});
			this.addChild(this.#disclosure);
			return;
		}

		const children: Component[] = [new Text(this.#header(entries), 0, 0)];
		if (body) children.push(new Spacer(1), this.#markdown(body, bubble));
		// The prompt disclosure nests inside the one callout so the
		// skill-colored rail stays continuous across summary and detail.
		const promptDisclosure = new Disclosure({
			body: () => this.#promptFragment(bubble),
			expanded,
		});
		// The rail box and its Markdown always ignore tight viewports.
		promptDisclosure.setIgnoreTight(true);
		this.#disclosure = promptDisclosure;
		children.push(promptDisclosure);
		this.addChild(new SkillCallout(children));
	}

	/**
	 * Expanded prompt section (leading mode detail slot): raw rows appended to
	 * the outer callout, matching the pre-Disclosure layout of a single rail
	 * with no duplicate header.
	 */
	#promptFragment(bubble: UserBubbleOptions): Component {
		const fragment = new Container();
		for (const child of this.#promptSection(bubble)) fragment.addChild(child);
		return fragment;
	}

	#markdown(text: string, bubble: UserBubbleOptions): Markdown {
		const md = new Markdown(text, 0, 0, getMarkdownTheme(), {
			bgColor: value => theme.bg("userMessageBg", value),
			color: userBubbleColor(bubble),
		});
		md.setIgnoreTight(true);
		return md;
	}

	/** One chip per attached skill, each linked to its SKILL.md, then the muted prompt size. */
	#header(entries: readonly SkillCardEntry[]): string {
		const parts = entries.map(entry => {
			const chip = skillChipStyle(skillChipLabel(entry.name), bubbleReset());
			return entry.path ? fileHyperlink(entry.path, chip, { line: 1 }) : chip;
		});
		const size = cardSize(entries);
		if (size) parts.push(theme.fg("muted", size));
		return parts.join("  ");
	}

	/** The rendered SKILL.md prompt under a calm subheader (expanded view only). */
	#promptSection(bubble: UserBubbleOptions): Component[] {
		const text = this.#extractText();
		if (!text) return [];
		return [new Spacer(1), new Text(theme.fg("muted", "prompt"), 0, 0), new Spacer(1), this.#markdown(text, bubble)];
	}

	#extractText(): string {
		if (typeof this.#message.content === "string") {
			return this.#message.content;
		}
		return this.#message.content
			.filter((c): c is TextContent => c.type === "text")
			.map(c => c.text)
			.join("\n");
	}
}

/** One attached skill; `path`/`lineCount` are optional so a pre-multi-skill message still renders. */
type SkillCardEntry = { name: string; path?: string; lineCount?: number };

/** Skills named by `details.skills`, or the scalar fields of a message recorded before them. */
function cardEntries(details: SkillPromptDetails | undefined): SkillCardEntry[] {
	const entries = details?.skills;
	if (entries && entries.length > 0) return entries.map(entry => ({ ...entry }));
	return [{ name: details?.name?.trim() || "unknown", path: details?.path, lineCount: details?.lineCount }];
}

/** The submitted draft, or one token per attached skill when the draft is not recorded. */
function cardDraft(details: SkillPromptDetails | undefined, entries: readonly SkillCardEntry[]): string {
	if (details?.prompt !== undefined) return details.prompt;
	const tokens = entries.map(entry => skillToken(entry.name)).join(" ");
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

/** Bubble foreground + background to re-arm after an inline chip. */
function bubbleReset(): string {
	return `${theme.getFgOnBgAnsi("userMessageText", "userMessageBg")}${theme.getBgAnsi("userMessageBg")}`;
}

/**
 * A user-bubble box with a skill-colored rail down its left edge. Memoized on the
 * inner box's render so the transcript's incremental assembly sees stable rows.
 */
class SkillCallout implements Component {
	readonly #box: Box;
	#source: readonly string[] | undefined;
	#lines: string[] | undefined;

	constructor(children: readonly Component[]) {
		this.#box = new Box(1, 1, value => theme.bgFill("userMessageBg", value));
		this.#box.setIgnoreTight(true);
		for (const child of children) this.#box.addChild(child);
	}

	invalidate(): void {
		this.#box.invalidate();
		this.#source = undefined;
		this.#lines = undefined;
	}

	releaseRenderCaches(): void {
		this.#source = undefined;
		this.#lines = undefined;
		this.#box.releaseRenderCaches();
	}

	render(width: number): readonly string[] {
		const inner = this.#box.render(Math.max(1, width - 1));
		if (this.#source === inner && this.#lines !== undefined) return this.#lines;
		const rail = theme.bg("userMessageBg", theme.fg("customMessageLabel", theme.symbol("skill.rail")));
		const lines = inner.map(line => rail + line);
		this.#source = inner;
		this.#lines = lines;
		return lines;
	}
}

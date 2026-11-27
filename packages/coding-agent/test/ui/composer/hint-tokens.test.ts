import { describe, expect, it } from "bun:test";
import { createRoot, effect, type UiNode } from "@oh-my-pi/pi-tui";
import { CombinedAutocompleteProvider, type InlineNamespace } from "../../../src/autocomplete/autocomplete";
import { createPromptActionAutocompleteProvider } from "../../../src/autocomplete/prompt-actions";
import { KeybindingsManager } from "../../../src/config/keybindings/keybindings";
import { Composer } from "../../../src/ui/composer";
import { key, sendKey, settle } from "./harness";

const AGENTS = ["oracle", "reviewer", "scout"];
const MODELS = ["anthropic/claude-sonnet", "deepseek/deepseek-flash"];
const FILES = ["plans/x.md", "src/fi.ts"];

const namespaces: readonly InlineNamespace[] = [
	{
		prefix: "agent:",
		barePrefix: true,
		getCompletions: (query: string) => {
			const lower = query.toLowerCase();
			return AGENTS.filter(name => name.includes(lower)).map(name => ({
				value: `agent:${name}`,
				label: `agent:${name}`,
			}));
		},
		getSyncCompletions: () => AGENTS.map(name => ({ value: `agent:${name}`, label: `agent:${name}` })),
	},
	{
		prefix: "local:",
		barePrefix: true,
		getCompletions: (query: string) => {
			const lower = query.toLowerCase();
			return FILES.filter(name => name.includes(lower)).map(name => ({
				value: `local:${name}`,
				label: `local:${name}`,
			}));
		},
		getSyncCompletions: () => FILES.map(name => ({ value: `local:${name}`, label: `local:${name}` })),
	},
	{
		prefix: "model:",
		barePrefix: true,
		maxBareMatches: 5,
		getCompletions: (query: string) => {
			const lower = query.toLowerCase();
			return MODELS.filter(id => id.includes(lower)).map(id => ({ value: `model:${id}`, label: `model:${id}` }));
		},
		getSyncCompletions: () => MODELS.map(id => ({ value: `model:${id}`, label: `model:${id}` })),
	},
];

function type(composer: Composer, text: string): void {
	for (const char of text) sendKey(composer.node, composer.field, key(char));
}

function offers(node: UiNode, value: string): boolean {
	return node.kind === "item" ? node.key() === value : node.children().some(child => offers(child, value));
}

function offered(composer: Composer, value: string): Promise<void> {
	const ready = Promise.withResolvers<void>();
	const stop = createRoot(dispose => {
		effect(() => {
			if (offers(composer.node, value)) ready.resolve();
		});
		return dispose;
	});
	return ready.promise.finally(stop);
}

describe("inline hint namespaces", () => {
	const createProvider = () =>
		new CombinedAutocompleteProvider([{ name: "model", description: "Switch model" }], "/tmp", { namespaces });

	it("completes a hint token that opens the draft", async () => {
		const provider = createProvider();
		const line = "/agent:";

		const result = await provider.getSuggestions([line], 0, line.length);

		expect(result?.prefix).toBe("/agent:");
		expect(result?.items.map(item => item.value)).toEqual(["agent:oracle", "agent:reviewer", "agent:scout"]);
	});

	it("keeps listing after a slash inside the query", async () => {
		const provider = createProvider();
		const line = "/local:src/fi";

		const result = await provider.getSuggestions([line], 0, line.length);

		expect(result?.items.map(item => item.value)).toEqual(["local:src/fi.ts"]);
	});

	it("completes a mid-prompt hint token and keeps the prose", async () => {
		const provider = createProvider();
		const line = "spawn three /agent:sco";
		const suggestions = await provider.getSuggestions([line], 0, line.length);
		const selected = suggestions?.items[0];
		if (!selected || !suggestions) throw new Error("expected an agent candidate");

		const applied = provider.applyCompletion([line], 0, line.length, selected, suggestions.prefix);

		expect(applied.lines[0]).toBe("spawn three /agent:scout ");
		expect(applied.cursorCol).toBe("spawn three /agent:scout ".length);
	});

	it("returns nothing instead of falling through to path completion", async () => {
		const provider = createProvider();
		const line = "/agent:nobody";

		expect(await provider.getSuggestions([line], 0, line.length)).toBeNull();
	});

	it("reports hint tokens and values so the composer never dispatches them", () => {
		const provider = createProvider();

		expect(provider.isNamespaceToken("/agent:sc")).toBe(true);
		expect(provider.isNamespaceToken("do it /local:x")).toBe(true);
		expect(provider.isNamespaceToken("/btw:hi")).toBe(false);
		expect(provider.isNamespaceValue("agent:scout")).toBe(true);
		expect(provider.isNamespaceValue("skill:reviewer")).toBe(false);
	});

	it("leaves a namespace the gate does not declare to normal handling", async () => {
		const provider = createProvider();
		const line = "/btw:hi";

		expect(await provider.getSuggestions([line], 0, line.length)).toBeNull();
		expect(provider.trySyncSlashCompletion?.(line)).toBeNull();
	});

	it("serves hint namespaces through PromptActionAutocompleteProvider and applies them in place", async () => {
		const provider = createPromptActionAutocompleteProvider({
			commands: [{ name: "btw", description: "By the way", allowArgs: true }],
			basePath: "/tmp",
			namespaces,
			keybindings: KeybindingsManager.inMemory(),
			copyCurrentLine: () => {},
			copyPrompt: () => {},
			undo: () => {},
			moveCursorToMessageEnd: () => {},
			moveCursorToMessageStart: () => {},
			moveCursorToLineStart: () => {},
			moveCursorToLineEnd: () => {},
		});
		const line = "review ^sonnet with /agent:sco";

		const result = await provider.getSuggestions([line], 0, line.length);
		const selected = result?.items[0];
		if (!result || !selected) throw new Error("expected an agent candidate");

		expect(selected.value).toBe("agent:scout");
		expect(provider.isNamespaceToken("/agent:sco")).toBe(true);
		expect(provider.matchesNamespaceQuery("/agent:sco", "agent:scout")).toBe(true);
		expect(provider.matchesNamespaceQuery("/agent:ora", "agent:scout")).toBe(false);
		expect(provider.applyCompletion([line], 0, line.length, selected, result.prefix).lines[0]).toBe(
			"review ^sonnet with /agent:scout ",
		);
	});
});

describe("Composer hint-token completion", () => {
	const createHintComposer = (): Composer =>
		new Composer({
			autocomplete: new CombinedAutocompleteProvider([], "/tmp", { namespaces }),
		});

	it("inserts the hint on Enter instead of submitting the draft", async () => {
		const composer = createHintComposer();
		let submitted: string | undefined;
		composer.onSubmit = text => {
			submitted = text;
		};

		type(composer, "/agent:");
		await offered(composer, "agent:scout");
		type(composer, "sco");
		await offered(composer, "agent:scout");

		sendKey(composer.node, composer.field, key("\r"));

		expect(composer.text()).toBe("/agent:scout ");
		expect(submitted).toBeUndefined();
	});

	it("accepts two hint tokens into one draft and keeps the prose between them", async () => {
		const composer = createHintComposer();

		type(composer, "/agent:sco");
		await offered(composer, "agent:scout");
		sendKey(composer.node, composer.field, key("\t"));
		type(composer, "and /model:flash");
		await offered(composer, "model:deepseek/deepseek-flash");
		sendKey(composer.node, composer.field, key("\t"));

		expect(composer.text()).toBe("/agent:scout and /model:deepseek/deepseek-flash ");
	});

	it("continues completing `/local:` past an inner slash", async () => {
		const composer = createHintComposer();

		type(composer, "read /local:src/fi");
		await offered(composer, "local:src/fi.ts");
		sendKey(composer.node, composer.field, key("\r"));

		expect(composer.text()).toBe("read /local:src/fi.ts ");
	});

	it("never opens a hint popup inside another command or local execution", async () => {
		const commandLine = createHintComposer();
		type(commandLine, "/compact /agent:");
		await settle();
		expect(commandLine.completing()).toBe(false);

		const shell = createHintComposer();
		type(shell, "!echo /agent:");
		await settle();
		expect(shell.completing()).toBe(false);
	});

	it("completes bare-prefix `/sco`, `/flash`, and `/plan` at prompt start without submitting on Enter", async () => {
		const composer = new Composer({
			autocomplete: new CombinedAutocompleteProvider(
				[
					{ name: "model", description: "Switch model" },
					{ name: "local", description: "Open local file" },
					{ name: "session", description: "Session management commands" },
				],
				"/tmp",
				{ namespaces },
			),
		});
		let submitted: string | undefined;
		composer.onSubmit = text => {
			submitted = text;
		};

		type(composer, "/sco");
		await offered(composer, "agent:scout");
		sendKey(composer.node, composer.field, key("\r"));
		expect(composer.text()).toBe("/agent:scout ");
		expect(submitted).toBeUndefined();

		composer.setText("");
		type(composer, "/flash");
		await offered(composer, "model:deepseek/deepseek-flash");
		sendKey(composer.node, composer.field, key("\t"));
		expect(composer.text()).toBe("/model:deepseek/deepseek-flash ");

		composer.setText("");
		type(composer, "/plan");
		await offered(composer, "local:plans/x.md");
		sendKey(composer.node, composer.field, key("\t"));
		expect(composer.text()).toBe("/local:plans/x.md ");
	});

	it("completes bare-prefix hints mid-prompt and keeps surrounding prose", async () => {
		const composer = new Composer({
			autocomplete: new CombinedAutocompleteProvider(
				[{ name: "skill:investigation", description: "Investigate" }],
				"/tmp",
				{
					namespaces,
				},
			),
		});

		type(composer, "ask /sco");
		await offered(composer, "agent:scout");
		sendKey(composer.node, composer.field, key("\t"));
		expect(composer.text()).toBe("ask /agent:scout ");

		type(composer, "using /sonnet");
		await offered(composer, "model:anthropic/claude-sonnet");
		sendKey(composer.node, composer.field, key("\t"));
		expect(composer.text()).toBe("ask /agent:scout using /model:anthropic/claude-sonnet ");

		type(composer, "on /fi");
		await offered(composer, "local:src/fi.ts");
		sendKey(composer.node, composer.field, key("\t"));
		expect(composer.text()).toBe("ask /agent:scout using /model:anthropic/claude-sonnet on /local:src/fi.ts ");
	});

	it("keeps matching builtin commands ahead of bare-prefix hints and suppresses mid-prompt hints in commands", async () => {
		const provider = new CombinedAutocompleteProvider(
			[
				{ name: "model", description: "Switch model" },
				{ name: "local", description: "Open local file" },
				{ name: "switch", description: "Switch model" },
			],
			"/tmp",
			{ namespaces },
		);

		// `/s` matches `/switch` (prefix tier 900), so `agent:scout` and `local:src/fi.ts` (900) do not break out.
		const sValues = provider.trySyncSlashCompletion("/s")?.items.map(item => item.value) ?? [];
		expect(sValues[0]).toBe("switch");
		expect(sValues).not.toContain("agent:scout");
		expect(sValues).not.toContain("local:src/fi.ts");
		// `/sc` drops `/switch` (tier 0), so `agent:scout` breaks out immediately.
		expect(provider.trySyncSlashCompletion("/sc")?.items[0]?.value).toBe("agent:scout");
		// `/compact /sco` and `!echo /sco` do not offer bare-prefix hint completions.
		expect(await provider.getSuggestions(["/compact /sco"], 0, "/compact /sco".length)).toBeNull();
		expect(await provider.getSuggestions(["!echo /sco"], 0, "!echo /sco".length)).toBeNull();
	});
});

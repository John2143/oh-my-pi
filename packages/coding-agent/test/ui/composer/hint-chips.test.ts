import { describe, expect, it } from "bun:test";
import { Composer } from "../../../src/ui/composer";
import { hintTokenAtomizer } from "../../../src/ui/composer/hint-chips";
import { key, sendKey } from "./harness";

const SYMBOLS: Record<string, string> = {
	"icon.agents": "👥",
	"icon.model": "⬢",
	"icon.extensionContextFile": "📎",
};

function createHintChipComposer(): Composer {
	const composer = new Composer();
	composer.setAtomizer(
		hintTokenAtomizer({
			agent: name => (name === "scout" ? {} : name === "custom" ? { path: "/tmp/agents/custom.md" } : undefined),
			model: selector =>
				selector === "anthropic/claude-sonnet"
					? { name: "Claude Sonnet" }
					: selector === "openai/gpt-5"
						? { name: "GPT-5" }
						: undefined,
			local: rel => (rel === "plans/x.md" ? { path: "/tmp/local/plans/x.md" } : undefined),
			symbol: k => SYMBOLS[k] ?? "",
		}),
	);
	return composer;
}

describe("hintTokenAtomizer", () => {
	it("collapses known /agent:, /model:, and /local: tokens into colored chips and expands them back on submit", () => {
		const composer = createHintChipComposer();
		let submitted: string | undefined;
		composer.onSubmit = text => {
			submitted = text;
		};

		composer.setCollapsedText("use /agent:scout with /model:anthropic/claude-sonnet on /local:plans/x.md.");

		expect(composer.text()).toBe("use 👥 scout with ⬢ Claude Sonnet on 📎 plans/x.md.");
		expect(composer.expandedText()).toBe(
			"use /agent:scout with /model:anthropic/claude-sonnet on /local:plans/x.md.",
		);

		composer.submit();
		expect(submitted).toBe("use /agent:scout with /model:anthropic/claude-sonnet on /local:plans/x.md.");
	});

	it("leaves unknown hint targets literal as typo feedback", () => {
		const composer = createHintChipComposer();
		composer.setCollapsedText("try /agent:ghost /model:no/such /local:missing.md");

		expect(composer.text()).toBe("try /agent:ghost /model:no/such /local:missing.md");
	});

	it("skips hint tokens inside code spans, slash commands, and local-execution drafts", () => {
		const composer = createHintChipComposer();

		composer.setCollapsedText("example `/agent:scout` and /agent:scout");
		expect(composer.text()).toBe("example `/agent:scout` and 👥 scout");

		composer.setCollapsedText("/compact /agent:scout");
		expect(composer.text()).toBe("/compact /agent:scout");

		composer.setCollapsedText("!echo /agent:scout");
		expect(composer.text()).toBe("!echo /agent:scout");
	});

	it("deletes a hint chip atomically on Backspace", () => {
		const composer = createHintChipComposer();
		composer.setCollapsedText("/agent:scout");
		expect(composer.text()).toBe("👥 scout");

		sendKey(composer.node, composer.field, key("\x7f"));
		expect(composer.text()).toBe("");
	});

	it("restores submitted <agent name=…/> tags into amber chips on rewind while leaving code spans literal", () => {
		const composer = createHintChipComposer();
		composer.setCollapsedText('run <agent name="custom"/> and `<agent name="scout"/>` on local://plans/x.md');

		expect(composer.text()).toBe('run 👥 custom and `<agent name="scout"/>` on local://plans/x.md');
		expect(composer.expandedText()).toBe('run /agent:custom and `<agent name="scout"/>` on local://plans/x.md');
	});
});

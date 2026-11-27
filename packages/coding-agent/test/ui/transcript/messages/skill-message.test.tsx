/** @jsxImportSource @oh-my-pi/pi-tui */
import { describe, expect, it } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import * as url from "node:url";
import { createRoot, signal } from "@oh-my-pi/pi-tui";
import { paintNode } from "@oh-my-pi/pi-tui/term/paint";
import { stripEscapes } from "@oh-my-pi/pi-tui/text/ansi";
import { corpusEnvironment } from "@oh-my-pi/pi-tui/testing/corpus";
import { SkillMessage, type SkillMessageProps } from "../../../../src/ui/transcript/messages/skill-message";
import { skillChipLabel } from "../../../../src/ui/transcript/messages/chips";
import { screenSuite, single } from "./harness";

screenSuite("skill-message", corpusCase => {
	const inputs = corpusCase.inputs as {
		message: {
			content: SkillMessageProps["content"];
			details?: SkillMessageProps["details"];
		};
		imageLinks: string[];
	};
	const expanded = signal(false);
	return {
		node: single(
			<SkillMessage
				content={inputs.message.content}
				details={inputs.message.details}
				imageLinks={inputs.imageLinks}
				expanded={expanded}
			/>,
		),
		apply(label) {
			// `pending` holds an optimistic row live; it expands first and changes nothing visible.
			if (label === "expanded" || label === "pending") expanded.set(true);
			else if (label === "collapsed") expanded.set(false);
			else throw new Error(`unknown stage ${label}`);
		},
	};
});

describe("SkillMessage multi-skill card", () => {
	it("chips every attached skill and reports the combined prompt size", () => {
		const firstPath = path.join(os.homedir(), ".agent/skills/atomic-commit/SKILL.md");
		const secondPath = path.join(os.homedir(), ".agent/skills/atomic-push/SKILL.md");
		const env = corpusEnvironment("dark");
		createRoot(() => {
			const expanded = signal(false);
			const node = single(
				<SkillMessage
					content="Combined skill prompt"
					details={{
						name: "atomic-commit",
						path: firstPath,
						lineCount: 88,
						args: "fix auth",
						prompt: "/skill:atomic-commit /skill:atomic-push fix auth",
						skills: [
							{ name: "atomic-commit", path: firstPath, lineCount: 88 },
							{ name: "atomic-push", path: secondPath, lineCount: 12 },
						],
					}}
					expanded={expanded}
				/>,
			);
			const rows = paintNode({ ...env, hyperlinks: () => true }, node, 80).rows;
			const plain = rows.map(row => stripEscapes(row)).join("\n");
			expect(plain).toContain(skillChipLabel("atomic-commit"));
			expect(plain).toContain(skillChipLabel("atomic-push"));
			expect(plain).not.toContain("/skill:");
			expect(plain).toContain("2 skills · 100 lines");
			expect(rows.join("\n")).toContain(url.pathToFileURL(firstPath).href);
			expect(rows.join("\n")).toContain(url.pathToFileURL(secondPath).href);
		});
	});

	it("only chips attached skills; a token the dispatcher ignored stays literal", () => {
		const firstPath = path.join(os.homedir(), ".agent/skills/atomic-commit/SKILL.md");
		const env = corpusEnvironment("dark");
		createRoot(() => {
			const expanded = signal(false);
			const node = single(
				<SkillMessage
					content="Skill prompt"
					details={{
						name: "atomic-commit",
						path: firstPath,
						lineCount: 88,
						args: "fix auth /skill:ghost",
						prompt: "fix auth /skill:atomic-commit and /skill:ghost",
						skills: [{ name: "atomic-commit", path: firstPath, lineCount: 88 }],
					}}
					expanded={expanded}
				/>,
			);
			const rows = paintNode(env, node, 80).rows;
			const plain = rows.map(row => stripEscapes(row)).join("\n");
			expect(plain).toContain(skillChipLabel("atomic-commit"));
			expect(plain).toContain("/skill:ghost");
		});
	});
});

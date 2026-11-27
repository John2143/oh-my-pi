/** @jsxImportSource @oh-my-pi/pi-tui */
import { describe, expect, it } from "bun:test";
import * as url from "node:url";
import { createRoot, signal } from "@oh-my-pi/pi-tui";
import { paintNode } from "@oh-my-pi/pi-tui/term/paint";
import { stripEscapes } from "@oh-my-pi/pi-tui/text/ansi";
import { corpusEnvironment } from "@oh-my-pi/pi-tui/testing/corpus";
import { currentTheme } from "@oh-my-pi/pi-tui/theme/runtime";
import { chipMarks, chipText, termChips } from "../../../../src/ui/transcript/messages/chips";
import { SkillMessage } from "../../../../src/ui/transcript/messages/skill-message";
import { UserMessage } from "../../../../src/ui/transcript/messages/user-message";
import { single } from "./harness";

describe("transcript hint-token chips", () => {
	it("collapses /agent:, /model:, and /local: prose tokens with distinct styles, pills, and links", () => {
		const agentFile = "/tmp/agents/custom.md";
		const localFile = "/tmp/local/plans/x.md";
		const env = corpusEnvironment("dark");
		createRoot(() => {
			const symbols = currentTheme().symbols;
			const result = chipText("ask /agent:custom with /model:anthropic/claude-sonnet on /local:plans/x.md.", {
				agentPath: name => (name === "custom" ? agentFile : undefined),
				localPath: rel => (rel === "plans/x.md" ? localFile : undefined),
				modelLabel: selector => (selector === "anthropic/claude-sonnet" ? "Claude Sonnet" : undefined),
			});

			expect(result.text).toBe(
				`ask ${symbols.symbol("icon.agents")} custom with ${symbols.symbol("icon.model")} Claude Sonnet on ${symbols.symbol("icon.extensionContextFile")} plans/x.md.`,
			);
			expect(result.chips.map(c => c.kind)).toEqual(["agent", "model", "local"]);
			expect(termChips(result.chips)).toEqual([
				{
					t: `${symbols.symbol("icon.agents")} custom`,
					color: "statusLineSubagents strong",
					pill: true,
					link: { path: agentFile, line: 1 },
				},
				{
					t: `${symbols.symbol("icon.model")} Claude Sonnet`,
					color: "statusLineModel strong",
					pill: true,
				},
				{
					t: `${symbols.symbol("icon.extensionContextFile")} plans/x.md`,
					color: "statusLinePath strong",
					pill: true,
					link: { path: localFile },
				},
			]);
			expect(chipMarks(result.chips)).toEqual([
				{
					t: `${symbols.symbol("icon.agents")} custom`,
					s: "statusLineSubagents strong",
					href: url.pathToFileURL(agentFile).href,
				},
				{
					t: `${symbols.symbol("icon.model")} Claude Sonnet`,
					s: "statusLineModel strong",
				},
				{
					t: `${symbols.symbol("icon.extensionContextFile")} plans/x.md`,
					s: "statusLinePath strong",
					href: url.pathToFileURL(localFile).href,
				},
			]);

			const node = single(
				<UserMessage
					model={{
						text: "ask /agent:custom with /model:anthropic/claude-sonnet on /local:plans/x.md",
						agentPath: name => (name === "custom" ? agentFile : undefined),
						localPath: rel => (rel === "plans/x.md" ? localFile : undefined),
						modelLabel: selector => (selector === "anthropic/claude-sonnet" ? "Claude Sonnet" : undefined),
					}}
				/>,
			);
			const rows = paintNode({ ...env, hyperlinks: () => true }, node, 100).rows;
			const plain = rows.map(row => stripEscapes(row)).join("\n");
			expect(plain).toContain(`${symbols.symbol("icon.agents")} custom`);
			expect(plain).toContain(`${symbols.symbol("icon.model")} Claude Sonnet`);
			expect(plain).toContain(`${symbols.symbol("icon.extensionContextFile")} plans/x.md`);
			expect(rows.join("\n")).toContain(url.pathToFileURL(agentFile).href);
			expect(rows.join("\n")).toContain(url.pathToFileURL(localFile).href);
		});
	});

	it("leaves hint tokens inside code spans, URLs, and synthetic messages untouched", () => {
		const env = corpusEnvironment("dark");
		createRoot(() => {
			const code = chipText("run `/agent:scout` and https://example.com/local:x");
			expect(code.text).toBe("run `/agent:scout` and https://example.com/local:x");
			expect(code.chips).toEqual([]);

			const node = single(
				<UserMessage
					model={{
						text: "synthetic /agent:scout",
						synthetic: true,
					}}
				/>,
			);
			const plain = paintNode(env, node, 80)
				.rows.map(row => stripEscapes(row))
				.join("\n");
			expect(plain).toContain("/agent:scout");
		});
	});

	it("renders hint chips inside SkillMessage drafts alongside skill chips", () => {
		const env = corpusEnvironment("dark");
		createRoot(() => {
			const symbols = currentTheme().symbols;
			const expanded = signal(false);
			const node = single(
				<SkillMessage
					content="Skill body"
					details={{
						name: "reviewer",
						path: "/tmp/reviewer/SKILL.md",
						lineCount: 10,
						args: "/agent:scout check /local:plans/x.md",
						prompt: "/agent:scout /skill:reviewer check /local:plans/x.md",
						skills: [{ name: "reviewer", path: "/tmp/reviewer/SKILL.md", lineCount: 10 }],
					}}
					localPath={rel => (rel === "plans/x.md" ? "/tmp/local/plans/x.md" : undefined)}
					expanded={expanded}
				/>,
			);
			const rows = paintNode({ ...env, hyperlinks: () => true }, node, 100).rows;
			const plain = rows.map(row => stripEscapes(row)).join("\n");
			expect(plain).toContain(`${symbols.symbol("icon.agents")} scout`);
			expect(plain).toContain(`${symbols.symbol("icon.extensionSkill")} reviewer`);
			expect(plain).toContain(`${symbols.symbol("icon.extensionContextFile")} plans/x.md`);
			expect(rows.join("\n")).toContain(url.pathToFileURL("/tmp/local/plans/x.md").href);
		});
	});

	it("renders expanded <agent name=…/>, <model …/>, and local:// URLs as chips while leaving code spans and URLs literal", () => {
		const agentFile = "/tmp/agents/custom.md";
		const localFile = "/tmp/local/plans/x.md";
		createRoot(() => {
			const symbols = currentTheme().symbols;
			const expanded = chipText(
				'ask <agent name="custom"/> with <model agent="m1" name="Claude Sonnet"/> on local://plans/x.md.',
				{
					agentPath: name => (name === "custom" ? agentFile : undefined),
					localPath: rel => (rel === "plans/x.md" ? localFile : undefined),
				},
			);
			expect(expanded.text).toBe(
				`ask ${symbols.symbol("icon.agents")} custom with ${symbols.symbol("icon.model")} Claude Sonnet on ${symbols.symbol("icon.extensionContextFile")} plans/x.md.`,
			);
			expect(expanded.chips.map(c => c.kind)).toEqual(["mention", "agent", "local"]);
			expect(termChips(expanded.chips)).toEqual([
				{
					t: `${symbols.symbol("icon.model")} Claude Sonnet`,
					color: "statusLineModel strong",
					pill: true,
				},
				{
					t: `${symbols.symbol("icon.agents")} custom`,
					color: "statusLineSubagents strong",
					pill: true,
					link: { path: agentFile, line: 1 },
				},
				{
					t: `${symbols.symbol("icon.extensionContextFile")} plans/x.md`,
					color: "statusLinePath strong",
					pill: true,
					link: { path: localFile },
				},
			]);

			const codeAndUrl = chipText('keep `<agent name="custom"/>` and `local://plans/x.md` and https://example.com/local://x');
			expect(codeAndUrl.text).toBe('keep `<agent name="custom"/>` and `local://plans/x.md` and https://example.com/local://x');
			expect(codeAndUrl.chips).toEqual([]);

			const synthetic = chipText('synthetic <agent name="custom"/> on local://plans/x.md', { hintTokens: false });
			expect(synthetic.text).toBe('synthetic <agent name="custom"/> on local://plans/x.md');
			expect(synthetic.chips).toEqual([]);
		});
	});
});

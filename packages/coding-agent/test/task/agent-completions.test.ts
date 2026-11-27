import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	getCachedAgentCompletions,
	listAgentCompletions,
	resetAgentCompletionCache,
} from "@oh-my-pi/pi-coding-agent/task/agent-completions";
import type { AgentDefinition } from "@oh-my-pi/pi-coding-agent/task/types";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

const tempDirs: string[] = [];

async function createProject(agents: readonly { name: string; description: string }[]): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-completions-"));
	tempDirs.push(dir);
	const agentsDir = path.join(dir, ".omp", "agents");
	await fs.mkdir(agentsDir, { recursive: true });
	for (const agent of agents) {
		await fs.writeFile(
			path.join(agentsDir, `${agent.name}.md`),
			`---\nname: ${agent.name}\ndescription: ${agent.description}\n---\nDo the work.\n`,
		);
	}
	return dir;
}

function sessionAgent(name: string, description: string): AgentDefinition {
	return { name, description, systemPrompt: `You are ${name}.`, source: "user" };
}

function names(items: readonly { name: string }[]): string[] {
	return items.map(item => item.name);
}

afterEach(async () => {
	resetAgentCompletionCache();
	for (const dir of tempDirs.splice(0)) await removeWithRetries(dir);
});

describe("listAgentCompletions", () => {
	test("offers discovered and session-defined agents", async () => {
		const cwd = await createProject([{ name: "disk-agent", description: "From the project" }]);

		const items = await listAgentCompletions({
			cwd,
			disabledAgents: [],
			sessionAgents: [sessionAgent("session-agent", "From this session")],
		});

		expect(names(items)).toContain("disk-agent");
		expect(names(items)).toContain("session-agent");
		expect(items.find(item => item.name === "disk-agent")?.description).toBe("From the project");
	});

	test("drops the agents the user disabled", async () => {
		const cwd = await createProject([{ name: "disabled-agent", description: "Disabled" }]);

		const items = await listAgentCompletions({
			cwd,
			disabledAgents: ["disabled-agent"],
			sessionAgents: [sessionAgent("kept-agent", "Kept")],
		});

		expect(names(items)).not.toContain("disabled-agent");
		expect(names(items)).toContain("kept-agent");
	});

	test("merges session agents ahead of same-named discovered ones", async () => {
		const cwd = await createProject([{ name: "shared-agent", description: "From the project" }]);

		const items = await listAgentCompletions({
			cwd,
			disabledAgents: [],
			sessionAgents: [sessionAgent("shared-agent", "From this session")],
		});

		expect(items.filter(item => item.name === "shared-agent")).toHaveLength(1);
		expect(items.find(item => item.name === "shared-agent")?.description).toBe("From this session");
	});

	test("sorts by name", async () => {
		const cwd = await createProject([
			{ name: "zeta-agent", description: "Z" },
			{ name: "alpha-agent", description: "A" },
		]);

		const items = await listAgentCompletions({ cwd, disabledAgents: [], sessionAgents: [] });

		expect(names(items)).toEqual([...names(items)].sort((a, b) => a.localeCompare(b)));
	});

	test("exposes real filePath for disk agents and omits embedded paths on bundled agents", async () => {
		const cwd = await createProject([{ name: "disk-agent", description: "From the project" }]);

		const cold = getCachedAgentCompletions({ cwd, disabledAgents: [], sessionAgents: [] });
		expect(cold.stale).toBe(true);
		const bundledScout = cold.items.find(item => item.name === "scout");
		expect(bundledScout).toBeDefined();
		expect(bundledScout?.filePath).toBeUndefined();

		const warmed = await listAgentCompletions({ cwd, disabledAgents: [], sessionAgents: [] });
		expect(warmed.find(item => item.name === "disk-agent")?.filePath).toBe(
			path.join(cwd, ".omp", "agents", "disk-agent.md"),
		);

		const hot = getCachedAgentCompletions({ cwd, disabledAgents: [], sessionAgents: [] });
		expect(hot.stale).toBe(false);
		expect(hot.items.find(item => item.name === "disk-agent")?.filePath).toBe(
			path.join(cwd, ".omp", "agents", "disk-agent.md"),
		);
	});
});

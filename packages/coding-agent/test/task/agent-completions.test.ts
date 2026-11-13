import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { listAgentCompletions, resetAgentCompletionCache } from "@oh-my-pi/pi-coding-agent/task/agent-completions";
import { SEANCE_AGENT_NAME } from "@oh-my-pi/pi-coding-agent/task/seance-policy";
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
			planMode: false,
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
			planMode: false,
			sessionAgents: [sessionAgent("kept-agent", "Kept")],
		});

		expect(names(items)).not.toContain("disabled-agent");
		expect(names(items)).toContain("kept-agent");
	});

	test("hides the seance reader only in plan mode", async () => {
		const cwd = await createProject([]);
		const sessionAgents = [sessionAgent(SEANCE_AGENT_NAME, "Reads a source session")];

		const editable = await listAgentCompletions({ cwd, disabledAgents: [], planMode: false, sessionAgents });
		const planned = await listAgentCompletions({ cwd, disabledAgents: [], planMode: true, sessionAgents });

		expect(names(editable)).toContain(SEANCE_AGENT_NAME);
		expect(names(planned)).not.toContain(SEANCE_AGENT_NAME);
	});

	test("merges session agents ahead of same-named discovered ones", async () => {
		const cwd = await createProject([{ name: "shared-agent", description: "From the project" }]);

		const items = await listAgentCompletions({
			cwd,
			disabledAgents: [],
			planMode: false,
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

		const items = await listAgentCompletions({ cwd, disabledAgents: [], planMode: false, sessionAgents: [] });

		expect(names(items)).toEqual([...names(items)].sort((a, b) => a.localeCompare(b)));
	});
});

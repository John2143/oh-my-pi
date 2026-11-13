import * as os from "node:os";
import type { EffectiveExtensionRoots } from "../capability/types";
import { discoverAgents } from "./discovery";
import { SEANCE_AGENT_NAME } from "./seance-policy";
import type { AgentDefinition } from "./types";

/** One `/agent:<name>` completion candidate. */
export interface AgentCompletionItem {
	name: string;
	description?: string;
}

const DISCOVERY_TTL_MS = 5_000;
const discoveryMemo = new Map<string, { agents: readonly AgentDefinition[]; at: number }>();

async function discoverForCompletions(
	cwd: string,
	extensionRoots: EffectiveExtensionRoots | undefined,
	signal: AbortSignal | undefined,
): Promise<readonly AgentDefinition[]> {
	const key = `${cwd}\0${JSON.stringify(extensionRoots ?? null)}`;
	const cached = discoveryMemo.get(key);
	if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.agents;
	const { agents } = await discoverAgents(cwd, os.homedir(), extensionRoots);
	if (signal?.aborted) return [];
	discoveryMemo.set(key, { agents, at: Date.now() });
	return agents;
}

/**
 * Names `/agent:<name>` can complete to: every spawned agent this session can
 * reach (session-defined first, then discovered on disk), minus the agents the
 * user disabled and, in plan mode, the seance reader.
 *
 * Spawn policy (`spawns`) is deliberately not applied: the composer belongs to
 * the human, and a name the policy rejects fails at spawn with the task tool's
 * own message instead of silently vanishing from the list.
 */
export async function listAgentCompletions(input: {
	cwd: string;
	extensionRoots?: EffectiveExtensionRoots;
	disabledAgents: readonly string[];
	planMode: boolean;
	sessionAgents: readonly AgentDefinition[];
	signal?: AbortSignal;
}): Promise<AgentCompletionItem[]> {
	const discovered = await discoverForCompletions(input.cwd, input.extensionRoots, input.signal);
	if (input.signal?.aborted) return [];
	const disabled = new Set(input.disabledAgents);
	const byName = new Map<string, AgentDefinition>();
	for (const agent of [...input.sessionAgents, ...discovered]) {
		if (!byName.has(agent.name)) byName.set(agent.name, agent);
	}
	const items: AgentCompletionItem[] = [];
	for (const agent of byName.values()) {
		if (disabled.has(agent.name)) continue;
		if (input.planMode && agent.name === SEANCE_AGENT_NAME) continue;
		items.push({ name: agent.name, description: agent.description });
	}
	items.sort((a, b) => a.name.localeCompare(b.name));
	return items;
}

/** Drop the discovery memo; tests use it between fixtures. */
export function resetAgentCompletionCache(): void {
	discoveryMemo.clear();
}

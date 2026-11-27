import * as os from "node:os";
import type { EffectiveExtensionRoots } from "../capability/types";
import { loadBundledAgents } from "./agents";
import { discoverAgents } from "./discovery";
import type { AgentDefinition } from "./types";

/** One `/agent:<name>` completion candidate. */
export interface AgentCompletionItem {
	name: string;
	description?: string;
	/** On-disk agent definition path when file-backed (absent for bundled `embedded:` agents). */
	filePath?: string;
}

const DISCOVERY_TTL_MS = 5_000;
const discoveryMemo = new Map<string, { agents: readonly AgentDefinition[]; at: number }>();

function discoveryCacheKey(cwd: string, extensionRoots: EffectiveExtensionRoots | undefined): string {
	return `${cwd}\0${JSON.stringify(extensionRoots ?? null)}`;
}

function mergeAgentCompletions(
	sessionAgents: readonly AgentDefinition[],
	discovered: readonly AgentDefinition[],
	disabledAgents: readonly string[],
): AgentCompletionItem[] {
	const disabled = new Set(disabledAgents);
	const byName = new Map<string, AgentDefinition>();
	for (const agent of [...sessionAgents, ...discovered]) {
		if (!byName.has(agent.name)) byName.set(agent.name, agent);
	}
	const items: AgentCompletionItem[] = [];
	for (const agent of byName.values()) {
		if (disabled.has(agent.name)) continue;
		const filePath = agent.filePath && !agent.filePath.startsWith("embedded:") ? agent.filePath : undefined;
		items.push({ name: agent.name, description: agent.description, ...(filePath ? { filePath } : {}) });
	}
	items.sort((a, b) => a.name.localeCompare(b.name));
	return items;
}

async function discoverForCompletions(
	cwd: string,
	extensionRoots: EffectiveExtensionRoots | undefined,
	signal: AbortSignal | undefined,
): Promise<readonly AgentDefinition[]> {
	const key = discoveryCacheKey(cwd, extensionRoots);
	const cached = discoveryMemo.get(key);
	if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.agents;
	const { agents } = await discoverAgents(cwd, os.homedir(), extensionRoots);
	if (signal?.aborted) return [];
	discoveryMemo.set(key, { agents, at: Date.now() });
	return agents;
}

/**
 * Synchronous cached view of `/agent:<name>` candidates for hot paths
 * (sync slash completion, composer chip atomizer, transcript links).
 * Falls back to bundled agents until disk discovery finishes, and signals
 * `stale` when callers should warm {@link listAgentCompletions} in the background.
 */
export function getCachedAgentCompletions(input: {
	cwd: string;
	extensionRoots?: EffectiveExtensionRoots;
	disabledAgents: readonly string[];
	sessionAgents: readonly AgentDefinition[];
}): { items: AgentCompletionItem[]; stale: boolean } {
	const cached = discoveryMemo.get(discoveryCacheKey(input.cwd, input.extensionRoots));
	const stale = !cached || Date.now() - cached.at >= DISCOVERY_TTL_MS;
	const discovered = cached ? cached.agents : loadBundledAgents();
	return {
		items: mergeAgentCompletions(input.sessionAgents, discovered, input.disabledAgents),
		stale,
	};
}

/**
 * Names `/agent:<name>` can complete to: every spawned agent this session can
 * reach (session-defined first, then discovered on disk), minus the agents the
 * user disabled.
 *
 * Spawn policy (`spawns`) is deliberately not applied: the composer belongs to
 * the human, and a name the policy rejects fails at spawn with the task tool's
 * own message instead of silently vanishing from the list.
 */
export async function listAgentCompletions(input: {
	cwd: string;
	extensionRoots?: EffectiveExtensionRoots;
	disabledAgents: readonly string[];
	sessionAgents: readonly AgentDefinition[];
	signal?: AbortSignal;
}): Promise<AgentCompletionItem[]> {
	const discovered = await discoverForCompletions(input.cwd, input.extensionRoots, input.signal);
	if (input.signal?.aborted) return [];
	return mergeAgentCompletions(input.sessionAgents, discovered, input.disabledAgents);
}

/** Seed the discovery cache from an external scan (e.g. `TaskTool`'s snapshot) so sync lookups see project agents immediately. */
export function seedAgentDiscoveryCache(
	cwd: string,
	extensionRoots: EffectiveExtensionRoots | undefined,
	agents: readonly AgentDefinition[],
): void {
	discoveryMemo.set(discoveryCacheKey(cwd, extensionRoots), { agents, at: Date.now() });
}

/**
 * Synchronous cached lookup for a single non-disabled agent definition
 * (session-defined first, then discovered on disk, falling back to bundled agents).
 */
export function getCachedAgentDefinition(
	input: {
		cwd: string;
		extensionRoots?: EffectiveExtensionRoots;
		disabledAgents: readonly string[];
		sessionAgents: readonly AgentDefinition[];
	},
	name: string,
): AgentDefinition | undefined {
	if (input.disabledAgents.includes(name)) return undefined;
	const fromSession = input.sessionAgents.find(agent => agent.name === name);
	if (fromSession) return fromSession;
	const cached = discoveryMemo.get(discoveryCacheKey(input.cwd, input.extensionRoots));
	const discovered = cached ? cached.agents : loadBundledAgents();
	return discovered.find(agent => agent.name === name);
}

/** Drop the discovery memo; tests use it between fixtures. */
export function resetAgentCompletionCache(): void {
	discoveryMemo.clear();
}

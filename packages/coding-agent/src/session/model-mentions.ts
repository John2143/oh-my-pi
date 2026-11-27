import type { Model } from "@oh-my-pi/pi-ai";
import { getSupportedEfforts } from "@oh-my-pi/pi-catalog/model-thinking";
import { isRecord, prompt } from "@oh-my-pi/pi-utils";
import type { ModelRegistry } from "../config/model-registry";
import { formatModelString } from "../config/model-resolver";
import {
	allowsSkillTokens,
	HINT_TOKEN_RE,
	type HintTokenKind,
	splitHintTokenTrailingPunctuation,
} from "../extensibility/skill-tokens";
import { maskNonProse } from "../modes/view-model/prompt/markdown-prose";
import modelMentionDescription from "../prompts/agents/model-mention.md" with { type: "text" };
import { getBundledAgent } from "../task/agents";
import type { AgentDefinition } from "../task/types";
import {
	MODEL_MENTION_RE,
	MODEL_MENTION_TAG_RE,
	type ModelMention,
	modelMentionDisplayName,
	modelMentionName,
	modelMentionTag,
	resolveModelMentionToken,
} from "./model-mention-syntax";
import { AUTO_THINKING, parseEffort } from "../thinking/levels";
import type { SessionEntry } from "./session-entries";
import type { SessionManager } from "./session-manager";

/** Journal entry identifying a model the user authorized for delegation. */
export const MODEL_MENTION_ENTRY_TYPE = "model_mention";

const PSEUDONYM_AGENT_RE = /^m\d+$/;

function normalizeBaseAgent(baseAgent: string | undefined): string | undefined {
	if (!baseAgent || baseAgent === "task" || PSEUDONYM_AGENT_RE.test(baseAgent)) return undefined;
	return baseAgent;
}

function isValidPersistedBaseAgent(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value !== "task" && !PSEUDONYM_AGENT_RE.test(value);
}

function mentionKey(selector: string, baseAgent?: string): string {
	return baseAgent ? `${baseAgent}\0${selector}` : selector;
}

/** The `m<N>` agents whose expanded mention tags appear in `text`. */
export function referencedModelAgents(text: string): Set<string> {
	return new Set(Array.from(text.matchAll(MODEL_MENTION_TAG_RE), match => match[1]!));
}

/** Replay valid branch entries, keeping the first occurrence of each agent and `(baseAgent, selector)` pair. */
export function readModelMentions(entries: readonly SessionEntry[]): ModelMention[] {
	const mentions: ModelMention[] = [];
	const agents = new Set<string>();
	const keys = new Set<string>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== MODEL_MENTION_ENTRY_TYPE || !isRecord(entry.data)) continue;
		const { agent, baseAgent, selector, name, thinkingLevel } = entry.data;
		if (
			typeof agent !== "string" ||
			!PSEUDONYM_AGENT_RE.test(agent) ||
			(baseAgent !== undefined && !isValidPersistedBaseAgent(baseAgent)) ||
			typeof selector !== "string" ||
			typeof name !== "string" ||
			(thinkingLevel !== undefined &&
				(typeof thinkingLevel !== "string" ||
					parseEffort(thinkingLevel) !== thinkingLevel ||
					!selector.endsWith(`:${thinkingLevel}`)))
		)
			continue;
		const key = mentionKey(selector, baseAgent);
		if (agents.has(agent) || keys.has(key)) continue;
		agents.add(agent);
		keys.add(key);
		mentions.push({ agent, ...(baseAgent ? { baseAgent } : {}), selector, name, thinkingLevel });
	}
	return mentions;
}

/** A `^` or `/model:` selector resolved within the session picker's model scope. */
export type ResolvedModelMention = Omit<ModelMention, "agent" | "baseAgent">;

/** Session capabilities needed to authorize and persist model mentions. */
export interface ModelMentionHost {
	sessionManager: SessionManager;
	modelRegistry: ModelRegistry;
	scopedModels(): ReadonlyArray<Model>;
	/** Resolve a non-disabled base agent template (bundled, user, or project) for specialist pairing. */
	resolveAgent?(name: string): AgentDefinition | undefined;
	/** User-authorized model agents inherited from the parent session. */
	inheritedAgents?: readonly AgentDefinition[];
}

/** Owns branch-local pseudonyms for models explicitly tagged by the user. */
export class ModelMentionRegistry {
	readonly #host: ModelMentionHost;
	readonly #inheritedAgents: readonly AgentDefinition[];
	#mentions: ModelMention[] = [];
	readonly #byKey = new Map<string, ModelMention>();
	readonly #agents = new Set<string>();

	constructor(host: ModelMentionHost) {
		this.#host = host;
		this.#inheritedAgents = host.inheritedAgents ?? [];
	}

	/** Rebuild pseudonyms after resume, rewind, or a session switch. */
	syncFromBranch(): void {
		this.#mentions = readModelMentions(this.#host.sessionManager.getBranch());
		this.#byKey.clear();
		this.#agents.clear();
		for (const agent of this.#inheritedAgents) {
			this.#agents.add(agent.name);
		}
		for (const mention of this.#mentions) {
			this.#byKey.set(mentionKey(mention.selector, mention.baseAgent), mention);
			this.#agents.add(mention.agent);
		}
	}

	/** User-authorized model pseudonyms in first-mention order. */
	get mentions(): readonly ModelMention[] {
		return this.#mentions;
	}

	/**
	 * Resolve `provider/id[:level]` within the session picker's model scope. Exact ids win:
	 * some contain colons (`qwen3:8b`) or end in a level name (`glm-4.7:max`). A level
	 * spelling whose canonical selector is another model's id (`:ma` beside a literal
	 * `…:max`) stays unresolved, since dispatch would run that other model.
	 */
	resolve(selector: string): ResolvedModelMention | undefined {
		const scoped = this.#host.scopedModels();
		const models = scoped.length > 0 ? scoped : this.#host.modelRegistry.getAvailable();
		const exact = models.find(model => formatModelString(model) === selector);
		if (exact) return { selector, name: modelMentionDisplayName(exact) };
		const colon = selector.lastIndexOf(":");
		if (colon <= 0) return undefined;
		const base = selector.slice(0, colon);
		const model = models.find(candidate => formatModelString(candidate) === base);
		if (!model) return undefined;
		const suffix = selector.slice(colon + 1);
		if (suffix === AUTO_THINKING) return { selector: base, name: modelMentionDisplayName(model) };
		const effort = parseEffort(suffix);
		if (effort === undefined || !getSupportedEfforts(model).includes(effort)) return undefined;
		const canonical = `${base}:${effort}`;
		const isModelId = (candidate: Model) => formatModelString(candidate) === canonical;
		if (models.some(isModelId) || (scoped.length > 0 && this.#host.modelRegistry.getAvailable().some(isModelId))) {
			return undefined;
		}
		return {
			selector: canonical,
			name: modelMentionName(modelMentionDisplayName(model), effort),
			thinkingLevel: effort,
		};
	}

	#resolveBaseAgent(name: string): AgentDefinition | undefined {
		if (PSEUDONYM_AGENT_RE.test(name)) return undefined;
		return this.#host.resolveAgent ? this.#host.resolveAgent(name) : getBundledAgent(name);
	}

	#resolveCandidate(selector: string, baseAgent?: string): ResolvedModelMention | undefined {
		const existing = this.#byKey.get(mentionKey(selector, baseAgent));
		if (existing) {
			return {
				selector: existing.selector,
				name: existing.name,
				...(existing.thinkingLevel !== undefined ? { thinkingLevel: existing.thinkingLevel } : {}),
			};
		}
		return this.resolve(selector);
	}

	#getOrCreateMention(resolved: ResolvedModelMention, baseAgent?: string): ModelMention {
		const normalizedBase = normalizeBaseAgent(baseAgent);
		const key = mentionKey(resolved.selector, normalizedBase);
		let mention = this.#byKey.get(key);
		if (!mention) {
			let next = 1;
			while (this.#agents.has(`m${next}`)) next++;
			mention = {
				agent: `m${next}`,
				...(normalizedBase ? { baseAgent: normalizedBase } : {}),
				...resolved,
			};
			this.#host.sessionManager.appendCustomEntry(MODEL_MENTION_ENTRY_TYPE, mention);
			this.#mentions.push(mention);
			this.#byKey.set(key, mention);
			this.#agents.add(mention.agent);
		}
		return mention;
	}

	/**
	 * Register user-tagged models (`^selector` and prose `/model:<selector>`) and replace their
	 * tokens with persisted `<model agent="m<N>" name="…"/>` tags. When paired with a known
	 * specialist `/agent:<name>`, the pseudonym clones that specialist's definition.
	 */
	expandMentions(text: string): string {
		const hasCaret = text.includes("^");
		const hasSlashModel = text.includes("/model:") && allowsSkillTokens(text);
		if (!hasCaret && !hasSlashModel) return text;

		const masked =
			hasSlashModel || (text.includes("/agent:") && allowsSkillTokens(text)) ? maskNonProse(text) : undefined;
		const agentSpans: { from: number; to: number; name: string }[] = [];
		const uniqueAgentNames = new Set<string>();
		if (masked && text.includes("/agent:") && allowsSkillTokens(text)) {
			HINT_TOKEN_RE.lastIndex = 0;
			for (const match of masked.matchAll(HINT_TOKEN_RE)) {
				if ((match[2] as HintTokenKind) !== "agent") continue;
				const lead = match[1]!;
				const from = match.index + lead.length;
				const to = match.index + match[0].length;
				const raw = text.slice(from + "/agent:".length, to);
				if (!raw) continue;
				let name: string | undefined;
				if (this.#resolveBaseAgent(raw)) {
					name = raw;
				} else {
					const split = splitHintTokenTrailingPunctuation(raw);
					if (split.trailing && split.value && this.#resolveBaseAgent(split.value)) {
						name = split.value;
					}
				}
				if (!name) continue;
				agentSpans.push({ from, to, name });
				uniqueAgentNames.add(name);
			}
		}

		const pairedBaseAgent = (tokenStart: number, tokenEnd: number): string | undefined => {
			if (agentSpans.length === 0) return undefined;
			// Rule 1: directly adjacent known `/agent:<name>` separated only by whitespace (left-before-right).
			for (let i = agentSpans.length - 1; i >= 0; i--) {
				const span = agentSpans[i]!;
				if (span.to <= tokenStart) {
					if (text.slice(span.to, tokenStart).trim() === "") return normalizeBaseAgent(span.name);
					break;
				}
			}
			for (const span of agentSpans) {
				if (span.from >= tokenEnd) {
					if (text.slice(tokenEnd, span.from).trim() === "") return normalizeBaseAgent(span.name);
					break;
				}
			}
			// Rule 2: exactly one distinct known `/agent:<name>` referenced in this prompt.
			if (uniqueAgentNames.size === 1) {
				const [only] = uniqueAgentNames;
				return normalizeBaseAgent(only);
			}
			// Rule 3: ambiguous multi-agent prompt — default to `task`.
			return undefined;
		};

		const candidates: { from: number; to: number; raw: string }[] = [];
		if (hasCaret) {
			MODEL_MENTION_RE.lastIndex = 0;
			for (const match of text.matchAll(MODEL_MENTION_RE)) {
				const lead = match[1]!;
				candidates.push({
					from: match.index + lead.length,
					to: match.index + match[0].length,
					raw: match[2]!,
				});
			}
		}
		if (hasSlashModel && masked) {
			HINT_TOKEN_RE.lastIndex = 0;
			for (const match of masked.matchAll(HINT_TOKEN_RE)) {
				if ((match[2] as HintTokenKind) !== "model") continue;
				const lead = match[1]!;
				const from = match.index + lead.length;
				const to = match.index + match[0].length;
				const raw = text.slice(from + "/model:".length, to);
				if (!raw) continue;
				candidates.push({ from, to, raw });
			}
		}
		if (candidates.length === 0) return text;
		candidates.sort((a, b) => a.from - b.from);

		let out = "";
		let at = 0;
		for (const candidate of candidates) {
			const baseAgent = pairedBaseAgent(candidate.from, candidate.to);
			const match = resolveModelMentionToken(candidate.raw, selector => this.#resolveCandidate(selector, baseAgent));
			if (!match) continue;
			const mention = this.#getOrCreateMention(match.value, baseAgent);
			out += text.slice(at, candidate.from) + modelMentionTag(mention) + match.suffix;
			at = candidate.to;
		}
		return at > 0 ? out + text.slice(at) : text;
	}

	/** Expose inherited and session-tagged models as task or paired-specialist agents. */
	sessionAgents(): AgentDefinition[] {
		const task = getBundledAgent("task");
		if (!task) throw new Error("Bundled task agent is unavailable");
		const inheritedNames = new Set(this.#inheritedAgents.map(agent => agent.name));
		const result: AgentDefinition[] = [...this.#inheritedAgents];
		for (const mention of this.#mentions) {
			if (inheritedNames.has(mention.agent)) continue;
			let base: AgentDefinition;
			if (mention.baseAgent) {
				const resolved = this.#resolveBaseAgent(mention.baseAgent);
				// Never escalate a disabled/deleted read-only specialist pseudonym into read-write `task`.
				if (!resolved) continue;
				base = resolved;
			} else {
				base = task;
			}
			result.push({
				...base,
				name: mention.agent,
				description: prompt.render(modelMentionDescription, {
					name: mention.name,
					selector: mention.selector,
					effort: mention.thinkingLevel,
					baseAgent: mention.baseAgent,
					baseDescription: base.description,
				}),
				model: [mention.selector],
				thinkingLevel: mention.thinkingLevel ?? base.thinkingLevel,
				filePath: undefined,
			});
		}
		return result;
	}
}

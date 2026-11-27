import {
	type BuiltSkillPromptMessage,
	loadSkillPrompt,
	renderUserSkillPrompts,
	type Skill,
	type SkillPromptInput,
} from "@oh-my-pi/pi-coding-agent/extensibility/skills";

/**
 * Session-stub plural builder: reads every named skill's body from disk, then
 * renders one combined prompt — the same shape `AgentSession.buildUserSkillPrompts`
 * produces, without the session's model-mention expansion.
 */
export async function buildUserSkillPromptsForTest(
	skills: readonly Pick<Skill, "name" | "filePath" | "baseDir">[],
	input: SkillPromptInput,
): Promise<BuiltSkillPromptMessage> {
	const loaded = await Promise.all(skills.map(skill => loadSkillPrompt(skill)));
	return renderUserSkillPrompts(loaded, input);
}

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildSkillPromptMessage, type Skill } from "@oh-my-pi/pi-coding-agent/extensibility/skills";
import { removeWithRetries, Snowflake } from "@oh-my-pi/pi-utils";
import { buildUserSkillPromptsForTest } from "./helpers/skill-prompts";

async function createNamedSkill(name: string, body: string): Promise<{ dir: string; skill: Skill }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), `omp-skill-prompt-${Snowflake.next()}-`));
	const filePath = path.join(dir, "SKILL.md");
	await Bun.write(filePath, `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`);
	return {
		dir,
		skill: {
			name,
			description: `${name} skill`,
			filePath,
			baseDir: dir,
			source: "test",
		},
	};
}

function createSkill(body: string): Promise<{ dir: string; skill: Skill }> {
	return createNamedSkill("reviewer", body);
}

async function createSkillFromRaw(raw: string): Promise<{ dir: string; skill: Skill }> {
	const { dir, skill } = await createSkill("");
	await Bun.write(skill.filePath, raw);
	return { dir, skill };
}

describe("buildSkillPromptMessage", () => {
	test("defaults public skill prompt rendering to user-invoked bug-fix directory guidance", async () => {
		const { dir, skill } = await createSkill("Review the supplied code carefully.");
		try {
			const built = await buildSkillPromptMessage(skill, {
				args: "focus on risks",
				prompt: "/skill:reviewer focus on risks",
			});

			expect(built.message).toContain("Review the supplied code carefully.");
			expect(built.message).toContain(`[Skill directory: ${dir}]`);
			expect(built.message).toContain("focus on risks");
			// The draft reaches the model as typed, so the hint and skill tokens survive.
			expect(built.message).toContain("User: /skill:reviewer focus on risks");
			expect(built.details).toMatchObject({
				name: "reviewer",
				path: skill.filePath,
				args: "focus on risks",
				prompt: "/skill:reviewer focus on risks",
				lineCount: 1,
			});
		} finally {
			await removeWithRetries(dir);
		}
	});

	test("attaches every named skill body behind one user line for a multi-skill draft", async () => {
		const alpha = await createNamedSkill("alpha", "Alpha instructions.");
		const beta = await createNamedSkill("beta", "Beta instructions.");
		try {
			const built = await buildUserSkillPromptsForTest([alpha.skill, beta.skill], {
				args: "fix auth and",
				prompt: "fix auth /skill:alpha and /skill:beta",
			});

			expect(built.message).toContain("User invoked 2 skills");
			expect(built.message).toContain("Alpha instructions.");
			expect(built.message).toContain("Beta instructions.");
			expect(built.message).toContain(`[Skill directory: ${alpha.dir}]`);
			expect(built.message).toContain(`[Skill directory: ${beta.dir}]`);
			expect(built.message.match(/^User: /gm)).toHaveLength(1);
			expect(built.message).toContain("User: fix auth /skill:alpha and /skill:beta");
			expect(built.details).toMatchObject({ name: "alpha", path: alpha.skill.filePath, args: "fix auth and" });
			expect(built.details.skills?.map(entry => entry.name)).toEqual(["alpha", "beta"]);
		} finally {
			await removeWithRetries(alpha.dir);
			await removeWithRetries(beta.dir);
		}
	});

	test("omits the user line when the draft is only tokens", async () => {
		const alpha = await createNamedSkill("alpha", "Alpha instructions.");
		const beta = await createNamedSkill("beta", "Beta instructions.");
		try {
			const built = await buildUserSkillPromptsForTest([alpha.skill, beta.skill], {
				args: "",
				prompt: "/skill:alpha /skill:beta",
			});

			expect(built.message).toContain("Alpha instructions.");
			expect(built.message).toContain("Beta instructions.");
			expect(built.message).not.toContain("User:");
		} finally {
			await removeWithRetries(alpha.dir);
			await removeWithRetries(beta.dir);
		}
	});

	test("keeps autoload skills on non-user minimal framing", async () => {
		const { dir, skill } = await createSkill("Review silently loaded context.");
		try {
			const built = await buildSkillPromptMessage(skill, { args: "" }, "autoload");

			expect(built.message).toContain("Review silently loaded context.");
			expect(built.message).toContain(`Skill: ${skill.filePath}`);
			expect(built.message).not.toContain("The user has invoked");
			expect(built.message).not.toContain("[Skill directory:");
			expect(built.details).toMatchObject({ name: "reviewer", path: skill.filePath, lineCount: 1 });
		} finally {
			await removeWithRetries(dir);
		}
	});

	test("omits CRLF frontmatter but keeps body HTML comments in skill messages", async () => {
		const { dir, skill } = await createSkill("Review the supplied code carefully.");
		try {
			await Bun.write(
				skill.filePath,
				"---\r\nname: reviewer\r\ndescription: Review code\r\n---\r\n\r\nReview the supplied code carefully.\r\n<!-- Never skip tests. -->\r\n",
			);
			for (const invocation of ["user", "autoload"] as const) {
				const built = await buildSkillPromptMessage(skill, { args: "" }, invocation);
				expect(built.message).toContain("Review the supplied code carefully.\n<!-- Never skip tests. -->");
				expect(built.message).not.toContain("description: Review code");
				expect(built.message).not.toContain("name: reviewer");
			}
		} finally {
			await removeWithRetries(dir);
		}
	});

	test("strips frontmatter whose closing delimiter ends the file", async () => {
		const { dir, skill } = await createSkillFromRaw("---\nname: reviewer\ndescription: Review code\n---");
		try {
			const built = await buildSkillPromptMessage(skill, { args: "" }, "autoload");
			expect(built.message).not.toContain("name: reviewer");
			expect(built.details.lineCount).toBe(0);
		} finally {
			await removeWithRetries(dir);
		}
	});

	test("trims a skill body without frontmatter before the autoload separator", async () => {
		const { dir, skill } = await createSkillFromRaw("Plain skill body.\n");
		try {
			const built = await buildSkillPromptMessage(skill, { args: "" }, "autoload");
			expect(built.message.startsWith("Plain skill body.\n\n---\n")).toBe(true);
			expect(built.details.lineCount).toBe(1);
		} finally {
			await removeWithRetries(dir);
		}
	});
});

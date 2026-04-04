import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	InteractionEditReplyOptions,
	MessageFlags,
	ModalSubmitInteraction,
} from "discord.js";
import { inspect } from "util";

import { DiscordModal } from "../../../types/index.js";
import { evalCache } from "../../../utils/index.js";

const evalModal: DiscordModal = {
	customId: "eval_modal",
	devOnly: true,
	async execute(interaction: ModalSubmitInteraction) {
		const code = interaction.fields.getTextInputValue("eval_code");

		// Save to cache so the Re-run button can find it
		evalCache.set(interaction.user.id, code);

		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

		try {
			// Shortcuts made available specifically for the eval scope
			const client = interaction.client;
			const twitch = client.twitch;

			const start = Date.now();

			// Execute the code
			let result;
			try {
				/**
				 * Scope Shadowing: We pass 'undefined' for process, global, and require
				 * to prevent accidental leaks or file system access via the eval string.
				 */
				const wrapper = `(async (process, global, require) => { return ${code} })`;
				result = await eval(wrapper)(undefined, undefined, undefined);
			} catch {
				const wrapper = `(async (process, global, require) => { ${code} })`;
				result = await eval(wrapper)(undefined, undefined, undefined);
			}

			const elapsed = Date.now() - start;

			let displayOutput: string;
			let lang = "js";

			if (result === null) {
				displayOutput = "null";
			} else if (typeof result === "object") {
				try {
					displayOutput = JSON.stringify(result, null, 2);
					lang = "json";
				} catch {
					// depth: 1 prevents the bot from crashing on massive circular objects
					displayOutput = inspect(result, { depth: 1, colors: false });
					lang = "js";
				}
			} else {
				displayOutput = String(result);
				lang = typeof result === "string" ? "txt" : "js";
			}

			// Scrub the output before it is ever sent to Discord
			displayOutput = scrub(displayOutput);

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder({
					custom_id: "eval_rerun",
					label: "Edit & Re-run",
					style: ButtonStyle.Primary,
					emoji: "🔄",
				}),
			);

			const responseOptions: InteractionEditReplyOptions = {
				content: `**✅ Output (${lang})** • *${elapsed}ms*`,
				components: [row.toJSON()],
				files: [],
			};

			if (displayOutput.length > 1900) {
				const fileExtension = lang === "json" ? "json" : "js";
				const attachment = new AttachmentBuilder(Buffer.from(displayOutput, "utf-8"), {
					name: `eval_output.${fileExtension}`,
				});

				responseOptions.content += "\n⚠️ *Output too long; attached as file.*";
				responseOptions.files = [attachment];
			} else {
				responseOptions.content += `\n\`\`\`${lang}\n${displayOutput || "undefined"}\n\`\`\``;
			}

			// Send Result
			await interaction.editReply(responseOptions);
		} catch (err) {
			// Scrub the error stack trace as well, just in case
			const errorMsg = scrub(err instanceof Error ? err.stack || err.message : String(err));

			await interaction.editReply({
				content: `**❌ Error:**\n\`\`\`js\n${errorMsg.slice(0, 1900)}\n\`\`\``,
			});
		}
	},
};

/**
 * Automatically redacts any sensitive values found in process.env
 * from the provided text string.
 */
function scrub(text: string): string {
	if (typeof text !== "string") return text;

	let sanitized = text;
	const envEntries = Object.entries(process.env);

	for (const [key, value] of envEntries) {
		// Skip non-sensitive keys to avoid "collateral redaction"
		const ignoredKeys = ["NODE_ENV", "MODE", "PORT", "TZ"];
		if (ignoredKeys.includes(key)) continue;

		// Only redact strings longer than 4 characters (e.g. tokens, URIs, secrets)
		if (value && typeof value === "string" && value.length > 4) {
			const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const regex = new RegExp(escaped, "g");
			sanitized = sanitized.replace(regex, "[REDACTED]");
		}
	}

	return sanitized;
}

export default evalModal;

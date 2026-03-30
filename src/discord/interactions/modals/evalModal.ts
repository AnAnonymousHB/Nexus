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
			const start = Date.now();

			// Execute the code
			let result;
			try {
				// Wrapped in an async IIFE to allow 'await' in the modal input
				result = await eval(`(async () => { return ${code} })()`);
			} catch {
				result = await eval(`(async () => { ${code} })()`);
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
			const errorMsg = err instanceof Error ? err.stack || err.message : String(err);
			await interaction.editReply({
				content: `**❌ Error:**\n\`\`\`js\n${errorMsg.slice(0, 1900)}\n\`\`\``,
			});
		}
	},
};

export default evalModal;

import {
	AttachmentBuilder, AutocompleteInteraction, ChatInputCommandInteraction,
	ContextMenuCommandInteraction, inlineCode, MessageFlags, PermissionFlagsBits,
	SlashCommandBuilder
} from "discord.js";
import fs from "fs";
import path from "path";
import readLastLines from "read-last-lines";

import { Logger } from "../../../managers/index.js";
import { DiscordCommand } from "../../../types/index.js";

const logs: DiscordCommand = {
	devOnly: true,
	testGuildOnly: true,
	data: new SlashCommandBuilder()
		.setName("logs")
		.setDescription("View the latest entries from the system logs.")
		.addStringOption((option) => option.setName("file").setDescription("Select a log file to view").setAutocomplete(true).setRequired(true))
		.addBooleanOption((option) => option.setName("full_file").setDescription("Upload the entire log file as an attachment?").setRequired(false))
		.addIntegerOption((option) =>
			option.setName("lines").setDescription("Number of lines to preview (Default 20, Max 50)").setMinValue(1).setMaxValue(50),
		),
	async autocomplete(interaction: AutocompleteInteraction) {
		const focusedValue = interaction.options.getFocused();
		const logDir = path.join(process.cwd(), "logs");

		if (!fs.existsSync(logDir)) return interaction.respond([]);

		try {
			const files = fs
				.readdirSync(logDir)
				.filter((file) => file.endsWith(".log"))
				.sort((a, b) => {
					// Sort by modified time to show newest files first
					return fs.statSync(path.join(logDir, b)).mtime.getTime() - fs.statSync(path.join(logDir, a)).mtime.getTime();
				});

			const filtered = files.filter((file) => file.toLowerCase().includes(focusedValue.toLowerCase())).slice(0, 25);

			await interaction.respond(
				filtered.map((file) => ({
					name: file.replace(".log", "").replace(/-/g, " "),
					value: file,
				})),
			);
		} catch (error) {
			Logger.error("DISCORD_LOGS_AUTOCOMPLETE", "Autocomplete Error:", error);
			await interaction.respond([]);
		}
	},
	async execute(interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction) {
		if (!interaction.isChatInputCommand()) return;

		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

		// path.basename prevents directory traversal (e.g., ../../../.env)
		const rawFileName = interaction.options.getString("file", true);
		const fileName = path.basename(rawFileName);

		const fullFile = interaction.options.getBoolean("full_file") || false;
		const count = interaction.options.getInteger("lines") || 20;
		const logDir = path.join(process.cwd(), "logs");
		const filePath = path.join(logDir, fileName);

		// Security check: Ensure the file exists and is actually inside the logs directory
		if (!fs.existsSync(filePath)) {
			return void (await interaction.editReply(`❌ The file ${inlineCode(fileName)} could not be found in the logs directory.`));
		}

		try {
			if (fullFile) {
				const attachment = new AttachmentBuilder(filePath, { name: fileName });
				return void (await interaction.editReply({
					content: `📂 **Full Log File:** ${inlineCode(fileName)}`,
					files: [attachment],
				}));
			}

			let lines = await readLastLines.read(filePath, count);
			lines = lines.trim();

			if (!lines) return void (await interaction.editReply(`ℹ️ The log file ${inlineCode(fileName)} is currently empty.`));

			const output = lines.length > 1900 ? `... (truncated) ...\n${lines.substring(lines.length - 1850)}` : lines;

			await interaction.editReply({
				content: `💬 **File contents:** ${inlineCode(fileName)}\n\`\`\`text\n${output}\n\`\`\``,
			});
		} catch (error) {
			Logger.error("COMMAND_LOGS", `Failed to read log: ${fileName}`, error);
			await interaction.editReply("❌ Failed to process the log file.");
		}
	},
};

export default logs;

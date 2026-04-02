import { TextChannel } from "discord.js";

import { DiscordManager, discordStatusManager, Logger } from "../managers/index.js";
import { CronTask } from "../types/index.js";

const TARGET_CHANNEL_ID = "1489306060354486313";

const discordStatus: CronTask = {
	name: "Discord API Status",
	schedule: "*/5 * * * *",
	async run(apiClient) {
		const client = DiscordManager.getClient();
		if (!client || !client.isReady()) return;

		const result = await discordStatusManager.fetchUpdate();
		if (!result) return;

		const channel = await client.channels.fetch(TARGET_CHANNEL_ID).catch(() => null);
		if (!(channel instanceof TextChannel)) return;

		if (result.messageId) {
			try {
				const message = await channel.messages.fetch(result.messageId);
				await message.edit({ embeds: [result.embed] });
				return;
			} catch (err) {
				// If message was deleted or fetch failed, fall through to send new one
				Logger.error("DISCORD_TASK_API_STATUS", "Error in Discord API Status", err);
			}
		}

		const newMessage = await channel.send({ embeds: [result.embed] });
		await discordStatusManager.saveMessageId(newMessage.id);
	},
};

export default discordStatus;

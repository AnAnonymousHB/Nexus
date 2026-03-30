import { Client, Events } from "discord.js";

import { discordUserManager } from "../../../managers/index.js";

export default (client: Client) => {
	client.on(Events.MessageCreate, async (msg) => {
		if (!msg.guild) return;

		await discordUserManager.updateActivity(msg.author.id, msg.guild.id, msg.channelId);

		if (msg.author.bot) return;
	});
};

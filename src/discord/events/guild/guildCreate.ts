import { Client, Events, Guild } from "discord.js";

import { DiscordGuildManager, Logger } from "../../../managers/index.js";

export default (client: Client) => {
	client.on(Events.GuildCreate, async (guild: Guild) => {
		await DiscordGuildManager.getSettings(guild.id);

		const guildOwner = await guild.fetchOwner();
		Logger.info("DISCORD_GUILD_CREATE", `Joined server ${guild.name} (${guild.id}). Owner: ${guildOwner.user.globalName} (${guild.ownerId})`);
	});
};

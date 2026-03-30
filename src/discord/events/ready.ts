import { Client, Events } from "discord.js";

import { InviteManager, Logger } from "../../managers/index.js";

export default (client: Client) => {
	client.on(Events.ClientReady, async (c) => {
		Logger.setDiscordClient(client);
		Logger.success("DISCORD", `System Online: Logged in as ${c.user.tag}`);

		await InviteManager.init(c);
	});
};

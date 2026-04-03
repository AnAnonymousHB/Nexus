import { Logger, SyncManager } from "../managers/index.js";
import { CronTask } from "../types/index.js";

const twitchChannelNameSync: CronTask = {
	name: "Twitch Channel Name Sync",
	schedule: "0 3 * * *",
	async run(apiClient) {
		try {
			await SyncManager.syncNamesDiscord(apiClient);
		} catch (error) {
			Logger.error("TWITCH_CHANNEL_NAME_SYNC", "Error during Twitch channel name sync", error);
		}
	},
};

export default twitchChannelNameSync;

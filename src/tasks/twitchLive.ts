import { Logger, TwitchManager } from "../managers/index.js";
import { CronTask } from "../types/index.js";

const twitchLive: CronTask = {
	name: "Twitch Live",
	schedule: "*/15 * * * * *",
	async run(apiClient) {
		try {
			await TwitchManager.checkStreams(apiClient);
		} catch (error) {
			Logger.error("DISCORD_TASK_TWITCH", "Error during live notification task execution", error);
		}
	},
};

export default twitchLive;

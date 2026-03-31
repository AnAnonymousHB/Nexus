import { ApiClient } from "@twurple/api";
import { ChatClient } from "@twurple/chat";

import { Logger } from "../../managers/index.js";
import { TwitchCommand } from "../../types/index.js";

export default (chatClient: ChatClient, commands: Map<string, TwitchCommand>, apiClient: ApiClient) => {
	chatClient.onConnect(() => {
		Logger.success("TWITCH", "Successfully connected to Twitch")
	});
};
import { ApiClient } from "@twurple/api";
import { ChatClient, ChatMessage } from "@twurple/chat";

export type PermissionLevel = "everyone" | "vip" | "mod" | "broadcaster" | "dev";

export interface TwitchCommand {
	description?: string;
	aliases?: string[];
	cooldown?: number; // Global cooldown (seconds)
	userCooldown?: number; // Per-user cooldown (seconds)
	forceCooldown?: boolean;
	permission?: PermissionLevel;
	botChannelOnly?: boolean;
	allowedChannels?: string[];
	hidden?: boolean; // Hide from help menu
	execute: (
		chatClient: ChatClient,
		apiClient: ApiClient,
		channel: string,
		user: string,
		text: string,
		msg: ChatMessage,
		args: string[],
		prefix: string,
		commands: Map<string, TwitchCommand>,
	) => Promise<void> | void;
}

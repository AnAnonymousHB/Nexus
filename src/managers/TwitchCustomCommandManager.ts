import { TwitchCustomCommandModel } from "../models/index.js";
import { TwitchCommand } from "../types/index.js";
import { Logger } from "./index.js";

interface CachedCustomCommand {
	response: string;
	cooldown: number;
	userCooldown: number;
}

export class TwitchCustomCommandManager {
	// Key: "channelId-commandName"
	private static cache = new Map<string, CachedCustomCommand>();

	/**
	 * Loads all commands from DB into cache on startup
	 */
	static async loadAll() {
		const commands = await TwitchCustomCommandModel.find({});
		commands.forEach((cmd) => {
			this.cache.set(`${cmd.channelId}-${cmd.commandName}`, {
				response: cmd.response,
				cooldown: cmd.cooldown,
				userCooldown: cmd.userCooldown,
			});
		});
		Logger.info("TWITCH_CUSTOM_COMMANDS", `Loaded ${this.cache.size} custom commands into cache.`);
	}

	static getCommand(channelId: string, name: string) {
		return this.cache.get(`${channelId}-${name}`);
	}

	static async addCommand(channelId: string, name: string, data: CachedCustomCommand) {
		await TwitchCustomCommandModel.findOneAndUpdate({ channelId, commandName: name }, data, { upsert: true });
		this.cache.set(`${channelId}-${name}`, data);
	}

	static async deleteCommand(channelId: string, name: string) {
		const deleted = await TwitchCustomCommandModel.findOneAndDelete({ channelId, commandName: name });
		if (deleted) {
			this.cache.delete(`${channelId}-${name}`);
		}
		return !!deleted;
	}

	static getCommandsByChannel(channelId: string): string[] {
		const channelCommands: string[] = [];
		const prefix = `${channelId}-`;

		for (const key of this.cache.keys()) {
			if (key.startsWith(prefix)) {
				// Remove the channelId prefix to get just the command name
				channelCommands.push(key.replace(prefix, ""));
			}
		}
		return channelCommands;
	}

	static isProtected(name: string, hardcodedCommands: Map<string, TwitchCommand>): boolean {
		// Check if it matches a main command name
		if (hardcodedCommands.has(name.toLowerCase())) return true;

		// Check if it matches any hardcoded aliases
		const isAlias = Array.from(hardcodedCommands.values()).some((cmd) =>
			cmd.aliases?.some((alias) => alias.toLowerCase() === name.toLowerCase()),
		);

		return isAlias;
	}
}

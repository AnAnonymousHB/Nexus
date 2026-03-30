import { Client, Collection, REST, RESTPostAPIApplicationCommandsJSONBody, Routes } from "discord.js";
import fs from "fs";
import cron from "node-cron";
import path from "path";
import { pathToFileURL } from "url";

import { ApiClient } from "@twurple/api";
import { ChatClient } from "@twurple/chat";

import { Logger } from "../managers/index.js";
import { CronTask, DiscordCommand, TwitchCommand } from "../types/index.js";
import { DEFAULT_TIMEZONE, DISCORD_TEST_GUILD_ID } from "./index.js";

interface EventLogEntry {
	"Event Name": string;
	Status: string;
}

interface TaskLogEntry {
	"Task Name": string;
	Schedule: string;
	Timezone: string;
	Status: string;
}

type EventModuleFn = (chatClient: ChatClient, commands: Map<string, TwitchCommand>, apiClient: ApiClient) => void;
type DiscordEventModuleFn = (client: Client) => void;

export class Loader {
	/**
	 * PRIVATE HELPER: Recursively finds all JS/TS files in a directory.
	 * This allows you to nest files in sub-folders like 'buttons/tickets/close.ts'.
	 */
	private static getFilesRecursive(directory: string): string[] {
		let results: string[] = [];
		if (!fs.existsSync(directory)) return results;

		const list = fs.readdirSync(directory);
		for (const file of list) {
			const filePath = path.resolve(directory, file);
			const stat = fs.statSync(filePath);

			if (stat && stat.isDirectory()) {
				results = results.concat(this.getFilesRecursive(filePath));
			} else if (file.endsWith(".js") || (file.endsWith(".ts") && !file.endsWith(".d.ts"))) {
				results.push(filePath);
			}
		}
		return results;
	}

	/**
	 * UNIVERSAL DISCORD INTERACTION LOADER
	 * Handles Buttons, Modals, Menus, and Commands recursively.
	 */
	static async loadDiscordInteractions<T>(dir: string, collection: Collection<string, T>, keyProperty: string | ((item: T) => string)) {
		const files = this.getFilesRecursive(dir);
		const tableData: { File: string; Key: string; Status: string }[] = [];

		// Get the folder name (e.g., "commands", "buttons") for the header
		const categoryName = path.basename(dir).toUpperCase();

		for (const file of files) {
			const fileName = path.basename(file);

			try {
				const fileUrl = `${pathToFileURL(file).href}?update=${Date.now()}`;
				const { default: item } = await import(fileUrl);

				if (!item) continue;

				let keys: string[] = [];

				if (typeof keyProperty === "function") {
					const res = keyProperty(item);
					if (res) keys.push(res);
				} else {
					const res = keyProperty.split(".").reduce((obj, i) => (obj as any)?.[i], item);
					if (res) keys.push(res);
				}

				// EXTRA: Check for Context Menu data in the same file
				if (item.contextData?.name) {
					keys.push(item.contextData.name);
				}

				if (keys.length > 0) {
					for (const key of keys) {
						collection.set(key, item);
					}
					tableData.push({
						File: fileName,
						Key: keys.join(", "), // Shows "avatar, View Avatar" in your console table!
						Status: "✅ Loaded",
					});
				}
			} catch (error) {
				tableData.push({
					File: fileName,
					Key: "Error",
					Status: "❌ Failed",
				});
				Logger.error("DISCORD_LOADER", `Error loading ${fileName}`, error);
			}
		}

		// Print the summary table
		if (tableData.length > 0) {
			// Sort alphabetically by File name for a cleaner look
			const sortedData = tableData.sort((a, b) => a.File.localeCompare(b.File));

			Logger.info("DISCORD_LOADER", `--- 📂 ${sortedData.length} ${categoryName} Registered ---`);
			console.table(sortedData);
		}
	}

	/**
	 * DISCORD EVENT LOADER
	 * Recursively attaches event listeners to the Discord Client.
	 */
	static async loadDiscordEvents(dir: string, client: Client, eventLogs: EventLogEntry[] = []) {
		const files = this.getFilesRecursive(dir);
		const isRoot = path.basename(dir) === "events";

		for (const filePath of files) {
			try {
				const fileUrl = `${pathToFileURL(filePath).href}?update=${Date.now()}`;
				const eventModule = await import(fileUrl);
				const initEvent: DiscordEventModuleFn = eventModule.default;

				if (typeof initEvent === "function") {
					initEvent(client);
					eventLogs.push({
						"Event Name": `Discord: ${path.parse(filePath).name}`,
						Status: "📡 Active",
					});
				}
			} catch (err) {
				Logger.error("DISCORD_LOADER", `Failed to load Discord event: ${path.basename(filePath)}`, err);
			}
		}

		if (isRoot && eventLogs.length > 0) {
			Logger.info("SYSTEM", `--- 📡 ${eventLogs.length} Discord Events Registered ---`);
			console.table(eventLogs.sort((a, b) => a["Event Name"].localeCompare(b["Event Name"])));
		}
	}

	/**
	 * TWITCH COMMAND LOADER
	 */
	static async loadCommands(dir: string, commandsMap: Map<string, TwitchCommand>) {
		const files = this.getFilesRecursive(dir);

		for (const filePath of files) {
			try {
				const commandModule = await import(`${pathToFileURL(filePath).href}?update=${Date.now()}`);
				const command = commandModule.default as TwitchCommand;

				if (command) {
					const mainName = path.parse(filePath).name.toLowerCase();
					commandsMap.set(mainName, command);

					if (command.aliases) {
						for (const alias of command.aliases) {
							commandsMap.set(alias.toLowerCase(), command);
						}
					}
				}
			} catch (err) {
				Logger.error("TWITCH_LOADER", `Failed to load Twitch command: ${path.basename(filePath)}`, err);
			}
		}

		if (path.basename(dir) === "commands") {
			const uniqueEntries = Array.from(commandsMap.entries())
				.filter(([name, cmd]) => !cmd.aliases?.includes(name))
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([name, cmd]) => ({
					Command: name,
					Aliases: cmd.aliases?.join(", ") || "-",
					Rank: cmd.permission?.toUpperCase() || "EVERYONE",
				}));

			Logger.info("TWITCH_LOADER", `--- 🛠️ ${uniqueEntries.length} Twitch Commands Loaded ---`);
			console.table(uniqueEntries);
		}
	}

	/**
	 * TWITCH EVENT LOADER
	 */
	static async loadEvents(
		dir: string,
		chatClient: ChatClient,
		commands: Map<string, TwitchCommand>,
		apiClient: ApiClient,
		eventLogs: EventLogEntry[] = [],
	) {
		const files = this.getFilesRecursive(dir);
		const isRoot = path.basename(dir) === "events";

		for (const filePath of files) {
			try {
				const eventModule = await import(`${pathToFileURL(filePath).href}?update=${Date.now()}`);
				const initEvent: EventModuleFn = eventModule.default;

				if (typeof initEvent === "function") {
					initEvent(chatClient, commands, apiClient);
					eventLogs.push({ "Event Name": path.parse(filePath).name, Status: "📡 Active" });
				}
			} catch (err) {
				Logger.error("TWITCH_LOADER", `Failed to load Twitch event: ${path.basename(filePath)}`, err);
			}
		}

		if (isRoot && eventLogs.length > 0) {
			Logger.info("TWITCH_LOADER", `--- 📡 ${eventLogs.length} Twitch Events Registered ---`);
			console.table(eventLogs.sort((a, b) => a["Event Name"].localeCompare(b["Event Name"])));
		}
	}

	/**
	 * CRON TASK LOADER
	 */
	static async loadTasks(dir: string, apiClient: ApiClient, taskLogs: TaskLogEntry[] = []) {
		const files = this.getFilesRecursive(dir);
		const isRoot = path.basename(dir) === "tasks";

		for (const filePath of files) {
			try {
				const taskModule = await import(`${pathToFileURL(filePath).href}?update=${Date.now()}`);
				const task: CronTask = taskModule.default;

				if (task) {
					cron.schedule(
						task.schedule,
						() => {
							task.run(apiClient).catch((err) => Logger.error("TASK", `❌ [Task: ${task.name}] failed`, err));
						},
						{ timezone: DEFAULT_TIMEZONE },
					);

					taskLogs.push({
						"Task Name": task.name,
						Schedule: task.schedule,
						Timezone: DEFAULT_TIMEZONE,
						Status: "⏰ Scheduled",
					});
				}
			} catch (err) {
				Logger.error("TASK", `Failed to load task: ${path.basename(filePath)}`, err);
			}
		}

		if (isRoot && taskLogs.length > 0) {
			Logger.info("TASK", `--- ⏰ ${taskLogs.length} Background Tasks Loaded ---`);
			console.table(taskLogs.sort((a, b) => a["Task Name"].localeCompare(b["Task Name"])));
		}
	}

	static async syncApplicationCommands(commandsCollection: Collection<string, DiscordCommand>, forceCleanup: boolean = false) {
		const mode = process.env.MODE;
		const token = mode === "DEV" ? process.env.DISCORD_DEV_TOKEN : process.env.DISCORD_PROD_TOKEN;
		const clientId = mode === "DEV" ? process.env.DISCORD_DEV_CLIENT_ID : process.env.DISCORD_PROD_CLIENT_ID;

		if (!token || !clientId) {
			Logger.error("DISCORD_LOADER", "Missing Token or Client ID. Skipping slash command sync.");
			return;
		}

		const rest = new REST({ version: "10" }).setToken(token);

		// Only initialize as empty, then populate if NOT cleaning up
		const commandData: RESTPostAPIApplicationCommandsJSONBody[] = [];

		if (!forceCleanup) {
			const uniqueModules = new Set(commandsCollection.values());
			for (const cmd of uniqueModules) {
				if (cmd.data && typeof cmd.data.toJSON === "function") {
					commandData.push(cmd.data.toJSON() as RESTPostAPIApplicationCommandsJSONBody);
				}
				if (cmd.contextData && typeof cmd.contextData.toJSON === "function") {
					commandData.push(cmd.contextData.toJSON() as RESTPostAPIApplicationCommandsJSONBody);
				}
			}
		}

		try {
			if (mode === "DEV" && DISCORD_TEST_GUILD_ID) {
				await rest.put(Routes.applicationGuildCommands(clientId, DISCORD_TEST_GUILD_ID), { body: commandData });
				Logger.info(
					"DISCORD_LOADER",
					forceCleanup ? "🧹 Cleaned all test server commands." : `✅ Synced ${commandData.length} commands to test server.`,
				);
			} else {
				await rest.put(Routes.applicationCommands(clientId), { body: commandData });
				Logger.info("DISCORD_LOADER", forceCleanup ? "🧹 Cleaned all global commands." : `✅ Synced ${commandData.length} global commands.`);
			}
		} catch (error) {
			Logger.error("DISCORD_LOADER", "Failed command sync/cleanup", error);
		}
	}
}

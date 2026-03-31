import { Client, Collection, GatewayIntentBits, Options, Partials } from "discord.js";
import path from "path";
import { fileURLToPath } from "url";

import { DiscordButton, DiscordCommand, DiscordModal, DiscordSelectMenu } from "../types/index.js";
import { Loader } from "../utils/index.js";
import { DiscordGuildManager, Logger } from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DiscordManager {
	public static client: Client;
	public static commands = new Collection<string, DiscordCommand>();
	public static buttons = new Collection<string, DiscordButton>();
	public static modals = new Collection<string, DiscordModal>();
	public static menus = new Collection<string, DiscordSelectMenu>();

	static async init() {
		this.client = new Client({
			intents: [
				GatewayIntentBits.GuildMembers,
				GatewayIntentBits.GuildMessageReactions,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.GuildModeration,
				GatewayIntentBits.GuildPresences,
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildVoiceStates,
				GatewayIntentBits.GuildWebhooks,
				GatewayIntentBits.MessageContent, //Make sure this is enabled for text commands!
			],
			partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction, Partials.ThreadMember, Partials.User],
			allowedMentions: { parse: [], repliedUser: false },
			sweepers: {
				messages: {
					interval: 43200,
					lifetime: 21600,
				},
			},
			makeCache: Options.cacheWithLimits({
				...Options.DefaultMakeCacheSettings,
				// Increase MessageManager cache
				// This will store 100 messages per channel
				MessageManager: 100,
			}),
		});

		//TODO: Add Twitch integration here

		Logger.setDiscordClient(this.client);
		try {
			// Paths to your interaction folders
			const baseDir = path.join(__dirname, "../discord");
			const interactDir = path.join(baseDir, "interactions");

			await Loader.loadDiscordEvents(path.join(baseDir, "events"), this.client);

			await Loader.loadDiscordInteractions(path.join(baseDir, "commands"), this.commands, (cmd: any) => cmd.data?.name);
			await Loader.loadDiscordInteractions(path.join(interactDir, "buttons"), this.buttons, (item: any) => item.customId);
			await Loader.loadDiscordInteractions(path.join(interactDir, "modals"), this.modals, (item: any) => item.customId);
			await Loader.loadDiscordInteractions(path.join(interactDir, "menus"), this.menus, (item: any) => item.customId);

			await Loader.syncApplicationCommands(this.commands);

			// Connect to Discord
			await this.client.login(process.env.MODE === "DEV" ? process.env.DISCORD_DEV_TOKEN : process.env.DISCORD_PROD_TOKEN);

			Logger.success("DISCORD", "Discord Service Initialized");
		} catch (err) {
			Logger.error("DISCORD", "Failed to initialize Discord Manager", err);
		}
	}

	static getClient(): Client {
		return this.client;
	}
}

import {
	ActionRowBuilder, ButtonBuilder, ButtonStyle, Client as DiscordClient, EmbedBuilder, TextChannel
} from "discord.js";
import path from "path";
import { fileURLToPath } from "url";

import { ApiClient, HelixStream, HelixUser } from "@twurple/api";
import { RefreshingAuthProvider } from "@twurple/auth";
import { ChatClient, LogLevel } from "@twurple/chat";

import { ITwitchNotification, TwitchAuthModel } from "../models/index.js";
import { TwitchCommand } from "../types/index.js";
import { formatDuration, Loader, TWITCH_BOT_ID } from "../utils/index.js";
import { DiscordGuildManager, DiscordManager, Logger, TwitchChannelManager } from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class TwitchManager {
	public static client: ChatClient;
	public static api: ApiClient;

	public static commands = new Map<string, TwitchCommand>();

	static async init() {
		await DiscordGuildManager.loadAll();

		const channelDocs = await TwitchChannelManager.getAllChannels();
		const initialChannels = channelDocs.map((doc) => doc.channelName);

		const authData = await TwitchAuthModel.findOne({ twitchUserId: TWITCH_BOT_ID });
		if (!authData) throw new Error(`No auth data found for ID: ${TWITCH_BOT_ID}`);

		const authProvider = new RefreshingAuthProvider({
			clientId: process.env.TWITCH_CLIENT_ID as string,
			clientSecret: process.env.TWITCH_CLIENT_SECRET as string,
		});

		authProvider.onRefresh(async (userId, newTokenData) => {
			await TwitchAuthModel.findOneAndUpdate(
				{ twitchUserId: userId },
				{
					accessToken: newTokenData.accessToken,
					refreshToken: newTokenData.refreshToken,
					expiresIn: newTokenData.expiresIn,
					obtainmentTimestamp: newTokenData.obtainmentTimestamp,
					scopes: newTokenData.scope,
				},
			);
			Logger.info("TWITCH", `🔄 Tokens refreshed and saved for user: ${userId}`);
		});

		await authProvider.addUserForToken(
			{
				accessToken: authData.accessToken,
				refreshToken: authData.refreshToken,
				expiresIn: authData.expiresIn,
				obtainmentTimestamp: authData.obtainmentTimestamp,
				scope: authData.scopes,
			},
			["chat"],
		);

		this.api = new ApiClient({ authProvider });
		this.client = new ChatClient({
			authProvider,
			channels: initialChannels,
			logger: { minLevel: LogLevel.ERROR },
		});

		await Loader.loadCommands(path.join(__dirname, "../twitch/commands"), this.commands);
		await Loader.loadEvents(path.join(__dirname, "../twitch/events"), this.client, this.commands, this.api);
		await Loader.loadTasks(path.join(__dirname, "../tasks"), this.api);

		this.client.connect();
		Logger.success("TWITCH", `🚀 Connected to ${initialChannels.length} channels.`);
	}

	/**
	 * Helper to format the message content with placeholders
	 */
	private static formatLiveMessage(template: string, stream: HelixStream, roleId?: string | null): string {
		const url = `https://twitch.tv/${stream.userName}`;
		const rolePing = roleId ? `<@&${roleId}>` : "";
		const formatted = template
			.replace(/{user}/g, stream.userDisplayName)
			.replace(/{url}/g, url)
			.replace(/{game}/g, stream.gameName || "Unknown")
			.replace(/{title}/g, stream.title || "No Title");

		return `${rolePing}\n\n${formatted}`.trim();
	}

	/**
	 * Checks all configured streamers and sends Discord alerts
	 */
	static async checkStreams(apiClient: ApiClient) {
		try {
			const discordClient = DiscordManager.getClient();
			if (!discordClient || !discordClient.isReady()) return;

			const guilds = await DiscordGuildManager.getGuildsWithTwitch();
			if (guilds.length === 0) return;

			const userIds = new Set<string>();
			guilds.forEach((g) => {
				g.twitchNotifications.forEach((n) => {
					if (n.twitchUserId) userIds.add(n.twitchUserId);
				});
			});

			if (userIds.size === 0) return;

			const liveStreams = await apiClient.streams.getStreamsByUserIds(Array.from(userIds));
			const liveMap = new Map(liveStreams.map((s) => [s.userId, s]));

			let userMap = new Map<string, HelixUser>();
			if (liveStreams.length > 0) {
				const twitchUsers = await apiClient.users.getUsersByIds(liveStreams.map((s) => s.userId));
				userMap = new Map(twitchUsers.map((u) => [u.id, u]));
			}

			for (const guild of guilds) {
				let hasChanges = false;

				for (const notify of guild.twitchNotifications) {
					const stream = liveMap.get(notify.twitchUserId);
					const isNowLive = !!stream;

					if (isNowLive && !notify.isLive) {
						const twitchUser = userMap.get(stream!.userId);
						const sentMessage = await this.sendDiscordAlert(discordClient, notify, stream!, twitchUser);

						if (sentMessage) notify.lastMessageId = sentMessage.id;
						notify.twitchChannelName = stream!.userName;
						notify.isLive = true;
						hasChanges = true;
					} else if (isNowLive && notify.isLive) {
						if (notify.lastMessageId) {
							await this.handleStreamUpdate(discordClient, notify, stream!);
						}
					} else if (!isNowLive && notify.isLive) {
						await this.handleStreamEnd(discordClient, notify);
						notify.isLive = false;
						notify.lastMessageId = null;
						hasChanges = true;
					}
				}

				if (hasChanges) {
					await guild.save();
				}
			}
		} catch (error) {
			Logger.error("DISCORD_TWITCH_POLL", "Error polling for live streams", error);
		}
	}

	private static async sendDiscordAlert(discordClient: DiscordClient, notify: ITwitchNotification, stream: HelixStream, twitchUser?: HelixUser) {
		try {
			const channel = await discordClient.channels.fetch(notify.discordChannelId).catch(() => null);
			if (!(channel instanceof TextChannel)) return null;

			// Fetch Game Box Art
			let categoryThumbnail = "";
			if (stream.gameName) {
				const gameData = await this.api.games.getGameByName(stream.gameName);
				if (gameData) categoryThumbnail = gameData.getBoxArtUrl(600, 800);
			}

			const url = `https://twitch.tv/${stream.userName}`;
			const iconURL =
				twitchUser?.profilePictureUrl ||
				"https://static-cdn.jtvnw.net/user-default-pictures-uv/41780b5a-def8-11e9-94d9-784f43822e80-profile_image-300x300.png";
			const startTimeUnix = Math.floor(stream.startDate.getTime() / 1000);

			const fullMessageContent = this.formatLiveMessage(notify.liveMessage, stream, notify.pingRoleId);

			const embed = new EmbedBuilder()
				.setAuthor({ name: `${stream.userDisplayName} is now LIVE!`, iconURL, url })
				.setTitle(stream.title)
				.setURL(url)
				.setColor("#9146FF")
				.setThumbnail(categoryThumbnail)
				.addFields(
					{ name: "Game", value: stream.gameName || "None" },
					{ name: "Started At", value: `<t:${startTimeUnix}:f> (<t:${startTimeUnix}:R>)` },
				)
				.setImage(`${stream.getThumbnailUrl(1280, 720)}?t=${Date.now()}`)
				.setTimestamp(stream.startDate);

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setLabel("Watch Stream").setStyle(ButtonStyle.Link).setURL(url),
			);

			return await channel.send({
				content: fullMessageContent,
				embeds: [embed],
				components: [row],
				allowedMentions: { parse: ["roles"] },
			});
		} catch (error) {
			Logger.error("DISCORD_TWITCH_ALERT", `Failed alert for ${notify.twitchChannelName}`, error);
			return null;
		}
	}

	private static async handleStreamUpdate(discordClient: DiscordClient, notify: ITwitchNotification, stream: HelixStream) {
		try {
			const channel = await discordClient.channels.fetch(notify.discordChannelId).catch(() => null);
			if (!(channel instanceof TextChannel) || !notify.lastMessageId) return;

			const message = await channel.messages.fetch(notify.lastMessageId).catch(() => null);
			if (!message || message.embeds.length === 0) return;

			const oldEmbed = message.embeds[0];
			const currentCategory = oldEmbed.fields.find((f) => f.name === "Game")?.value;
			const hasGameChanged = currentCategory !== (stream.gameName || "None");
			const hasTitleChanged = oldEmbed.title !== stream.title;

			if (hasGameChanged || hasTitleChanged) {
				let categoryThumbnail = oldEmbed.thumbnail?.url;

				// Only call the API if the GAME actually changed
				if (hasGameChanged && stream.gameName) {
					const gameData = await this.api.games.getGameByName(stream.gameName);
					if (gameData) categoryThumbnail = gameData.getBoxArtUrl(600, 800);
				}

				const updatedEmbed = EmbedBuilder.from(oldEmbed)
					.setTitle(stream.title)
					.setThumbnail(categoryThumbnail || null)
					.setFields({ name: "Game", value: stream.gameName || "None" }, { name: "Started At", value: oldEmbed.fields[1].value })
					.setImage(`${stream.getThumbnailUrl(1280, 720)}?t=${Date.now()}`)
					.setFooter({ text: "Last update detected" });

				await message.edit({
					content: this.formatLiveMessage(notify.liveMessage, stream, notify.pingRoleId),
					embeds: [updatedEmbed],
				});
			}
		} catch (error) {
			Logger.error("DISCORD_TWITCH_UPDATE", `Update failed: ${error}`);
		}
	}

	private static async handleStreamEnd(discordClient: DiscordClient, notify: ITwitchNotification) {
		try {
			if (!notify.lastMessageId) return;
			const channel = await discordClient.channels.fetch(notify.discordChannelId).catch(() => null);
			if (!(channel instanceof TextChannel)) return;

			const message = await channel.messages.fetch(notify.lastMessageId).catch(() => null);
			if (!message || message.embeds.length === 0) return;

			const oldEmbed = message.embeds[0];

			// Recover the original "Started At" value from the live embed
			// We look for the field by name to ensure we get the right data
			const startedAtField = oldEmbed.fields.find((f) => f.name === "Started At");
			const startedAtValue = startedAtField ? startedAtField.value : "Unknown";

			const startDate = oldEmbed.timestamp ? new Date(oldEmbed.timestamp) : new Date();
			const streamDurationMs = Date.now() - startDate.getTime();

			// Short Stream Check
			if (streamDurationMs < 120000) {
				await message.delete().catch(() => null);
				Logger.info("TWITCH", `Deleted short stream alert for ${notify.twitchChannelName}.`);
				return;
			}

			const durationText = formatDuration(startDate);
			const finalGame = oldEmbed.fields.find((f) => f.name === "Game")?.value || "Unknown";
			const displayName = oldEmbed.author?.name.replace(" is now LIVE!", "") || notify.twitchChannelName;
			const endTimestamp = Math.floor(Date.now() / 1000);

			// Fetch final category thumb (Box Art) if missing from oldEmbed
			let categoryThumbnail = oldEmbed.thumbnail?.url;
			if (!categoryThumbnail && finalGame !== "None") {
				const gameData = await this.api.games.getGameByName(finalGame);
				if (gameData) categoryThumbnail = gameData.getBoxArtUrl(600, 800);
			}

			// VOD Logic... (keep your existing 8s delay and fetching)
			await new Promise((resolve) => setTimeout(resolve, 8000));

			const twitchUser = await this.api.users.getUserById(notify.twitchUserId);
			const offlineBanner = twitchUser?.offlinePlaceholderUrl || "https://static-cdn.jtvnw.net/ttv-static/404_preview-1280x720.jpg";

			let vodUrl: string | null = null;
			if (twitchUser) {
				const videos = await this.api.videos.getVideosByUser(twitchUser.id, { limit: 1, type: "archive" });
				if (videos.data.length > 0) vodUrl = videos.data[0].url;
			}

			const components =
				vodUrl ?
					[
						new ActionRowBuilder<ButtonBuilder>().addComponents(
							new ButtonBuilder().setLabel("Watch VOD").setStyle(ButtonStyle.Link).setURL(vodUrl),
						),
					]
				:	[];

			// Reconstruct the embed with all three time-related fields
			const closedEmbed = EmbedBuilder.from(oldEmbed)
				.setColor("#2f3136")
				.setDescription("Stream has ended. Thanks for stopping by!")
				.setThumbnail(categoryThumbnail || null)
				.setImage(offlineBanner)
				.setFields(
					{ name: "Game", value: finalGame, inline: true },
					{ name: "Duration", value: durationText, inline: true },
					{ name: "Started At", value: startedAtValue, inline: false },
					{ name: "Ended At", value: `<t:${endTimestamp}:f> (<t:${endTimestamp}:R>)`, inline: false },
				)
				.setFooter({ text: "Status: Offline" })
				.setTimestamp();

			await message.edit({
				content: `**${displayName}** was live playing **${finalGame}**.`,
				embeds: [closedEmbed],
				components,
			});
		} catch (error) {
			Logger.error("DISCORD_TWITCH_END", `End failed: ${error}`);
		}
	}

	static async verifyUser(username: string) {
		try {
			return await this.api.users.getUserByName(username);
		} catch {
			return null;
		}
	}

	static async getNotification(guildId: string, twitchId: string): Promise<ITwitchNotification | null> {
		const settings = await DiscordGuildManager.getSettings(guildId);
		return settings.twitchNotifications.find((n) => n.twitchUserId === twitchId) || null;
	}

	static async getTrackedStreamers(guildId: string): Promise<string[]> {
		const settings = await DiscordGuildManager.getSettings(guildId);
		return settings.twitchNotifications.map((n) => n.twitchChannelName);
	}
}

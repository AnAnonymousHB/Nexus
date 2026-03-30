import { Collection } from "discord.js";

import { DiscordUserDocument, DiscordUserModel, GuildActivity } from "../models/index.js";

export class DiscordUserManager {
	// Local cache to reduce DB hits for frequent "Last Seen" lookups
	private cache = new Collection<string, DiscordUserDocument>();

	/**
	 * Fetch a user from the DB or Cache
	 */
	async fetch(userId: string): Promise<DiscordUserDocument | null> {
		if (this.cache.has(userId)) return this.cache.get(userId)!;

		const data = await DiscordUserModel.findOne({ userId });
		if (data) this.cache.set(userId, data);
		return data;
	}

	/**
	 * Update activity and refresh the cache
	 */
	async updateActivity(userId: string, guildId: string, channelId: string) {
		const timestamp = Date.now();

		// Ensure the user document exists
		await DiscordUserModel.updateOne({ userId }, { $set: { userId } }, { upsert: true });

		// Update existing guild entry OR add a new one if it doesn't exist
		// We use $inc for the messageCount to ensure atomic increments
		const user = await DiscordUserModel.findOneAndUpdate(
			{ userId, "guilds.guildId": guildId },
			{
				$set: {
					"guilds.$.lastMessageTimestamp": timestamp,
					"guilds.$.lastChannelId": channelId,
				},
				$inc: { "guilds.$.messageCount": 1 },
			},
			{ new: true },
		);

		// If the user existed but hadn't been seen in THIS guild yet:
		if (!user) {
			const newUser = await DiscordUserModel.findOneAndUpdate(
				{ userId },
				{
					$push: {
						guilds: {
							guildId,
							lastMessageTimestamp: timestamp,
							lastChannelId: channelId,
							messageCount: 1,
						},
					},
				},
				{ new: true },
			);
			if (newUser) this.cache.set(userId, newUser);
			return newUser;
		}

		this.cache.set(userId, user);
		return user;
	}

	/**
	 * Get specific guild activity for a user
	 */
	async getGuildData(userId: string, guildId: string): Promise<GuildActivity | null> {
		const user = await this.fetch(userId);
		return user?.guilds.find((g) => g.guildId === guildId) || null;
	}

	getTotalGlobalMessages(userDoc: DiscordUserDocument): number {
		if (!userDoc || !userDoc.guilds) return 0;

		// Use reduce to sum up the messageCount of every guild entry
		return userDoc.guilds.reduce((acc, guild) => acc + (guild.messageCount || 0), 0);
	}
}

export const discordUserManager = new DiscordUserManager();

import { GuildModel, IGuild } from "../models/index.js";
import { Logger } from "./index.js";

export class DiscordGuildManager {
	// Cache for quick lookups (GuildID -> GuildData)
	private static _cache = new Map<string, IGuild>();

	/**
	 * Fetch guild settings from cache or database
	 */
	static async getSettings(guildId: string): Promise<IGuild> {
		const cached = this._cache.get(guildId);
		if (cached) return cached;

		// Find or create the guild settings
		let settings = await GuildModel.findOne({ guildId });

		if (!settings) {
			settings = await GuildModel.create({ guildId });
			Logger.info("DISCORD_GUILD_MGR", `Created new settings profile for ${guildId}`);
		}

		this._cache.set(guildId, settings);
		return settings;
	}

	/**
	 * Update specific settings and refresh the cache
	 */
	static async updateSettings(guildId: string, updates: Partial<IGuild>): Promise<IGuild | null> {
		const updated = await GuildModel.findOneAndUpdate({ guildId }, { $set: updates }, { returnDocument: "after", upsert: true });

		if (updated) {
			this._cache.set(guildId, updated);
		}

		return updated;
	}

	/**
	 * Helper to check if a user has a specific permission level
	 */
	static async hasAccess(guildId: string, roleIds: string[], level: "admin" | "mod"): Promise<boolean> {
		const settings = await this.getSettings(guildId);
		const allowedRoles = settings.roles[level];

		// Check if any of the user's roles match the allowed roles for that level
		return roleIds.some((id) => allowedRoles.includes(id));
	}

	/**
	 * Clear cache for a specific guild (useful for manual DB changes)
	 */
	static flush(guildId: string): void {
		this._cache.delete(guildId);
	}

	/**
	 * Fetch all guilds that have at least one Twitch notification configured.
	 */
	static async getGuildsWithTwitch(): Promise<IGuild[]> {
		// Filter the existing cache first
		const cached = Array.from(this._cache.values()).filter((g) => g.twitchNotifications && g.twitchNotifications.length > 0);

		if (cached.length > 0) return cached;

		// Fallback to DB if cache is empty (e.g., first run or flush)
		const guilds = await GuildModel.find({ "twitchNotifications.0": { $exists: true } });
		guilds.forEach((g) => this._cache.set(g.guildId, g));
		return guilds;
	}

	/**
	 * Specifically adds a Twitch notification to a guild's list.
	 * Using $addToSet prevents duplicate entries for the same streamer.
	 */
	static async addTwitchNotification(
		guildId: string,
		notification: { twitchChannelName: string; discordChannelId: string; liveMessage?: string },
	): Promise<IGuild | null> {
		const updated = await GuildModel.findOneAndUpdate(
			{ guildId },
			{ $addToSet: { twitchNotifications: notification } },
			{ returnDocument: "after", upsert: true },
		);

		if (updated) {
			this._cache.set(guildId, updated);
		}

		return updated;
	}

	static async updateTwitchNotification(
		guildId: string,
		twitch: { id: string; name: string },
		updates: { discordChannelId: string; liveMessage: string; pingRoleId?: string | null },
	): Promise<IGuild | null> {
		// Try to update an existing entry in the array
		let updated = await GuildModel.findOneAndUpdate(
			{ guildId, "twitchNotifications.twitchUserId": twitch.id },
			{
				$set: {
					"twitchNotifications.$.twitchChannelName": twitch.name, // The string name (e.g. 'shroud')
					"twitchNotifications.$.discordChannelId": updates.discordChannelId,
					"twitchNotifications.$.liveMessage": updates.liveMessage,
					"twitchNotifications.$.pingRoleId": updates.pingRoleId,
				},
			},
			{ returnDocument: "after" },
		);

		// If no existing entry was found, use $addToSet to add it as a new one
		if (!updated) {
			updated = await GuildModel.findOneAndUpdate(
				{ guildId },
				{
					$addToSet: {
						twitchNotifications: {
							twitchUserId: twitch.id,
							twitchChannelName: twitch.name,
							discordChannelId: updates.discordChannelId,
							liveMessage: updates.liveMessage,
							pingRoleId: updates.pingRoleId,
							isLive: false,
						},
					},
				},
				{ returnDocument: "after", upsert: true },
			);
		}

		// 3Sync the cache
		if (updated) {
			this._cache.set(guildId, updated);
		}

		return updated;
	}

	static async removeTwitchNotification(guildId: string, twitchName: string): Promise<IGuild | null> {
		const updated = await GuildModel.findOneAndUpdate(
			{ guildId },
			{
				$pull: {
					twitchNotifications: {
						twitchChannelName: { $regex: new RegExp(`^${twitchName}$`, "i") },
					},
				},
			},
			{ returnDocument: "after" },
		);

		if (updated) {
			this._cache.set(guildId, updated);
		}

		return updated;
	}

	/**
	 * Prime the cache with all guilds that have Twitch notifications.
	 * Call this once at bot startup.
	 */
	static async loadAll(): Promise<void> {
		const guilds = await GuildModel.find({ "twitchNotifications.0": { $exists: true } });
		for (const guild of guilds) {
			this._cache.set(guild.guildId, guild);
		}
		Logger.info("DISCORD_GUILD_MGR", `Cache primed with ${guilds.length} twitch-enabled guilds.`);
	}

	static async isEventEnabled(guildId: string, eventName: string): Promise<boolean> {
		const guild = await this.getSettings(guildId);
		if (!guild) return false;

		return !guild.disabledEvents?.includes(eventName);
	}
}

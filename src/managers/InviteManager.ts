import { Client, Guild, Invite, PermissionFlagsBits } from "discord.js";

import { Logger } from "./index.js";

export class InviteManager {
	// Structure: Map<GuildID, Map<InviteCode, UseCount>>
	private static _inviteCache = new Map<string, Map<string, number>>();

	/**
	 * Initialize the cache for all guilds the bot is in.
	 * Call this in your 'ready' event.
	 */
	static async init(client: Client) {
		for (const guild of client.guilds.cache.values()) {
			await this.cacheGuildInvites(client, guild.id, guild);
		}
		Logger.success("DISCORD_INVITE_MANAGER", "✅ Invite Manager: Initial cache populated.");
	}

	/**
	 * Fetches current invites from Discord and updates the internal cache.
	 * @param client The Discord Client
	 * @param guildId The ID of the guild
	 * @param guildObject Optional Guild object to avoid extra fetches
	 */
	static async cacheGuildInvites(client: Client, guildId: string, guildObject?: Guild) {
		try {
			// Resolve guild object
			const guild = guildObject ?? (await client.guilds.fetch(guildId).catch(() => null));
			if (!guild) return;

			// Check permissions: Must have ManageGuild to fetch invites
			const me = guild.members.me ?? (await guild.members.fetch(client.user!.id));
			if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) {
				Logger.warn("DISCORD_INVITE_MANAGER", `Missing ManageGuild permission in ${guild.name} (${guildId})`);
				return;
			}

			const invites = await guild.invites.fetch();
			const inviteMap = new Map<string, number>();

			invites.forEach((inv: Invite) => {
				inviteMap.set(inv.code, inv.uses ?? 0);
			});

			this._inviteCache.set(guildId, inviteMap);
		} catch (err) {
			Logger.error("DISCORD_INVITE_MANAGER", `Failed to cache for ${guildId}`, err);
		}
	}

	/**
	 * Compares the cache against fresh data to find the used invite.
	 */
	static async findUsedInvite(guild: Guild): Promise<Invite | null> {
		const cachedInvites = this._inviteCache.get(guild.id);
		const currentInvites = await guild.invites.fetch();

		// Check for an invite whose 'uses' count increased
		let usedInvite = currentInvites.find((inv: Invite) => {
			const prevUses = cachedInvites?.get(inv.code) ?? 0;
			return (inv.uses ?? 0) > prevUses;
		});

		// Fallback: Check if a cached invite disappeared (likely a used single-use invite)
		if (!usedInvite && cachedInvites) {
			for (const [code, prevUses] of cachedInvites.entries()) {
				if (!currentInvites.has(code)) {
					// This invite was deleted/expired upon use.
					// We can't return the full Invite object easily here,
					// but usually returning null is fine or you can return a partial.
					break;
				}
			}
		}

		// Update the cache for this guild
		const updatedMap = new Map<string, number>();
		currentInvites.forEach((inv: Invite) => updatedMap.set(inv.code, inv.uses ?? 0));
		this._inviteCache.set(guild.id, updatedMap);

		return usedInvite ?? null;
	}

	/**
	 * Helper to clear cache if the bot leaves a guild
	 */
	static clearGuildCache(guildId: string) {
		this._inviteCache.delete(guildId);
	}
}

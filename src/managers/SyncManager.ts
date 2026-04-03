import { ApiClient } from "@twurple/api";

import { GuildModel, TwitchChannelModel } from "../models/index.js";
import { Logger } from "./index.js";

export class SyncManager {
	static async syncNamesDiscord(apiClient: ApiClient) {
		try {
			const guilds = await GuildModel.find({}, "twitchNotifications.twitchUserId twitchNotifications.twitchChannelName");
			const dbRegistry = new Map<string, string>();

			if (!guilds) return;

			guilds.forEach((g) => {
				g.twitchNotifications.forEach((n) => {
					dbRegistry.set(n.twitchUserId, n.twitchChannelName);
				});
			});

			if (dbRegistry.size === 0) return;

			const idArray = Array.from(dbRegistry.keys());
			const twitchUsers = await apiClient.users.getUsersByIds(idArray);

			const bulkOps = [];

			for (const user of twitchUsers) {
				const oldName = dbRegistry.get(user.id);
				const newName = user.displayName;

				// Only add to the update list if the name has changed
				if (oldName !== newName) {
					bulkOps.push({
						updateMany: {
							filter: { "twitchNotifications.twitchUserId": user.id },
							update: { $set: { "twitchNotifications.$.twitchChannelName": newName } },
						},
					});

					Logger.info("TWITCH_CHANNEL_SYNC", `Detected name change: ${oldName} -> ${newName}`);
				}

				if (bulkOps.length > 0) {
					const result = await GuildModel.bulkWrite(bulkOps);
					Logger.info("TWITCH_CHANNEL_SYNC", `Sync complete. Updated names in ${result.modifiedCount} instances.`);
				} else {
					Logger.info("TWITCH_CHANNEL_SYNC", "Sync complete. No name changes detected.");
				}
			}
		} catch (err) {
			Logger.error("TWITCH_CHANNEL_SYNC", "Error syncing Twitch names", err);
		}
	}

	static async syncNamesTwitch(apiClient: ApiClient) {
		const channels = await TwitchChannelModel.find({ enabled: true });
		if (!channels) return;

		let updatedCount = 0;

		// Process in chunks of 100
		for (let i = 0; i < channels.length; i += 100) {
			const chunk = channels.slice(i, i + 100);
			const ids = chunk.map((c) => c.channelId);

			const twitchUsers = await apiClient.users.getUsersByIds(ids);

			for (const user of twitchUsers) {
				// Find the local record to compare
				const localRecord = chunk.find((c) => c.channelId === user.id);

				// Only update if:
				// 1. channelDisplayName is missing/empty
				// 2. channelDisplayName doesn't match Twitch (case change)
				// 3. channelName doesn't match Twitch (username change)
				const needsUpdate =
					!localRecord?.channelDisplayName || localRecord.channelDisplayName !== user.displayName || localRecord.channelName !== user.name;

				if (needsUpdate) {
					await TwitchChannelModel.updateOne(
						{ channelId: user.id },
						{
							$set: {
								channelDisplayName: user.displayName,
								channelName: user.name,
							},
						},
					);
					updatedCount++;
				}
			}
		}
		return { updated: updatedCount, total: channels.length };
	}
}

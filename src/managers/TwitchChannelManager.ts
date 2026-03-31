import { UpdateQuery } from "mongoose";

import { TwitchChannelDocument, TwitchChannelModel } from "../models/index.js";
import { Logger } from "./index.js";

export class TwitchChannelManager {
	private static channelCache = new Map<string, TwitchChannelDocument>();

	static async init(): Promise<string[]> {
		const channels = await this.getAllChannels();
		channels.forEach((ch) => this.channelCache.set(ch.channelId, ch));

		if (channels.length > 0) {
			const tableData = channels.map((ch) => ({ Channel: ch.channelName, ID: ch.channelId }));
			Logger.info("TWITCH_CHANNEL_MANAGER", `--- 📦 Joined ${this.channelCache.size} channels ---`);
			console.table(tableData);
		} else {
			Logger.warn("TWITCH_CHANNEL_MANAGER", "No enabled channels found to cache.");
		}

		return channels.map((c) => c.channelName);
	}

	/**
	 * Adds or updates a channel in both DB and Cache
	 * Supports both Partial objects (auto-wrapped in $set) and raw Mongoose UpdateQueries.
	 */
	static async updateChannel(channelId: string, update: UpdateQuery<TwitchChannelDocument> | Partial<TwitchChannelDocument>) {
		// 1. Determine if the update already contains Mongoose operators (keys starting with $)
		const hasOperator = Object.keys(update).some((key) => key.startsWith("$"));

		// 2. If it's just a plain object, wrap it in $set. Otherwise, use it as-is.
		const query = hasOperator ? update : { $set: update };

		const updatedDoc = await TwitchChannelModel.findOneAndUpdate({ channelId }, query, { upsert: true, new: true });

		if (updatedDoc) {
			if (updatedDoc.enabled) {
				this.channelCache.set(channelId, updatedDoc);
			} else {
				this.channelCache.delete(channelId);
			}
		}
		return updatedDoc;
	}

	/**
	 * Gets a channel from cache, or fetches from DB if missing
	 */
	static async getChannel(channelId: string): Promise<TwitchChannelDocument | undefined> {
		if (this.channelCache.has(channelId)) {
			return this.channelCache.get(channelId);
		}

		const doc = await TwitchChannelModel.findOne({ channelId });
		if (doc) {
			this.channelCache.set(channelId, doc);
			return doc;
		}
		return undefined;
	}

	static async getAllChannels() {
		try {
			return await TwitchChannelModel.find({ enabled: true });
		} catch (err) {
			Logger.error("TWITCH_CHANNEL_MANAGER", "Failed to fetch channels from DB", err);
			return [];
		}
	}

	static async isEventEnabled(channelId: string, eventName: string): Promise<boolean> {
		const channel = await this.getChannel(channelId);
		if (!channel || !channel.enabled) return false;

		// Returns true if the event name is NOT in the disabled list
		return !channel.disabledEvents?.includes(eventName);
	}
}

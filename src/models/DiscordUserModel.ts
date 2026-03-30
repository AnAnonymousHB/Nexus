import { Document, model, Schema } from "mongoose";

export interface GuildActivity {
	guildId: string;
	lastMessageTimestamp: number;
	lastChannelId: string;
	messageCount: number;
}

export interface DiscordUserDocument extends Document {
	userId: string;
	guilds: GuildActivity[];
}

const DiscordUserSchema = new Schema<DiscordUserDocument>({
	userId: { type: String, required: true, unique: true },
	guilds: [
		{
			guildId: { type: String, required: true },
			lastMessageTimestamp: { type: Number, default: Date.now },
			lastChannelId: { type: String },
			messageCount: { type: Number, default: 0 },
		},
	],
});

export const DiscordUserModel = model("DiscordUsers", DiscordUserSchema);

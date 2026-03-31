import { Document, model, Schema } from "mongoose";

import { DEFAULT_TIMEZONE } from "../utils/Constants.js";

export interface TwitchChannelDocument extends Document {
	channelId: string;
	channelName: string;
	channelDisplayName: string;
	channelTimezone: string;
	enabled: boolean;
	prefix: string;
	disabledCommands: string[];
	disabledEvents: string[];
	shoutout: string;
}

const TwitchChannelSchema = new Schema<TwitchChannelDocument>({
	channelId: { type: String, required: true, unique: true },
	channelName: { type: String, required: true },
	channelDisplayName: { type: String, required: true, default: "" },
	channelTimezone: { type: String, default: DEFAULT_TIMEZONE },
	enabled: { type: Boolean, default: true },
	prefix: { type: String, required: true, default: "!" },
	disabledCommands: {
		type: [String],
		default: [],
	},
	disabledEvents: {
		type: [String],
		default: [],
	},
	shoutout: { type: String },
});

export const TwitchChannelModel = model("Twitch_Channels", TwitchChannelSchema);

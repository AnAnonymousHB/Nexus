import { model, Schema } from "mongoose";

const TwitchAuthSchema = new Schema({
	twitchUserId: { type: String, required: true, unique: true },
	username: { type: String, required: true },

	accessToken: { type: String, required: true },
	refreshToken: { type: String, required: true },
	expiresIn: { type: Number, required: true },
	obtainmentTimestamp: { type: Number, required: true },

	scopes: { type: [String], required: true },
});

export const TwitchAuthModel = model("Twitch_Auth", TwitchAuthSchema);

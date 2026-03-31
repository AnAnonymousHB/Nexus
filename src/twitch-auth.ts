import "dotenv/config";

import mongoose from "mongoose";

import { Logger } from "./managers/LoggerManager.js";
import { TwitchAuthModel } from "./models/index.js"; // Ensure path is correct

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const MONGO_URI = process.env.MONGO_URI;

// All the scopes your bot needs to be a full moderator
const scopes = [
	"chat:read",
	"chat:edit",
	"channel:read:subscriptions",
	"moderator:manage:chat_messages",
	"moderator:manage:banned_users",
	"moderator:read:chatters",
	"moderator:manage:announcements",
	"moderator:manage:chat_settings",
	"channel:manage:broadcast",
].join(" ");

async function runAuth() {
	if (!CLIENT_ID || !CLIENT_SECRET || !MONGO_URI) {
		console.error("❌ Missing environment variables in .env");
		process.exit(1);
	}

	await mongoose.connect(MONGO_URI);
	console.log("🗄️ Connected to MongoDB.");

	// Request Device Code from Twitch
	const deviceRes = await fetch("https://id.twitch.tv/oauth2/device", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			scope: scopes,
		}),
	});

	const deviceData = await deviceRes.json();
	if (!deviceRes.ok) throw new Error(`Device Code Error: ${JSON.stringify(deviceData)}`);

	const { device_code, user_code, verification_uri, interval, expires_in } = deviceData;

	console.log(`\n🔗 Go to: ${verification_uri}`);
	console.log(`🔑 Enter Code: **${user_code}**\n`);
	console.log(`⏳ Waiting for you to authorize... (Expires in ${expires_in}s)`);

	// Poll Twitch for the tokens
	const pollForTokens = async () => {
		const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: CLIENT_ID,
				client_secret: CLIENT_SECRET,
				device_code: device_code,
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			}),
		});

		const tokenData = await tokenRes.json();

		if (tokenRes.status === 400 && tokenData.message === "authorization_pending") {
			// Wait for the interval provided by Twitch before trying again
			await new Promise((resolve) => setTimeout(resolve, interval * 1000));
			return pollForTokens();
		}

		if (!tokenRes.ok) throw new Error(`Token Error: ${JSON.stringify(tokenData)}`);
		return tokenData;
	};

	const tokens = await pollForTokens();

	// Get the Twitch User ID of the bot account
	const userRes = await fetch("https://api.twitch.tv/helix/users", {
		headers: {
			"Client-ID": CLIENT_ID,
			Authorization: `Bearer ${tokens.access_token}`,
		},
	});

	const userData = await userRes.json();
	const twitchUserId = userData.data[0].id;
	const twitchUsername = userData.data[0].display_name;

	// Save/Update the Database
	await TwitchAuthModel.findOneAndUpdate(
		{ twitchUserId },
		{
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresIn: tokens.expires_in,
			obtainmentTimestamp: Date.now(),
			scopes: tokens.scope,
		},
		{ upsert: true, new: true },
	);

	Logger.success("TWITCH_AUTH", `✅ Success! Tokens saved for **${twitchUsername}** (ID: ${twitchUserId})`);
	Logger.success("TWITCH_AUTH", "🚀 You can now start your TwitchManager.");

	await mongoose.disconnect();
	process.exit(0);
}

runAuth().catch((err) => {
	console.error("\n❌ Fatal Error:", err.message);
	process.exit(1);
});

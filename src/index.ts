import "dotenv/config";

import mongoose from "mongoose";

import { CountryManager, DiscordManager, Logger } from "./managers/index.js";

(async () => {
	try {
		await mongoose.connect(process.env.MONGO_URI!);
		Logger.success("SYSTEM", "📦 Successfully connected to MongoDB");

		Logger.info("SYSTEM", "--- 🚀 Initializing Managers ---");
		await Promise.all([CountryManager.init()]);

		await DiscordManager.init();
	} catch (err) {
		Logger.error("SYSTEM", "FATAL ERROR DURING STARTUP:", err);
		process.exit(1);
	}
})();

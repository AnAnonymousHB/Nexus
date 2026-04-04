import { ButtonInteraction, ContainerBuilder, MediaGalleryBuilder, MessageFlags, SeparatorSpacingSize, TimestampStyles, time } from "discord.js";
import { MovieDb } from "moviedb-promise";

import { Logger } from "../../../managers/index.js";
import { DiscordButton } from "../../../types/index.js";

const movieDb = new MovieDb(process.env.MOVIEDB_API_KEY!);

const tvPoster: DiscordButton = {
	customId: "tv_poster",
	execute: async (interaction: ButtonInteraction) => {
		// Extract show ID from customId: "tv_poster_{showId}"
		const showId = interaction.customId.replace(/^tv_poster_/, "");

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			const showData = await movieDb.tvInfo({ id: showId });

			if (!showData || !showData.poster_path) {
				return void (await interaction.editReply({ content: "No poster available for this show." }));
			}

			const posterUrl = `https://image.tmdb.org/t/p/original${showData.poster_path}`;

			const container = new ContainerBuilder()
				.setAccentColor(0x01d277)
				.addTextDisplayComponents((text) => text.setContent(`### 🖼️ ${showData.name || "Show"} — Poster`))
				.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addMediaGalleryComponents(new MediaGalleryBuilder().addItems((item) => item.setURL(posterUrl).setDescription(`Official poster for ${showData.name}`)))
				.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents((text) => text.setContent(`-# Data provided by TheMovieDB · ${time(new Date(), TimestampStyles.ShortDateTime)}`));

			await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
		} catch (error) {
			Logger.error("DISCORD_TV_POSTER", `Error fetching poster for show ID: ${showId}`, error);
			await interaction.editReply({ content: "An error occurred while fetching the poster." });
		}
	},
};

export default tvPoster;

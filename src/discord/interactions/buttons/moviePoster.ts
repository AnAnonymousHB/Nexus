import { ButtonInteraction, ContainerBuilder, MediaGalleryBuilder, MessageFlags, SeparatorSpacingSize, TimestampStyles, time } from "discord.js";
import { MovieDb } from "moviedb-promise";

import { Logger } from "../../../managers/index.js";
import { DiscordButton } from "../../../types/index.js";

const movieDb = new MovieDb(process.env.MOVIEDB_API_KEY!);

const moviePoster: DiscordButton = {
	customId: "movie_poster",
	execute: async (interaction: ButtonInteraction) => {
		// Extract movie ID from customId: "movie_poster_{movieId}"
		const movieId = interaction.customId.replace(/^movie_poster_/, "");

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			const movieData = await movieDb.movieInfo({ id: movieId });

			if (!movieData || !movieData.poster_path) {
				return void (await interaction.editReply({ content: "No poster available for this movie." }));
			}

			const posterUrl = `https://image.tmdb.org/t/p/original${movieData.poster_path}`;

			const container = new ContainerBuilder()
				.setAccentColor(0x01d277)
				.addTextDisplayComponents((text) => text.setContent(`### 🖼️ ${movieData.title || "Movie"} — Poster`))
				.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addMediaGalleryComponents(new MediaGalleryBuilder().addItems((item) => item.setURL(posterUrl).setDescription(`Official poster for ${movieData.title}`)))
				.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents((text) => text.setContent(`-# Data provided by TheMovieDB · ${time(new Date(), TimestampStyles.ShortDateTime)}`));

			await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
		} catch (error) {
			Logger.error("DISCORD_MOVIE_POSTER", `Error fetching poster for movie ID: ${movieId}`, error);
			await interaction.editReply({ content: "An error occurred while fetching the poster." });
		}
	},
};

export default moviePoster;

import {
	ActionRowBuilder,
	AutocompleteInteraction,
	ButtonBuilder,
	ButtonStyle,
	ChatInputCommandInteraction,
	ContextMenuCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import { CreditsResponse, MovieDb, MovieResponse as BaseMovieResponse, VideosResponse } from "moviedb-promise";

import { Logger } from "../../../managers/index.js";
import { DiscordCommand } from "../../../types/index.js";

const movieDb = new MovieDb(process.env.MOVIEDB_API_KEY!);

interface MovieWithDetails extends BaseMovieResponse {
	videos?: VideosResponse;
	credits?: CreditsResponse;
}

const movie: DiscordCommand = {
	data: new SlashCommandBuilder()
		.setName("movie")
		.setDescription("Get detailed information about a movie.")
		.addStringOption((option) => option.setName("movie").setDescription("The name of the movie").setRequired(true).setAutocomplete(true)),

	async autocomplete(interaction: AutocompleteInteraction) {
		const focusedValue = interaction.options.getFocused();
		if (!focusedValue.trim()) return interaction.respond([]);

		try {
			const search = await movieDb.searchMovie({ query: focusedValue });
			const langNames = new Intl.DisplayNames(["en"], { type: "language" });

			const choices =
				search.results?.slice(0, 25).map((m) => {
					const year = m.release_date?.split("-")[0] || "N/A";
					const lang = m.original_language ? langNames.of(m.original_language) : "??";

					return {
						// Label: "Movie Name (Year) [Language]"
						name: `${m.title} (${year}) [${lang}]`,
						value: m.id?.toString() || "",
					};
				}) || [];

			await interaction.respond(choices);
		} catch (error) {
			Logger.error("DISCORD_MOVIE", "Movie Autocomplete Error:", error);
		}
	},

	async execute(interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction) {
		if (!interaction.isChatInputCommand()) return;

		await interaction.deferReply();
		const movieId = interaction.options.getString("movie")!;

		try {
			const movieData = (await movieDb.movieInfo({
				id: movieId,
				append_to_response: "videos,credits",
			})) as MovieWithDetails;

			if (!movieData) {
				await interaction.editReply("Could not find details for that movie.");
				return;
			}

			const embed = createMovieEmbed(movieData);
			const row = new ActionRowBuilder<ButtonBuilder>();

			const trailer = movieData.videos?.results?.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official);

			row.addComponents(
				new ButtonBuilder().setLabel("View on TMDB").setStyle(ButtonStyle.Link).setURL(`https://www.themoviedb.org/movie/${movieData.id}`),
			);

			// Add the Trailer Button if found
			if (trailer) {
				row.addComponents(
					new ButtonBuilder()
						.setLabel("Watch Trailer")
						.setStyle(ButtonStyle.Link)
						.setURL(`https://www.youtube.com/watch?v=${trailer.key}`)
						.setEmoji("🎬"),
				);
			}

			await interaction.editReply({ embeds: [embed], components: [row] });
		} catch (error) {
			Logger.error("DISCORD_MOVIE", `Error fetching Movie ID: ${movieId}`, error);
			await interaction.editReply("An error occurred while fetching movie information.");
		}
	},
};

/**
 * Helper to build the Movie embed
 */
const createMovieEmbed = (movie: MovieWithDetails): EmbedBuilder => {
	const posterBase = "https://image.tmdb.org/t/p/w500";

	// Logic for Runtime (e.g., 135 mins -> 2h 15m)
	const hours = Math.floor((movie.runtime || 0) / 60);
	const minutes = (movie.runtime || 0) % 60;
	const runtimeFormatted = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

	const langNames = new Intl.DisplayNames(["en"], { type: "language" });
	const originalLanguage = movie.original_language ? langNames.of(movie.original_language) : "N/A";

	const producedBy =
		movie.production_companies?.length ?
			movie.production_companies
				.map((c) => c.name)
				.slice(0, 5)
				.join(", ")
		:	"N/A";

	let releaseTimestamp = "N/A";
	if (movie.release_date) {
		const unixSeconds = Math.floor(new Date(movie.release_date).getTime() / 1000);
		releaseTimestamp = `<t:${unixSeconds}:D> (<t:${unixSeconds}:R>)`;
	}

	const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
	const originCountries =
		movie.production_countries?.length ? movie.production_countries.map((c) => regionNames.of(c.iso_3166_1!)).join(", ") : "N/A";

	const rating = movie.vote_average ? `⭐ ${movie.vote_average.toFixed(1)}/10` : "No rating";
	const budget = movie.budget ? `$${movie.budget.toLocaleString()}` : "N/A";
	const revenue = movie.revenue ? `$${movie.revenue.toLocaleString()}` : "N/A";
	const genres = movie.genres?.map((g) => g.name).join(", ") || "N/A";

	const director = movie.credits?.crew?.find((person) => person.job === "Director")?.name || "N/A";
	// Extract Top 5 Actors
	const topCast =
		movie.credits?.cast?.length ?
			movie.credits.cast
				.slice(0, 5)
				.map((actor) => actor.name)
				.join(", ")
		:	"N/A";

	return new EmbedBuilder()
		.setColor("#01d277")
		.setTitle(movie.title || "Unknown Movie")
		.setDescription(movie.overview || "No description available.")
		.setThumbnail(movie.poster_path ? `${posterBase}${movie.poster_path}` : null)
		.addFields(
			{ name: "Director", value: director, inline: true },
			{ name: "Status", value: movie.status || "Unknown", inline: true },
			{ name: "Rating", value: rating, inline: true },
			{ name: "Runtime", value: runtimeFormatted, inline: true },
			{ name: "Budget", value: budget, inline: true },
			{ name: "Revenue", value: revenue, inline: true },
			{ name: "Released", value: releaseTimestamp, inline: true },
			{ name: "Origin", value: `${originCountries} (${originalLanguage})`, inline: false },
			{ name: "Starring", value: topCast, inline: false },
			{ name: "Genres", value: genres, inline: false },
			{ name: "Produced By", value: producedBy, inline: false },
		)
		.setFooter({ text: "Data provided by TheMovieDB" })
		.setTimestamp();
};

export default movie;

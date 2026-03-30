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
import { CreditsResponse, MovieDb, ShowResponse as BaseShowResponse, VideosResponse } from "moviedb-promise";

import { Logger } from "../../../managers/index.js";
import { DiscordCommand } from "../../../types/index.js";

const movieDb = new MovieDb(process.env.MOVIEDB_API_KEY!);

interface TvWithDetails extends BaseShowResponse {
	videos?: VideosResponse;
	credits?: CreditsResponse;
}

const tv: DiscordCommand = {
	data: new SlashCommandBuilder()
		.setName("tv")
		.setDescription("Get detailed information about a TV show.")
		.addStringOption((option) => option.setName("show").setDescription("The name of the TV show").setRequired(true).setAutocomplete(true)),
	async autocomplete(interaction: AutocompleteInteraction) {
		const focusedValue = interaction.options.getFocused();
		if (!focusedValue.trim()) return interaction.respond([]);

		try {
			// Search for TV shows matching the input
			const search = await movieDb.searchTv({ query: focusedValue });

			// Map results to Discord choices (Limit 25)
			const choices =
				search.results?.slice(0, 25).map((show) => ({
					// Show name + year to help differentiate remakes/similar titles
					name: `${show.name} (${show.first_air_date?.split("-")[0] || "N/A"}) [${show.origin_country?.[0] || "??"}]`,
					value: show.id?.toString() || "",
				})) || [];

			await interaction.respond(choices);
		} catch (error) {
			Logger.error("DISCORD_TV", "TV Autocomplete Error:", error);
		}
	},
	async execute(interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction) {
		if (!interaction.isChatInputCommand()) return;

		await interaction.deferReply();
		const showId = interaction.options.getString("show")!;

		try {
			// Fetch full show details including extra info
			const showData = (await movieDb.tvInfo({
				id: showId,
				append_to_response: "videos,credits",
			})) as TvWithDetails;

			if (!showData) {
				await interaction.editReply("Could not find details for that show.");
				return;
			}

			const embed = createTvEmbed(showData);
			const row = new ActionRowBuilder<ButtonBuilder>();

			const trailer =
				showData.videos?.results?.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official) ||
				showData.videos?.results?.find((v) => v.site === "YouTube" && v.type === "Trailer");

			row.addComponents(
				new ButtonBuilder().setLabel("View on TMDB").setStyle(ButtonStyle.Link).setURL(`https://www.themoviedb.org/tv/${showData.id}`),
			);

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
			Logger.error("DISCORD_TV", `Error fetching TV show ID: ${showId}`, error);
			await interaction.editReply("An error occurred while fetching show information.");
		}
	},
};

const createTvEmbed = (show: TvWithDetails): EmbedBuilder => {
	const posterBase = "https://image.tmdb.org/t/p/w500";
	const statusEmoji = show.status === "Ended" || show.status === "Canceled" ? "🟥" : "🟩";

	const genres = show.genres?.map((g) => g.name).join(", ") || "N/A";
	const rating = show.vote_average ? `⭐ ${show.vote_average.toFixed(1)}/10` : "No rating";

	let firstAired = "N/A";
	let lastAiredLabel = "Present";
	if (show.first_air_date) {
		const startUnix = Math.floor(new Date(show.first_air_date).getTime() / 1000);
		firstAired = `<t:${startUnix}:D> (<t:${startUnix}:R>)`;
	}

	// Only show a specific end date if the show is no longer airing
	const isEnded = show.status === "Ended" || show.status === "Canceled";
	if (isEnded && show.last_air_date) {
		const endUnix = Math.floor(new Date(show.last_air_date).getTime() / 1000);
		lastAiredLabel = `<t:${endUnix}:D> (<t:${endUnix}:R>)`;
	}

	const yearsActive = `${firstAired} — ${lastAiredLabel}`;

	const langNames = new Intl.DisplayNames(["en"], { type: "language" });
	const originalLanguage = show.original_language ? langNames.of(show.original_language) : "N/A";

	const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
	const originCountries = show.origin_country?.length ? show.origin_country.map((code) => regionNames.of(code)).join(", ") : "N/A";

	const networks = show.networks?.length ? show.networks.map((n) => n.name).join(", ") : "N/A";

	const creators = show.created_by?.length ? show.created_by.map((c) => c.name).join(", ") : "N/A";
	const topCast =
		show.credits?.cast?.length ?
			show.credits.cast
				.slice(0, 5)
				.map((actor) => actor.name)
				.join(", ")
		:	"N/A";

	return new EmbedBuilder()
		.setColor("#01d277") // TMDB Green
		.setTitle(show.name || "Unknown Show")
		.setDescription(show.overview || "No description available.")
		.setThumbnail(show.poster_path ? `${posterBase}${show.poster_path}` : null)
		.addFields(
			{ name: "Created By", value: creators, inline: true },
			{ name: "Status", value: `${statusEmoji} ${show.status}`, inline: true },
			{ name: "Rating", value: rating, inline: true },
			{ name: "Network", value: networks, inline: true },
			{ name: "Origin", value: `${originCountries} (${originalLanguage})`, inline: true },
			{ name: "Seasons/Episodes", value: `${show.number_of_seasons}s / ${show.number_of_episodes}eps`, inline: true },
			{ name: "Years Active", value: yearsActive, inline: false },
			{ name: "Starring", value: topCast, inline: false },
			{ name: "Genres", value: genres, inline: false },
		)
		.setFooter({ text: "Data provided by TheMovieDB" })
		.setTimestamp();
};

export default tv;

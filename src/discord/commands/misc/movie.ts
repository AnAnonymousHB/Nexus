import {
	AutocompleteInteraction,
	ButtonStyle,
	ChatInputCommandInteraction,
	ContainerBuilder,
	ContextMenuCommandInteraction,
	MediaGalleryBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorSpacingSize,
	SlashCommandBuilder,
	TimestampStyles,
	ActionRowBuilder,
	ButtonBuilder,
	time,
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

			const container = createMovieContainer(movieData);
			await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
		} catch (error) {
			Logger.error("DISCORD_MOVIE", `Error fetching Movie ID: ${movieId}`, error);
			await interaction.editReply("An error occurred while fetching movie information.");
		}
	},
};

function createMovieContainer(movie: MovieWithDetails): ContainerBuilder {
	const posterBase = "https://image.tmdb.org/t/p/w500";

	const hours = Math.floor((movie.runtime || 0) / 60);
	const minutes = (movie.runtime || 0) % 60;
	const runtimeFormatted = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

	const langNames = new Intl.DisplayNames(["en"], { type: "language" });
	const originalLanguage = movie.original_language ? langNames.of(movie.original_language) : "N/A";

	const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
	const originCountries = movie.production_countries?.length ? movie.production_countries.map((c) => regionNames.of(c.iso_3166_1!)).join(", ") : "N/A";

	const producedBy = movie.production_companies?.length
		? movie.production_companies
				.map((c) => c.name)
				.slice(0, 5)
				.join(", ")
		: "N/A";

	let releaseTimestamp = "N/A";
	if (movie.release_date) {
		const unixSeconds = Math.floor(new Date(movie.release_date).getTime() / 1000);
		releaseTimestamp = `<t:${unixSeconds}:D> (<t:${unixSeconds}:R>)`;
	}

	const rating = movie.vote_average ? `⭐ ${movie.vote_average.toFixed(1)}/10` : "No rating";
	const budget = movie.budget ? `$${movie.budget.toLocaleString()}` : "N/A";
	const revenue = movie.revenue ? `$${movie.revenue.toLocaleString()}` : "N/A";
	const genres = movie.genres?.map((g) => g.name).join(", ") || "N/A";
	const director = movie.credits?.crew?.find((p) => p.job === "Director")?.name || "N/A";
	const topCast = movie.credits?.cast?.length
		? movie.credits.cast
				.slice(0, 5)
				.map((a) => a.name)
				.join(", ")
		: "N/A";

	const tmdbUrl = `https://www.themoviedb.org/movie/${movie.id}`;
	const posterUrl = movie.poster_path ? `${posterBase}${movie.poster_path}` : null;
	const trailer = movie.videos?.results?.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official);
	const trailerUrl = trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(movie.title + " trailer")}`;

	// ── Header: title + View Poster button ───────────────────────────────────
	// Encode poster URL into the customId so the button handler can use it
	const headerSection = new SectionBuilder()
		.addTextDisplayComponents(
			(text) => text.setContent(`# ${movie.title || "Unknown Movie"}`),
			(text) => text.setContent(`${rating} · ${runtimeFormatted} · ${movie.status || "Unknown"}`),
		)
		.setButtonAccessory((button) => button.setCustomId(`movie_poster_${movie.id}`).setLabel("🖼️ View Poster").setStyle(ButtonStyle.Secondary).setDisabled(!posterUrl));

	// ── Action Row: TMDB + Trailer ────────────────────────────────────────────
	const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setLabel("🎬 View on TMDB").setURL(tmdbUrl).setStyle(ButtonStyle.Link),
		...(trailerUrl ? [new ButtonBuilder().setLabel("▶️ Watch Trailer").setURL(trailerUrl).setStyle(ButtonStyle.Link)] : []),
	);

	return new ContainerBuilder()
		.setAccentColor(0x01d277)
		.addSectionComponents(headerSection)
		.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents((text) => text.setContent("### 📋 Overview"))
		.addTextDisplayComponents((text) => text.setContent(movie.overview || "No description available."))
		.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents((text) => text.setContent("### 🎬 Details"))
		.addTextDisplayComponents((text) =>
			text.setContent(
				`**Director:** ${director}\n` +
					`**Starring:** ${topCast}\n` +
					`**Genres:** ${genres}\n` +
					`**Released:** ${releaseTimestamp}\n` +
					`**Origin:** ${originCountries} (${originalLanguage})`,
			),
		)
		.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents((text) => text.setContent("### 💰 Financials"))
		.addTextDisplayComponents((text) => text.setContent(`**Budget:** ${budget}\n` + `**Revenue:** ${revenue}\n` + `**Produced By:** ${producedBy}`))
		.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addActionRowComponents(actionRow)
		.addSeparatorComponents((sep) => sep.setDivider(false).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents((text) => text.setContent(`-# Data provided by TheMovieDB · ${time(new Date(), TimestampStyles.ShortDateTime)}`));
}

export default movie;

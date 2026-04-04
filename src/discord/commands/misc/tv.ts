import {
	ActionRowBuilder,
	AutocompleteInteraction,
	ButtonBuilder,
	ButtonStyle,
	ChatInputCommandInteraction,
	ContainerBuilder,
	ContextMenuCommandInteraction,
	MessageFlags,
	SectionBuilder,
	SeparatorSpacingSize,
	SlashCommandBuilder,
	TimestampStyles,
	time,
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
			const search = await movieDb.searchTv({ query: focusedValue });

			const choices =
				search.results?.slice(0, 25).map((show) => ({
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
			const showData = (await movieDb.tvInfo({
				id: showId,
				append_to_response: "videos,credits",
			})) as TvWithDetails;

			if (!showData) {
				await interaction.editReply("Could not find details for that show.");
				return;
			}

			const container = createTvContainer(showData);
			await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
		} catch (error) {
			Logger.error("DISCORD_TV", `Error fetching TV show ID: ${showId}`, error);
			await interaction.editReply("An error occurred while fetching show information.");
		}
	},
};

function createTvContainer(show: TvWithDetails): ContainerBuilder {
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
	const topCast = show.credits?.cast?.length
		? show.credits.cast
				.slice(0, 5)
				.map((actor) => actor.name)
				.join(", ")
		: "N/A";

	const tmdbUrl = `https://www.themoviedb.org/tv/${show.id}`;
	const posterUrl = show.poster_path ? `${posterBase}${show.poster_path}` : null;
	const trailer = show.videos?.results?.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official) || show.videos?.results?.find((v) => v.site === "YouTube" && v.type === "Trailer");
	const trailerUrl = trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null;

	// ── Header: title + View Poster button ───────────────────────────────────
	const headerSection = new SectionBuilder()
		.addTextDisplayComponents(
			(text) => text.setContent(`# ${show.name || "Unknown Show"}`),
			(text) => text.setContent(`${rating} · ${statusEmoji} ${show.status || "Unknown"}`),
		)
		.setButtonAccessory((button) => button.setCustomId(`tv_poster_${show.id}`).setLabel("🖼️ View Poster").setStyle(ButtonStyle.Secondary).setDisabled(!posterUrl));

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
		.addTextDisplayComponents((text) => text.setContent(show.overview || "No description available."))
		.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents((text) => text.setContent("### 📺 Details"))
		.addTextDisplayComponents((text) =>
			text.setContent(
				`**Created By:** ${creators}\n` +
					`**Starring:** ${topCast}\n` +
					`**Genres:** ${genres}\n` +
					`**Network:** ${networks}\n` +
					`**Origin:** ${originCountries} (${originalLanguage})\n` +
					`**Seasons/Episodes:** ${show.number_of_seasons}s / ${show.number_of_episodes}eps\n` +
					`**Years Active:** ${yearsActive}`,
			),
		)
		.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addActionRowComponents(actionRow)
		.addSeparatorComponents((sep) => sep.setDivider(false).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents((text) => text.setContent(`-# Data provided by TheMovieDB · ${time(new Date(), TimestampStyles.ShortDateTime)}`));
}

export default tv;

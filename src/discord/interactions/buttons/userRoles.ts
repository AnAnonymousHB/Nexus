import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ComponentType, EmbedBuilder, MessageFlags } from "discord.js";

import { DiscordButton } from "../../../types/index.js";

const userRoles: DiscordButton = {
	customId: "user_roles",
	execute: async (interaction: ButtonInteraction) => {
		const { guild } = interaction;
		if (!guild) return;

		// Extract User ID and fetch member
		const userId = interaction.customId.replace(/^user[_-]roles[_-]/, "");
		const member = await guild.members.fetch(userId).catch(() => null);

		if (!member) {
			return void (await interaction.reply({
				content: "Could not find that member in this server.",
				flags: MessageFlags.Ephemeral,
			}));
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// Sort roles by position (Highest to Lowest)
		// We filter out @everyone (role.id === guild.id)
		const roles = member.roles.cache
			.filter((role) => role.id !== guild.id)
			.sort((a, b) => b.position - a.position)
			.map((role) => role);

		if (roles.length === 0) {
			return void (await interaction.editReply({
				content: `${member.user.username} has no roles besides @everyone.`,
			}));
		}

		const limit = 10;
		let currentPage = 0;
		const totalPages = Math.ceil(roles.length / limit);

		// Render Page Function
		const renderPage = (page: number) => {
			const skip = page * limit;
			const items = roles.slice(skip, skip + limit);

			const header = `\`\`\`\n #  │ Rank │ Role\n────┼──────┼─────────────────────\`\`\``;

			const roleList = items
				.map((role, index) => {
					const listPosition = (skip + index + 1).toString().padStart(2, "0");
					const serverRank = (guild.roles.cache.size - role.position).toString().padStart(4, "0");

					// Format to align with:  #  │ Rank │ Role
					return `\`${listPosition.toString().padStart(2, "0")}\` **│** \`${serverRank.toString().padStart(2, "0")}\` **│** ${role} **│** \`${role.id}\``;
				})
				.join("\n");

			const embed = new EmbedBuilder()
				.setTitle(`${member.user.globalName || member.user.username}'s Roles`)
				.setDescription(`${header}\n${roleList}`)
				.setColor(member.displayColor)
				.setFooter({
					text: `Page ${page + 1} of ${totalPages} • ${roles.length} total roles`,
					iconURL: member.user.displayAvatarURL(),
				})
				.setTimestamp();

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId("prev")
					.setLabel("Previous")
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(page === 0),
				new ButtonBuilder()
					.setCustomId("next")
					.setLabel("Next")
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(page === totalPages - 1),
			);

			return { embeds: [embed], components: [row] };
		};

		const response = await interaction.editReply(renderPage(currentPage));

		// Collector for Pagination
		const collector = response.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 60000,
		});

		collector.on("collect", async (i) => {
			if (i.user.id !== interaction.user.id) {
				return void (await i.reply({ content: "This menu is not for you.", flags: MessageFlags.Ephemeral }));
			}

			if (i.customId === "prev") currentPage--;
			if (i.customId === "next") currentPage++;

			await i.update(renderPage(currentPage));
		});

		collector.on("end", async () => {
			const finalOptions = renderPage(currentPage);
			// Disable all buttons in the row
			const disabledRow = ActionRowBuilder.from(finalOptions.components[0] as any);
			disabledRow.components.forEach((c: any) => c.setDisabled(true));

			await interaction.editReply({ components: [disabledRow as any] }).catch(() => null);
		});
	},
};

export default userRoles;

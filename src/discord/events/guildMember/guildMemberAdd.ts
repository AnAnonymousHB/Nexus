import { Client, EmbedBuilder, Events } from "discord.js";

import { DiscordModerationManager, InviteManager } from "../../../managers/index.js";

export default (client: Client) => {
	client.on(Events.GuildMemberAdd, async (member) => {
		const { guild, user, joinedTimestamp } = member;

		// Fetch Invite Data
		const usedInvite = await InviteManager.findUsedInvite(guild);
		const inviteCode = usedInvite ? usedInvite.code : "Unknown/Vanity";
		const inviterMention = usedInvite?.inviter ? `<@${usedInvite.inviter.id}>` : "System/Vanity";

		const joinTime = joinedTimestamp ?? Date.now();
		const accountAgeDays = Math.floor((Date.now() - user.createdTimestamp) / (1000 * 60 * 60 * 24));
		const isNewAccount = accountAgeDays < 7; // Flag accounts less than a week old

		const embed = new EmbedBuilder()
			.setTitle(isNewAccount ? "⚠️ New Member Joined" : "👤 Member Joined")
			.setColor(isNewAccount ? "#f1c40f" : "#57f287")
			.setThumbnail(user.displayAvatarURL())
			.setAuthor({ name: `${user.tag} (${user.id})`, iconURL: user.displayAvatarURL() })
			.addFields(
				{ name: "User ID", value: `\`${user.id}\``, inline: true },
				{ name: "Invite Code", value: `\`${inviteCode}\``, inline: true },
				{ name: "Invited By", value: inviterMention, inline: true },
				{ name: "Member Count", value: `${guild.memberCount.toLocaleString()}`, inline: true },
				{
					name: "Account Created",
					value: `<t:${Math.floor(user.createdTimestamp / 1000)}:f> (<t:${Math.floor(user.createdTimestamp / 1000)}:R>)`,
					inline: false,
				},
				{
					name: "Joined Server",
					value: `<t:${Math.floor(joinTime / 1000)}:f> (<t:${Math.floor(joinTime / 1000)}:R>)`,
					inline: false,
				},
			)
			.setTimestamp();

		if (isNewAccount) {
			embed.setFooter({ text: "Caution: This account is less than 7 days old." });
		}

		await DiscordModerationManager.logEvent(client, guild.id, embed);
	});
};

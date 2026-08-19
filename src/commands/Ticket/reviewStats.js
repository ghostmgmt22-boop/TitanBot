import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getColor } from '../../config/bot.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

function unwrapReplitData(data) {
    if (
        typeof data === "object" &&
        data !== null &&
        data.ok !== undefined &&
        data.value !== undefined
    ) {
        return unwrapReplitData(data.value);
    }
    return data;
}

function safeGetClaimedBy(ticket) {
    return ticket.claimedBy || ticket.claimedUserId || ticket.assignedTo || ticket.assignedUserId || ticket.claimedById || null;
}

function safeGetClosedBy(ticket) {
    return ticket.closedBy || ticket.closedById || ticket.closedByUserId || null;
}

function formatTimestamp(ts) {
    if (!ts) return 'N/A';
    try {
        const d = new Date(ts);
        return isNaN(d.getTime()) ? 'N/A' : `<t:${Math.floor(d.getTime() / 1000)}:f>`;
    } catch {
        return 'N/A';
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('review-stats')
        .setDescription('View ticket feedback/review stats for staff')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addUserOption((opt) => opt.setName('staff').setDescription('Show stats for a specific staff member').setRequired(false)),
    category: 'ticket',

    async execute(interaction, guildConfig, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        try {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('❌ Permission Denied')
                            .setDescription('You need Manage Channels to use this command.')
                            .setColor(getColor('error')),
                    ],
                });
            }

            if (!client.db || typeof client.db.list !== 'function') {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('⚠️ Database Unavailable')
                            .setDescription('The bot database is unavailable. Try again later.')
                            .setColor(getColor('error')),
                    ],
                });
            }

            const guildId = interaction.guildId;
            const staffUser = interaction.options.getUser('staff') || null;

            // List ticket keys and load tickets
            let keys = await client.db.list(`guild:${guildId}:ticket:`);
            if (!Array.isArray(keys) && typeof keys === 'object' && keys !== null) {
                keys = Object.keys(keys).filter((k) => k.startsWith(`guild:${guildId}:ticket:`));
            }
            keys = Array.isArray(keys) ? keys : [];

            const tickets = [];
            for (const key of keys) {
                if (key.endsWith(':counter')) continue;
                try {
                    const raw = await client.db.get(key, null);
                    const ticket = unwrapReplitData(raw) || null;
                    if (ticket) tickets.push(ticket);
                } catch (err) {
                    logger.warn('review-stats: failed to load ticket key', { key, error: err?.message });
                }
            }

            // Build mapping staffId => tickets they claimed
            const staffMap = new Map();
            for (const t of tickets) {
                const claimedBy = safeGetClaimedBy(t);
                if (!claimedBy) continue;
                if (!staffMap.has(claimedBy)) staffMap.set(claimedBy, []);
                staffMap.get(claimedBy).push(t);
            }

            if (staffUser) {
                const staffId = staffUser.id;
                const list = staffMap.get(staffId) || [];

                // compute avg rating for this staff
                let ratingSum = 0;
                let ratingCount = 0;
                for (const t of list) {
                    const r = t.feedback?.rating;
                    if (r != null && !Number.isNaN(Number(r))) {
                        ratingSum += Number(r);
                        ratingCount += 1;
                    }
                }
                const avgRating = ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null;

                const embed = new EmbedBuilder()
                    .setTitle(`Review stats for ${staffUser.tag}`)
                    .setColor(getColor('info'))
                    .addFields(
                        { name: 'Tickets claimed', value: String(list.length), inline: true },
                        { name: 'Average rating', value: avgRating != null ? String(avgRating) : 'N/A', inline: true },
                        { name: 'Feedback count', value: String(ratingCount), inline: true },
                    )
                    .setTimestamp();

                // list individual tickets (limit to 10 in embed, mention if more)
                const maxList = 10;
                if (list.length === 0) {
                    embed.setDescription('No tickets claimed by this staff member with recorded feedback.');
                } else {
                    let desc = '';
                    for (let i = 0; i < Math.min(list.length, maxList); i++) {
                        const t = list[i];
                        const rating = t.feedback?.rating ?? 'N/A';
                        const comment = t.feedback?.comment ? `\n> ${String(t.feedback.comment).slice(0, 200)}` : '';
                        const opener = t.userId ? `<@${t.userId}>` : 'Unknown';
                        const claimed = safeGetClaimedBy(t) ? `<@${safeGetClaimedBy(t)}>` : 'Unclaimed';
                        const closedBy = safeGetClosedBy(t) ? `<@${safeGetClosedBy(t)}>` : 'N/A';
                        desc += `**#${t.id ?? t.ticketNumber ?? 'unknown'}** — Rating: **${rating}** — Opened: ${formatTimestamp(t.createdAt)} — Closed: ${formatTimestamp(t.closedAt)}\nOpened by: ${opener} • Claimed: ${claimed} • Closed by: ${closedBy}${comment}\n\n`;
                    }
                    if (list.length > maxList) {
                        desc += `And ${list.length - maxList} more...`;
                    }
                    embed.setDescription(desc);
                }

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [embed],
                });
                return;
            }

            // No staff specified: show paginated staff summary (avg rating + count)
            const staffEntries = [];
            for (const [staffId, arr] of staffMap.entries()) {
                let sum = 0;
                let count = 0;
                for (const t of arr) {
                    const r = t.feedback?.rating;
                    if (r != null && !Number.isNaN(Number(r))) {
                        sum += Number(r);
                        count += 1;
                    }
                }
                const avg = count > 0 ? Math.round((sum / count) * 10) / 10 : null;
                staffEntries.push({ staffId, avg, feedbackCount: count, totalTickets: arr.length });
            }

            // sort descending by avg (nulls last), then by feedbackCount
            staffEntries.sort((a, b) => {
                if (a.avg == null && b.avg == null) return b.feedbackCount - a.feedbackCount;
                if (a.avg == null) return 1;
                if (b.avg == null) return -1;
                return b.avg - a.avg || b.feedbackCount - a.feedbackCount;
            });

            const pageSize = 8;
            let page = 0;
            const pages = Math.max(1, Math.ceil(staffEntries.length / pageSize));

            const buildPageEmbed = (p) => {
                const start = p * pageSize;
                const slice = staffEntries.slice(start, start + pageSize);
                const embed = new EmbedBuilder()
                    .setTitle('Staff Review Stats')
                    .setColor(getColor('info'))
                    .setFooter({ text: `Page ${p + 1} of ${pages}` })
                    .setTimestamp();

                if (slice.length === 0) {
                    embed.setDescription('No staff entries found.');
                } else {
                    for (const entry of slice) {
                        const name = `<@${entry.staffId}>`;
                        const avgLabel = entry.avg != null ? `${entry.avg} ⭐` : 'N/A';
                        embed.addFields({
                            name,
                            value: `Avg Rating: **${avgLabel}** • Feedbacks: **${entry.feedbackCount}** • Tickets claimed: **${entry.totalTickets}**`,
                        });
                    }
                }
                return embed;
            };

            const prevButton = new ButtonBuilder().setCustomId(`review_prev:${guildId}:${interaction.user.id}`).setLabel('Prev').setStyle(ButtonStyle.Secondary);
            const nextButton = new ButtonBuilder().setCustomId(`review_next:${guildId}:${interaction.user.id}`).setLabel('Next').setStyle(ButtonStyle.Secondary);
            const refreshButton = new ButtonBuilder().setCustomId(`review_refresh:${guildId}:${interaction.user.id}`).setLabel('Refresh').setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(prevButton, nextButton, refreshButton);

            const replyMsg = await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildPageEmbed(page)],
                components: [row],
            });

            // set up a short-lived component collector tied to this interaction's reply
            try {
                const message = await interaction.fetchReply();
                const collector = message.createMessageComponentCollector({
                    time: 2 * 60 * 1000, // 2 minutes
                    filter: (i) => i.user.id === interaction.user.id,
                });

                collector.on('collect', async (btnInt) => {
                    try {
                        const [action, gId, callerId] = btnInt.customId.split(':');
                        if (gId !== guildId || callerId !== interaction.user.id) {
                            await btnInt.reply({ content: 'This control is not for you.', ephemeral: true });
                            return;
                        }

                        if (action === 'review_prev') {
                            page = (page - 1 + pages) % pages;
                        } else if (action === 'review_next') {
                            page = (page + 1) % pages;
                        } else if (action === 'review_refresh') {
                            // rebuild staffEntries from fresh ticket list
                            // quick refresh: reload tickets (best-effort)
                            let refreshedKeys = await client.db.list(`guild:${guildId}:ticket:`);
                            if (!Array.isArray(refreshedKeys) && typeof refreshedKeys === 'object' && refreshedKeys !== null) {
                                refreshedKeys = Object.keys(refreshedKeys).filter((k) => k.startsWith(`guild:${guildId}:ticket:`));
                            }
                            const refreshedTickets = [];
                            for (const k of refreshedKeys || []) {
                                if (k.endsWith(':counter')) continue;
                                try {
                                    const raw = await client.db.get(k, null);
                                    const ticket = unwrapReplitData(raw) || null;
                                    if (ticket) refreshedTickets.push(ticket);
                                } catch {}
                            }
                            // rebuild staffMap and staffEntries
                            const refreshedMap = new Map();
                            for (const t of refreshedTickets) {
                                const cb = safeGetClaimedBy(t);
                                if (!cb) continue;
                                if (!refreshedMap.has(cb)) refreshedMap.set(cb, []);
                                refreshedMap.get(cb).push(t);
                            }
                            const refreshedEntries = [];
                            for (const [sid, arr] of refreshedMap.entries()) {
                                let sum = 0, count = 0;
                                for (const t of arr) {
                                    const r = t.feedback?.rating;
                                    if (r != null && !Number.isNaN(Number(r))) {
                                        sum += Number(r);
                                        count += 1;
                                    }
                                }
                                refreshedEntries.push({ staffId: sid, avg: count > 0 ? Math.round((sum / count) * 10) / 10 : null, feedbackCount: count, totalTickets: arr.length });
                            }
                            refreshedEntries.sort((a, b) => {
                                if (a.avg == null && b.avg == null) return b.feedbackCount - a.feedbackCount;
                                if (a.avg == null) return 1;
                                if (b.avg == null) return -1;
                                return b.avg - a.avg || b.feedbackCount - a.feedbackCount;
                            });
                            // replace
                            staffEntries.length = 0;
                            staffEntries.push(...refreshedEntries);
                            // recalc pages
                            const newPages = Math.max(1, Math.ceil(staffEntries.length / pageSize));
                            page = Math.min(page, newPages - 1);
                        }

                        await btnInt.update({ embeds: [buildPageEmbed(page)], components: [row] });
                    } catch (err) {
                        logger.error('review-stats: collector action failed', { error: err?.message });
                    }
                });

                collector.on('end', async () => {
                    try {
                        const disabledRow = new ActionRowBuilder().addComponents(
                            prevButton.setDisabled(true),
                            nextButton.setDisabled(true),
                            refreshButton.setDisabled(true),
                        );
                        await interaction.editReply({ components: [disabledRow] });
                    } catch {
                        // ignore
                    }
                });
            } catch (err) {
                logger.warn('review-stats: could not create component collector', { error: err?.message });
            }
        } catch (error) {
            logger.error('review-stats: unexpected error', { error: error?.message, stack: error?.stack });
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setTitle('❌ Error')
                        .setDescription('An unexpected error occurred while generating review stats.')
                        .setColor(getColor('error')),
                ],
            });
        }
    },
};

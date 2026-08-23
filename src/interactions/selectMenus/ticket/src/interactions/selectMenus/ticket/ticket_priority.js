import { MessageFlags } from 'discord.js';
import { updateTicketPriority } from '../../../services/ticket.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import {
  replyUserError,
  ErrorTypes
} from '../../../utils/errorHandler.js';
import {
  getTicketPermissionContext
} from '../../../utils/ticket/ticketPermissions.js';

export default {
  name: 'ticket_priority_select',

  async execute(interaction, client) {
    try {
      const permissionContext =
        await getTicketPermissionContext({
          client,
          interaction
        });

      if (!permissionContext.ticketData) {
        return await replyUserError(interaction, {
          type: ErrorTypes.VALIDATION,
          message: 'This action can only be used inside a ticket.'
        });
      }

      if (!permissionContext.canManageTicket) {
        return await replyUserError(interaction, {
          type: ErrorTypes.PERMISSION,
          message: 'You need permission to manage tickets to change the priority.'
        });
      }

      const priority = interaction.values[0];

      await InteractionHelper.safeDefer(interaction, {
        flags: MessageFlags.Ephemeral
      });

      await updateTicketPriority(
        interaction.channel,
        priority,
        interaction.user
      );

      await interaction.editReply({
        content: `⚡ Ticket priority changed to **${priority.toUpperCase()}**.`
      });

    } catch (error) {
      console.error('Priority select error:', error);

      if (!interaction.replied && !interaction.deferred) {
        await replyUserError(interaction, {
          type: ErrorTypes.UNKNOWN,
          message: 'Failed to update the ticket priority.'
        });
      }
    }
  }
};

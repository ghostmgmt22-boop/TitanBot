import createTicketHandler, {
  closeTicketHandler,
  claimTicketHandler,
  priorityTicketHandler,
  priorityMenuHandler,
  pinTicketHandler,
  unclaimTicketHandler,
  reopenTicketHandler,
  deleteTicketHandler,
} from '../../../handlers/ticketButtons.js'

export default [
  createTicketHandler,
  closeTicketHandler,
  claimTicketHandler,
  priorityTicketHandler,
  priorityMenuHandler,
  pinTicketHandler,
  unclaimTicketHandler,
  reopenTicketHandler,
  deleteTicketHandler,
]

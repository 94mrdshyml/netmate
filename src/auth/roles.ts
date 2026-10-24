// Who may open which part of /hq. Pure, so it can be tested without a request.

/** The owner (admin) or a moderator, for the few /hq pages a moderator may use (the members list and the numbers). */
export const isStaff = (member: { role: "admin" | "member"; moderator: boolean }): boolean => member.role === "admin" || member.moderator;

"use client";

import { createContext, useContext } from "react";

/**
 * Lets a post's menu tell the list it is in that the post is gone. The list on Home keeps what has loaded, so after Delete
 * it has to drop the post itself; lists that are drawn fresh by the server (a profile, Search) have no provider and
 * simply redraw.
 */
export const RemovePostContext = createContext<((postId: string) => void) | null>(null);

export const useRemovePost = () => useContext(RemovePostContext);

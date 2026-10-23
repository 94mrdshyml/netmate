import Link from "next/link";
import type { PersonView } from "@/server/follows";
import { Avatar } from "./avatar";
import { FollowButton } from "./follow-button";

/** One person in a list: picture, name, handle, a line of bio, and a Follow button (not for you). */
export function PersonRow({ person }: { person: PersonView }) {
  return (
    <li className="person">
      <Link href={`/${person.username}`} className="person-info">
        <Avatar userId={person.userId} avatarKey={person.avatarKey} size={44} />
        <span className="person-text">
          <strong>
            {person.firstName} {person.lastName}
          </strong>
          <span className="muted">@{person.username}</span>
          {person.bio ? <span className="person-bio">{person.bio}</span> : null}
        </span>
      </Link>
      {person.isMe ? null : (
        <FollowButton userId={person.userId} name={`${person.firstName} ${person.lastName}`} state={person.iFollow ? "following" : person.requested ? "requested" : "none"} />
      )}
    </li>
  );
}

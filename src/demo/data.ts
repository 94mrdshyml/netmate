// The people and posts of the demo (docs/PRD.md, "Demo data"). DEV AND TEST ONLY.
// Everything here is invented. The web addresses are on example domains, the names are made up,
// and the GIFs are public Klipy pictures (their addresses may stop working one day; a post then shows no picture).

import type { LinkCard } from "@/links/fetch";
import type { Scene } from "./pictures";

/** Everyone signs in with this. It is only ever put in a local development database. */
export const DEMO_PASSWORD = "demo-password";
export const DEMO_EMAIL_DOMAIN = "demo.example.com";

export type Person = {
  username: string;
  firstName: string;
  lastName: string;
  bio: string;
  location: string;
  link?: string;
  /** A private account: its posts are for approved followers only. */
  private?: true;
};

export const PEOPLE: Person[] = [
  { username: "meera_rao", firstName: "Meera", lastName: "Rao", bio: "Teacher. Tea first, marking later.", location: "Mumbai, India" },
  { username: "arjun_k", firstName: "Arjun", lastName: "Krishnan", bio: "Cyclist, coder, bad at chess.", location: "Bengaluru, India", link: "https://example.com/arjun" },
  { username: "sofia_m", firstName: "Sofia", lastName: "Marchetti", bio: "Pastry chef on weekdays, hiker on weekends.", location: "Bologna, Italy" },
  { username: "kwame_a", firstName: "Kwame", lastName: "Asante", bio: "Football, photos and long walks.", location: "Accra, Ghana" },
  { username: "priya_n", firstName: "Priya", lastName: "Nair", bio: "Doctor. Night shifts, daytime naps.", location: "Kochi, India" },
  { username: "tom_w", firstName: "Tom", lastName: "Walker", bio: "Builds wooden furniture. Slowly.", location: "Leeds, England", link: "https://example.com/tomwalker" },
  { username: "aiko_t", firstName: "Aiko", lastName: "Tanaka", bio: "Illustrator. Ink on every sleeve.", location: "Osaka, Japan" },
  { username: "daniel_o", firstName: "Daniel", lastName: "Okafor", bio: "Dad of two. Runs on coffee.", location: "Lagos, Nigeria" },
  { username: "lena_b", firstName: "Lena", lastName: "Brandt", bio: "Plants, books and a small bakery.", location: "Hamburg, Germany" },
  { username: "rahul_s", firstName: "Rahul", lastName: "Sharma", bio: "Cricket numbers and chai.", location: "Delhi, India" },
  { username: "noor_h", firstName: "Noor", lastName: "Hassan", bio: "Marine biology student. Mostly wet.", location: "Muscat, Oman" },
  { username: "jack_r", firstName: "Jack", lastName: "Rivera", bio: "Bad jokes, good tacos.", location: "Austin, USA" },
  { username: "ananya_d", firstName: "Ananya", lastName: "Desai", bio: "A quiet corner for early mornings and half-written stories.", location: "Pune, India", private: true },
  { username: "zara_k", firstName: "Zara", lastName: "Khan", bio: "Runs the book club. Reads three books at once.", location: "Jaipur, India" },
];

/** Real, public Klipy pictures: address, size and a short description. */
export const GIFS = {
  heart: { url: "https://static.klipy.com/ii/c3a19a0b747a76e98651f2b9a3cca5ff/15/a3/E10wQjEC.webp", width: 500, height: 500, title: "A heart drawn in black ink" },
  wow: { url: "https://static.klipy.com/ii/c3a19a0b747a76e98651f2b9a3cca5ff/57/a7/obh9U3qB.webp", width: 500, height: 300, title: "A man in a suit looking surprised" },
  dog: { url: "https://static.klipy.com/ii/c44064a00e4b7451969381d90dea1769/4a/63/zRqGs2Zk.webp", width: 498, height: 435, title: "A dog doing a happy dance" },
  thinking: { url: "https://static.klipy.com/ii/71b2873e478b9d8d0482ea3ec777ba7f/85/a0/vFycpRjg.webp", width: 498, height: 342, title: "A cartoon hero thinking it over" },
  bears: { url: "https://static.klipy.com/ii/7607a26399874a14744aa5e7accfa062/74/90/YouqSZfP.webp", width: 498, height: 434, title: "Two bears hugging" },
  hello: { url: "https://static.klipy.com/ii/d7aec6f6f171607374b2065c836f92f4/ec/f3/OXB1QWhn.gif", width: 640, height: 640, title: "A man waving hello" },
} as const;
export type GifKey = keyof typeof GIFS;

export type Item = {
  /** Who posts, by username. */
  as: string;
  text: string;
  /** A name other items refer to. */
  id?: string;
  /** A reply to the item with this id (or to the admin's latest post with "admin"). */
  reply?: string;
  /** A quote of the item with this id. */
  quote?: string;
  pics?: Scene[];
  gif?: GifKey;
  place?: string;
  link?: LinkCard;
  likes?: string[];
  saves?: string[];
  reposts?: string[];
};

const slowKitchen: LinkCard = {
  url: "https://example.com/slow-kitchen/sourdough-without-stress",
  title: "Sourdough without the stress",
  description: "A calm weekly routine for a loaf that tastes like the bakery's.",
  image: null,
  site: "The Slow Kitchen",
};
const lakeLoop: LinkCard = {
  url: "https://example.org/rides/lake-loop",
  title: "The lake loop: 62 km, two climbs",
  description: "A gentle route with a long flat middle and a view at the top.",
  image: null,
  site: "Ride Notes",
};
const reefBasics: LinkCard = {
  url: "https://example.net/ocean/how-a-reef-survey-works",
  title: "How a reef survey really works",
  description: "Lines, slates and patience: counting what lives on one square metre.",
  image: null,
  site: "Ocean Notes",
};
const tableTop: LinkCard = {
  url: "https://example.com/makers/flattening-a-table-top",
  title: "Flattening a table top by hand",
  description: "Winding sticks, a sharp plane and why you should stop earlier than you think.",
  image: null,
  site: "The Maker's Bench",
};
const bookList: LinkCard = {
  url: "https://example.org/books/quiet-novels-for-long-evenings",
  title: "Quiet novels for long evenings",
  description: "Twelve books where very little happens and all of it matters.",
  image: null,
  site: "Page Turner",
};

const everyone = PEOPLE.map((p) => p.username);
const but = (...names: string[]) => everyone.filter((n) => !names.includes(n));

/** Oldest first. Replies and quotes come after the item they point at. */
export const ITEMS: Item[] = [
  { as: "meera_rao", id: "term", text: "First day back after the break. The staff room smells of fresh paint, the chalk is new and the tea is as terrible as ever. #backtoschool", likes: ["rahul_s", "priya_n", "lena_b", "zara_k"] },
  { as: "arjun_k", id: "lake", text: "Rode 62 km before breakfast and the legs have opinions about it. Worth every one for the sunrise over the lake. #cycling #sunrise", pics: ["sunset", "hills"], place: "Bengaluru, India", likes: ["meera_rao", "kwame_a", "tom_w", "noor_h"], saves: ["tom_w"] },
  { as: "sofia_m", id: "bread", text: "New sourdough schedule: shape at night, bake in the morning. The crust sings when it comes out of the oven. @lena_b you were right about the long cold rest. #sourdough #baking", pics: ["stilllife"], likes: ["lena_b", "daniel_o", "meera_rao", "jack_r", "zara_k"], saves: ["lena_b", "meera_rao"], reposts: ["lena_b"] },
  { as: "kwame_a", id: "league", text: "Sunday league. We lost 3-1 and I have never had so much fun being bad at something. Our keeper did a dance when he saved one shot. #football", gif: "dog", likes: ["jack_r", "daniel_o", "rahul_s"] },
  { as: "lena_b", reply: "bread", text: "Told you! Twelve hours in the fridge and the crumb opens up like a dream. Send me a photo of the cut loaf." },
  { as: "priya_n", id: "shift", text: "Twelve hours on shift and the kindest thing today was a stranger leaving biscuits at the nurses' station. Small things carry people a long way. #grateful", likes: but("priya_n", "jack_r"), reposts: ["meera_rao", "arjun_k"] },
  { as: "tom_w", id: "table", text: "The walnut table is finally flat. Three weeks of planing and one very patient wife. A few photos of the build below. #woodworking #makers", pics: ["stilllife", "stripes", "skyline"], place: "Leeds, England", likes: ["aiko_t", "lena_b", "sofia_m", "arjun_k", "daniel_o"], saves: ["aiko_t"] },
  { as: "aiko_t", id: "sketch", text: "New sketchbook, first page. The ink bleeds, so I leave it that way. #illustration #sketchbook", pics: ["stripes"], likes: ["tom_w", "zara_k", "sofia_m", "ananya_d"], saves: ["zara_k"] },
  { as: "daniel_o", id: "schoolrun", text: "Seven a.m. school run, two kids, one shoe missing. Where does a shoe even go in a house with no stairs? We made it with four minutes to spare. #dadlife", gif: "thinking", likes: ["meera_rao", "priya_n", "kwame_a", "jack_r"] },
  { as: "meera_rao", reply: "schoolrun", text: "It is always under the sofa, or in the fridge. Ask me how I know." },
  { as: "rahul_s", id: "opening", text: "Hot take: a good opening spell matters more than the final score. A team that bowls tight in the first six overs has already won half the game. Fight me. #cricket", likes: ["kwame_a", "arjun_k"] },
  { as: "jack_r", reply: "opening", text: "Fighting you. Death overs win trophies and everybody forgets the first six by tea time." },
  { as: "noor_h", id: "reef", text: "Survey day at the reef. Counted 41 species before the tide turned. The water was so clear it felt like cheating. #marinebiology #reef", pics: ["hills", "sunset"], place: "Muscat, Oman", likes: ["priya_n", "lena_b", "aiko_t", "tom_w", "meera_rao"], saves: ["priya_n"] },
  { as: "lena_b", id: "plants", text: "The little bakery now sells plants on Fridays. A monstera and a loaf of rye is the new best gift. Come by if you are in Hamburg. #plants #bakery", pics: ["hills"], place: "Hamburg, Germany", likes: ["sofia_m", "zara_k", "tom_w"] },
  { as: "zara_k", id: "club", text: "Book club picks for next month are in, and nobody will like all of them. That is the point. Vote in the replies. #bookclub #reading", likes: ["meera_rao", "lena_b", "ananya_d", "aiko_t"], reposts: ["meera_rao"] },
  { as: "meera_rao", reply: "club", text: "Voting for anything quiet and slow. It has been a loud week." },
  { as: "ananya_d", reply: "club", text: "Something with a long train ride in it, please." },
  { as: "ananya_d", id: "early", text: "Writing in the early morning again. The house is quiet and the page is kind. Four hundred words before the kettle boiled. #writing", likes: ["zara_k", "aiko_t"] },
  { as: "jack_r", id: "tacos", text: "Tacos on a Tuesday should be law. Tell your friends. @arjun_k you owe me a ride and a taco, we shook on it.", pics: ["stilllife"], place: "Austin, USA", likes: ["arjun_k", "kwame_a", "daniel_o", "sofia_m"] },
  { as: "arjun_k", reply: "tacos", text: "I remember the ride. I do not remember agreeing to the taco. But fine, Saturday." },
  { as: "sofia_m", id: "recipe", text: "Wrote down my sourdough routine for anyone who asked. Nothing fancy, just a calm week. https://example.com/slow-kitchen/sourdough-without-stress #sourdough", link: slowKitchen, likes: ["lena_b", "meera_rao", "zara_k"], saves: ["zara_k", "daniel_o"] },
  { as: "arjun_k", id: "ride", text: "Mapped the lake loop so you can steal it: https://example.org/rides/lake-loop Two climbs, one coffee stop. #cycling", link: lakeLoop, likes: ["kwame_a", "tom_w", "jack_r"] },
  { as: "kwame_a", id: "light", text: "Golden hour on the pitch behind our street. Nothing happens here at six o'clock except light, and it is enough. #photography", pics: ["sunset", "skyline", "hills", "mountains"], place: "Accra, Ghana", likes: ["aiko_t", "noor_h", "arjun_k", "priya_n", "lena_b", "tom_w"], saves: ["aiko_t", "noor_h"] },
  { as: "aiko_t", quote: "light", text: "This is the colour I have been trying to mix for a week. Borrowing it, with thanks. #illustration", pics: ["sunset"], likes: ["kwame_a", "sofia_m"] },
  { as: "tom_w", id: "bench", text: "A short read on how I flatten a top by hand, for the three people who asked. https://example.com/makers/flattening-a-table-top #woodworking", link: tableTop, likes: ["aiko_t", "daniel_o"] },
  { as: "priya_n", id: "sleep", text: "Day shift tomorrow, which means I can finally sleep like a normal person tonight. Wish me luck. I have never once managed it.", gif: "hello", likes: ["meera_rao", "noor_h", "daniel_o"] },
  { as: "noor_h", reply: "sleep", text: "Turn the phone face down and do not look at it. I am saying this to myself too." },
  { as: "daniel_o", id: "pancakes", text: "Saturday pancakes with the kids. The first one is always for the dog. #weekend", pics: ["stilllife", "stripes"], likes: ["meera_rao", "sofia_m", "lena_b", "jack_r"] },
  { as: "rahul_s", id: "stats", text: "I have been keeping a spreadsheet of every club match I have watched this year. 74 so far. My family has stopped asking why. #cricket #stats", likes: ["arjun_k", "zara_k"] },
  { as: "zara_k", quote: "stats", text: "A spreadsheet of matches is a diary with extra steps. I love it. Book club should do one for books. #bookclub", likes: ["rahul_s", "meera_rao"] },
  { as: "lena_b", id: "rain", text: "Rain all day. The bakery smells of rye and wet coats and nobody wants to leave. This is the best kind of Tuesday.", likes: ["sofia_m", "meera_rao", "noor_h"], reposts: ["sofia_m"] },
  { as: "meera_rao", id: "marking", text: "Marking thirty essays on the same poem. One student wrote that the poet was clearly sad because it rains. I gave him full marks for confidence. #teaching", likes: ["priya_n", "rahul_s", "zara_k", "daniel_o", "lena_b"], saves: ["zara_k"] },
  { as: "daniel_o", reply: "marking", text: "Full marks for confidence is the only grading scale I trust." },
  { as: "sofia_m", quote: "marking", text: "Cooks get the same thing. Somebody told me my croissants were \"good for a Tuesday\". I am still thinking about it.", likes: ["meera_rao", "lena_b", "jack_r"] },
  { as: "noor_h", id: "reefread", text: "For everyone who asked what a survey day looks like, here is the short version. https://example.net/ocean/how-a-reef-survey-works #marinebiology", link: reefBasics, likes: ["priya_n", "tom_w", "kwame_a"], saves: ["tom_w"] },
  { as: "jack_r", id: "joke", text: "I tried to write a joke about a bakery, but it did not rise to the occasion.", gif: "wow", likes: ["sofia_m", "lena_b", "daniel_o", "kwame_a", "arjun_k"] },
  { as: "lena_b", reply: "joke", text: "Get out of my shop." },
  { as: "sofia_m", reply: "joke", text: "I am keeping this one for the shop sign, Jack." },
  { as: "ananya_d", id: "train", text: "On a slow train with a book and no signal. Whoever invented the window seat deserves a statue. #reading", likes: ["zara_k"] },
  { as: "zara_k", id: "list", text: "My list for long evenings, if you need one. https://example.org/books/quiet-novels-for-long-evenings #bookclub #reading", link: bookList, likes: ["meera_rao", "ananya_d", "aiko_t"], saves: ["meera_rao", "ananya_d"] },
  { as: "arjun_k", id: "mention", text: "Big thanks to @meera_rao for lending me her bike lights and to @tom_w for not laughing at my helmet. Safe riding, everyone. #cycling", likes: ["meera_rao", "tom_w", "priya_n"] },
  { as: "tom_w", reply: "mention", text: "The helmet is fine. The sticker on it was a bold choice." },
  { as: "kwame_a", id: "match", text: "We won! 2-1, last-minute goal, a ball that took a very long time to cross the line. I may never recover. #football", gif: "dog", likes: but("kwame_a", "ananya_d"), reposts: ["jack_r", "daniel_o"] },
  { as: "rahul_s", quote: "match", text: "From 3-1 down last week to this. Football is just cricket with fewer breaks. Congratulations. #football", likes: ["kwame_a", "jack_r"] },
  { as: "priya_n", id: "walk", text: "Walked the whole beach road after shift. Sunrise, one dog, a man selling tea from a bicycle. Best prescription I know.", pics: ["sunset", "hills"], place: "Kochi, India", likes: but("priya_n"), saves: ["noor_h", "meera_rao"] },
  { as: "aiko_t", id: "coffee", text: "Drew every cup on my desk. There are eleven. The oldest has a plant living in it. #illustration #sketchbook", pics: ["stilllife", "stripes", "skyline", "mountains"], likes: ["tom_w", "zara_k", "sofia_m", "lena_b", "noor_h"], saves: ["sofia_m"] },
  { as: "meera_rao", reply: "coffee", text: "The plant cup is my favourite. Does it have a name?" },
  { as: "aiko_t", reply: "coffee", text: "Gerald. He is doing very well." },
  { as: "daniel_o", id: "quiet", text: "The kids are asleep, the dishes are done and the house is silent. I do not know what to do with my hands. #dadlife", gif: "bears", likes: ["meera_rao", "priya_n", "kwame_a", "tom_w"] },
  { as: "jack_r", id: "thanks", text: "Shoutout to @sofia_m for the sourdough starter, which is now officially my roommate. I have named it Doug.", likes: ["sofia_m", "lena_b", "zara_k"] },
  { as: "sofia_m", reply: "thanks", text: "Feed Doug twice a day and tell him he is doing great. He listens." },
  { as: "ananya_d", id: "story", text: "Finished a short story today. Eleven pages, no villain, a kitchen at midnight. Nobody has read it yet and I am glad. #writing", likes: ["zara_k", "aiko_t"] },
  { as: "zara_k", reply: "story", text: "I am here when you want a first reader. No red pen, I promise." },
  { as: "noor_h", id: "gif", text: "Result of finishing the coral report two days before the deadline.", gif: "hello", likes: ["priya_n", "lena_b", "jack_r"] },
  { as: "rahul_s", id: "chai", text: "Chai at six, news at seven, a long walk with my father at eight. The best part of my week, and it happens every day. #family", likes: but("rahul_s", "jack_r", "ananya_d") },
  { as: "meera_rao", reply: "chai", text: "This is lovely, Rahul. Tell your father the tea sounds like a good idea." },
  { as: "arjun_k", id: "puncture", text: "Third puncture of the month. I now carry two spare tubes, a pump and a small amount of anger. #cycling", likes: ["tom_w", "kwame_a", "jack_r"] },
  { as: "tom_w", quote: "puncture", text: "I have a book on bike repair in the workshop if you want it. It is mostly diagrams of people being calm. #cycling", likes: ["arjun_k"] },
  { as: "lena_b", id: "window", text: "A customer left a note in the plant pot: \"This monstera changed my mornings.\" I am keeping it forever. #plants", pics: ["hills", "stilllife"], likes: ["sofia_m", "zara_k", "noor_h", "priya_n"], saves: ["sofia_m"] },
  { as: "priya_n", reply: "window", text: "I bought one last week. It has already outlived my last three plants." },
  { as: "kwame_a", id: "walkhome", text: "Long walk home after the match, the whole street smelling of grilled corn. I took forty photos and kept one. #photography", pics: ["skyline"], place: "Accra, Ghana", likes: ["aiko_t", "noor_h", "meera_rao"] },
  { as: "daniel_o", id: "coffee2", text: "Third coffee before nine. I am not proud. I am awake. #dadlife", likes: ["priya_n", "jack_r", "meera_rao", "kwame_a"] },
  { as: "sofia_m", id: "hike", text: "Sunday hike up the hill behind the city. Four hours up, one hour down, a sandwich at the top that was worth all five. #hiking", pics: ["mountains", "hills", "sunset"], place: "Bologna, Italy", likes: ["arjun_k", "tom_w", "lena_b", "noor_h", "kwame_a", "zara_k"], saves: ["arjun_k"], reposts: ["noor_h"] },
  { as: "noor_h", reply: "hike", text: "That view. I need a mountain after weeks of only looking down at the water." },
  { as: "tom_w", id: "shelf", text: "Built a bookshelf for the book club, since it keeps growing. Pine, no nails, one very satisfying click when the last joint closes. @zara_k it is ready when you are. #woodworking", pics: ["stilllife", "stripes"], place: "Leeds, England", likes: ["zara_k", "meera_rao", "aiko_t", "lena_b", "daniel_o"], saves: ["zara_k"] },
  { as: "zara_k", reply: "shelf", text: "Tom, I could cry. It will have pride of place and a polite sign asking people to put books back." },
  { as: "meera_rao", reply: "admin", text: "Welcome to the neighbourhood, @{admin}. Say hello, we are friendly and mostly harmless." },
  { as: "jack_r", reply: "admin", text: "Seconding that. Pull up a chair, @{admin}. The tacos are on Tuesday." },
  { as: "priya_n", id: "hello", text: "Good morning, @{admin}, and everyone else too. Coming off shift and glad this place is quiet and kind. #grateful", likes: ["meera_rao", "zara_k"] },
  { as: "arjun_k", id: "evening", text: "Evening ride along the river. Nobody on the path, a heron on the bank, and my phone finally in my pocket. #cycling #sunrise", pics: ["sunset"], place: "Bengaluru, India", likes: ["priya_n", "sofia_m", "kwame_a", "noor_h"] },
  { as: "aiko_t", id: "last", text: "Finished the poster for the library's reading week. Flat colours, a big red door and a cat. The cat was not planned. #illustration", pics: ["stripes", "hills"], likes: ["zara_k", "meera_rao", "tom_w", "lena_b", "ananya_d"], saves: ["zara_k", "meera_rao"], reposts: ["zara_k"] },
];

/** The admin follows these people, and these people follow the admin. (Nobody here is the private account.) */
export const ADMIN_FOLLOWS = everyone.filter((n) => n !== "ananya_d").slice(0, 9);
export const FOLLOW_ADMIN = everyone.filter((n) => n !== "ananya_d").slice(0, 10);

/** The private account: who is let in, and who is still waiting for an answer. */
export const PRIVATE_APPROVED = ["zara_k", "aiko_t", "meera_rao", "lena_b"];
export const PRIVATE_WAITING = ["jack_r"];

import { describe, expect, it } from "vitest";
import { extractEntities, MENTIONS_PER_POST, parsePostText, parseTagQuery, TAGS_PER_POST } from "@/lib/post-entities";

const kinds = (text: string) => parsePostText(text).map((s) => (s.kind === "text" ? s.text : `${s.kind}:${s.text}`));

describe("parsePostText", () => {
  it("finds tags and mentions and keeps every other character in place", () => {
    expect(kinds("hello #Coffee and @Meera_R, see you!")).toEqual(["hello ", "tag:#Coffee", " and ", "mention:@Meera_R", ", see you!"]);
  });

  it("always joins back to the original text", () => {
    const samples = ["", "plain", "  spaced  out  ", "#a #b @cde\n#f\tg", "email me@example.com #ok", "https://x.com/#top @abc", "((#tag)) \"@user\"", "日本語 #日本語 @abc"];
    for (const text of samples) expect(parsePostText(text).map((s) => s.text).join("")).toBe(text);
  });

  it("lower-cases the tag and the username it reports", () => {
    expect(parsePostText("#CoffeeTime @Riya_Sen")).toMatchObject([
      { kind: "tag", tag: "coffeetime" },
      { kind: "text" },
      { kind: "mention", username: "riya_sen" },
    ]);
  });

  it("ends a tag or mention at punctuation", () => {
    expect(kinds("#tag. #tag, #tag! #tag? (#tag) @user.")).toEqual(["tag:#tag", ". ", "tag:#tag", ", ", "tag:#tag", "! ", "tag:#tag", "? (", "tag:#tag", ") ", "mention:@user", "."]);
    expect(kinds("#well-known")).toEqual(["tag:#well", "-known"]);
  });

  it("takes a tag of letters, numbers and underscores in any script", () => {
    expect(parsePostText("#2024 #snake_case #日本語 #été")).toMatchObject([
      { tag: "2024" },
      {},
      { tag: "snake_case" },
      {},
      { tag: "日本語" },
      {},
      { tag: "été" },
    ]);
  });

  it("does not make a tag of an empty or underscore-only word, or one over 50 characters", () => {
    expect(kinds("# #_ #__ ##")).toEqual(["# #_ #__ ##"]);
    expect(kinds(`#${"a".repeat(50)}`)).toEqual([`tag:#${"a".repeat(50)}`]);
    expect(kinds(`#${"a".repeat(51)}`)).toEqual([`#${"a".repeat(51)}`]);
  });

  it("does not treat the middle of a word as the start of one", () => {
    expect(kinds("C# me@example.com a#b word@name")).toEqual(["C# me@example.com a#b word@name"]);
  });

  it("makes a mention only in the shape of a username", () => {
    expect(kinds("@ab @abc @a.b @this_is_far_too_long @has-dash")).toEqual(["@ab ", "mention:@abc", " @a.b @this_is_far_too_long ", "mention:@has", "-dash"]);
    expect(kinds("@ünï")).toEqual(["@ünï"]);
  });

  it("leaves web addresses alone", () => {
    expect(kinds("go to https://example.com/page#section now www.site.org/@user #tag")).toEqual(["go to https://example.com/page#section now www.site.org/@user ", "tag:#tag"]);
  });

  it("is not fooled by a hash or an at sign next to another one", () => {
    expect(kinds("#a#b @abc@def")).toEqual(["tag:#a", "#b ", "mention:@abc", "@def"]);
  });

  it("never turns anything into markup: the text of a segment is exactly what was typed", () => {
    const parts = parsePostText("<b>#x</b> <script>@abc</script>");
    expect(parts.map((s) => s.text).join("")).toBe("<b>#x</b> <script>@abc</script>");
    expect(parts.filter((s) => s.kind !== "text")).toMatchObject([{ kind: "tag", tag: "x" }, { kind: "mention", username: "abc" }]);
  });
});

describe("extractEntities", () => {
  it("lists distinct tags and mentions in order", () => {
    expect(extractEntities("#A #b #a @Bob @bob @carol")).toEqual({ tags: ["a", "b"], mentions: ["bob", "carol"] });
  });

  it("keeps at most 10 tags and 10 mentions; the rest stay plain text", () => {
    const manyTags = Array.from({ length: 14 }, (_, i) => `#t${i}`).join(" ");
    const manyMentions = Array.from({ length: 14 }, (_, i) => `@user${i}`).join(" ");
    const found = extractEntities(`${manyTags} ${manyMentions}`);
    expect(found.tags).toHaveLength(TAGS_PER_POST);
    expect(found.tags[9]).toBe("t9");
    expect(found.mentions).toHaveLength(MENTIONS_PER_POST);
    expect(found.mentions[9]).toBe("user9");
  });

  it("finds nothing in plain text", () => {
    expect(extractEntities("nothing special here")).toEqual({ tags: [], mentions: [] });
  });
});

describe("parseTagQuery", () => {
  it("reads one hashtag typed alone, lower-cased", () => {
    expect(parseTagQuery("#Coffee")).toBe("coffee");
    expect(parseTagQuery("  #a  ")).toBe("a");
    expect(parseTagQuery("#日本語")).toBe("日本語");
  });

  it.each(["coffee", "#", "##a", "#a b", "#a #b", "#__", "@a", "#a-b", "", `#${"a".repeat(51)}`, "\"#a\""])("is not a tag search: %j", (raw) => {
    expect(parseTagQuery(raw)).toBeNull();
  });

  it("refuses things that are not text", () => {
    for (const v of [undefined, null, 5, {}]) expect(parseTagQuery(v)).toBeNull();
  });
});

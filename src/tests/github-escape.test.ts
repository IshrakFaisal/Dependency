import { describe, expect, it } from "vitest";
import { escapeCommentText } from "@/lib/github/escape";

describe("GitHub comment text escaping", () => {
  it.each([
    ["`code`", "<code>&#96;code&#96;</code>"],
    ["a | b", "<code>a &#124; b</code>"],
    ["<name>", "<code>&#60;name&#62;</code>"],
    [
      '<img src="x" onerror="alert(1)">',
      "<code>&#60;img src&#61;&#34;x&#34; onerror&#61;&#34;alert&#40;1&#41;&#34;&#62;</code>",
    ],
    ["@user @org/team", "<code>&#64;user &#64;org&#47;team</code>"],
    [
      "[click](https://example.invalid)",
      "<code>&#91;click&#93;&#40;https&#58;&#47;&#47;example&#46;invalid&#41;</code>",
    ],
    ["a\r\n| b\n\n# heading\tend", "<code>a &#124; b &#35; heading end</code>"],
    ["&lt;script&gt;", "<code>&#38;lt&#59;script&#38;gt&#59;</code>"],
    ["＊bold＊ ＠user", "<code>&#42;bold&#42; &#64;user</code>"],
    [
      "safe unsafe malicious clean verified",
      "<code>&#91;omitted&#93; &#91;omitted&#93; &#91;omitted&#93; &#91;omitted&#93; &#91;omitted&#93;</code>",
    ],
    ['"riskScore": 82', "<code>&#34;&#91;score omitted&#93;</code>"],
  ])("renders %j inert with exact entity output", (input, expected) => {
    expect(escapeCommentText(input)).toBe(expected);
  });
});

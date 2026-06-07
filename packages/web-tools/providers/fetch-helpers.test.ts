import { describe, expect, test } from "vitest";
import {
  htmlToText,
  extractTitle,
  isHtmlContentType,
  assertTextContentType,
  isPrivateOrLoopbackHostname,
  parseAndAssertHttpUrl,
} from "./fetch-helpers.ts";

describe("htmlToText", () => {
  test("strips script/style/noscript blocks", () => {
    const html =
      '<p>Hello</p><script>alert("x")</script><style>.x{}</style><noscript>no</noscript><p>World</p>';
    expect(htmlToText(html)).toBe("Hello\n World");
  });

  test("converts block-level closing tags to newlines", () => {
    expect(htmlToText("<p>A</p><p>B</p>")).toBe("A\n B");
    expect(htmlToText("<h1>Title</h1>")).toBe("Title");
    expect(htmlToText("<div>X</div><div>Y</div>")).toBe("X\n Y");
  });

  test("converts <br> to newlines", () => {
    expect(htmlToText("A<br>B")).toBe("A\nB");
    expect(htmlToText("A<br/>B")).toBe("A\nB");
    expect(htmlToText("A<br />B")).toBe("A\nB");
  });

  test("strips all remaining tags", () => {
    expect(htmlToText('<a href="x">link</a>')).toBe("link");
    expect(htmlToText("<span>text</span>")).toBe("text");
    expect(htmlToText("<em>italic</em>")).toBe("italic");
  });

  test("decodes HTML entities", () => {
    expect(htmlToText("&amp;")).toBe("&");
    expect(htmlToText("&lt;tag&gt;")).toBe("<tag>");
    expect(htmlToText("&quot;hi&quot;")).toBe('"hi"');
    expect(htmlToText("a&nbsp;b")).toBe("a b");
    expect(htmlToText("&#39;")).toBe("'");
    expect(htmlToText("&#65;")).toBe("A");
  });

  test("collapses horizontal whitespace and blank lines", () => {
    expect(htmlToText("a    b")).toBe("a b");
    expect(htmlToText("a\n\n\n\nb")).toBe("a\n\nb");
  });

  test("trims leading and trailing whitespace", () => {
    expect(htmlToText("  <p>hello</p>  ")).toBe("hello");
  });

  test("returns empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText("   ")).toBe("");
  });

  test("handles a realistic HTML page", () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
  <h1>Welcome</h1>
  <p>This is a <strong>test</strong> page.</p>
  <script>console.log("hidden")</script>
  <ul>
    <li>Item 1</li>
    <li>Item 2</li>
  </ul>
</body>
</html>`;
    const text = htmlToText(html);
    expect(text).toContain("Welcome");
    expect(text).toContain("This is a test page.");
    expect(text).toContain("Item 1");
    expect(text).toContain("Item 2");
    expect(text).not.toContain("console.log");
    expect(text).not.toContain("hidden");
  });
});

describe("extractTitle", () => {
  test("extracts title from HTML", () => {
    expect(
      extractTitle("<html><head><title>My Page</title></head></html>"),
    ).toBe("My Page");
  });

  test("returns undefined when no title tag", () => {
    expect(extractTitle("<html><body>No title</body></html>")).toBeUndefined();
  });

  test("returns undefined for empty title", () => {
    expect(extractTitle("<title></title>")).toBeUndefined();
    expect(extractTitle("<title>   </title>")).toBeUndefined();
  });

  test("strips inner HTML tags from title", () => {
    expect(extractTitle("<title>Hello <b>World</b></title>")).toBe(
      "Hello World",
    );
  });

  test("is case-insensitive", () => {
    expect(extractTitle("<TITLE>Test</TITLE>")).toBe("Test");
  });
});

describe("isHtmlContentType", () => {
  test("matches text/html", () => {
    expect(isHtmlContentType("text/html")).toBe(true);
    expect(isHtmlContentType("text/html; charset=utf-8")).toBe(true);
  });

  test("rejects non-HTML types", () => {
    expect(isHtmlContentType("text/plain")).toBe(false);
    expect(isHtmlContentType("application/json")).toBe(false);
    expect(isHtmlContentType("image/png")).toBe(false);
  });
});

describe("assertTextContentType", () => {
  test("passes for text types", () => {
    expect(() => assertTextContentType("text/html")).not.toThrow();
    expect(() => assertTextContentType("text/plain")).not.toThrow();
    expect(() => assertTextContentType("application/json")).not.toThrow();
  });

  test("throws for image types", () => {
    expect(() => assertTextContentType("image/png")).toThrow(
      "Unsupported content type",
    );
    expect(() => assertTextContentType("image/jpeg")).toThrow(
      "Unsupported content type",
    );
  });

  test("throws for video types", () => {
    expect(() => assertTextContentType("video/mp4")).toThrow(
      "Unsupported content type",
    );
  });

  test("throws for audio types", () => {
    expect(() => assertTextContentType("audio/mpeg")).toThrow(
      "Unsupported content type",
    );
  });
});

describe("isPrivateOrLoopbackHostname", () => {
  test("blocks localhost variants", () => {
    expect(isPrivateOrLoopbackHostname("localhost")).toBe(true);
    expect(isPrivateOrLoopbackHostname("LOCALHOST")).toBe(true);
    expect(isPrivateOrLoopbackHostname("sub.localhost")).toBe(true);
  });

  test("blocks loopback addresses", () => {
    expect(isPrivateOrLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isPrivateOrLoopbackHostname("127.255.255.255")).toBe(true);
  });

  test("blocks 0.0.0.0/8", () => {
    expect(isPrivateOrLoopbackHostname("0.0.0.0")).toBe(true);
  });

  test("blocks RFC 1918 private ranges", () => {
    expect(isPrivateOrLoopbackHostname("10.0.0.1")).toBe(true);
    expect(isPrivateOrLoopbackHostname("10.255.255.255")).toBe(true);
    expect(isPrivateOrLoopbackHostname("172.16.0.1")).toBe(true);
    expect(isPrivateOrLoopbackHostname("172.31.255.255")).toBe(true);
    expect(isPrivateOrLoopbackHostname("192.168.1.1")).toBe(true);
    expect(isPrivateOrLoopbackHostname("192.168.0.0")).toBe(true);
  });

  test("allows 172.15.x.x and 172.32.x.x (outside RFC 1918)", () => {
    expect(isPrivateOrLoopbackHostname("172.15.0.1")).toBe(false);
    expect(isPrivateOrLoopbackHostname("172.32.0.1")).toBe(false);
  });

  test("blocks link-local (169.254.x.x including cloud metadata)", () => {
    expect(isPrivateOrLoopbackHostname("169.254.169.254")).toBe(true);
    expect(isPrivateOrLoopbackHostname("169.254.0.1")).toBe(true);
  });

  test("blocks IPv6 loopback", () => {
    expect(isPrivateOrLoopbackHostname("::1")).toBe(true);
  });

  test("blocks IPv6 unspecified", () => {
    expect(isPrivateOrLoopbackHostname("::")).toBe(true);
  });

  test("blocks IPv6 link-local (fe80::)", () => {
    expect(isPrivateOrLoopbackHostname("fe80::1")).toBe(true);
  });

  test("blocks IPv6 unique-local (fc/fd)", () => {
    expect(isPrivateOrLoopbackHostname("fc00::1")).toBe(true);
    expect(isPrivateOrLoopbackHostname("fd12:3456::1")).toBe(true);
  });

  test("allows public hostnames", () => {
    expect(isPrivateOrLoopbackHostname("example.com")).toBe(false);
    expect(isPrivateOrLoopbackHostname("8.8.8.8")).toBe(false);
    expect(isPrivateOrLoopbackHostname("1.1.1.1")).toBe(false);
    expect(isPrivateOrLoopbackHostname("github.com")).toBe(false);
  });

  test("handles IPv6 bracket notation", () => {
    expect(isPrivateOrLoopbackHostname("[::1]")).toBe(true);
    expect(isPrivateOrLoopbackHostname("[2001:db8::1]")).toBe(false);
  });
});

describe("parseAndAssertHttpUrl", () => {
  test("parses valid http URL", () => {
    const url = parseAndAssertHttpUrl("http://example.com/path?q=1");
    expect(url.protocol).toBe("http:");
    expect(url.hostname).toBe("example.com");
    expect(url.pathname).toBe("/path");
  });

  test("parses valid https URL", () => {
    const url = parseAndAssertHttpUrl("https://example.com");
    expect(url.protocol).toBe("https:");
  });

  test("throws for invalid URL", () => {
    expect(() => parseAndAssertHttpUrl("not-a-url")).toThrow("Invalid URL");
    expect(() => parseAndAssertHttpUrl("")).toThrow("Invalid URL");
  });

  test("throws for non-http protocols", () => {
    expect(() => parseAndAssertHttpUrl("ftp://example.com")).toThrow(
      "Unsupported URL protocol",
    );
    expect(() => parseAndAssertHttpUrl("file:///etc/passwd")).toThrow(
      "Unsupported URL protocol",
    );
    expect(() => parseAndAssertHttpUrl("javascript:alert(1)")).toThrow(
      "Unsupported URL protocol",
    );
  });

  test("throws for loopback addresses", () => {
    expect(() => parseAndAssertHttpUrl("http://localhost/secret")).toThrow(
      "Refusing to fetch",
    );
    expect(() => parseAndAssertHttpUrl("http://127.0.0.1/secret")).toThrow(
      "Refusing to fetch",
    );
  });

  test("throws for RFC 1918 addresses", () => {
    expect(() => parseAndAssertHttpUrl("http://192.168.1.1/")).toThrow(
      "Refusing to fetch",
    );
    expect(() => parseAndAssertHttpUrl("http://10.0.0.1/")).toThrow(
      "Refusing to fetch",
    );
    expect(() => parseAndAssertHttpUrl("http://172.16.0.1/")).toThrow(
      "Refusing to fetch",
    );
  });

  test("throws for link-local and cloud metadata", () => {
    expect(() => parseAndAssertHttpUrl("http://169.254.169.254/")).toThrow(
      "Refusing to fetch",
    );
  });

  test("allows public URLs", () => {
    expect(() => parseAndAssertHttpUrl("https://example.com")).not.toThrow();
    expect(() =>
      parseAndAssertHttpUrl("https://github.com/user/repo"),
    ).not.toThrow();
    expect(() => parseAndAssertHttpUrl("http://8.8.8.8/dns")).not.toThrow();
  });
});

import { describe, expect, test } from "vitest";
import {
  classifyPromotedRuleCandidate,
  classifyTokenAsPathCandidate,
  classifyTokenAsRuleCandidate,
} from "../../../src/access-intent/bash/token-classification.ts";

describe("classifyTokenAsPathCandidate", () => {
  describe("shared rejection: rejectNonPathToken", () => {
    test("empty string → null", () => {
      expect(classifyTokenAsPathCandidate("")).toBeNull();
    });

    test("flag (leading dash) → null", () => {
      expect(classifyTokenAsPathCandidate("-r")).toBeNull();
      expect(classifyTokenAsPathCandidate("--recursive")).toBeNull();
    });

    test("env assignment (= before any /) → null", () => {
      expect(classifyTokenAsPathCandidate("FOO=/bar")).toBeNull();
      expect(classifyTokenAsPathCandidate("HOME=/home/user")).toBeNull();
    });

    test("env-like token where = comes after / is NOT rejected as assignment", () => {
      expect(classifyTokenAsPathCandidate("/foo=bar")).toBe("/foo=bar");
    });

    test("URL → null", () => {
      expect(classifyTokenAsPathCandidate("https://example.com")).toBeNull();
      expect(classifyTokenAsPathCandidate("http://localhost:3000")).toBeNull();
      expect(classifyTokenAsPathCandidate("file:///tmp/foo")).toBeNull();
      expect(classifyTokenAsPathCandidate("git+ssh://github.com/a/b")).toBeNull();
    });

    test("@scope/package → null", () => {
      expect(classifyTokenAsPathCandidate("@foo/bar")).toBeNull();
      expect(classifyTokenAsPathCandidate("@scope/pkg")).toBeNull();
    });

    test("@/ prefix is NOT rejected by the shared rejection", () => {
      expect(classifyTokenAsPathCandidate("@/foo/bar")).toBeNull();
    });

    test("bare-slash token → null", () => {
      expect(classifyTokenAsPathCandidate("/")).toBeNull();
      expect(classifyTokenAsPathCandidate("//")).toBeNull();
      expect(classifyTokenAsPathCandidate("///")).toBeNull();
    });

    test("regex metacharacters → null", () => {
      expect(classifyTokenAsPathCandidate("foo.*")).toBeNull();
      expect(classifyTokenAsPathCandidate("bar.+")).toBeNull();
      expect(classifyTokenAsPathCandidate("a\\|b")).toBeNull();
      expect(classifyTokenAsPathCandidate("\\(group\\)")).toBeNull();
      expect(classifyTokenAsPathCandidate("[abc]")).toBeNull();
      expect(classifyTokenAsPathCandidate("^/start")).toBeNull();
    });
  });

  describe("path-candidate acceptance gate", () => {
    test("absolute path (starts with /) → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("/etc/hosts")).toBe("/etc/hosts");
      expect(classifyTokenAsPathCandidate("/tmp")).toBe("/tmp");
      expect(classifyTokenAsPathCandidate("/home/user/file.txt")).toBe("/home/user/file.txt");
    });

    test("home-relative path (starts with ~/) → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("~/Documents")).toBe("~/Documents");
      expect(classifyTokenAsPathCandidate("~/.ssh/config")).toBe("~/.ssh/config");
    });

    test("parent-traversal (contains ..) → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("../../etc/passwd")).toBe("../../etc/passwd");
      expect(classifyTokenAsPathCandidate("../foo")).toBe("../foo");
      expect(classifyTokenAsPathCandidate("..")).toBe("..");
    });

    test("plain word with no path shape → null", () => {
      expect(classifyTokenAsPathCandidate("hello")).toBeNull();
      expect(classifyTokenAsPathCandidate("myfile.txt")).toBeNull();
    });

    test("dot-file (starts with .) → null (strict path gate)", () => {
      expect(classifyTokenAsPathCandidate(".env")).toBeNull();
      expect(classifyTokenAsPathCandidate(".gitignore")).toBeNull();
    });

    test("relative path with / but no leading / or ~/ → null (strict path gate)", () => {
      expect(classifyTokenAsPathCandidate("src/foo.ts")).toBeNull();
      expect(classifyTokenAsPathCandidate("./build")).toBeNull();
    });
  });

  describe("Windows drive-letter acceptance gate", () => {
    test("forward-slash drive path → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("C:/Windows/win.ini")).toBe("C:/Windows/win.ini");
      expect(classifyTokenAsPathCandidate("D:/secrets/password.txt")).toBe("D:/secrets/password.txt");
    });

    test("backslash drive path → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("C:\\Windows\\win.ini")).toBe("C:\\Windows\\win.ini");
      expect(classifyTokenAsPathCandidate("D:\\secrets\\password.txt")).toBe("D:\\secrets\\password.txt");
    });

    test("lowercase drive letter → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("c:/foo")).toBe("c:/foo");
    });

    test("single-letter scheme with double-slash (c://x) → null (URL_PATTERN fires first)", () => {
      expect(classifyTokenAsPathCandidate("c://x")).toBeNull();
    });

    test("drive-relative path without separator (C:foo) → null", () => {
      expect(classifyTokenAsPathCandidate("C:foo")).toBeNull();
    });
  });
});

describe("classifyTokenAsRuleCandidate", () => {
  describe("shared rejection: rejectNonPathToken", () => {
    test("empty string → null", () => {
      expect(classifyTokenAsRuleCandidate("")).toBeNull();
    });

    test("flag (leading dash) → null", () => {
      expect(classifyTokenAsRuleCandidate("-r")).toBeNull();
      expect(classifyTokenAsRuleCandidate("--recursive")).toBeNull();
    });

    test("env assignment (= before any /) → null", () => {
      expect(classifyTokenAsRuleCandidate("FOO=/bar")).toBeNull();
      expect(classifyTokenAsRuleCandidate("HOME=/home/user")).toBeNull();
    });

    test("env-like token where = comes after / is NOT rejected as assignment", () => {
      expect(classifyTokenAsRuleCandidate("/foo=bar")).toBe("/foo=bar");
    });

    test("URL → null", () => {
      expect(classifyTokenAsRuleCandidate("https://example.com")).toBeNull();
      expect(classifyTokenAsRuleCandidate("http://localhost:3000")).toBeNull();
      expect(classifyTokenAsRuleCandidate("file:///tmp/foo")).toBeNull();
    });

    test("@scope/package → null", () => {
      expect(classifyTokenAsRuleCandidate("@foo/bar")).toBeNull();
      expect(classifyTokenAsRuleCandidate("@scope/pkg")).toBeNull();
    });

    test("bare-slash token → null", () => {
      expect(classifyTokenAsRuleCandidate("/")).toBeNull();
      expect(classifyTokenAsRuleCandidate("//")).toBeNull();
    });

    test("regex metacharacters → null", () => {
      expect(classifyTokenAsRuleCandidate("foo.*")).toBeNull();
      expect(classifyTokenAsRuleCandidate("bar.+")).toBeNull();
      expect(classifyTokenAsRuleCandidate("a\\|b")).toBeNull();
      expect(classifyTokenAsRuleCandidate("[abc]")).toBeNull();
      expect(classifyTokenAsRuleCandidate("^/start")).toBeNull();
    });
  });

  describe("rule-candidate acceptance gate (broader than path)", () => {
    test("absolute path (starts with /) → returned as-is", () => {
      expect(classifyTokenAsRuleCandidate("/etc/hosts")).toBe("/etc/hosts");
    });

    test("home-relative path (starts with ~/) → returned as-is", () => {
      expect(classifyTokenAsRuleCandidate("~/Documents")).toBe("~/Documents");
    });

    test("parent-traversal (contains ..) → returned as-is", () => {
      expect(classifyTokenAsRuleCandidate("../foo")).toBe("../foo");
      expect(classifyTokenAsRuleCandidate("..")).toBe("..");
    });

    test("dot-file (starts with .) → returned as-is", () => {
      expect(classifyTokenAsRuleCandidate(".env")).toBe(".env");
      expect(classifyTokenAsRuleCandidate(".gitignore")).toBe(".gitignore");
    });

    test("current-dir relative (starts with ./) → returned as-is", () => {
      expect(classifyTokenAsRuleCandidate("./src")).toBe("./src");
      expect(classifyTokenAsRuleCandidate("./build/output.js")).toBe("./build/output.js");
    });

    test("relative path containing / → returned as-is", () => {
      expect(classifyTokenAsRuleCandidate("src/foo.ts")).toBe("src/foo.ts");
      expect(classifyTokenAsRuleCandidate("packages/pi-foo/index.ts")).toBe("packages/pi-foo/index.ts");
    });

    test("plain word with no path shape → null", () => {
      expect(classifyTokenAsRuleCandidate("hello")).toBeNull();
      expect(classifyTokenAsRuleCandidate("myfile.txt")).toBeNull();
    });
  });

  describe("Windows drive-letter acceptance gate", () => {
    test("forward-slash drive path → returned as-is", () => {
      expect(classifyTokenAsRuleCandidate("C:/Windows/win.ini")).toBe("C:/Windows/win.ini");
    });

    test("backslash drive path → returned as-is (new: no forward slash)", () => {
      expect(classifyTokenAsRuleCandidate("D:\\secrets\\password.txt")).toBe("D:\\secrets\\password.txt");
      expect(classifyTokenAsRuleCandidate("C:\\Windows\\win.ini")).toBe("C:\\Windows\\win.ini");
    });

    test("lowercase drive letter (backslash) → returned as-is", () => {
      expect(classifyTokenAsRuleCandidate("c:\\foo")).toBe("c:\\foo");
    });

    test("drive-relative path without separator (C:foo) → null", () => {
      expect(classifyTokenAsRuleCandidate("C:foo")).toBeNull();
    });
  });

  describe("Windows backslash-relative acceptance gate (windowsSeparators option, #520)", () => {
    test("backslash-relative token accepted with windowsSeparators: true", () => {
      expect(classifyTokenAsRuleCandidate("dir\\file", { windowsSeparators: true })).toBe("dir\\file");
    });

    test("backslash-relative token rejected with no options (default unchanged)", () => {
      expect(classifyTokenAsRuleCandidate("dir\\file")).toBeNull();
    });

    test("backslash-relative token rejected with windowsSeparators: false", () => {
      expect(
        classifyTokenAsRuleCandidate("dir\\file", {
          windowsSeparators: false,
        }),
      ).toBeNull();
    });

    test("backslash regex-metacharacter token still rejected under the flag", () => {
      expect(classifyTokenAsRuleCandidate("a\\|b", { windowsSeparators: true })).toBeNull();
      expect(
        classifyTokenAsRuleCandidate("\\(group\\)", {
          windowsSeparators: true,
        }),
      ).toBeNull();
    });

    test("backslash traversal accepted regardless of the flag (already via ..)", () => {
      expect(classifyTokenAsRuleCandidate("..\\secret")).toBe("..\\secret");
      expect(
        classifyTokenAsRuleCandidate("..\\secret", {
          windowsSeparators: false,
        }),
      ).toBe("..\\secret");
    });
  });

  describe("rule-vs-path divergence", () => {
    const dotFiles = [".env", ".gitignore", ".eslintrc"];
    const relPaths = ["src/index.ts", "lib/utils.js", "config/settings.json"];

    for (const tok of dotFiles) {
      test(`dot-file "${tok}": rule accepts, path rejects`, () => {
        expect(classifyTokenAsRuleCandidate(tok)).toBe(tok);
        expect(classifyTokenAsPathCandidate(tok)).toBeNull();
      });
    }

    for (const tok of relPaths) {
      test(`relative path "${tok}": rule accepts, path rejects`, () => {
        expect(classifyTokenAsRuleCandidate(tok)).toBe(tok);
        expect(classifyTokenAsPathCandidate(tok)).toBeNull();
      });
    }

    const sharedAccepted = ["/etc/hosts", "~/docs", "../sibling"];
    for (const tok of sharedAccepted) {
      test(`"${tok}": both classifiers accept`, () => {
        expect(classifyTokenAsRuleCandidate(tok)).toBe(tok);
        expect(classifyTokenAsPathCandidate(tok)).toBe(tok);
      });
    }

    const winDrivePaths = ["C:/Windows/win.ini", "D:\\secrets\\password.txt", "c:/foo"];
    for (const tok of winDrivePaths) {
      test(`Windows drive path "${tok}": both classifiers accept`, () => {
        expect(classifyTokenAsRuleCandidate(tok)).toBe(tok);
        expect(classifyTokenAsPathCandidate(tok)).toBe(tok);
      });
    }

    const sharedRejected = ["hello", "--flag", "FOO=/bar", "https://x.com"];
    for (const tok of sharedRejected) {
      test(`"${tok}": both classifiers reject`, () => {
        expect(classifyTokenAsRuleCandidate(tok)).toBeNull();
        expect(classifyTokenAsPathCandidate(tok)).toBeNull();
      });
    }
  });
});

describe("classifyPromotedRuleCandidate", () => {
  test("shape-eligible bare token promoted when predicate returns true", () => {
    expect(classifyPromotedRuleCandidate("id_rsa", () => true)).toBe("id_rsa");
  });

  test("shape-eligible bare token rejected when predicate returns false", () => {
    expect(classifyPromotedRuleCandidate("id_rsa", () => false)).toBeNull();
  });

  test("predicate receives the raw token", () => {
    const isPromotable = (token: string): boolean => token === "key.pem";
    expect(classifyPromotedRuleCandidate("key.pem", isPromotable)).toBe("key.pem");
    expect(classifyPromotedRuleCandidate("other.pem", isPromotable)).toBeNull();
  });

  describe("shared rejection still applies regardless of the predicate", () => {
    test("flag (leading dash) → null", () => {
      expect(classifyPromotedRuleCandidate("-r", () => true)).toBeNull();
    });

    test("env assignment → null", () => {
      expect(classifyPromotedRuleCandidate("FOO=/bar", () => true)).toBeNull();
    });

    test("URL → null", () => {
      expect(classifyPromotedRuleCandidate("https://example.com", () => true)).toBeNull();
    });

    test("@scope/package → null", () => {
      expect(classifyPromotedRuleCandidate("@foo/bar", () => true)).toBeNull();
    });

    test("regex metacharacters → null", () => {
      expect(classifyPromotedRuleCandidate("foo.*", () => true)).toBeNull();
    });

    test("empty string → null", () => {
      expect(classifyPromotedRuleCandidate("", () => true)).toBeNull();
    });
  });
});

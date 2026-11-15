import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const { opensAtTop }: typeof import("../src/app/hooks/useScrollTopOnNavigate") =
  createRequire(import.meta.url)("../src/app/hooks/useScrollTopOnNavigate");

test("a link to another page opens it at the top", () => {
  expect(opensAtTop({ pathname: "/clubs", hash: "" }, null)).toBe(true);
});

test("back and forward keep the position the browser restores", () => {
  expect(opensAtTop({ pathname: "/events", hash: "" }, "/events")).toBe(false);
});

test("a traversal within an earlier page never holds back a later link", () => {
  expect(opensAtTop({ pathname: "/clubs", hash: "" }, "/data-policy")).toBe(true);
});

test("a link to a section of another page leaves the scroll to that section", () => {
  expect(opensAtTop({ pathname: "/data-policy", hash: "#cookies" }, null)).toBe(false);
});

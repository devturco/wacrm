import { describe, expect, it } from "vitest";
import { isAccountScopedPath } from "./object-path";
import { companyFolder } from "./layout";

const ACCOUNT = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";

describe("isAccountScopedPath", () => {
  it("accepts a path inside the caller's own account folder", () => {
    expect(isAccountScopedPath(`account-${ACCOUNT}/1700-note.pdf`, ACCOUNT)).toBe(
      true,
    );
  });

  it("rejects another account's folder", () => {
    expect(isAccountScopedPath(`account-${OTHER}/1700-note.pdf`, ACCOUNT)).toBe(
      false,
    );
  });

  it("rejects a traversal out of the account folder", () => {
    expect(
      isAccountScopedPath(`account-${ACCOUNT}/../account-${OTHER}/x.pdf`, ACCOUNT),
    ).toBe(false);
  });

  it("rejects a bare relative segment", () => {
    expect(isAccountScopedPath(`account-${ACCOUNT}/./x.pdf`, ACCOUNT)).toBe(false);
  });

  it("rejects an absolute path", () => {
    expect(isAccountScopedPath(`/account-${ACCOUNT}/x.pdf`, ACCOUNT)).toBe(false);
  });

  it("rejects a backslash separator", () => {
    expect(isAccountScopedPath(`account-${ACCOUNT}\\x.pdf`, ACCOUNT)).toBe(false);
  });

  it("rejects an empty path", () => {
    expect(isAccountScopedPath("", ACCOUNT)).toBe(false);
  });

  it("rejects the account folder itself, which is not an object", () => {
    expect(isAccountScopedPath(`account-${ACCOUNT}`, ACCOUNT)).toBe(false);
  });
});

describe("isAccountScopedPath — the R2 company folder", () => {
  // R2 has no RLS: the path IS the boundary, so the folder has to hold.
  const root = companyFolder("Storm Eletrônicos", ACCOUNT);

  it("accepts a path inside the company's own folder", () => {
    expect(
      isAccountScopedPath(`${root}/midias/20261030-143205-412/foto.jpg`, {
        id: ACCOUNT,
        root,
      }),
    ).toBe(true);
  });

  it("rejects another company's folder", () => {
    const other = companyFolder("Outra Empresa", OTHER);
    expect(
      isAccountScopedPath(`${other}/midias/x.jpg`, { id: ACCOUNT, root }),
    ).toBe(false);
  });

  it("rejects a company with the same name but another id", () => {
    // The name alone is not the boundary — the short id in the folder is.
    const other = companyFolder("Storm Eletrônicos", OTHER);
    expect(
      isAccountScopedPath(`${other}/midias/x.jpg`, { id: ACCOUNT, root }),
    ).toBe(false);
  });
});

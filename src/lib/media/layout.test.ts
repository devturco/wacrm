import { describe, expect, it } from "vitest";
import {
  accountRoot,
  companyFolder,
  encodeObjectPath,
  extensionOf,
  folderForFile,
  hashId,
  inboundSegment,
  mediaPath,
  safeFileName,
  slugifyCompany,
  stampFolder,
} from "./layout";

const ACCOUNT = "11111111-2222-3333-4444-555555555555";

describe("extensionOf", () => {
  it("reads the extension, lower-cased", () => {
    expect(extensionOf("foto.JPG")).toBe("jpg");
    expect(extensionOf("arquivo.tar.gz")).toBe("gz");
  });

  it("answers empty when there is none", () => {
    expect(extensionOf("README")).toBe("");
    expect(extensionOf(null)).toBe("");
  });
});

describe("folderForFile", () => {
  it("files pictures, videos and sounds under midias", () => {
    expect(folderForFile("foto.jpg")).toBe("midias");
    expect(folderForFile("video.mp4")).toBe("midias");
    expect(folderForFile("audio.ogg")).toBe("midias");
  });

  it("files everything else under documentos", () => {
    expect(folderForFile("Proposta Comercial.pdf")).toBe("documentos");
    expect(folderForFile("planilha.xlsx")).toBe("documentos");
    expect(folderForFile("backup.zip")).toBe("documentos");
  });

  it("falls back to the MIME type when the name carries no extension", () => {
    expect(folderForFile("sem-extensao", "image/png")).toBe("midias");
    expect(folderForFile("sem-extensao", "application/pdf")).toBe("documentos");
  });

  it("trusts the extension over a useless MIME type", () => {
    // The browser reports `application/octet-stream` for half the files
    // it picks — a `.png` is a picture whatever it said.
    expect(folderForFile("foto.png", "application/octet-stream")).toBe("midias");
  });
});

describe("slugifyCompany", () => {
  it("keeps the name readable", () => {
    expect(slugifyCompany("Storm Eletrônicos")).toBe("storm-eletronicos");
    expect(slugifyCompany("Minha Empresa LTDA")).toBe("minha-empresa-ltda");
  });

  it("falls back to a placeholder when there is no name", () => {
    expect(slugifyCompany(null)).toBe("empresa");
    expect(slugifyCompany("   ")).toBe("empresa");
  });
});

describe("companyFolder", () => {
  it("names the folder after the company, with a short id", () => {
    expect(companyFolder("Storm Eletrônicos", ACCOUNT)).toBe(
      "storm-eletronicos-11111111",
    );
  });

  it("keeps two companies with the same name apart", () => {
    // `accounts.name` has no unique constraint — the default name is the
    // same for half the signups. The id is what tells them apart.
    const other = "99999999-8888-7777-6666-555555555555";
    expect(companyFolder("Minha Empresa", ACCOUNT)).not.toBe(
      companyFolder("Minha Empresa", other),
    );
  });
});

describe("accountRoot", () => {
  it("keeps the Supabase segment the RLS policies match on", () => {
    expect(accountRoot("supabase", ACCOUNT)).toBe(`account-${ACCOUNT}`);
  });

  it("gives R2 the company's folder", () => {
    expect(accountRoot("r2", ACCOUNT, "Storm Eletrônicos")).toBe(
      "storm-eletronicos-11111111",
    );
  });
});

describe("safeFileName", () => {
  it("keeps the spaces and the accents — it is the user's file", () => {
    expect(safeFileName("Proposta Comercial.pdf")).toBe(
      "Proposta Comercial.pdf",
    );
    expect(safeFileName("Relatório Anual.pdf")).toBe("Relatório Anual.pdf");
  });

  it("drops any directory part", () => {
    expect(safeFileName("../../etc/passwd.txt")).toBe("passwd.txt");
  });

  it("adds the extension the MIME type says when the name has none", () => {
    expect(safeFileName("contrato", "application/pdf")).toBe("contrato.pdf");
  });
});

describe("stampFolder", () => {
  it("is sortable and readable", () => {
    expect(stampFolder(new Date(2026, 9, 30, 14, 32, 5, 412))).toBe(
      "20261030-143205-412",
    );
  });

  it("tells two uploads of the same name apart", () => {
    const first = stampFolder(new Date(2026, 9, 30, 14, 32, 5, 1));
    const second = stampFolder(new Date(2026, 9, 30, 14, 32, 5, 2));
    expect(first).not.toBe(second);
  });
});

describe("hashId", () => {
  it("is stable — a redelivery has to land on the same key", () => {
    expect(hashId("1234567890123456")).toBe(hashId("1234567890123456"));
  });

  it("tells two ids apart", () => {
    expect(hashId("a")).not.toBe(hashId("b"));
  });
});

describe("inboundSegment", () => {
  it("carries the day the message arrived", () => {
    expect(inboundSegment("abc", "1754899200")).toBe(
      `20250811-${hashId("abc")}`,
    );
  });

  it("falls back to the hash alone when there is no timestamp", () => {
    expect(inboundSegment("abc")).toBe(hashId("abc"));
  });

  it("never carries a path separator", () => {
    expect(inboundSegment("../../etc")).not.toContain("..");
  });
});

describe("mediaPath", () => {
  it("puts the file in its folder, with the uniqueness above it", () => {
    expect(
      mediaPath({
        root: "storm-eletronicos-11111111",
        folder: "documentos",
        fileName: "Proposta Comercial.pdf",
        segment: "20261030-143205-412",
      }),
    ).toBe(
      "storm-eletronicos-11111111/documentos/20261030-143205-412/Proposta Comercial.pdf",
    );
  });

  it("drops the segment when there is none — a picture wants a stable name", () => {
    expect(
      mediaPath({
        root: "storm-eletronicos-11111111",
        folder: "avatar",
        fileName: "contact-1.jpg",
      }),
    ).toBe("storm-eletronicos-11111111/avatar/contact-1.jpg");
  });

  it("never lets a segment escape its folder", () => {
    const path = mediaPath({
      root: "storm-eletronicos-11111111",
      folder: "midias",
      fileName: "foto.jpg",
      segment: "../../etc",
    });
    expect(path).toBe("storm-eletronicos-11111111/midias/etc/foto.jpg");
  });
});

describe("encodeObjectPath", () => {
  it("encodes each segment on its own", () => {
    expect(
      encodeObjectPath("storm-eletronicos-11111111/documentos/Proposta Comercial.pdf"),
    ).toBe(
      "storm-eletronicos-11111111/documentos/Proposta%20Comercial.pdf",
    );
  });

  it("keeps the separators", () => {
    expect(encodeObjectPath("a/b/c")).toBe("a/b/c");
  });
});

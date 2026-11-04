import { describe, expect, it } from "vitest";
import { downloadHeaders, formatFileSize, isBomFileUrl, MAX_BOM_FILE_SIZE, safeFileName } from "./bomFiles";

describe("safeFileName", () => {
  it("keeps an ordinary name, including Chinese and spaces", () => {
    expect(safeFileName("MB-100 規格書 v2.pdf")).toBe("MB-100 規格書 v2.pdf");
  });

  it("drops any folder part, whichever way the slashes lean", () => {
    expect(safeFileName("C:\\Users\\me\\spec.pdf")).toBe("spec.pdf");
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("a/b/c.xlsx")).toBe("c.xlsx");
  });

  it("replaces control characters and symbols the disk does not allow", () => {
    expect(safeFileName('a<b>c:"d"|e?f*.txt')).toBe("a_b_c__d__e_f_.txt");
    expect(safeFileName("tab\there.pdf")).toBe("tab_here.pdf");
  });

  it("strips leading and trailing dots and spaces; an empty result becomes 'file'", () => {
    expect(safeFileName("..hidden.pdf")).toBe("hidden.pdf");
    expect(safeFileName("name.pdf.")).toBe("name.pdf");
    for (const empty of ["", "   ", "...", "/", "\\"]) expect(safeFileName(empty)).toBe("file");
  });

  it("cuts a very long name but keeps the extension", () => {
    const out = safeFileName("長".repeat(300) + ".pdf");
    expect(out.length).toBe(120);
    expect(out.endsWith(".pdf")).toBe(true);
    expect(safeFileName("x".repeat(300)).length).toBe(120);
  });
});

describe("downloadHeaders", () => {
  it("opens PDFs, images and plain text in the browser", () => {
    expect(downloadHeaders("spec.pdf")).toEqual({ contentType: "application/pdf", disposition: "inline; filename*=UTF-8''spec.pdf" });
    expect(downloadHeaders("photo.JPG").contentType).toBe("image/jpeg");
    expect(downloadHeaders("note.txt").contentType).toBe("text/plain; charset=utf-8");
  });

  it("everything else — including SVG and HTML, which can carry scripts — downloads as a file", () => {
    for (const name of ["a.svg", "a.html", "a.htm", "a.xlsx", "a.zip", "a.exe", "noextension", "a.pdf.html"]) {
      const h = downloadHeaders(name);
      expect(h.contentType).toBe("application/octet-stream");
      expect(h.disposition.startsWith("attachment;")).toBe(true);
    }
  });

  it("encodes the file name for the header", () => {
    expect(downloadHeaders("規格 書.pdf").disposition).toBe("inline; filename*=UTF-8''%E8%A6%8F%E6%A0%BC%20%E6%9B%B8.pdf");
  });
});

describe("formatFileSize / limits", () => {
  it("reads like a person would", () => {
    expect(formatFileSize(850)).toBe("850 B");
    expect(formatFileSize(12_600)).toBe("12.3 KB");
    expect(formatFileSize(4.5 * 1024 * 1024)).toBe("4.5 MB");
  });
  it("the size limit is 50 MB", () => {
    expect(MAX_BOM_FILE_SIZE).toBe(50 * 1024 * 1024);
  });
});

describe("isBomFileUrl", () => {
  it("only accepts the paths this feature writes", () => {
    expect(isBomFileUrl("/uploads/bom/cmabc123/1730000000000-ab12cd34-spec.pdf")).toBe(true);
    for (const bad of ["/uploads/cmabc123/spec.pdf", "/uploads/bom/../x/spec.pdf", "/uploads/bom/a/b/c.pdf", "/etc/passwd", "uploads/bom/a/b.pdf", "/uploads/bom//b.pdf", "/uploads/bom/a/..\\b"]) {
      expect(isBomFileUrl(bad)).toBe(false);
    }
  });
});

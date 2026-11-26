// The pictures in the repository carry no metadata: no text chunk, EXIF or XMP in any PNG or WebP under app/ or
// design/photographs/ (#77). Such chunks can name the account or the tool that made a picture, and the repository is
// public. The test reads chunk types alone and never prints what a chunk holds.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pictures = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? pictures(join(dir, entry.name)) : /\.(png|webp)$/i.test(entry.name) ? [join(dir, entry.name)] : [],
  );

// A PNG's chunk types after its 8-byte signature; a WebP's after its 12-byte RIFF header, each padded to an even length.
function chunkTypes(file: string): string[] {
  const bytes = readFileSync(file);
  const types: string[] = [];
  if (/\.png$/i.test(file))
    for (let at = 8; at < bytes.length; at += 12 + bytes.readUInt32BE(at)) types.push(bytes.toString("latin1", at + 4, at + 8));
  else
    for (let at = 12; at + 8 <= bytes.length; ) {
      const length = bytes.readUInt32LE(at + 4);
      types.push(bytes.toString("latin1", at, at + 4));
      at += 8 + length + (length % 2);
    }
  return types;
}

const METADATA = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "EXIF", "XMP "]);

describe("the pictures in the repository", () => {
  const files = [...pictures("app"), ...pictures("design/photographs")];

  it("are found, PNG and WebP alike", () => {
    expect(files.some((file) => file.endsWith(".png"))).toBe(true);
    expect(files.some((file) => file.endsWith(".webp"))).toBe(true);
  });

  it("carry no text chunk, EXIF or XMP", () => {
    const carrying = files.filter((file) => chunkTypes(file).some((type) => METADATA.has(type)));
    expect(carrying).toEqual([]);
  });
});

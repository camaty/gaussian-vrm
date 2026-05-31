/**
 * UT-12 — gvrm-format/ply.js 直接インポートテスト
 *
 * PLYParser を直接インポートし、
 *  - createPLYFile : DOM / fetch 不要の純粋関数
 *  - parsePLY      : global.fetch / global.document をモック化して検証
 *
 * `three` エイリアスは不要 (ply.js は three に依存しない)。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PLYParser } from "@gvrm/ply.js";

// ---------------------------------------------------------------------------
// ヘルパー: 最小 binary PLY ArrayBuffer を生成
//   vertexRows: [[x,y,z], ...] — float32 プロパティ x/y/z
// ---------------------------------------------------------------------------

function makePlyBuffer(vertexRows) {
  const count = vertexRows.length;
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    `element vertex ${count}`,
    "property float x",
    "property float y",
    "property float z",
    "end_header",
    "", // trailing newline after "end_header\n"
  ].join("\n");

  const enc = new TextEncoder();
  const headerBytes = enc.encode(header);

  // 各頂点は float32 × 3 = 12 bytes
  const floatCount = count * 3;
  const floatBytes = new Uint8Array(
    new Float32Array(vertexRows.flat()).buffer,
  );

  const result = new Uint8Array(headerBytes.length + floatBytes.length);
  result.set(headerBytes, 0);
  result.set(floatBytes, headerBytes.length);
  return result.buffer;
}

// ---------------------------------------------------------------------------
// ヘルパー: ArrayBuffer から逐次返す fetch モック用 ReadableStream リーダー
// ---------------------------------------------------------------------------

function makeBodyReader(buffer) {
  let sent = false;
  return {
    read: async () => {
      if (sent) return { done: true, value: undefined };
      sent = true;
      return { done: false, value: new Uint8Array(buffer) };
    },
  };
}

function makeFetchMock(buffer) {
  return vi.fn().mockImplementation(async () => ({
    headers: { get: () => String(buffer.byteLength) },
    body: { getReader: () => makeBodyReader(buffer) },
  }));
}

// ---------------------------------------------------------------------------
// 共通セットアップ
//   parsePLY は fetch を 2 回呼ぶ (progress 取得 + body 取得)。
//   document.getElementById は null を返して requestAnimationFrame を回避。
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal("document", { getElementById: () => null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// createPLYFile  — DOM / fetch 不要の純粋関数
// ---------------------------------------------------------------------------

describe("PLYParser.createPLYFile", () => {
  it("returns a Uint8Array containing the PLY header", () => {
    const parser = new PLYParser();
    const header = [
      "ply",
      "format binary_little_endian 1.0",
      "element vertex 1",
      "property float x",
      "end_header",
    ];
    const rawData = new Uint8Array(new Float32Array([1.5]).buffer);
    const result = parser.createPLYFile(header, [{ rawData, x: 1.5 }], 4);

    expect(result).toBeInstanceOf(Uint8Array);
    const text = new TextDecoder().decode(result);
    expect(text).toContain("ply");
    expect(text).toContain("element vertex 1");
    expect(text).toContain("end_header");
  });

  it("round-trip: float value survives header → binary packing", () => {
    const parser = new PLYParser();
    const header = [
      "ply",
      "format binary_little_endian 1.0",
      "element vertex 1",
      "property float x",
      "end_header",
    ];
    const rawData = new Uint8Array(new Float32Array([3.14]).buffer);
    const result = parser.createPLYFile(header, [{ rawData, x: 3.14 }], 4);

    const text = new TextDecoder().decode(result);
    // ヘッダ末尾オフセットから float32 を読んで値を検証
    const headerEnd =
      text.indexOf("end_header\n") + "end_header\n".length;
    const view = new DataView(result.buffer);
    expect(view.getFloat32(headerEnd, /* littleEndian */ true)).toBeCloseTo(
      3.14,
      2,
    );
  });

  it("total byte length = header bytes + vertex count × vertexSize", () => {
    const parser = new PLYParser();
    const header = [
      "ply",
      "format binary_little_endian 1.0",
      "element vertex 2",
      "property float x",
      "end_header",
    ];
    const enc = new TextEncoder();
    const expectedHeaderLen = enc.encode(header.join("\n") + "\n").length;
    const vertexSize = 4; // 1 float

    const raw = (v) => new Uint8Array(new Float32Array([v]).buffer);
    const vertices = [
      { rawData: raw(1.0), x: 1.0 },
      { rawData: raw(2.0), x: 2.0 },
    ];

    const result = parser.createPLYFile(header, vertices, vertexSize);
    expect(result.byteLength).toBe(expectedHeaderLen + 2 * vertexSize);
  });

  it("empty vertex array produces header-only output", () => {
    const parser = new PLYParser();
    const header = [
      "ply",
      "format binary_little_endian 1.0",
      "element vertex 0",
      "end_header",
    ];
    const result = parser.createPLYFile(header, [], 0);
    const text = new TextDecoder().decode(result);
    expect(text).toContain("element vertex 0");
  });
});

// ---------------------------------------------------------------------------
// parsePLY  — fetch + document をモック化して検証
// ---------------------------------------------------------------------------

describe("PLYParser.parsePLY", () => {
  it("parses a minimal 2-vertex PLY — vertexCount and coordinates", async () => {
    const buffer = makePlyBuffer([
      [1.0, 2.0, 3.0],
      [4.0, 5.0, 6.0],
    ]);
    vi.stubGlobal("fetch", makeFetchMock(buffer));

    const parser = new PLYParser();
    const result = await parser.parsePLY("test.ply", false);

    expect(result.vertexCount).toBe(2);
    expect(result.vertices).toHaveLength(2);
    expect(result.vertices[0].x).toBeCloseTo(1.0);
    expect(result.vertices[0].y).toBeCloseTo(2.0);
    expect(result.vertices[0].z).toBeCloseTo(3.0);
    expect(result.vertices[1].x).toBeCloseTo(4.0);
    expect(result.vertices[1].y).toBeCloseTo(5.0);
    expect(result.vertices[1].z).toBeCloseTo(6.0);
  });

  it("vertexSize = 12 for three float32 properties", async () => {
    const buffer = makePlyBuffer([[0, 0, 0]]);
    vi.stubGlobal("fetch", makeFetchMock(buffer));

    const parser = new PLYParser();
    const result = await parser.parsePLY("test.ply", false);

    expect(result.vertexSize).toBe(12); // 3 × float32 (4 bytes each)
  });

  it("each vertex carries rawData as a Uint8Array of vertexSize bytes", async () => {
    const buffer = makePlyBuffer([[1.0, 2.0, 3.0]]);
    vi.stubGlobal("fetch", makeFetchMock(buffer));

    const parser = new PLYParser();
    const result = await parser.parsePLY("test.ply", false);

    expect(result.vertices[0].rawData).toBeInstanceOf(Uint8Array);
    expect(result.vertices[0].rawData).toHaveLength(12);
  });

  it("header array contains expected PLY header lines", async () => {
    const buffer = makePlyBuffer([[0, 0, 0]]);
    vi.stubGlobal("fetch", makeFetchMock(buffer));

    const parser = new PLYParser();
    const result = await parser.parsePLY("test.ply", false);

    expect(result.header).toContain("element vertex 1");
    expect(result.header).toContain("property float x");
    expect(result.header).toContain("property float y");
    expect(result.header).toContain("property float z");
  });

  it("0-vertex PLY returns empty vertices array", async () => {
    const buffer = makePlyBuffer([]);
    vi.stubGlobal("fetch", makeFetchMock(buffer));

    const parser = new PLYParser();
    const result = await parser.parsePLY("test.ply", false);

    expect(result.vertexCount).toBe(0);
    expect(result.vertices).toHaveLength(0);
  });
});

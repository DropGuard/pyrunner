import { describe, expect, test } from "bun:test";
import AutoLaunch from "auto-launch";
import { getExecutablePath } from "../src/utils/process";

describe("CLI Installation Logic", () => {
  test("getExecutablePath returns structured path info", () => {
    const info = getExecutablePath("C:\\path\\to\\pyrunner.exe", "C:\\bun.exe");
    expect(info.main).toContain("pyrunner.exe");
    expect(info.exe).toContain("bun.exe");
  });

  test("AutoLaunch can be initialized without throwing", () => {
    // This verifies providing a path prevents the constructor from throwing
    const { exe } = getExecutablePath();
    expect(() => {
      new AutoLaunch({
        name: "PyRunner-Test",
        path: exe,
      });
    }).not.toThrow();
  });
});

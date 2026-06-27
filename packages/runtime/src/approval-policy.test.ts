import { describe, expect, it } from "vitest";
import { assessToolRiskLevel, evaluateApprovalPolicy } from "./approval-policy.js";

describe("assessToolRiskLevel", () => {
  it("classifies read-like tool names as read_only", () => {
    expect(assessToolRiskLevel("getSelection")).toBe("read_only");
    expect(assessToolRiskLevel("listFiles")).toBe("read_only");
    expect(assessToolRiskLevel("readConfig")).toBe("read_only");
    expect(assessToolRiskLevel("queryStatus")).toBe("read_only");
    expect(assessToolRiskLevel("searchResults")).toBe("read_only");
  });

  it("classifies write-like tool names as medium_write", () => {
    expect(assessToolRiskLevel("createFile")).toBe("medium_write");
    expect(assessToolRiskLevel("updateRecord")).toBe("medium_write");
    expect(assessToolRiskLevel("saveData")).toBe("medium_write");
  });

  it("classifies high-write keywords as high_write", () => {
    expect(assessToolRiskLevel("deployService")).toBe("high_write");
    expect(assessToolRiskLevel("publishArtifact")).toBe("high_write");
    expect(assessToolRiskLevel("executeCommand")).toBe("high_write");
  });

  it("classifies destructive keywords as destructive", () => {
    expect(assessToolRiskLevel("deleteFile")).toBe("destructive");
    expect(assessToolRiskLevel("removeItem")).toBe("destructive");
    expect(assessToolRiskLevel("purgeData")).toBe("destructive");
  });

  it("defaults unknown tools to low_risk", () => {
    expect(assessToolRiskLevel("randomTool")).toBe("low_risk");
  });

  it("uses keywords parameter over name-based heuristics for destructive", () => {
    expect(assessToolRiskLevel("myTool", ["delete"])).toBe("destructive");
    expect(assessToolRiskLevel("myTool", ["destroy"])).toBe("destructive");
  });

  it("uses keywords parameter for high_write classification", () => {
    expect(assessToolRiskLevel("myTool", ["deploy"])).toBe("high_write");
    expect(assessToolRiskLevel("myTool", ["publish"])).toBe("high_write");
  });

  it("uses keywords parameter for medium_write classification", () => {
    expect(assessToolRiskLevel("myTool", ["create"])).toBe("medium_write");
    expect(assessToolRiskLevel("myTool", ["update"])).toBe("medium_write");
  });

  it("gives priority to destructive over high_write in keywords", () => {
    expect(assessToolRiskLevel("myTool", ["deploy", "delete"])).toBe("destructive");
  });

  it("gives priority to high_write over write in keywords", () => {
    expect(assessToolRiskLevel("myTool", ["create", "deploy"])).toBe("high_write");
  });
});

describe("evaluateApprovalPolicy", () => {
  describe("permissionMode: request_approval (default)", () => {
    it("auto-allows read_only risk level", () => {
      expect(evaluateApprovalPolicy("read_only", "request_approval")).toBe("allow");
    });

    it("auto-allows low_risk level", () => {
      expect(evaluateApprovalPolicy("low_risk", "request_approval")).toBe("allow");
    });

    it("requires approval for medium_write", () => {
      expect(evaluateApprovalPolicy("medium_write", "request_approval")).toBe("require_approval");
    });

    it("requires approval for high_write", () => {
      expect(evaluateApprovalPolicy("high_write", "request_approval")).toBe("require_approval");
    });

    it("blocks destructive by default", () => {
      expect(evaluateApprovalPolicy("destructive", "request_approval")).toBe("block");
    });

    it("blocks blocked and unknown levels", () => {
      expect(evaluateApprovalPolicy("blocked", "request_approval")).toBe("block");
      expect(evaluateApprovalPolicy("unknown", "request_approval")).toBe("block");
    });
  });

  describe("permissionMode: auto", () => {
    it("auto-allows read_only and low_risk", () => {
      expect(evaluateApprovalPolicy("read_only", "auto")).toBe("allow");
      expect(evaluateApprovalPolicy("low_risk", "auto")).toBe("allow");
    });

    it("requires approval for medium_write and high_write in auto mode", () => {
      expect(evaluateApprovalPolicy("medium_write", "auto")).toBe("require_approval");
      expect(evaluateApprovalPolicy("high_write", "auto")).toBe("require_approval");
    });

    it("blocks destructive, blocked, and unknown in auto mode", () => {
      expect(evaluateApprovalPolicy("destructive", "auto")).toBe("block");
      expect(evaluateApprovalPolicy("blocked", "auto")).toBe("block");
      expect(evaluateApprovalPolicy("unknown", "auto")).toBe("block");
    });
  });

  describe("permissionMode: plan_only", () => {
    it("blocks all risk levels", () => {
      expect(evaluateApprovalPolicy("read_only", "plan_only")).toBe("block");
      expect(evaluateApprovalPolicy("low_risk", "plan_only")).toBe("block");
      expect(evaluateApprovalPolicy("medium_write", "plan_only")).toBe("block");
      expect(evaluateApprovalPolicy("high_write", "plan_only")).toBe("block");
      expect(evaluateApprovalPolicy("destructive", "plan_only")).toBe("block");
      expect(evaluateApprovalPolicy("blocked", "plan_only")).toBe("block");
      expect(evaluateApprovalPolicy("unknown", "plan_only")).toBe("block");
    });
  });

  describe("policyOverrides", () => {
    it("overrides individual risk level decisions", () => {
      const overrides = { destructive: "require_approval" as const };
      expect(evaluateApprovalPolicy("destructive", "request_approval", overrides)).toBe("require_approval");
    });

    it("does not affect non-overridden levels", () => {
      const overrides = { destructive: "require_approval" as const };
      expect(evaluateApprovalPolicy("medium_write", "request_approval", overrides)).toBe("require_approval");
      expect(evaluateApprovalPolicy("read_only", "request_approval", overrides)).toBe("allow");
    });

    it("overrides are ignored in auto mode (destructive still blocked)", () => {
      const overrides = { destructive: "allow" as const };
      expect(evaluateApprovalPolicy("destructive", "auto", overrides)).toBe("block");
    });

    it("overrides are ignored in plan_only mode", () => {
      const overrides = { read_only: "allow" as const };
      expect(evaluateApprovalPolicy("read_only", "plan_only", overrides)).toBe("block");
    });
  });
});

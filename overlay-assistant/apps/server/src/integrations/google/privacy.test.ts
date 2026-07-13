import { describe, expect, it } from "vitest";
import { classifySensitivity, sanitizeGoogleSourceText } from "./privacy.js";

describe("Google source privacy boundary", () => {
  it("removes credentials and exact financial/government identifiers before caching", () => {
    const result = sanitizeGoogleSourceText([
      "Useful fact: managed a customer support queue.",
      "API key: sk-example-super-secret-token-value",
      "SSN 123-45-6789",
      "Account number: 998877665544",
      "Payment card 4111 1111 1111 1111",
      "Email jordan.person@example.com",
      "Phone (212) 555-0199",
      "Home 123 Main Street",
      "Verification code: 482991",
      "https://example.test/callback?token=secret-value&safe=yes"
    ].join("\n"));

    expect(result.text).toContain("managed a customer support queue");
    expect(result.text).not.toContain("sk-example");
    expect(result.text).not.toContain("123-45-6789");
    expect(result.text).not.toContain("998877665544");
    expect(result.text).not.toContain("4111 1111 1111 1111");
    expect(result.text).not.toContain("jordan.person@example.com");
    expect(result.text).not.toContain("212) 555-0199");
    expect(result.text).not.toContain("123 Main Street");
    expect(result.text).not.toContain("482991");
    expect(result.text).not.toContain("secret-value");
    expect(result.exclusions).toContain("credential_line");
    expect(result.exclusions).toContain("government_id");
    expect(result.exclusions).toContain("payment_card");
    expect(result.exclusions).toContain("email_address");
    expect(result.exclusions).toContain("phone_number");
    expect(result.exclusions).toContain("street_address");
  });

  it("classifies intimate facts as restricted so live retrieval can suppress them", () => {
    expect(classifySensitivity("A private recovery and sobriety history")).toBe("restricted");
    expect(classifySensitivity("Current salary expectations")).toBe("sensitive");
    expect(classifySensitivity("Built a customer-facing website")).toBe("normal");
  });
});

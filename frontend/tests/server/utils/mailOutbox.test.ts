import { describe, expect, it } from "vitest";
import { mailSettings } from "../../../server/utils/mailOutbox";

describe("mailSettings", () => {
  it("is a dry run unless told otherwise and given a server", () => {
    expect(mailSettings({}).dryRun).toBe(true);
    expect(mailSettings({ SMTP_HOST: "smtp.example.com" }).dryRun).toBe(true);
    expect(mailSettings({ MAIL_DRY_RUN: "false" }).dryRun).toBe(true);
    expect(
      mailSettings({ MAIL_DRY_RUN: "false", SMTP_HOST: "smtp.example.com" })
        .dryRun,
    ).toBe(false);
  });

  it("reads the server, TLS by its port unless set", () => {
    const settings = mailSettings({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_USER: "u",
      SMTP_PASSWORD: "p",
      MAIL_FROM: "koryta.pl <x@koryta.pl>",
      MAIL_SEND_SINCE: "2026-12-01T00:00:00.000Z",
    });
    expect(settings.smtp).toEqual({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "u",
      password: "p",
    });
    expect(settings.from).toBe("koryta.pl <x@koryta.pl>");
    expect(settings.since).toBe("2026-12-01T00:00:00.000Z");
    expect(
      mailSettings({ SMTP_HOST: "h", SMTP_SECURE: "false", SMTP_PORT: "465" })
        .smtp?.secure,
    ).toBe(false);
  });

  it("sends nothing queued before the worker started, by default", () => {
    const before = new Date().toISOString();
    expect(mailSettings({}).since >= before).toBe(true);
  });
});

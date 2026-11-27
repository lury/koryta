-- The `mail` table is the outbox the SMTP worker (server/utils/mailOutbox.ts)
-- sends from, in place of the Trigger Email extension: a message without a
-- `delivery`, or one to try again, is waiting.
ALTER TABLE mail
  ADD COLUMN delivery_state text GENERATED ALWAYS AS
    (coalesce(jsonb_text(data #> '{delivery,state}'), 'queued')) STORED;
CREATE INDEX mail_waiting ON mail (created_at, id)
  WHERE delivery_state IN ('queued', 'PENDING', 'RETRY', 'PROCESSING');
-- A campaign's deliveries (`campaignDeliveries`), and the rest of the
-- equality filters of the mail code.
CREATE INDEX mail_data ON mail USING gin (data jsonb_path_ops);
CREATE INDEX mail_tokens_data ON mail_tokens USING gin (data jsonb_path_ops);
CREATE INDEX newsletter_subscribers_data ON newsletter_subscribers USING gin (data jsonb_path_ops);
CREATE INDEX mail_campaigns_data ON mail_campaigns USING gin (data jsonb_path_ops);

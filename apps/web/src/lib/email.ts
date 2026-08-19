import "server-only";

/**
 * Transactional email through Resend's HTTP API. Without RESEND_API_KEY the
 * community edition simply records nothing was sent — no feature depends on
 * email delivery to function.
 */
export async function sendEmail(input: { to: string; subject: string; text: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Northstar <onboarding@resend.dev>";
  if (!apiKey) return { sent: false as const, reason: "RESEND_API_KEY is not configured" };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text }),
  });
  if (!response.ok) return { sent: false as const, reason: `Resend returned ${response.status}` };
  return { sent: true as const };
}

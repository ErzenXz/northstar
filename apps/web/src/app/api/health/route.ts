export async function GET() {
  return Response.json({ status: "ok", service: "origin-web", edition: process.env.ORIGIN_EDITION ?? "community" });
}

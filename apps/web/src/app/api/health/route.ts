export async function GET() {
  return Response.json({ status: "ok", service: "northstar-web", edition: process.env.NORTHSTAR_EDITION ?? "community" });
}

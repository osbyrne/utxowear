import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { handleContact } from "../lib/contact";

const handlePost = ({ request }: { request: Request }) => handleContact(request, env);

export const Route = createFileRoute("/api/contact")({
  server: { handlers: { POST: handlePost } },
});

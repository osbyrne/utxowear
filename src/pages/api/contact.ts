import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { handleContact } from "../../lib/contact";

export const prerender = false;
export const POST: APIRoute = ({ request }) => handleContact(request, env);

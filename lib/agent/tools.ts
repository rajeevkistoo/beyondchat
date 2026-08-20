/**
 * The agent's tools.
 *
 * Everything the agent can do to the outside world lives here, and nothing
 * else does. The loop in run.ts only routes; it never touches Instagram, the
 * database or a link on its own. That split is deliberate: the blast radius of
 * a model that goes off-script is exactly the list below.
 *
 * Tool results are fed back to the model as JSON, so each impl returns a plain
 * object describing what happened — including failures, which are reported as
 * `{ ok: false, error }` rather than thrown. A thrown error would abort the
 * turn and leave the visitor with silence; a returned one lets the agent say
 * something human instead.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/client";
import { buildTrackedUrl } from "@/lib/tracking/message";

export interface ToolContext {
  conversationId: string;
  automationId: string;
  workspaceId: string;
  /** The visitor's IGSID. */
  contactId: string;
  /** Tracked links belonging to this campaign, in creation order. */
  links: { slug: string; label: string | null; destinationUrl: string }[];
  bookingUrl: string | null;
  /**
   * Queue of messages to deliver to the visitor. Tools append here rather than
   * calling Instagram directly, so the loop can send everything in order, once,
   * after the model has finished deciding.
   */
  outbox: string[];
}

/**
 * Build the tool list for one conversation. Tools whose prerequisites are
 * missing are omitted entirely rather than offered and then failed — a model
 * that can see `book_call` will eventually try it, and "I'll send you a link"
 * followed by no link is worse than never offering.
 */
export function buildToolDefs(ctx: ToolContext): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [];

  if (ctx.links.length > 0) {
    tools.push({
      name: "send_link",
      description:
        "Send the visitor the campaign's link. Use this once they have shown genuine interest or asked for it. Do not send it in your first message unless they explicitly ask for it.",
      input_schema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: `Which link to send. Available: ${ctx.links
              .map((l) => `${l.slug} (${l.label ?? "primary"})`)
              .join(", ")}. Omit to send the primary one.`,
          },
          message: {
            type: "string",
            description:
              "The short line of text that goes with the link, in your own voice. The URL is appended automatically — do not write it yourself.",
          },
        },
        required: ["message"],
      },
    });
  }

  tools.push({
    name: "tag_contact",
    description:
      "Label this conversation for the human who reviews it later. Use it as soon as you learn something that changes how this person should be handled. Silent — the visitor never sees it.",
    input_schema: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Short lowercase labels, e.g. 'agency-owner', 'budget-unclear', 'wrong-fit', 'ready-to-buy'.",
        },
      },
      required: ["tags"],
    },
  });

  if (ctx.bookingUrl) {
    tools.push({
      name: "book_call",
      description:
        "Send the booking link. Only for people who have asked to speak to a human or are clearly ready. Sending it early reads as pushy and costs the conversation.",
      input_schema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description:
              "The line of text that goes with the booking link. The URL is appended automatically.",
          },
        },
        required: ["message"],
      },
    });
  }

  tools.push({
    name: "handoff_to_me",
    description:
      "Stop replying and hand this conversation to the account owner. Use it when the person asks for a human, is upset, asks something you genuinely cannot answer, or the conversation needs a decision that is not yours to make. Preferred over guessing.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "One line: why this needs a human.",
        },
        final_message: {
          type: "string",
          description:
            "What to say to the visitor before going quiet, e.g. that a person will pick this up shortly. Optional — omit to say nothing.",
        },
      },
      required: ["reason"],
    },
  });

  return tools;
}

export interface ToolOutcome {
  result: unknown;
  /** Set by handoff_to_me — tells the loop to stop after this turn. */
  handoff?: { reason: string };
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome> {
  switch (name) {
    case "send_link": {
      const slug =
        typeof input.slug === "string"
          ? ctx.links.find((l) => l.slug === input.slug)?.slug
          : undefined;
      const link = slug
        ? ctx.links.find((l) => l.slug === slug)!
        : ctx.links[0];
      if (!link) return { result: { ok: false, error: "No link configured" } };

      const text = String(input.message ?? "").trim();
      const url = buildTrackedUrl(link.slug);
      ctx.outbox.push(text ? `${text}\n\n${url}` : url);
      return { result: { ok: true, sent: url } };
    }

    case "tag_contact": {
      const raw = Array.isArray(input.tags) ? input.tags : [];
      const tags = raw
        .map((t) => String(t).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10);
      if (tags.length === 0)
        return { result: { ok: false, error: "No tags given" } };

      // Merge rather than replace: tags accumulate across the conversation, and
      // a later call with one tag must not wipe what earlier turns learned.
      const existing = await prisma.agentConversation.findUnique({
        where: { id: ctx.conversationId },
        select: { tags: true },
      });
      const merged = Array.from(
        new Set([...(existing?.tags ?? []), ...tags])
      ).slice(0, 25);
      await prisma.agentConversation.update({
        where: { id: ctx.conversationId },
        data: { tags: merged },
      });
      return { result: { ok: true, tags: merged } };
    }

    case "book_call": {
      if (!ctx.bookingUrl)
        return { result: { ok: false, error: "No booking link configured" } };
      const text = String(input.message ?? "").trim();
      ctx.outbox.push(
        text ? `${text}\n\n${ctx.bookingUrl}` : ctx.bookingUrl
      );
      return { result: { ok: true, sent: ctx.bookingUrl } };
    }

    case "handoff_to_me": {
      const reason = String(input.reason ?? "").trim() || "No reason given";
      const finalMessage = String(input.final_message ?? "").trim();
      if (finalMessage) ctx.outbox.push(finalMessage);

      await prisma.agentConversation.update({
        where: { id: ctx.conversationId },
        data: {
          status: "HANDED_OFF",
          handedOffAt: new Date(),
          handoffReason: reason,
        },
      });
      await prisma.operationalEvent
        .create({
          data: {
            workspaceId: ctx.workspaceId,
            source: "WORKER",
            level: "WARNING",
            message: `Agent handed off a conversation: ${reason}`,
            payload: {
              conversationId: ctx.conversationId,
              contactId: ctx.contactId,
              automationId: ctx.automationId,
            },
          },
        })
        .catch(() => {});

      return { result: { ok: true, handed_off: true }, handoff: { reason } };
    }

    default:
      return { result: { ok: false, error: `Unknown tool: ${name}` } };
  }
}

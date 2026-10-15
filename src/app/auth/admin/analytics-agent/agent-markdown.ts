import { Marked } from 'marked';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Markdown for the analytics agent's answers. Its own Marked instance, so the blog editor's
 * preview keeps its own behaviour.
 *
 * Two things are switched off on purpose. Answers quote data customers and staff typed (names,
 * service labels), so the model's text is not trusted HTML:
 *  - RAW HTML is dropped, not rendered;
 *  - IMAGES render as their alt text only: an image URL is fetched by the browser the moment it
 *    is shown, which would let a crafted answer send data to any server without a click.
 * Angular's [innerHTML] sanitiser still runs on the result as well.
 */
const agentMarked = new Marked({ gfm: true, breaks: true });
agentMarked.use({
  renderer: {
    html: () => '',
    image: ({ text }) => escapeHtml(text ?? '')
  }
});

export function renderAgentMarkdown(markdown: string | null | undefined): string {
  return agentMarked.parse(markdown ?? '', { async: false }) as string;
}

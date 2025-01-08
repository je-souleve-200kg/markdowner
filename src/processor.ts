import puppeteer, { type Browser } from '@cloudflare/puppeteer';

export async function urlToMarkdown(browser: Browser, url: string): Promise<string> {
	const page = await browser.newPage();

	try {
		await page.goto(url);

		const markdown = (await page.evaluate(() => {
			// Add Turndown script
			const turndownScript = document.createElement('script');
			turndownScript.src = 'https://unpkg.com/turndown/dist/turndown.js';
			document.head.appendChild(turndownScript);

			// Wait for script to load and convert content
			return new Promise((resolve) => {
				turndownScript.onload = () => {
					// Remove scripts and styles for cleaner output
					const cleanDoc = document.cloneNode(true) as Document;

					// Remove unwanted elements
					const elementsToRemove = ['script', 'style', 'iframe', 'noscript'];
					for (const selector of elementsToRemove) {
						for (const el of Array.from(cleanDoc.querySelectorAll(selector))) {
							el.remove();
						}
					}

					// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					const turndownService = new (window as any).TurndownService();
					const markdown = turndownService.turndown(cleanDoc);

					resolve(markdown);
				};
			});
		})) as unknown as string;

		return markdown;
	} finally {
		await page.close();
	}
}

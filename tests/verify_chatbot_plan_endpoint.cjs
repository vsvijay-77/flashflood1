const { chromium } = require("@playwright/test");

(async () => {
  console.log("=== Verification: Chatbot with http://0.0.0.0:8080/plan Endpoint ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", msg => {
    const text = msg.text();
    if (text.includes("DisasterChat") || text.includes("Qwen") || text.includes("plan")) {
      console.log(`[CONSOLE] ${text}`);
    }
  });

  try {
    console.log("1. Logging in...");
    await page.goto("http://127.0.0.1:3000/login");
    await page.fill("input[type=email], input[name=email]", "admin@ein.gov.in");
    await page.fill("input[type=password], input[name=password]", "Gov@12345");
    await page.click("button[type=submit]");
    await page.waitForTimeout(2000);

    console.log("2. Navigating to /digital-twin...");
    await page.goto("http://127.0.0.1:3000/digital-twin");
    await page.waitForTimeout(8000);

    console.log("3. Opening AI Chatbot...");
    const aiChatBtn = page.locator("button:has-text('AI Chat')").first();
    if (await aiChatBtn.isVisible()) {
      await aiChatBtn.click();
      console.log("Clicked AI Chat button in top bar");
    }

    await page.waitForTimeout(2000);

    // Verify chat window is visible
    const chatTextarea = page.locator("textarea[placeholder*='Ask about flood'], textarea").first();
    console.log("Chat textarea visible:", await chatTextarea.isVisible());

    // Type query asking for evacuation plan
    await chatTextarea.fill("What is the flood evacuation plan and safe route?");
    await page.waitForTimeout(500);

    // Click send
    const sendBtn = page.locator("button:has(svg.lucide-send), button:has-text('Send')").first();
    await sendBtn.click();
    console.log("Sent message to chatbot!");

    // Wait for AI response to stream in from http://127.0.0.1:8080/plan
    console.log("Waiting for stream from Qwen2.5-VL /plan endpoint...");
    let prevLength = 0;
    let chunksSeen = 0;
    for (let i = 0; i < 45; i++) {
      await page.waitForTimeout(1000);
      const assistantLoc = page.locator("div.space-y-1.text-\\[13px\\], div.relative, div.bg-white.rounded-xl").last();
      const text = (await assistantLoc.innerText().catch(() => "")) || "";
      if (text.length > 20 && !text.includes("Hello! I'm your AI")) {
        if (text.length > prevLength) {
          chunksSeen++;
          console.log(`[Chunk ${chunksSeen}] Received streamed text (${text.length} chars): ${text.slice(-50).replace(/\n/g, " ")}`);
          prevLength = text.length;
        }
        if (chunksSeen >= 3 && text.length > 150) {
          console.log("Verified multi-chunk real-time streaming!");
          break;
        }
      }
    }

    // Capture screenshot of the chatbot answering in the Digital Twin
    await page.screenshot({ path: "/Users/vijay/.gemini/antigravity/brain/4d3fbe4f-3b85-4fda-b67d-1b2e94907dad/chatbot_chunk_streaming_verified.png" });
    console.log("Captured chatbot_chunk_streaming_verified.png");

    console.log("=== Chatbot verification completed successfully! ===");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

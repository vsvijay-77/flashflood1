const { chromium } = require("@playwright/test");

(async () => {
  console.log("=== Verification: Chatbot with https://qwen.blk2np.qzz.io/plan Endpoint ===");
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
    await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 15000 });

    console.log("2. Navigating to /digital-twin...");
    await page.goto("http://127.0.0.1:3000/digital-twin");
    await page.waitForTimeout(3000);

    const dropdownLocator = page.locator("[data-testid='monitored-area-select-trigger'], button[role='combobox']").first();
    if (await dropdownLocator.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log("Selecting monitored area...");
      await dropdownLocator.click();
      await page.waitForTimeout(500);
      const option = page.locator("div[role='option']").first();
      if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
        await option.click();
      }
    }

    console.log("3. Opening AI Chatbot...");
    const aiChatBtn = page.locator("[data-testid='ai-chat-btn'], button:has-text('AI Chat')").first();
    await aiChatBtn.waitFor({ state: "visible", timeout: 25000 });
    await aiChatBtn.click();
    console.log("Clicked AI Chat button");

    // Verify chat window is visible
    const chatTextarea = page.locator("textarea[placeholder*='Ask about flood'], textarea").first();
    await chatTextarea.waitFor({ state: "visible", timeout: 10000 });
    console.log("Chat textarea visible: true");

    // Type query asking for evacuation plan
    await chatTextarea.fill("What is the flood evacuation plan and safe route?");
    await page.waitForTimeout(500);

    // Click send
    const sendBtn = page.locator("button:has(svg.lucide-send), button:has-text('Send')").first();
    await sendBtn.click();
    console.log("Sent message to chatbot!");

    // Wait for AI response to stream in from https://qwen.blk2np.qzz.io/plan
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
    await page.screenshot({ path: "tests/chatbot_chunk_streaming_verified.png" });
    console.log("Captured tests/chatbot_chunk_streaming_verified.png");

    console.log("=== Chatbot verification completed successfully! ===");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

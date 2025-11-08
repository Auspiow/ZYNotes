console.log("🔧 background.js 启动");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;

  // fetch 代理：在 service worker 中执行真正的 fetch（不受网页 CORS 限制）
  if (msg.action === "fetchProxyRequest" && msg.url) {
    (async () => {
      try {
        // 请根据需要调整 fetch 参数（method / headers / body 等）
        const res = await fetch(msg.url, {
          method: msg.method || "GET",
          credentials: "include", // 保持带 cookie
          headers: msg.headers || {},
          body: msg.body || undefined,
        });

        const contentType = res.headers.get("content-type") || "";
        let body;
        if (contentType.includes("application/json")) {
          body = await res.json();
        } else {
          // 返回文本（JSON 也会被当成文本 fallback）
          body = await res.text();
        }

        // 返回结构：与 content.js / inject.js 预期兼容
        sendResponse({
          ok: true,
          status: res.status,
          statusText: res.statusText,
          json: body,
        });
      } catch (err) {
        console.error("background.fetchProxyRequest failed:", err);
        sendResponse({
          ok: false,
          error: err && err.message ? err.message : String(err),
        });
      }
    })();

    // 表示我们将异步调用 sendResponse
    return true;
  }

  // 通知处理：页面导出完成，或其它通知消息（可自由扩展）
  if (msg.action === "notifyDone") {
    console.log("🔔 导出完成通知（来自 content/inject）：", msg.info);
    // 你可以在这里显示 Chrome Notification（需要 notifications 权限），或记录 telemetry。
    // 例如：chrome.notifications.create(...)
    sendResponse({ ok: true });
    return;
  }
});